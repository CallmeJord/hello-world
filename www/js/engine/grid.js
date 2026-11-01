// Tile grid: terrain, building occupancy, A* pathfinding, line of sight.
import { RNG, hashString } from './rng.js';

export const TILE = 32;
const SQRT2 = 1.4142135623730951;

export const TERRAIN = [
  { id: 'grass', walk: true, build: true, color: '#3f6b38' },
  { id: 'dirt', walk: true, build: false, color: '#80603e' },
  { id: 'water', walk: false, build: false, color: '#245a86' },
  { id: 'rock', walk: false, build: false, color: '#4d4a47' },
  { id: 'trees', walk: false, build: false, color: '#20401f' },
  { id: 'snow', walk: true, build: true, color: '#d5e0e8' },
  { id: 'stone', walk: true, build: true, color: '#7f8088' },
  { id: 'lava', walk: false, build: false, color: '#b8431f' },
  { id: 'ice', walk: true, build: false, color: '#a9d6ea' },
  { id: 'sand', walk: true, build: true, color: '#c8b27a' },
  { id: 'void', walk: false, build: false, color: '#0b0b12' }
];
export const TERRAIN_INDEX = Object.fromEntries(TERRAIN.map((t, i) => [t.id, i]));

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  clear() {
    this.k.length = 0;
    this.v.length = 0;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.terrain = new Uint8Array(n);
    this.block = new Uint8Array(n); // building occupancy count
    this.version = 0;
    this._g = new Float64Array(n);
    this._came = new Int32Array(n);
    this._open = new Uint32Array(n);
    this._closed = new Uint32Array(n);
    this._gen = 0;
    this._heap = new MinHeap();
    this._walkT = TERRAIN.map((t) => t.walk);
    this._buildT = TERRAIN.map((t) => t.build);
  }

  static fromMap(map) {
    const g = new Grid(map.width, map.height);
    paintTerrain(g, map.terrain || {}, map.id || map.name || 'map');
    return g;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }
  walkableTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const i = ty * this.w + tx;
    return this._walkT[this.terrain[i]] && this.block[i] === 0;
  }
  buildableTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const i = ty * this.w + tx;
    return this._buildT[this.terrain[i]] && this.block[i] === 0;
  }
  walkableAt(x, y) {
    return this.walkableTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }
  // Conservative check for a unit body of radius r centred at (x,y).
  fits(x, y, r) {
    const e = r * 0.7;
    return (
      this.walkableAt(x - e, y - e) &&
      this.walkableAt(x + e, y - e) &&
      this.walkableAt(x - e, y + e) &&
      this.walkableAt(x + e, y + e)
    );
  }
  setBlock(tx, ty, size, delta) {
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++)
        if (this.inBounds(x, y)) {
          const i = y * this.w + x;
          this.block[i] = Math.max(0, this.block[i] + delta);
        }
    this.version++;
  }

  los(x0, y0, x1, y1, r = 0) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(d / 8);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t, y = y0 + dy * t;
      if (r > 0 ? !this.fits(x, y, r) : !this.walkableAt(x, y)) return false;
    }
    return true;
  }

  nearestWalkable(x, y, r = 8) {
    if (this.fits(x, y, r)) return [x, y];
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (let rad = 1; rad < 12; rad++) {
      let best = null, bd = Infinity;
      for (let oy = -rad; oy <= rad; oy++)
        for (let ox = -rad; ox <= rad; ox++) {
          if (Math.abs(ox) !== rad && Math.abs(oy) !== rad) continue;
          const cx = (tx + ox + 0.5) * TILE, cy = (ty + oy + 0.5) * TILE;
          if (!this.fits(cx, cy, r)) continue;
          const dd = (cx - x) * (cx - x) + (cy - y) * (cy - y);
          if (dd < bd) {
            bd = dd;
            best = [cx, cy];
          }
        }
      if (best) return best;
    }
    return [x, y];
  }

  // A* from world (sx,sy) to world (gx,gy). Returns a smoothed list of world
  // waypoints; `.partial` is set when the goal was unreachable and the path
  // leads to the closest reachable tile instead.
  findPath(sx, sy, gx, gy, radius = 8, maxNodes = 8000) {
    const w = this.w, h = this.h;
    const stx = clamp(Math.floor(sx / TILE), 0, w - 1), sty = clamp(Math.floor(sy / TILE), 0, h - 1);
    let gtx = clamp(Math.floor(gx / TILE), 0, w - 1), gty = clamp(Math.floor(gy / TILE), 0, h - 1);
    const out = [];
    if (this.los(sx, sy, gx, gy, radius)) {
      out.push([gx, gy]);
      return out;
    }
    const gen = ++this._gen;
    if (gen > 0xfffffff0) {
      this._open.fill(0);
      this._closed.fill(0);
      this._gen = 1;
    }
    const G = this._g, came = this._came, open = this._open, closed = this._closed, heap = this._heap;
    heap.clear();
    const start = sty * w + stx, goal = gty * w + gtx;
    G[start] = 0;
    came[start] = -1;
    open[start] = this._gen;
    const hfn = (i) => {
      const x = i % w, y = (i - x) / w;
      const dx = Math.abs(x - gtx), dy = Math.abs(y - gty);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    heap.push(hfn(start), start);
    let best = start, bestH = hfn(start), found = false, expanded = 0;
    const cg = this._gen;
    while (heap.size > 0 && expanded < maxNodes) {
      const cur = heap.pop();
      if (closed[cur] === cg) continue;
      closed[cur] = cg;
      expanded++;
      if (cur === goal) {
        found = true;
        best = cur;
        break;
      }
      const hc = hfn(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const cx = cur % w, cy = (cur - cx) / w;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox, ny = cy + oy;
          if (!this.walkableTile(nx, ny)) continue;
          if (ox && oy && (!this.walkableTile(cx + ox, cy) || !this.walkableTile(cx, cy + oy))) continue;
          const ni = ny * w + nx;
          if (closed[ni] === cg) continue;
          const ng = G[cur] + (ox && oy ? SQRT2 : 1);
          if (open[ni] === cg && ng >= G[ni]) continue;
          open[ni] = cg;
          G[ni] = ng;
          came[ni] = cur;
          heap.push(ng + hfn(ni) * 1.0001, ni);
        }
    }
    // Reconstruct tile chain
    const chain = [];
    for (let i = best; i !== -1 && i !== start; i = came[i]) chain.push(i);
    chain.reverse();
    const pts = chain.map((i) => {
      const x = i % w;
      return [(x + 0.5) * TILE, ((i - x) / w + 0.5) * TILE];
    });
    if (found && pts.length) pts[pts.length - 1] = [gx, gy];
    else if (found) pts.push([gx, gy]);
    // String-pull smoothing (linear pass)
    let ax = sx, ay = sy;
    for (let j = 0; j < pts.length; j++) {
      if (j === pts.length - 1) {
        out.push(pts[j]);
        break;
      }
      if (!this.los(ax, ay, pts[j + 1][0], pts[j + 1][1], radius)) {
        out.push(pts[j]);
        ax = pts[j][0];
        ay = pts[j][1];
      }
    }
    if (!found) out.partial = true;
    return out;
  }

  // Flood fill from a set of start tiles; returns Uint8Array visited mask.
  flood(startTiles, extraBlocked = null) {
    const w = this.w, n = w * this.h;
    const seen = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    const ok = (x, y) => this.walkableTile(x, y) && !(extraBlocked && extraBlocked(x, y));
    for (const [x, y] of startTiles)
      if (ok(x, y) && !seen[y * w + x]) {
        seen[y * w + x] = 1;
        q[qt++] = y * w + x;
      }
    while (qh < qt) {
      const c = q[qh++];
      const cx = c % w, cy = (c - cx) / w;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [ox, oy] of nb) {
        const nx = cx + ox, ny = cy + oy;
        if (!ok(nx, ny)) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        q[qt++] = ni;
      }
    }
    return seen;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ------------------------------------------------------------------ painting
// Terrain is described by a fill plus a list of paint operations so maps stay
// small and easy to author by hand:
//   { rect: [x,y,w,h], t }        filled rectangle
//   { border: n, t }              frame around the map edge
//   { circle: [cx,cy,r], t }      disc
//   { path: [[x,y],...], w, t }   thick polyline (lanes, rivers)
//   { scatter: [x,y,w,h], t, density, avoid: [ids] }  random speckle
//   { rows: [..strings..], at: [x,y], legend: {char: id} }  ASCII block
function paintTerrain(grid, spec, seedKey) {
  const fill = TERRAIN_INDEX[spec.fill] ?? 0;
  grid.terrain.fill(fill);
  const rng = new RNG(spec.seed ?? hashString(String(seedKey)));
  const set = (x, y, t) => {
    if (grid.inBounds(x, y)) grid.terrain[y * grid.w + x] = t;
  };
  for (const op of spec.ops || []) {
    const t = TERRAIN_INDEX[op.t] ?? fill;
    if (op.rect) {
      const [x0, y0, w, h] = op.rect;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t);
    } else if (op.border != null) {
      const b = op.border;
      for (let y = 0; y < grid.h; y++)
        for (let x = 0; x < grid.w; x++)
          if (x < b || y < b || x >= grid.w - b || y >= grid.h - b) set(x, y, t);
    } else if (op.circle) {
      const [cx, cy, r] = op.circle;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r) set(x, y, t);
        }
    } else if (op.path) {
      const half = (op.w || 2) / 2;
      const pts = op.path;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const minx = Math.floor(Math.min(ax, bx) - half - 1), maxx = Math.ceil(Math.max(ax, bx) + half + 1);
        const miny = Math.floor(Math.min(ay, by) - half - 1), maxy = Math.ceil(Math.max(ay, by) + half + 1);
        for (let y = miny; y <= maxy; y++)
          for (let x = minx; x <= maxx; x++) {
            if (segDist(x + 0.5, y + 0.5, ax, ay, bx, by) <= half) set(x, y, t);
          }
      }
    } else if (op.scatter) {
      const [x0, y0, w, h] = op.scatter;
      const avoid = new Set((op.avoid || []).map((id) => TERRAIN_INDEX[id]));
      const dens = op.density ?? 0.1;
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
          const r = rng.next();
          if (!grid.inBounds(x, y)) continue;
          if (avoid.has(grid.terrain[y * grid.w + x])) continue;
          if (r < dens) set(x, y, t);
        }
    } else if (op.rows) {
      const [ox, oy] = op.at || [0, 0];
      const legend = op.legend || {};
      op.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const id = legend[row[x]];
          if (id != null && TERRAIN_INDEX[id] != null) set(ox + x, oy + y, TERRAIN_INDEX[id]);
        }
      });
    }
  }
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return Math.sqrt(ex * ex + ey * ey);
}
