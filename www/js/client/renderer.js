// Canvas renderer: prerendered terrain, interpolated units, effects, minimap.
import { TILE, TERRAIN } from '../engine/grid.js';
import { drawModel, BUILDINGS, shade } from './models.js';

const TAU = Math.PI * 2;

function hash2(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimap;
    this.mctx = minimap.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1.3 };
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.fx = [];
    this.face = new Map();
    this.selection = new Set();
    this.ghost = null; // { type, tx, ty, size, ok }
    this.box = null; // screen rect while box-selecting
    this.targeting = null;
    this.hoverId = 0;
    this.showRanges = false;
    this._miniT = 0;
  }

  attach(session) {
    this.session = session;
    this.game = session.game;
    this.local = session.local;
    this.fx = [];
    this.face.clear();
    this.selection.clear();
    this._buildTerrain();
    this._buildMiniBase();
    const g = this.game;
    const P = g.players[this.local];
    const camRegion = (P && P.start && g.regions[P.start]) || g.regions[g.rules.camera] || null;
    this.cam.x = camRegion ? camRegion.cx : g.W / 2;
    this.cam.y = camRegion ? camRegion.cy : g.H / 2;
    session.fxSinks.push((list) => this.addFx(list));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.dpr = dpr;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    const mr = this.mini.getBoundingClientRect();
    this.mini.width = Math.round(mr.width * dpr);
    this.mini.height = Math.round(mr.height * dpr);
    if (this.game) this._buildMiniBase();
    this.clampCam();
  }

  // ------------------------------------------------------------ camera
  screenToWorld(sx, sy) {
    return [this.cam.x + (sx - this.w / 2) / this.cam.zoom, this.cam.y + (sy - this.h / 2) / this.cam.zoom];
  }
  worldToScreen(x, y) {
    return [(x - this.cam.x) * this.cam.zoom + this.w / 2, (y - this.cam.y) * this.cam.zoom + this.h / 2];
  }
  clampCam() {
    if (!this.game) return;
    const g = this.game;
    const minZoom = Math.max(0.35, Math.min(this.w / g.W, this.h / g.H) * 0.9);
    this.cam.zoom = Math.max(minZoom, Math.min(3, this.cam.zoom));
    const hw = this.w / 2 / this.cam.zoom, hh = this.h / 2 / this.cam.zoom;
    const pad = 80;
    this.cam.x = g.W < hw * 2 ? g.W / 2 : Math.max(hw - pad, Math.min(g.W - hw + pad, this.cam.x));
    this.cam.y = g.H < hh * 2 ? g.H / 2 : Math.max(hh - pad, Math.min(g.H - hh + pad + 120 / this.cam.zoom, this.cam.y));
  }
  pan(dxScreen, dyScreen) {
    this.cam.x -= dxScreen / this.cam.zoom;
    this.cam.y -= dyScreen / this.cam.zoom;
    this.clampCam();
  }
  zoomAt(factor, sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.cam.zoom *= factor;
    this.clampCam();
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.clampCam();
  }
  centerOn(x, y) {
    this.cam.x = x;
    this.cam.y = y;
    this.clampCam();
  }

  // Interpolated render position of a unit.
  pos(u) {
    const a = this.session.alpha;
    return [u.px + (u.x - u.px) * a, u.py + (u.y - u.py) * a];
  }

  // Flying units are drawn this far above their ground position.
  lift(u) {
    return u.t.flying ? 16 : 0;
  }

  unitAt(wx, wy, slop = 10) {
    let best = null, bd = Infinity;
    for (const u of this.game.units) {
      if (u.dead) continue;
      const [x, y0] = this.pos(u);
      const y = y0 - this.lift(u);
      const r = u.radius + slop / Math.min(1.5, this.cam.zoom);
      const d = (x - wx) * (x - wx) + (y - wy) * (y - wy);
      if (d < r * r && d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ terrain
  _buildTerrain() {
    const g = this.game, grid = g.grid;
    const scale = Math.min(1, 4096 / Math.max(g.W, g.H));
    const c = document.createElement('canvas');
    c.width = Math.ceil(g.W * scale);
    c.height = Math.ceil(g.H * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    const T = TILE;
    const id = (x, y) => (grid.inBounds(x, y) ? TERRAIN[grid.terrain[y * grid.w + x]].id : 'void');
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        const t = id(x, y);
        const base = TERRAIN[grid.terrain[y * grid.w + x]].color;
        const n = hash2(x, y);
        const ground = t === 'trees' ? '#2c4a26' : base;
        ctx.fillStyle = shade(ground, (n - 0.5) * 0.12);
        ctx.fillRect(x * T, y * T, T + 0.6, T + 0.6);
        for (let i = 0; i < 4; i++) {
          const k = hash2(x * 7 + i, y * 13 - i);
          const px = x * T + hash2(x + i * 31, y) * T, py = y * T + hash2(x, y + i * 17) * T;
          if (t === 'grass' || t === 'trees') {
            ctx.fillStyle = k > 0.5 ? 'rgba(120,170,80,0.35)' : 'rgba(20,50,20,0.3)';
            ctx.fillRect(px, py, 2, 3);
          } else if (t === 'dirt' || t === 'sand') {
            ctx.fillStyle = k > 0.5 ? 'rgba(255,230,190,0.18)' : 'rgba(40,25,10,0.25)';
            ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill();
          } else if (t === 'snow' || t === 'ice') {
            ctx.fillStyle = k > 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(120,150,180,0.18)';
            ctx.fillRect(px, py, 2, 2);
          } else if (t === 'water') {
            ctx.strokeStyle = 'rgba(160,210,255,0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.quadraticCurveTo(px, py - 2, px + 4, py); ctx.stroke();
          } else if (t === 'lava') {
            ctx.fillStyle = k > 0.5 ? 'rgba(255,220,80,0.5)' : 'rgba(60,10,0,0.4)';
            ctx.beginPath(); ctx.arc(px, py, 2.5, 0, TAU); ctx.fill();
          }
        }
        if (t === 'stone') {
          ctx.strokeStyle = 'rgba(40,40,48,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1);
          if ((x + y) % 2) {
            ctx.beginPath(); ctx.moveTo(x * T + T / 2, y * T); ctx.lineTo(x * T + T / 2, y * T + T); ctx.stroke();
          }
        }
        if (t === 'rock') {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); ctx.moveTo(x * T + 4, y * T + T - 6); ctx.lineTo(x * T + T * n, y * T + 5); ctx.lineTo(x * T + T - 4, y * T + T - 8); ctx.fill();
        }
      }
    // Edges: shadow where walkable ground meets a blocking tile, shores on water.
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        const t = id(x, y);
        const walk = TERRAIN[grid.terrain[y * grid.w + x]].walk;
        if (!walk) continue;
        const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (const [ox, oy] of sides) {
          const nt = id(x + ox, y + oy);
          if (nt === t) continue;
          const ninfo = TERRAIN.find((q) => q.id === nt);
          if (!ninfo || ninfo.walk) continue;
          ctx.fillStyle = nt === 'water' ? 'rgba(220,240,255,0.35)' : 'rgba(0,0,0,0.28)';
          const w = 4;
          if (ox === 1) ctx.fillRect(x * T + T - w, y * T, w, T);
          if (ox === -1) ctx.fillRect(x * T, y * T, w, T);
          if (oy === 1) ctx.fillRect(x * T, y * T + T - w, T, w);
          if (oy === -1) ctx.fillRect(x * T, y * T, T, w);
        }
      }
    // Trees on top so canopies overlap neighbouring tiles.
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        if (id(x, y) !== 'trees') continue;
        const n = 2 + Math.floor(hash2(x, y * 3) * 2);
        for (let i = 0; i < n; i++) {
          const tx = x * T + 6 + hash2(x * 11 + i, y) * (T - 12);
          const ty = y * T + 6 + hash2(x, y * 7 + i) * (T - 12);
          const r = 9 + hash2(x + i, y - i) * 6;
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.arc(tx + 3, ty + 4, r, 0, TAU); ctx.fill();
          const gr = ctx.createRadialGradient(tx - r * 0.4, ty - r * 0.4, 1, tx, ty, r);
          gr.addColorStop(0, '#4f8a3c');
          gr.addColorStop(1, '#173416');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(tx, ty, r, 0, TAU); ctx.fill();
        }
      }
    this.terrain = c;
    this.terrainScale = scale;
  }

  _buildMiniBase() {
    const g = this.game, grid = g.grid;
    const c = document.createElement('canvas');
    c.width = grid.w;
    c.height = grid.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(grid.w, grid.h);
    for (let i = 0; i < grid.w * grid.h; i++) {
      const col = TERRAIN[grid.terrain[i]].color;
      const n = parseInt(col.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.miniBase = c;
  }

  // ------------------------------------------------------------ fx
  addFx(list) {
    const now = performance.now() / 1000;
    for (const f of list) {
      if (f.p && !f.p.includes(this.local)) continue;
      switch (f.k) {
        case 'msg':
        case 'end':
          break; // handled by HUD
        default:
          this.fx.push({ ...f, t0: now });
      }
    }
    if (this.fx.length > 600) this.fx.splice(0, this.fx.length - 600);
  }

  // ------------------------------------------------------------ draw
  draw() {
    const ctx = this.ctx, g = this.game, cam = this.cam, dpr = this.dpr;
    const now = performance.now() / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a10';
    ctx.fillRect(0, 0, this.w, this.h);
    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - cam.x * z), dpr * (this.h / 2 - cam.y * z));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, 0, 0, this.terrain.width, this.terrain.height, 0, 0, g.W, g.H);

    const [vx0, vy0] = this.screenToWorld(-60, -60);
    const [vx1, vy1] = this.screenToWorld(this.w + 60, this.h + 60);

    // Heal zones & build zones
    for (const z2 of g.rules.healZones || []) {
      const r = g.regions[z2.region];
      if (!r) continue;
      const gr = ctx.createRadialGradient(r.cx, r.cy, 4, r.cx, r.cy, Math.max(r.x1 - r.x0, r.y1 - r.y0) * 0.75);
      gr.addColorStop(0, 'rgba(120,255,160,0.28)');
      gr.addColorStop(1, 'rgba(120,255,160,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(r.x0 - 40, r.y0 - 40, r.x1 - r.x0 + 80, r.y1 - r.y0 + 80);
    }
    if (this.ghost) this._drawBuildZones(ctx);

    // Units (sorted by y, buildings slightly behind)
    const vis = [];
    for (const u of g.units) {
      if (u.dead) continue;
      const [x, y] = this.pos(u);
      if (x < vx0 - 60 || x > vx1 + 60 || y < vy0 - 60 || y > vy1 + 60) continue;
      vis.push([u, x, y]);
    }
    const depth = (e) => e[2] - (e[0].building ? 20 : 0) + (e[0].t.flying ? 100000 : 0);
    vis.sort((a, b) => depth(a) - depth(b));

    // selection rings
    for (const [u, x, y] of vis) {
      const sel = this.selection.has(u.id);
      if (!sel && this.hoverId !== u.id) continue;
      const enemy = g.areEnemies(this.local, u.owner);
      const col = enemy ? '#ff5050' : g.players[u.owner].team === g.players[this.local]?.team ? (u.owner === this.local ? '#5dff7a' : '#ffe14a') : '#ffe14a';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 / Math.min(z, 1.6);
      ctx.beginPath();
      ctx.ellipse(x, y + u.radius * 0.25, u.radius + 5, (u.radius + 5) * 0.8, 0, 0, TAU);
      ctx.stroke();
      if (sel && (this.showRanges || u.building) && u.t.damage) {
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,200,80,0.75)';
        ctx.beginPath();
        ctx.arc(x, y, u.s.range + u.radius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // shadows
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const [u, x, y] of vis) {
      if (u.building) continue;
      ctx.beginPath();
      if (u.t.flying) ctx.ellipse(x + 6, y + 6, u.radius * 0.8, u.radius * 0.4, 0, 0, TAU);
      else ctx.ellipse(x + 2, y + u.radius * 0.55, u.radius * 0.95, u.radius * 0.5, 0, 0, TAU);
      ctx.fill();
    }

    for (const [u, x, y] of vis) this._drawUnit(ctx, u, x, y, now);

    // projectiles
    const a = this.session.alpha;
    for (const p of g.projectiles) {
      const x = p.px + (p.x - p.px) * a, y = p.py + (p.y - p.py) * a;
      const dx = p.x - p.px, dy = p.y - p.py;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - dx * 1.5, y - dy * 1.5);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size * 0.75, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'butt';

    this._drawFx(ctx, now);
    this._drawBars(ctx, vis);
    if (this.ghost) this._drawGhost(ctx);

    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.box) {
      const b = this.box;
      ctx.fillStyle = 'rgba(93,255,122,0.12)';
      ctx.strokeStyle = '#5dff7a';
      ctx.lineWidth = 1.5;
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    if (now - this._miniT > 0.1) {
      this._miniT = now;
      this.drawMinimap(now);
    }
  }

  _drawUnit(ctx, u, x, y, now) {
    const g = this.game;
    const P = g.players[u.owner];
    let face = this.face.get(u.id);
    if (u.fdx || u.fdy) {
      const target = Math.atan2(u.fdy, u.fdx);
      if (face == null) face = target;
      let d = target - face;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      face += d * 0.25;
      this.face.set(u.id, face);
    }
    face = face || 0;
    ctx.save();
    // attack lunge
    const since = g.tick - u.atkTick;
    let ox = 0, oy = 0;
    if (since >= 0 && since < 4 && u.s.range < 40 && !u.building) {
      const k = Math.sin((since / 4) * Math.PI) * 4;
      ox = Math.cos(face) * k;
      oy = Math.sin(face) * k;
    }
    // walk bob
    const moving = u.vx !== 0 || u.vy !== 0;
    const bob = moving ? Math.sin(now * 14 + u.id) * 1.2 : 0;
    const lift = this.lift(u);
    ctx.translate(x + ox, y + oy + (lift ? -lift + Math.sin(now * 3 + u.id) * 2 : bob));
    const alpha = u.expires ? 0.75 + 0.25 * Math.sin(now * 4) : 1;
    drawModel(ctx, u.t.model, u.radius, P.color, u.t.color, face, now + u.id * 0.37, { alpha, tier: u.t.tier });
    // buff indicators
    for (const b of u.buffs) {
      if (b.stun) {
        ctx.fillStyle = '#ffe066';
        for (let i = 0; i < 3; i++) {
          const an = now * 5 + (i * TAU) / 3;
          ctx.beginPath();
          ctx.arc(Math.cos(an) * u.radius * 0.8, -u.radius - 4 + Math.sin(an) * 3, 2, 0, TAU);
          ctx.fill();
        }
      } else if (b.color) {
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, u.radius + 3, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (u.t.shop) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('SHOP', 0, -u.radius - 10);
    }
    ctx.restore();
  }

  _drawBars(ctx, vis) {
    const g = this.game;
    const z = this.cam.zoom;
    const showAll = z > 0.7;
    for (const [u, x, y] of vis) {
      if (u.t.invulnerable) continue;
      const damaged = u.hp < u.s.maxHp - 0.5;
      const hero = !!u.t.hero;
      if (!hero && !u.building && !damaged && !this.selection.has(u.id)) continue;
      if (!showAll && !hero && !u.building) continue;
      const w = Math.max(18, u.radius * 2.2), h = hero ? 4 : 3;
      const bx = x - w / 2, by = y - this.lift(u) - u.radius - (hero ? 12 : 8);
      const f = Math.max(0, u.hp / u.s.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2 + (hero && u.s.maxMana ? 3 : 0));
      ctx.fillStyle = f > 0.6 ? '#4ee35a' : f > 0.3 ? '#f2d33a' : '#f04a3a';
      if (g.areEnemies(this.local, u.owner) && !hero) ctx.fillStyle = f > 0.3 ? '#e8533f' : '#ff2a1a';
      ctx.fillRect(bx, by, w * f, h);
      if (hero && u.s.maxMana) {
        ctx.fillStyle = '#4a8cff';
        ctx.fillRect(bx, by + h + 1, w * (u.mana / u.s.maxMana), 2);
      }
      if (hero) {
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd54a';
        ctx.fillText(String(u.level), bx - 3, by + 5);
      }
    }
  }

  _drawFx(ctx, now) {
    const g = this.game;
    const keep = [];
    for (const f of this.fx) {
      const age = now - f.t0;
      let dur = f.dur || 0.6;
      if (f.k === 'text') dur = f.gold ? 1.2 : 0.9;
      if (f.k === 'death') dur = 0.9;
      if (f.k === 'levelup' || f.k === 'revive') dur = 1.2;
      if (f.k === 'ping') dur = 3;
      if (f.k === 'order') dur = 0.5;
      if (f.k === 'bolt') dur = 0.25;
      if (f.k === 'swing') dur = 0.2;
      if (f.k === 'telegraph') dur = f.dur;
      if (age > dur) continue;
      keep.push(f);
      const k = age / dur;
      ctx.save();
      switch (f.k) {
        case 'text':
          ctx.globalAlpha = 1 - k * k;
          ctx.font = `bold ${f.gold ? 12 : 11}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(f.text, f.x, f.y - k * 18);
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, f.x, f.y - k * 18);
          break;
        case 'ring':
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * Math.min(1, k * 2)), 0, TAU);
          ctx.stroke();
          if (f.fill) {
            ctx.globalAlpha = (1 - k) * 0.25;
            ctx.fillStyle = f.color;
            ctx.fill();
          }
          break;
        case 'telegraph':
          ctx.globalAlpha = 0.25 + 0.25 * Math.sin(age * 20);
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * k, 0, TAU);
          ctx.stroke();
          break;
        case 'bolt': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(f.x1, f.y1);
          const segs = 6;
          for (let i = 1; i < segs; i++) {
            const t = i / segs;
            const jx = (hash2(i, Math.floor(now * 30)) - 0.5) * 12, jy = (hash2(Math.floor(now * 30), i) - 0.5) * 12;
            ctx.lineTo(f.x1 + (f.x2 - f.x1) * t + jx, f.y1 + (f.y2 - f.y1) * t + jy);
          }
          ctx.lineTo(f.x2, f.y2);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
          break;
        }
        case 'hit':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 3 + k * 6, 0, TAU);
          ctx.fill();
          break;
        case 'swing': {
          const u = g.unitById.get(f.id);
          if (!u) break;
          const [ux, uy] = this.pos(u);
          const an = Math.atan2(f.y - uy, f.x - ux);
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ux, uy, u.radius + 6, an - 0.9 + k * 1.2, an - 0.2 + k * 1.2);
          ctx.stroke();
          break;
        }
        case 'death': {
          ctx.globalAlpha = 1 - k;
          const n = f.building ? 14 : 8;
          for (let i = 0; i < n; i++) {
            const an = (i / n) * TAU + hash2(i, Math.floor(f.x)) * 0.8;
            const d = (f.r + 8) * k * (0.6 + hash2(i, Math.floor(f.y)) * 0.8) * (f.building ? 2 : 1.3);
            ctx.fillStyle = i % 2 ? f.color : f.building ? '#7a7066' : '#3a1010';
            ctx.fillRect(f.x + Math.cos(an) * d - 2, f.y + Math.sin(an) * d - 2, 4, 4);
          }
          break;
        }
        case 'levelup':
        case 'revive': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#ffd54a';
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, 10 + k * 30 + i * 6, 0, TAU);
            ctx.stroke();
          }
          if (f.k === 'levelup') {
            ctx.font = 'bold 12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffd54a';
            ctx.fillText('LEVEL UP!', f.x, f.y - 26 - k * 12);
          }
          break;
        }
        case 'blink':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = f.color;
          for (let i = 0; i < 10; i++) {
            const an = (i / 10) * TAU;
            ctx.beginPath();
            ctx.arc(f.x + Math.cos(an) * k * 26, f.y + Math.sin(an) * k * 26, 2.5, 0, TAU);
            ctx.fill();
          }
          break;
        case 'cast':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 14 + k * 14, 0, TAU);
          ctx.stroke();
          break;
        case 'build':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#ffe9a8';
          ctx.lineWidth = 2;
          ctx.strokeRect(f.x - f.r - k * 10, f.y - f.r - k * 10, (f.r + k * 10) * 2, (f.r + k * 10) * 2);
          break;
        case 'order': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.attack ? '#ff5050' : '#5dff7a';
          ctx.lineWidth = 2;
          const s = 10 * (1 - k * 0.6);
          ctx.beginPath();
          ctx.moveTo(f.x - s, f.y - s); ctx.lineTo(f.x + s, f.y + s);
          ctx.moveTo(f.x + s, f.y - s); ctx.lineTo(f.x - s, f.y + s);
          ctx.stroke();
          break;
        }
        case 'ping':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, ((age * 60 + i * 30) % 60) + 10, 0, TAU);
            ctx.stroke();
          }
          break;
        default:
          break;
      }
      ctx.restore();
    }
    this.fx = keep;
  }

  _drawBuildZones(ctx) {
    const g = this.game;
    const P = g.players[this.local];
    const zones = g.rules.buildZones && (g.rules.buildZones[P.key] || g.rules.buildZones.all);
    if (!zones) return;
    ctx.strokeStyle = 'rgba(255,233,168,0.5)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    for (const n of zones) {
      const r = g.regions[n];
      if (r) ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    ctx.setLineDash([]);
    // tile grid near the ghost
    const gh = this.ghost;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let x = gh.tx - 6; x <= gh.tx + 8; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE, (gh.ty - 6) * TILE);
      ctx.lineTo(x * TILE, (gh.ty + 8) * TILE);
      ctx.stroke();
    }
    for (let y = gh.ty - 6; y <= gh.ty + 8; y++) {
      ctx.beginPath();
      ctx.moveTo((gh.tx - 6) * TILE, y * TILE);
      ctx.lineTo((gh.tx + 8) * TILE, y * TILE);
      ctx.stroke();
    }
  }

  _drawGhost(ctx) {
    const gh = this.ghost, g = this.game;
    const t = g.content.units[gh.type];
    const s = gh.size;
    ctx.fillStyle = gh.ok ? 'rgba(93,255,122,0.25)' : 'rgba(255,80,80,0.3)';
    ctx.strokeStyle = gh.ok ? '#5dff7a' : '#ff5050';
    ctx.lineWidth = 2;
    ctx.fillRect(gh.tx * TILE, gh.ty * TILE, s * TILE, s * TILE);
    ctx.strokeRect(gh.tx * TILE, gh.ty * TILE, s * TILE, s * TILE);
    const cx = (gh.tx + s / 2) * TILE, cy = (gh.ty + s / 2) * TILE;
    ctx.save();
    ctx.translate(cx, cy);
    drawModel(ctx, t.model, t.radius, g.players[this.local].color, t.color, 0, 0, { alpha: 0.6 });
    ctx.restore();
    if (t.range && t.damage) {
      ctx.strokeStyle = 'rgba(255,200,80,0.75)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, t.range + t.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawMinimap(now) {
    const ctx = this.mctx, g = this.game;
    const W = this.mini.width, H = this.mini.height;
    if (!W || !H || !this.miniBase) return;
    const s = Math.min(W / g.W, H / g.H);
    const ox = (W - g.W * s) / 2, oy = (H - g.H * s) / 2;
    this._mini = { s, ox, oy };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBase, ox, oy, g.W * s, g.H * s);
    for (const u of g.units) {
      if (u.dead) continue;
      const P = g.players[u.owner];
      const sz = Math.max(2, (u.building ? u.radius * 1.4 : u.t.hero ? 14 : 8) * s * this.dpr * 0.6);
      ctx.fillStyle = u.owner === this.local ? '#5dff7a' : P.color;
      ctx.fillRect(ox + u.x * s - sz / 2, oy + u.y * s - sz / 2, sz, sz);
      if (u.t.hero) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + u.x * s - sz / 2, oy + u.y * s - sz / 2, sz, sz);
      }
    }
    for (const f of this.fx) {
      if (f.k !== 'ping') continue;
      const age = now - f.t0;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox + f.x * s, oy + f.y * s, 4 + ((age * 20) % 14), 0, TAU);
      ctx.stroke();
    }
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.w, this.h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
  }

  minimapToWorld(mx, my) {
    const m = this._mini;
    if (!m) return null;
    return [(mx * this.dpr - m.ox) / m.s, (my * this.dpr - m.oy) / m.s];
  }
}

export { BUILDINGS };
