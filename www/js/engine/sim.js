// Deterministic game simulation. Every client runs this identically from the
// same seed + command stream (lockstep). Rules for determinism:
//   * only + - * / sqrt floor round min max abs on numbers (no trig/pow)
//   * all randomness via this.rng
//   * iteration in insertion order only (arrays / Map)
import { RNG } from './rng.js';
import { Grid, TILE } from './grid.js';
import { TriggerSystem } from './triggers.js';
import { buildContent, lv } from './content.js';
import { updateBots } from './ai.js';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const TICKS_PER_TURN = 2;
export const MAX_LEVEL = 10;
export const XP_TABLE = [0, 120, 300, 540, 840, 1200, 1620, 2100, 2640, 3240];
export const ITEM_SLOTS = 6;
export const SHOP_RANGE = 160;
const MAX_UNITS = 1500;
const XP_RANGE = 320;
const LEASH = 260;
const CELL = 96;

export const PLAYER_COLORS = ['#e8433f', '#3f7fe8', '#2fc4a8', '#9a4fe0', '#f2d33a', '#f08a2c',
  '#4fd14a', '#ea6fb4', '#9aa0a6', '#7fd3f0', '#1f6b3a', '#8a5a2b'];

const sec = (s) => Math.round(s * TICK_RATE);

export class Game {
  constructor(map, opts = {}) {
    this.map = map;
    this.debug = !!opts.debug;
    this.content = buildContent(map);
    this.rules = { sellRatio: 0.75, ...(map.rules || {}) };
    this.seed = opts.seed >>> 0 || 1;
    this.rng = new RNG(this.seed);
    this.grid = Grid.fromMap(map);
    this.W = map.width * TILE;
    this.H = map.height * TILE;
    this.tick = 0;
    this.units = [];
    this.unitById = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.scheduled = [];
    this._seq = 0;
    this.timers = [];
    this.fx = [];
    this.vars = JSON.parse(JSON.stringify(map.variables || {}));
    this.ended = null;
    this.repathBudget = 0;

    this.regions = {};
    for (const [name, r] of Object.entries(map.regions || {})) {
      const [x, y, w, h] = r;
      this.regions[name] = {
        name, tx: x, ty: y, tw: w, th: h,
        x0: x * TILE, y0: y * TILE, x1: (x + w) * TILE, y1: (y + h) * TILE,
        cx: (x + w / 2) * TILE, cy: (y + h / 2) * TILE
      };
    }
    // Regions that need per-tick membership tracking (enter events, heal zones)
    const tracked = new Set();
    for (const t of map.triggers || []) if (t.event && t.event.type === 'unitEntersRegion' && t.event.region) tracked.add(t.event.region);
    for (const z of this.rules.healZones || []) tracked.add(z.region);
    this._tracked = [...tracked].filter((n) => this.regions[n]).slice(0, 30);

    this._cw = Math.ceil(this.W / CELL);
    this._ch = Math.ceil(this.H / CELL);
    this._cells = Array.from({ length: this._cw * this._ch }, () => []);

    this._initPlayers(opts.slots || []);
    for (const pu of map.units || []) {
      const owner = this.playerByKey[pu.owner];
      if (!owner) continue;
      const u = this.createUnit(pu.type, owner.index, pu.at[0] * TILE, pu.at[1] * TILE, {
        guard: owner.ctrl === 'computer' && pu.guard !== false
      });
      if (u && pu.id) u.tag = pu.id;
    }
    this.triggers = new TriggerSystem(this, map.triggers || []);
    this.triggers.fire('mapInit', {});
  }

  get time() {
    return this.tick / TICK_RATE;
  }

  _initPlayers(slots) {
    this.players = [];
    this.playerByKey = {};
    (this.map.players || []).forEach((mp, i) => {
      const isSlot = mp.type !== 'computer';
      const s = slots[i] || {};
      const ctrl = isSlot ? s.ctrl || (mp.ai ? 'bot' : 'empty') : 'computer';
      const name = s.name || mp.name || (ctrl === 'bot' ? `Bot ${i + 1}` : isSlot ? `Player ${i + 1}` : mp.key);
      const P = {
        index: i, key: mp.key, name, team: mp.team || mp.key,
        color: mp.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
        ctrl, slot: isSlot, passive: !!mp.passive,
        gold: mp.gold ?? (isSlot ? this.rules.startGold ?? 0 : 0),
        start: mp.start || null, aiPath: mp.aiPath || null, defend: mp.defend || null,
        hero: 0, kills: 0, deaths: 0, left: false, bot: { state: 'push' }
      };
      this.players.push(P);
      this.playerByKey[P.key] = P;
    });
  }

  areEnemies(a, b) {
    if (a === b || a < 0 || b < 0) return false;
    const A = this.players[a], B = this.players[b];
    return A.team !== B.team && !A.passive && !B.passive;
  }

  // ------------------------------------------------------------ units
  createUnit(typeId, owner, x, y, o = {}) {
    const t = this.content.units[typeId];
    if (!t || !this.players[owner] || this.units.length >= MAX_UNITS) return null;
    const hpMul = o.hpMul || 1;
    const u = {
      id: this.nextId++, type: typeId, t, owner,
      x, y, px: x, py: y, vx: 0, vy: 0, fdx: 1, fdy: 0, radius: t.radius,
      baseHp: t.hp * hpMul, hp: 1, mana: 0, level: 1, xp: 0, skillPoints: t.hero ? 1 : 0,
      abilities: t.abilities.filter((id) => this.content.abilities[id]).map((id) => ({ id, level: t.hero ? 0 : 1, cd: 0 })),
      items: t.hero ? new Array(ITEM_SLOTS).fill(null) : null,
      buffs: [], order: { type: t.building || !t.speed ? 'hold' : 'idle' }, target: 0, attackCd: 0, atkTick: -99,
      path: null, pi: 0, pgx: 0, pgy: 0, pver: -1, stuck: 0,
      dead: false, removed: false, building: !!t.building, fp: null,
      guard: null, returning: false,
      expires: o.duration ? this.tick + sec(o.duration) : 0,
      bountyMul: o.bountyMul ?? 1, invested: t.cost || 0, reviveTick: 0, regions: 0,
      s: null, statsDirty: true, lastHitOwner: -1, born: this.tick
    };
    if (u.building) {
      const sz = t.building.size || 1;
      const tx = Math.round(x / TILE - sz / 2), ty = Math.round(y / TILE - sz / 2);
      u.fp = [tx, ty, sz];
      u.x = (tx + sz / 2) * TILE;
      u.y = (ty + sz / 2) * TILE;
      this.grid.setBlock(tx, ty, sz, 1);
    } else {
      const p = t.flying ? [clamp(x, 4, this.W - 4), clamp(y, 4, this.H - 4)] : this.grid.nearestWalkable(clamp(x, 4, this.W - 4), clamp(y, 4, this.H - 4), u.radius);
      u.x = p[0];
      u.y = p[1];
    }
    if (o.guard) u.guard = [u.x, u.y];
    u.px = u.x;
    u.py = u.y;
    this._refreshStats(u);
    u.hp = u.s.maxHp;
    u.mana = u.s.maxMana;
    this.units.push(u);
    this.unitById.set(u.id, u);
    const P = this.players[owner];
    if (t.hero && P.slot && !P.hero) P.hero = u.id;
    return u;
  }

  removeUnit(u) {
    if (u.removed) return;
    if (u.building && !u.dead && u.fp) this.grid.setBlock(u.fp[0], u.fp[1], u.fp[2], -1);
    u.dead = true;
    u.removed = true;
    const P = this.players[u.owner];
    if (P.hero === u.id) P.hero = 0;
  }

  _refreshStats(u) {
    const t = u.t, h = t.hero, L = u.level - 1;
    const old = u.s;
    let maxHp = u.baseHp + (h ? h.hpPerLevel * L : 0);
    let maxMana = (t.mana || 0) + (h ? h.manaPerLevel * L : 0);
    let dmgAdd = h ? h.dmgPerLevel * L : 0;
    let armor = (t.armor || 0) + (h ? h.armorPerLevel * L : 0);
    let speed = t.speed || 0, speedMult = 1, cdMult = 1;
    let hpRegen = t.hpRegen + (h ? 0.12 * L : 0), manaRegen = t.manaRegen + (h ? 0.06 * L : 0);
    let stunned = false, evasion = 0, crit = null, lifesteal = 0, attackSpeed = 0;
    if (u.items) {
      for (const it of u.items) {
        if (!it) continue;
        const d = this.content.items[it.id];
        if (!d) continue;
        maxHp += d.hp || 0;
        maxMana += d.mana || 0;
        dmgAdd += d.dmg || 0;
        armor += d.armor || 0;
        speed += d.speed || 0;
        hpRegen += d.hpRegen || 0;
        manaRegen += d.manaRegen || 0;
        attackSpeed += d.attackSpeed || 0;
        lifesteal += d.lifesteal || 0;
      }
    }
    for (const b of u.buffs) {
      dmgAdd += b.dmgAdd || 0;
      armor += b.armorAdd || 0;
      speed += b.speedAdd || 0;
      if (b.speedMult) speedMult *= b.speedMult;
      if (b.cdMult) cdMult *= b.cdMult;
      if (b.stun) stunned = true;
    }
    for (const a of u.abilities) {
      if (a.level <= 0) continue;
      const d = this.content.abilities[a.id];
      if (!d || !d.passive) continue;
      const e = d.effect || {};
      const L2 = a.level - 1;
      if (e.type === 'crit') crit = { chance: lv(e.chance, L2), mult: lv(e.mult, L2) };
      else if (e.type === 'evasion') evasion = 1 - (1 - evasion) * (1 - lv(e.chance, L2));
      else if (e.type === 'lifesteal') lifesteal += lv(e.amount, L2);
    }
    cdMult /= 1 + attackSpeed;
    const dmg = t.damage || [0, 0];
    u.s = {
      maxHp, maxMana, armor, dmgMin: dmg[0] + dmgAdd, dmgMax: dmg[1] + dmgAdd,
      range: t.range || 0, speed: Math.max(0, speed * speedMult), cdMult, hpRegen, manaRegen,
      stunned, evasion, crit, lifesteal
    };
    if (old && old.maxHp > 0 && old.maxHp !== maxHp) u.hp = Math.min(maxHp, (u.hp / old.maxHp) * maxHp);
    if (old && old.maxMana !== maxMana) u.mana = Math.min(maxMana, u.mana);
    u.statsDirty = false;
  }

  addBuff(u, b) {
    if (u.dead || u.building) return;
    const i = u.buffs.findIndex((x) => x.id === b.id);
    if (i >= 0) {
      if (u.buffs[i].end > b.end) b.end = u.buffs[i].end;
      u.buffs.splice(i, 1);
    }
    u.buffs.push(b);
    this._refreshStats(u);
  }

  // Air/ground targeting: towers may be ground-only or air-only; melee units
  // can't reach flyers.
  canHit(u, e) {
    const t = u.t && u.t.targets ? u.t.targets : u.t && u.t.range > 40 ? 'both' : 'ground';
    if (e.t.flying) return t !== 'ground';
    return t !== 'air';
  }

  canAttack(u) {
    return !!(u.t.damage && !u.t.passive);
  }

  // ------------------------------------------------------------ queries
  _rebuildCells() {
    for (const c of this._cells) c.length = 0;
    const cw = this._cw, ch = this._ch;
    for (const u of this.units) {
      if (u.dead) continue;
      const cx = clamp(Math.floor(u.x / CELL), 0, cw - 1), cy = clamp(Math.floor(u.y / CELL), 0, ch - 1);
      this._cells[cy * cw + cx].push(u);
    }
  }

  query(x, y, r, fn) {
    const cw = this._cw, ch = this._ch;
    const x0 = clamp(Math.floor((x - r) / CELL), 0, cw - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, cw - 1);
    const y0 = clamp(Math.floor((y - r) / CELL), 0, ch - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, ch - 1);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const list = this._cells[cy * cw + cx];
        for (let i = 0; i < list.length; i++) if (!list[i].dead) fn(list[i]);
      }
  }

  // Edge-to-edge distance between two units.
  gap(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy) - a.radius - b.radius;
  }

  isTargetable(e) {
    return !e.dead && !e.t.invulnerable;
  }

  acquire(u, range) {
    let best = null, bs = Infinity;
    this.query(u.x, u.y, range + u.radius + 40, (e) => {
      if (e === u || !this.isTargetable(e) || !this.areEnemies(u.owner, e.owner) || !this.canHit(u, e)) return;
      // Computer lane/wave units ignore neutral camp guards unless provoked.
      if (e.guard && !u.guard && e.order.type !== 'attack' && this.players[u.owner].ctrl !== 'human') return;
      const d = this.gap(u, e);
      if (d > (u.guard ? Math.min(range, 110) : range)) return;
      const score = d + (e.building ? 140 : 0);
      if (score < bs) {
        bs = score;
        best = e;
      }
    });
    return best;
  }

  enemiesNear(x, y, r, owner, fn) {
    this.query(x, y, r + 40, (e) => {
      if (!this.isTargetable(e) || !this.areEnemies(owner, e.owner)) return;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= (r + e.radius) * (r + e.radius)) fn(e);
    });
  }

  alliesNear(x, y, r, owner, fn) {
    this.query(x, y, r + 40, (e) => {
      if (e.dead || this.areEnemies(owner, e.owner) || this.players[e.owner].passive) return;
      if (this.players[e.owner].team !== this.players[owner].team) return;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= (r + e.radius) * (r + e.radius)) fn(e);
    });
  }

  findShop(u) {
    let shop = null;
    this.query(u.x, u.y, SHOP_RANGE + 60, (s) => {
      if (shop || !s.t.shop || this.areEnemies(u.owner, s.owner)) return;
      if (this.gap(u, s) <= SHOP_RANGE) shop = s;
    });
    return shop;
  }

  // ------------------------------------------------------------ tick
  step() {
    this.tick++;
    this.repathBudget = 14;
    this._runScheduled();
    this.triggers.update();
    this._rebuildCells();
    if (this.tick % 5 === 0) updateBots(this);
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      u.px = u.x;
      u.py = u.y;
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) {
        if (u.reviveTick && this.tick >= u.reviveTick && !u.removed) this._revive(u);
        continue;
      }
      this._updateUnit(u);
    }
    this._separate();
    this._updateProjectiles();
    this._updateRegions();
    if (this.fx.length > 4000) this.fx.splice(0, this.fx.length - 2000);
    if (this.units.some((u) => u.removed)) {
      this.units = this.units.filter((u) => {
        if (u.removed) this.unitById.delete(u.id);
        return !u.removed;
      });
    }
  }

  schedule(delayTicks, fn) {
    const at = this.tick + Math.max(1, delayTicks | 0);
    const item = { at, seq: ++this._seq, fn };
    const s = this.scheduled;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].at <= at) lo = mid + 1;
      else hi = mid;
    }
    s.splice(lo, 0, item);
  }

  _runScheduled() {
    const s = this.scheduled;
    while (s.length && s[0].at <= this.tick) s.shift().fn();
  }

  message(text, recipients = null, duration = 6, color) {
    this.fx.push({ k: 'msg', text: String(text).slice(0, 300), p: recipients, dur: duration, color });
  }

  endGame(winners, text = '') {
    if (this.ended) return;
    this.ended = { winners: winners.map(String), tick: this.tick, text };
    this.fx.push({ k: 'end' });
  }

  // ------------------------------------------------------------ unit AI
  _updateUnit(u) {
    if (u.expires && this.tick >= u.expires) {
      this.kill(u, null, true);
      return;
    }
    if (u.buffs.length) {
      let changed = false;
      for (let i = u.buffs.length - 1; i >= 0; i--)
        if (u.buffs[i].end <= this.tick) {
          u.buffs.splice(i, 1);
          changed = true;
        }
      if (changed) u.statsDirty = true;
    }
    if (u.statsDirty) this._refreshStats(u);
    const s = u.s;
    if (u.hp < s.maxHp) u.hp = Math.min(s.maxHp, u.hp + (u.returning ? s.maxHp * 0.1 : s.hpRegen) * DT);
    if (s.maxMana > 0 && u.mana < s.maxMana) u.mana = Math.min(s.maxMana, u.mana + s.manaRegen * DT);
    if (u.attackCd > 0) u.attackCd -= DT;
    for (const a of u.abilities) if (a.cd > 0) a.cd -= DT;
    if (s.stunned) {
      u.vx = u.vy = 0;
      return;
    }
    const P = this.players[u.owner];
    if (u.t.income && (this.tick - u.born) % Math.max(1, sec(u.t.income.every || 10)) === 0 && this.tick > u.born) {
      const amt = u.t.income.amount || 0;
      P.gold += amt;
      this.fx.push({ k: 'text', x: u.x, y: u.y - 20, text: '+' + amt, color: '#ffd54a', p: [u.owner], gold: true });
    }
    if (u.abilities.length && (P.ctrl === 'computer' || P.ctrl === 'bot') && (this.tick + u.id) % 10 === 0) {
      if (this._autocast(u)) return;
    }
    const o = u.order;
    switch (o.type) {
      case 'idle': {
        u.vx = u.vy = 0;
        if (this.canAttack(u) && (this.tick + u.id) % 4 === 0) {
          const e = this.acquire(u, u.t.acquire);
          if (e) {
            u.order = { type: 'attack', target: e.id, auto: true, ax: u.guard ? u.guard[0] : u.x, ay: u.guard ? u.guard[1] : u.y, resume: o };
            break;
          }
        }
        if (u.goal && (this.tick + u.id) % 20 === 0) {
          const dx = u.goal[0] - u.x, dy = u.goal[1] - u.y;
          if (dx * dx + dy * dy > 150 * 150) {
            u.order = { type: u.goal[2], pts: [[u.goal[0], u.goal[1]]], i: 0, spread: 14 };
            u.path = null;
            break;
          }
        }
        if (u.guard && (this.tick + u.id) % 10 === 0) {
          const dx = u.guard[0] - u.x, dy = u.guard[1] - u.y;
          if (dx * dx + dy * dy > 30 * 30) {
            u.returning = true;
            u.order = { type: 'move', pts: [[u.guard[0], u.guard[1]]], i: 0, spread: 10 };
          }
        }
        break;
      }
      case 'hold': {
        u.vx = u.vy = 0;
        if (!this.canAttack(u)) break;
        let tgt = u.target ? this.unitById.get(u.target) : null;
        if (!tgt || !this.isTargetable(tgt) || this.gap(u, tgt) > s.range || !this.canHit(u, tgt)) {
          tgt = this.acquire(u, s.range);
          u.target = tgt ? tgt.id : 0;
        }
        if (tgt) {
          u.fdx = tgt.x - u.x;
          u.fdy = tgt.y - u.y;
          if (u.attackCd <= 0) this._doAttack(u, tgt);
        }
        break;
      }
      case 'move':
      case 'amove': {
        if (o.type === 'amove' && this.canAttack(u) && (this.tick + u.id) % 4 === 0) {
          const e = this.acquire(u, u.t.acquire);
          if (e) {
            u.order = { type: 'attack', target: e.id, auto: true, ax: u.x, ay: u.y, resume: o };
            break;
          }
        }
        const pt = o.pts[o.i];
        if (!pt || this._moveTo(u, pt[0], pt[1], o.i === o.pts.length - 1 ? o.spread : 20)) {
          o.i++;
          u.path = null;
          if (o.i >= o.pts.length) {
            u.order = { type: 'idle' };
            if (u.returning) {
              u.returning = false;
              u.hp = u.s.maxHp;
              u.mana = u.s.maxMana;
            }
          }
        }
        break;
      }
      case 'attack': {
        const tgt = this.unitById.get(o.target);
        if (!tgt || !this.isTargetable(tgt) || (!o.manual && !this.areEnemies(u.owner, tgt.owner))) {
          this._resume(u);
          break;
        }
        if (o.auto) {
          const dx = u.x - o.ax, dy = u.y - o.ay;
          if (dx * dx + dy * dy > LEASH * LEASH) {
            this._resume(u);
            break;
          }
          if ((this.tick + u.id) % 10 === 0 && (tgt.building || this.gap(u, tgt) > u.t.acquire)) {
            const b = this.acquire(u, u.t.acquire);
            if (b && b !== tgt && (!b.building || !tgt.building)) o.target = b.id;
          }
        }
        this._engage(u, tgt);
        break;
      }
      case 'cast': {
        const def = this.content.abilities[o.ab];
        const ab = u.abilities.find((a) => a.id === o.ab);
        if (!def || !ab || !this._castReady(u, ab, def)) {
          this._resume(u);
          break;
        }
        const range = lv(def.range || 0, ab.level - 1);
        let tx = o.x, ty = o.y, tgt = null;
        if (def.target === 'unit') {
          tgt = this.unitById.get(o.target);
          if (!tgt || tgt.dead) {
            this._resume(u);
            break;
          }
          tx = tgt.x;
          ty = tgt.y;
          if (this.gap(u, tgt) <= range) {
            this._execute(u, ab, def, tgt, tx, ty);
            this._resume(u);
            break;
          }
        } else {
          const dx = tx - u.x, dy = ty - u.y;
          if (dx * dx + dy * dy <= range * range || def.effect.type === 'blink') {
            this._execute(u, ab, def, null, tx, ty);
            this._resume(u);
            break;
          }
        }
        if (s.speed > 0) this._moveTo(u, tx, ty, 0);
        else this._resume(u);
        break;
      }
      default:
        u.order = { type: 'idle' };
    }
  }

  _resume(u) {
    const r = u.order.resume;
    u.order = r && r.type !== 'attack' ? r : { type: u.building || !u.t.speed ? 'hold' : 'idle' };
    u.path = null;
    if (u.order.type === 'idle' && u.guard) {
      const dx = u.guard[0] - u.x, dy = u.guard[1] - u.y;
      if (dx * dx + dy * dy > 30 * 30) {
        u.returning = true;
        u.order = { type: 'move', pts: [[u.guard[0], u.guard[1]]], i: 0, spread: 10 };
      }
    }
  }

  _engage(u, tgt) {
    u.fdx = tgt.x - u.x;
    u.fdy = tgt.y - u.y;
    if (this.gap(u, tgt) <= u.s.range) {
      u.vx = u.vy = 0;
      if (u.attackCd <= 0) this._doAttack(u, tgt);
    } else if (u.s.speed > 0) {
      this._moveTo(u, tgt.x, tgt.y, 0);
    } else this._resume(u);
  }

  orderPath(u, type, pts) {
    u.order = { type, pts: pts.map((p) => [p[0], p[1]]), i: 0, spread: 14 };
    u.path = null;
    u.returning = false;
    // Computer units remember their objective so they resume it after chasing.
    if (pts.length && this.players[u.owner].ctrl === 'computer') u.goal = [pts[pts.length - 1][0], pts[pts.length - 1][1], type];
  }

  _moveTo(u, gx, gy, arrive) {
    const dx = gx - u.x, dy = gy - u.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= arrive * arrive) {
      u.vx = u.vy = 0;
      return true;
    }
    if (u.t.flying) {
      const d = Math.sqrt(d2), step = u.s.speed * DT;
      const k = Math.min(step, d) / d;
      u.vx = dx * k;
      u.vy = dy * k;
      u.x = clamp(u.x + u.vx, u.radius, this.W - u.radius);
      u.y = clamp(u.y + u.vy, u.radius, this.H - u.radius);
      u.fdx = dx;
      u.fdy = dy;
      return d <= step;
    }
    const need = !u.path || u.pver !== this.grid.version || Math.abs(u.pgx - gx) > 24 || Math.abs(u.pgy - gy) > 24 || u.stuck > 12;
    if (need) {
      if (u.stuck > 12 && d2 < (arrive + 48) * (arrive + 48)) {
        u.stuck = 0;
        u.vx = u.vy = 0;
        return true;
      }
      if (this.repathBudget > 0) {
        this.repathBudget--;
        u.path = this.grid.findPath(u.x, u.y, gx, gy, u.radius);
        u.pi = 0;
        u.pgx = gx;
        u.pgy = gy;
        u.pver = this.grid.version;
        u.stuck = 0;
      } else if (!u.path) {
        u.vx = u.vy = 0;
        return false;
      }
    }
    const path = u.path;
    while (u.pi < path.length) {
      const p = path[u.pi];
      const ex = p[0] - u.x, ey = p[1] - u.y;
      if (ex * ex + ey * ey > 9) break;
      u.pi++;
    }
    let tx, ty;
    if (u.pi < path.length) {
      tx = path[u.pi][0];
      ty = path[u.pi][1];
    } else {
      if (path.partial) {
        u.vx = u.vy = 0;
        return true;
      }
      tx = gx;
      ty = gy;
    }
    const mx = tx - u.x, my = ty - u.y;
    const md = Math.sqrt(mx * mx + my * my);
    if (md < 0.01) {
      u.vx = u.vy = 0;
      return u.pi >= path.length;
    }
    const step = u.s.speed * DT;
    const k = Math.min(step, md) / md;
    const ox = u.x, oy = u.y;
    u.x += mx * k;
    u.y += my * k;
    this._terrainResolve(u, ox, oy);
    u.vx = u.x - ox;
    u.vy = u.y - oy;
    u.fdx = mx;
    u.fdy = my;
    if (u.vx * u.vx + u.vy * u.vy < step * step * 0.09) u.stuck++;
    else if (u.stuck > 0) u.stuck--;
    return false;
  }

  _terrainResolve(u, ox, oy) {
    const g = this.grid, r = u.radius;
    u.x = clamp(u.x, r, this.W - r);
    u.y = clamp(u.y, r, this.H - r);
    if (g.fits(u.x, u.y, r)) return;
    if (g.fits(u.x, oy, r)) {
      u.y = oy;
      return;
    }
    if (g.fits(ox, u.y, r)) {
      u.x = ox;
      return;
    }
    if (g.fits(ox, oy, r)) {
      u.x = ox;
      u.y = oy;
      return;
    }
    const p = g.nearestWalkable(u.x, u.y, r);
    u.x = p[0];
    u.y = p[1];
  }

  _separate() {
    const cw = this._cw, ch = this._ch, cells = this._cells;
    for (let cy = 0; cy < ch; cy++)
      for (let cx = 0; cx < cw; cx++) {
        const list = cells[cy * cw + cx];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.dead || a.building) continue;
          for (let ny = cy - 1; ny <= cy + 1; ny++) {
            if (ny < 0 || ny >= ch) continue;
            for (let nx = cx - 1; nx <= cx + 1; nx++) {
              if (nx < 0 || nx >= cw) continue;
              const other = cells[ny * cw + nx];
              for (let j = 0; j < other.length; j++) {
                const b = other[j];
                if (b.id <= a.id || b.dead || b.building || !a.t.flying !== !b.t.flying) continue;
                let dx = b.x - a.x, dy = b.y - a.y;
                const rr = a.radius + b.radius;
                let d2 = dx * dx + dy * dy;
                if (d2 >= rr * rr) continue;
                let d = Math.sqrt(d2);
                if (d < 0.01) {
                  dx = (((a.id * 7 + b.id * 13) % 11) - 5) * 0.1 + 0.05;
                  dy = 0.3;
                  d = Math.sqrt(dx * dx + dy * dy);
                }
                const push = Math.min((rr - d) * 0.5, 2.5);
                const nx2 = dx / d, ny2 = dy / d;
                const am = a.vx !== 0 || a.vy !== 0, bm = b.vx !== 0 || b.vy !== 0;
                let wa = am === bm ? 0.5 : am ? 0.2 : 0.8;
                if (a.order.type === 'hold') wa = 0.05;
                if (b.order.type === 'hold') wa = 0.95;
                this._nudge(a, -nx2 * push * 2 * wa, -ny2 * push * 2 * wa);
                this._nudge(b, nx2 * push * 2 * (1 - wa), ny2 * push * 2 * (1 - wa));
              }
            }
          }
        }
      }
  }

  _nudge(u, dx, dy) {
    const g = this.grid, r = u.radius;
    const nx = clamp(u.x + dx, r, this.W - r), ny = clamp(u.y + dy, r, this.H - r);
    if (u.t.flying) {
      u.x = nx;
      u.y = ny;
      return;
    }
    if (g.fits(nx, ny, r)) {
      u.x = nx;
      u.y = ny;
    } else if (g.fits(nx, u.y, r)) u.x = nx;
    else if (g.fits(u.x, ny, r)) u.y = ny;
  }

  // ------------------------------------------------------------ combat
  _doAttack(u, tgt) {
    const s = u.s;
    let dmg = this.rng.range(s.dmgMin, s.dmgMax);
    let crit = false;
    if (s.crit && this.rng.next() < s.crit.chance) {
      dmg *= s.crit.mult;
      crit = true;
    }
    if (tgt.building && u.t.buildingDmgMult) dmg *= u.t.buildingDmgMult;
    u.attackCd = u.t.cooldown * s.cdMult;
    u.atkTick = this.tick;
    const hit = { dmg, spell: false, onHit: u.t.onHit || null, splash: u.t.splash || 0, chain: u.t.chain || null, crit };
    if (u.t.projectile) {
      this._spawnProjectile(u, tgt, { ...hit, ...u.t.projectile });
    } else {
      if (u.s.range > 40) this.fx.push({ k: 'bolt', x1: u.x, y1: u.y, x2: tgt.x, y2: tgt.y, color: u.t.color || '#c9b6ff' });
      else this.fx.push({ k: 'swing', id: u.id, x: tgt.x, y: tgt.y });
      this._impact(u, tgt, tgt.x, tgt.y, hit);
    }
  }

  _spawnProjectile(src, tgt, o) {
    this.projectiles.push({
      x: src.x, y: src.y, px: src.x, py: src.y, target: tgt.id, tx: tgt.x, ty: tgt.y,
      speed: o.speed || 400, src: src.id, owner: src.owner, dmg: o.dmg, spell: !!o.spell,
      splash: o.splash || 0, onHit: o.onHit || null, chain: o.chain || null, stun: o.stun || 0,
      slow: o.slow || null, crit: !!o.crit, color: o.color || '#fff', size: o.size || 3, done: false
    });
  }

  _updateProjectiles() {
    if (!this.projectiles.length) return;
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      const t = this.unitById.get(p.target);
      const alive = t && !t.dead;
      if (alive) {
        p.tx = t.x;
        p.ty = t.y;
      }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.sqrt(dx * dx + dy * dy), step = p.speed * DT;
      if (d <= step + 2) {
        p.x = p.tx;
        p.y = p.ty;
        p.done = true;
        const src = this.unitById.get(p.src) || { id: p.src, owner: p.owner, dead: true, s: null, t: {} };
        this._impact(src, alive ? t : null, p.tx, p.ty, p);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  _impact(src, t, x, y, h) {
    const hitOne = (e, dmg) => {
      this.damage(e, dmg, src, h.spell, h.crit);
      if (e.dead) return;
      if (h.stun) this.addBuff(e, { id: 'stun', stun: true, end: this.tick + sec(h.stun), color: '#ffe066' });
      const slow = h.slow || (h.onHit && h.onHit.slow);
      if (slow) this.addBuff(e, { id: 'slow', speedMult: slow.mult, cdMult: 1 + (1 - slow.mult) * 0.5, end: this.tick + sec(slow.duration), color: '#8fe3ff' });
    };
    if (t) hitOne(t, h.dmg);
    if (h.splash > 0) {
      this.fx.push({ k: 'ring', x, y, r: h.splash, color: h.color || '#ffcf7a', dur: 0.3 });
      const victims = [];
      this.enemiesNear(x, y, h.splash, src.owner, (e) => {
        if (e !== t && !e.building && (!src.t || !src.t.id || this.canHit(src, e))) victims.push(e);
      });
      for (const e of victims) hitOne(e, h.dmg * 0.75);
    }
    if (t && h.chain) this._chain(src, t, h.dmg, h.chain, h.spell, h.color || '#c9b6ff', 0);
    if (!h.splash) this.fx.push({ k: 'hit', x, y, color: h.color || '#fff' });
  }

  _chain(src, first, dmg, ch, spell, color, L) {
    const hit = new Set([first.id]);
    let last = first, d = dmg;
    const bounces = lv(ch.bounces, L) || 0, falloff = ch.falloff ?? 0.85, range = lv(ch.range, L) || 100;
    for (let i = 0; i < bounces; i++) {
      d *= falloff;
      let best = null, bd = Infinity;
      this.enemiesNear(last.x, last.y, range, src.owner, (e) => {
        if (hit.has(e.id) || e.building || (src.t && src.t.id && !spell && !this.canHit(src, e))) return;
        const dx = e.x - last.x, dy = e.y - last.y, dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = e;
        }
      });
      if (!best) break;
      this.fx.push({ k: 'bolt', x1: last.x, y1: last.y, x2: best.x, y2: best.y, color });
      hit.add(best.id);
      this.damage(best, d, src, spell);
      last = best;
    }
  }

  damage(tgt, amount, src, spell = false, crit = false) {
    if (tgt.dead || tgt.t.invulnerable) return 0;
    if (!spell) {
      if (tgt.s.evasion > 0 && this.rng.next() < tgt.s.evasion) {
        this.fx.push({ k: 'text', x: tgt.x, y: tgt.y - 14, text: 'miss', color: '#ddd' });
        return 0;
      }
      const a = Math.max(0, tgt.s.armor);
      amount *= 1 - (0.06 * a) / (1 + 0.06 * a);
    }
    tgt.hp -= amount;
    if (src) tgt.lastHitOwner = src.owner;
    if (spell || crit) this.fx.push({ k: 'text', x: tgt.x, y: tgt.y - 14, text: String(Math.round(amount)) + (crit ? '!' : ''), color: crit ? '#ff5050' : '#b7a3ff' });
    if (src && !src.dead && !spell && src.s && src.s.lifesteal > 0) src.hp = Math.min(src.s.maxHp, src.hp + amount * src.s.lifesteal);
    if (tgt.hp <= 0) {
      this.kill(tgt, src);
      return amount;
    }
    // Retaliate / call for help when idle
    if (src && !src.dead && src.x != null && this.areEnemies(tgt.owner, src.owner)) {
      const respond = (v) => {
        if (v.returning || v.order.type !== 'idle' || !this.canAttack(v) || !v.s.speed) return;
        v.order = { type: 'attack', target: src.id, auto: true, ax: v.guard ? v.guard[0] : v.x, ay: v.guard ? v.guard[1] : v.y, resume: { type: 'idle' } };
      };
      respond(tgt);
      if (this.players[tgt.owner].ctrl === 'computer' && tgt.guard) this.alliesNear(tgt.x, tgt.y, 140, tgt.owner, respond);
    }
    return amount;
  }

  kill(u, src, silent = false) {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    u.vx = u.vy = 0;
    u.buffs.length = 0;
    u.statsDirty = true;
    u.order = { type: 'idle' };
    u.path = null;
    const killerOwner = src ? src.owner : u.lastHitOwner;
    this.fx.push({ k: 'death', x: u.x, y: u.y, r: u.radius, color: this.players[u.owner].color, model: u.t.model, building: u.building });
    if (u.building && u.fp) this.grid.setBlock(u.fp[0], u.fp[1], u.fp[2], -1);
    if (!silent && killerOwner >= 0 && this.areEnemies(killerOwner, u.owner)) {
      const KP = this.players[killerOwner];
      const bounty = Math.round((u.t.bounty || 0) * u.bountyMul + (u.t.hero ? 100 + 25 * u.level : 0));
      if (bounty > 0 && KP.ctrl !== 'computer') {
        KP.gold += bounty;
        this.fx.push({ k: 'text', x: u.x, y: u.y - 20, text: '+' + bounty, color: '#ffd54a', p: [killerOwner], gold: true });
      }
      if (u.t.hero) KP.kills++;
      const xp = u.t.hero ? 60 + 40 * u.level : u.t.xp || 0;
      if (xp > 0) {
        const heroes = [];
        const kteam = KP.team;
        this.query(u.x, u.y, XP_RANGE, (h) => {
          if (!h.t.hero || h.dead || this.players[h.owner].team !== kteam) return;
          const dx = h.x - u.x, dy = h.y - u.y;
          if (dx * dx + dy * dy <= XP_RANGE * XP_RANGE) heroes.push(h);
        });
        if (!heroes.length && src && src.t && src.t.hero && !src.dead) heroes.push(src);
        for (const h of heroes) this._gainXp(h, xp / heroes.length);
      }
    }
    if (u.t.hero) {
      this.players[u.owner].deaths++;
      const rv = this.rules.heroRevive;
      if (rv && !u.expires) u.reviveTick = this.tick + sec((rv.base ?? 5) + (rv.perLevel ?? 2) * u.level);
      else u.removed = true;
    } else u.removed = true;
    this.triggers.fire('unitDies', { unit: u, killer: src && src.x != null && !src.dead ? src : null, killerOwner });
  }

  _gainXp(h, amount) {
    if (h.level >= MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
      h.level++;
      h.skillPoints++;
      this._refreshStats(h);
      this.fx.push({ k: 'levelup', id: h.id, x: h.x, y: h.y });
      this.triggers.fire('heroLevel', { unit: h });
    }
  }

  _revive(u) {
    const P = this.players[u.owner];
    const r = P.start ? this.regions[P.start] : null;
    const x = r ? r.cx : u.x, y = r ? r.cy : u.y;
    const p = this.grid.nearestWalkable(x, y, u.radius);
    u.x = u.px = p[0];
    u.y = u.py = p[1];
    u.dead = false;
    u.reviveTick = 0;
    this._refreshStats(u);
    u.hp = u.s.maxHp;
    u.mana = u.s.maxMana;
    u.order = { type: 'idle' };
    u.attackCd = 0;
    this.fx.push({ k: 'revive', x: u.x, y: u.y });
    this.message(`${u.t.name} has returned to the fight.`, [u.owner], 4);
  }

  // ------------------------------------------------------------ abilities
  _castReady(u, ab, def) {
    if (ab.level <= 0 || def.passive || ab.cd > 0 || u.dead) return false;
    return u.mana >= lv(def.mana || 0, ab.level - 1);
  }

  canLearn(u, ab) {
    const def = this.content.abilities[ab.id];
    if (!def || !u.t.hero || u.skillPoints <= 0 || ab.level >= def.maxLevel) return false;
    if (def.ultimate) return u.level >= 6 + ab.level * 4;
    return u.level >= 1 + 2 * ab.level;
  }

  _execute(u, ab, def, tgt, x, y) {
    const L = ab.level - 1;
    const e = def.effect || {};
    u.mana -= lv(def.mana || 0, L);
    ab.cd = lv(def.cooldown || 0, L);
    u.atkTick = this.tick;
    const aoe = lv(def.aoe || 0, L);
    const color = e.color || u.t.color || '#fff';
    this.fx.push({ k: 'cast', id: u.id, x: u.x, y: u.y, color, icon: def.icon });
    switch (e.type) {
      case 'projectile':
        if (tgt) this._spawnProjectile(u, tgt, { dmg: lv(e.damage, L), spell: true, stun: lv(e.stun || 0, L), slow: e.slow ? { mult: lv(e.slow.mult, L), duration: lv(e.slow.duration, L) } : null, speed: e.speed, color, size: e.size || 5 });
        break;
      case 'area': {
        const cx = def.target === 'point' ? x : u.x, cy = def.target === 'point' ? y : u.y;
        const owner = u.owner;
        const apply = () => {
          this.fx.push({ k: 'ring', x: cx, y: cy, r: aoe, color, dur: 0.5, fill: true });
          const victims = [];
          this.enemiesNear(cx, cy, aoe, owner, (v) => victims.push(v));
          const src = this.unitById.get(u.id) || { id: u.id, owner, dead: true, s: null, t: {} };
          for (const v of victims) {
            this.damage(v, lv(e.damage, L), src, true);
            if (v.dead) continue;
            if (e.stun) this.addBuff(v, { id: 'stun', stun: true, end: this.tick + sec(lv(e.stun, L)), color: '#ffe066' });
            if (e.slow) {
              const m = lv(e.slow.mult, L);
              this.addBuff(v, { id: 'slow', speedMult: m, cdMult: 1 + (1 - m) * 0.5, end: this.tick + sec(lv(e.slow.duration, L)), color: '#8fe3ff' });
            }
          }
        };
        if (e.delay) {
          this.fx.push({ k: 'telegraph', x: cx, y: cy, r: aoe, color, dur: e.delay });
          this.schedule(sec(e.delay), apply);
        } else apply();
        break;
      }
      case 'heal':
        if (tgt && !tgt.dead) {
          const amt = Math.round(lv(e.amount || 0, L) + lv(e.pct || 0, L) * tgt.s.maxHp);
          tgt.hp = Math.min(tgt.s.maxHp, tgt.hp + amt);
          this.fx.push({ k: 'text', x: tgt.x, y: tgt.y - 16, text: '+' + amt, color: '#7dff8a' });
          this.fx.push({ k: 'ring', x: tgt.x, y: tgt.y, r: 24, color: '#7dff8a', dur: 0.5 });
        }
        break;
      case 'areaHeal': {
        const pct = lv(e.pct || 0, L), flat = lv(e.amount || 0, L);
        this.fx.push({ k: 'ring', x: u.x, y: u.y, r: aoe, color: '#fff3a6', dur: 0.8, fill: true });
        const list = [];
        this.alliesNear(u.x, u.y, aoe, u.owner, (a) => {
          if (!a.building) list.push(a);
        });
        for (const a of list) {
          a.hp = Math.min(a.s.maxHp, a.hp + flat + pct * a.s.maxHp);
          if (e.buff) this.addBuff(a, this._mkBuff(def.id, e.buff, L));
        }
        break;
      }
      case 'blink': {
        const range = lv(def.range || 0, L);
        let dx = x - u.x, dy = y - u.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range && d > 0) {
          dx = (dx / d) * range;
          dy = (dy / d) * range;
        }
        const p = this.grid.nearestWalkable(u.x + dx, u.y + dy, u.radius);
        this.fx.push({ k: 'blink', x: u.x, y: u.y, color });
        u.x = u.px = p[0];
        u.y = u.py = p[1];
        u.path = null;
        this.fx.push({ k: 'blink', x: u.x, y: u.y, color });
        break;
      }
      case 'buff': {
        const b = e.buff || {};
        if (e.who === 'self' || !aoe) this.addBuff(u, this._mkBuff(def.id, b, L));
        else {
          this.fx.push({ k: 'ring', x: u.x, y: u.y, r: aoe, color: b.color || color, dur: 0.6 });
          const list = [];
          this.alliesNear(u.x, u.y, aoe, u.owner, (a) => {
            if (!a.building) list.push(a);
          });
          for (const a of list) this.addBuff(a, this._mkBuff(def.id, b, L));
        }
        break;
      }
      case 'summon': {
        const n = lv(e.count, L) || 1;
        for (let i = 0; i < n; i++) {
          const s = this.createUnit(e.unit, u.owner, u.x + this.rng.range(-24, 24), u.y + this.rng.range(-24, 24), { duration: lv(e.duration || 30, L) });
          if (s) {
            this.fx.push({ k: 'blink', x: s.x, y: s.y, color });
            if (u.order.type === 'attack') s.order = { type: 'attack', target: u.order.target, auto: true, ax: s.x, ay: s.y, resume: { type: 'idle' } };
          }
        }
        break;
      }
      case 'chain':
        if (tgt) {
          this.fx.push({ k: 'bolt', x1: u.x, y1: u.y, x2: tgt.x, y2: tgt.y, color });
          this.damage(tgt, lv(e.damage, L), u, true);
          this._chain(u, tgt, lv(e.damage, L), e, true, color, L);
        }
        break;
      default:
        break;
    }
  }

  _mkBuff(id, b, L) {
    return {
      id, end: this.tick + sec(lv(b.duration || 10, L)), dmgAdd: lv(b.dmgAdd || 0, L), armorAdd: lv(b.armorAdd || 0, L),
      speedAdd: lv(b.speedAdd || 0, L), cdMult: lv(b.cdMult || 1, L), speedMult: lv(b.speedMult || 1, L), color: b.color
    };
  }

  // Simple auto-cast used by computer creeps and bot heroes.
  _autocast(u) {
    for (const ab of u.abilities) {
      const def = this.content.abilities[ab.id];
      if (!def || !this._castReady(u, ab, def)) continue;
      const L = ab.level - 1, e = def.effect || {};
      const range = lv(def.range || 0, L), aoe = lv(def.aoe || 0, L);
      if (def.target === 'none') {
        if (e.type === 'areaHeal') {
          let hurt = 0;
          this.alliesNear(u.x, u.y, aoe, u.owner, (a) => {
            if (!a.building && a.hp < a.s.maxHp * 0.6) hurt++;
          });
          if (hurt >= 2 || u.hp < u.s.maxHp * 0.35) return this._execute(u, ab, def, null, u.x, u.y), true;
        } else if (e.type === 'summon' || e.type === 'buff') {
          let n = 0;
          this.enemiesNear(u.x, u.y, 200, u.owner, () => n++);
          if (n > 0) return this._execute(u, ab, def, null, u.x, u.y), true;
        } else {
          let n = 0, hero = false;
          this.enemiesNear(u.x, u.y, aoe, u.owner, (v) => {
            if (!v.building) {
              n++;
              if (v.t.hero) hero = true;
            }
          });
          if (n >= (def.ultimate ? 3 : 2) || (hero && n >= 1)) return this._execute(u, ab, def, null, u.x, u.y), true;
        }
      } else if (def.target === 'unit') {
        if (def.targets === 'ally') {
          let best = null, br = 0.6;
          this.alliesNear(u.x, u.y, range, u.owner, (a) => {
            if (a.building) return;
            const r = a.hp / a.s.maxHp;
            if (r < br) {
              br = r;
              best = a;
            }
          });
          if (best) return this._execute(u, ab, def, best, best.x, best.y), true;
        } else {
          let best = null, bs = Infinity;
          this.enemiesNear(u.x, u.y, range + u.radius, u.owner, (v) => {
            if (v.building) return;
            if (def.ultimate && !v.t.hero && v.s.maxHp < 800) return;
            const sc = (v.t.hero ? 0 : 1000) + v.hp;
            if (sc < bs) {
              bs = sc;
              best = v;
            }
          });
          if (best) return this._execute(u, ab, def, best, best.x, best.y), true;
        }
      } else if (def.target === 'point' && e.type !== 'blink') {
        let best = null, bn = 0;
        this.enemiesNear(u.x, u.y, range, u.owner, (v) => {
          if (v.building) return;
          let n = v.t.hero ? 2 : 0;
          this.enemiesNear(v.x, v.y, aoe, u.owner, (w) => {
            if (!w.building) n++;
          });
          if (n > bn) {
            bn = n;
            best = v;
          }
        });
        if (best && bn >= (def.ultimate ? 4 : 2)) return this._execute(u, ab, def, null, best.x, best.y), true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ regions
  _updateRegions() {
    const tr = this._tracked;
    if (!tr.length) return;
    const zones = this.rules.healZones || [];
    const healTick = this.tick % 10 === 0;
    for (const u of this.units) {
      if (u.dead) continue;
      let mask = 0;
      for (let i = 0; i < tr.length; i++) {
        const r = this.regions[tr[i]];
        if (u.x >= r.x0 && u.x <= r.x1 && u.y >= r.y0 && u.y <= r.y1) mask |= 1 << i;
      }
      const entered = mask & ~u.regions;
      u.regions = mask;
      if (healTick && zones.length) {
        for (const z of zones) {
          const bit = tr.indexOf(z.region);
          if (bit < 0 || !(mask & (1 << bit))) continue;
          if (z.team && this.players[u.owner].team !== z.team) continue;
          if (u.building) continue;
          u.hp = Math.min(u.s.maxHp, u.hp + (z.hps || 0) * 0.5);
          u.mana = Math.min(u.s.maxMana, u.mana + (z.mps || 0) * 0.5);
        }
      }
      if (entered) for (let i = 0; i < tr.length; i++) if (entered & (1 << i) && !u.dead) this.triggers.fire('unitEntersRegion', { unit: u, region: tr[i] });
    }
  }

  // ------------------------------------------------------------ building
  buildList(P) {
    const bl = this.rules.buildList;
    if (!bl) return [];
    if (Array.isArray(bl)) return bl;
    return bl[P.key] || bl.all || [];
  }

  canBuild(p, type, tx, ty) {
    const P = this.players[p], t = this.content.units[type];
    if (!P || !t || !t.building || !this.buildList(P).includes(type)) return { ok: false, reason: 'You cannot build that.' };
    if ((t.cost || 0) > P.gold) return { ok: false, reason: 'Not enough gold.' };
    if (t.limit && this.units.filter((u) => !u.dead && u.owner === p && u.type === type).length >= t.limit) return { ok: false, reason: `Limit reached (${t.limit}).` };
    const s = t.building.size || 1, g = this.grid;
    for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) if (!g.buildableTile(x, y)) return { ok: false, reason: 'Cannot build there.' };
    const zones = this.rules.buildZones && (this.rules.buildZones[P.key] || this.rules.buildZones.all);
    if (zones) {
      const inside = zones.some((name) => {
        const r = this.regions[name];
        return r && tx >= r.tx && ty >= r.ty && tx + s <= r.tx + r.tw && ty + s <= r.ty + r.th;
      });
      if (!inside) return { ok: false, reason: 'Outside your build area.' };
    }
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + s) * TILE, y1 = (ty + s) * TILE;
    for (const u of this.units) {
      if (u.dead || u.building || u.t.flying) continue;
      const cx = clamp(u.x, x0, x1), cy = clamp(u.y, y0, y1);
      const dx = u.x - cx, dy = u.y - cy;
      if (dx * dx + dy * dy < u.radius * u.radius) return { ok: false, reason: 'Something is in the way.' };
    }
    const checks = this.rules.pathChecks;
    if (checks && checks.length) {
      const blocked = (x, y) => x >= tx && x < tx + s && y >= ty && y < ty + s;
      const floods = new Map();
      for (const [from, to] of checks) {
        const rf = this.regions[from], rt = this.regions[to];
        if (!rf || !rt) continue;
        if (!floods.has(to)) floods.set(to, g.flood(regionTiles(rt), blocked));
        const seen = floods.get(to);
        const reach = regionTiles(rf).some(([x, y]) => seen[y * g.w + x]);
        if (!reach) return { ok: false, reason: 'That would block the path!' };
        for (const u of this.units) {
          if (u.dead || u.building || u.t.flying || !this.areEnemies(p, u.owner)) continue;
          const ux = Math.floor(u.x / TILE), uy = Math.floor(u.y / TILE);
          if (g.inBounds(ux, uy) && !seen[uy * g.w + ux] && !blocked(ux, uy) && g.walkableTile(ux, uy)) return { ok: false, reason: 'That would trap an enemy!' };
        }
      }
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ commands
  ownUnits(p, ids, mobileOnly = false) {
    if (!Array.isArray(ids)) return [];
    const out = [];
    for (const id of ids.slice(0, 64)) {
      const u = this.unitById.get(id);
      if (!u || u.dead || u.owner !== p) continue;
      if (mobileOnly && (u.building || !u.t.speed)) continue;
      out.push(u);
    }
    return out;
  }

  applyCommand(p, c) {
    const P = this.players[p];
    if (!P || !c || typeof c.t !== 'string') return;
    if (this.ended && c.t !== 'leave') return;
    if (P.left && c.t !== 'leave' && P.ctrl !== 'bot') return;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    switch (c.t) {
      case 'move':
      case 'amove': {
        const us = this.ownUnits(p, c.u, true);
        const x = clamp(num(c.x), 0, this.W), y = clamp(num(c.y), 0, this.H);
        const spread = 8 + 7 * Math.sqrt(us.length);
        for (const u of us) {
          const o = u.order;
          if (c.q && (o.type === 'move' || o.type === 'amove') && o.pts.length < 16) o.pts.push([x, y]);
          else {
            u.order = { type: c.t, pts: [[x, y]], i: 0, spread };
            u.path = null;
          }
          u.returning = false;
        }
        if (us.length && P.ctrl === 'human') this.fx.push({ k: 'order', x, y, p: [p], attack: c.t === 'amove' });
        break;
      }
      case 'attack': {
        const tgt = this.unitById.get(c.target);
        if (!tgt || !this.isTargetable(tgt)) break;
        const us = this.ownUnits(p, c.u).filter((u) => this.canAttack(u) && this.canHit(u, tgt));
        for (const u of us) {
          if (u === tgt) continue;
          if (u.building || !u.t.speed) {
            u.target = tgt.id;
            continue;
          }
          u.order = { type: 'attack', target: tgt.id, manual: true };
          u.path = null;
        }
        if (us.length && P.ctrl === 'human') this.fx.push({ k: 'order', x: tgt.x, y: tgt.y, p: [p], attack: true, target: tgt.id });
        break;
      }
      case 'stop':
      case 'hold':
        for (const u of this.ownUnits(p, c.u)) {
          u.order = { type: c.t === 'hold' || u.building || !u.t.speed ? 'hold' : 'idle' };
          u.path = null;
        }
        break;
      case 'cast': {
        const u = this.ownUnits(p, [c.u])[0];
        if (!u) break;
        const ab = u.abilities.find((a) => a.id === c.a);
        const def = ab && this.content.abilities[c.a];
        if (!def || !this._castReady(u, ab, def) || u.s.stunned) break;
        if (def.target === 'none') {
          this._execute(u, ab, def, null, u.x, u.y);
          break;
        }
        if (def.target === 'unit') {
          const tgt = this.unitById.get(c.target);
          if (!tgt || tgt.dead) break;
          const enemy = this.areEnemies(p, tgt.owner);
          if ((def.targets === 'enemy' && (!enemy || !this.isTargetable(tgt))) || (def.targets === 'ally' && enemy)) break;
          if (tgt.building && def.targets === 'ally') break;
          u.order = { type: 'cast', ab: c.a, target: tgt.id, resume: u.order.type === 'cast' ? null : u.order };
        } else {
          u.order = { type: 'cast', ab: c.a, x: clamp(num(c.x), 0, this.W), y: clamp(num(c.y), 0, this.H), resume: u.order.type === 'cast' ? null : u.order };
        }
        u.path = null;
        break;
      }
      case 'learn': {
        const u = this.ownUnits(p, [c.u])[0];
        const ab = u && u.abilities.find((a) => a.id === c.a);
        if (!ab || !this.canLearn(u, ab)) break;
        ab.level++;
        u.skillPoints--;
        u.statsDirty = true;
        break;
      }
      case 'build': {
        const tx = num(c.tx) | 0, ty = num(c.ty) | 0;
        const r = this.canBuild(p, c.type, tx, ty);
        if (!r.ok) {
          if (P.ctrl === 'human') this.message(r.reason, [p], 2.5, '#ff8080');
          break;
        }
        const t = this.content.units[c.type];
        const s = t.building.size || 1;
        P.gold -= t.cost || 0;
        const u = this.createUnit(c.type, p, (tx + s / 2) * TILE, (ty + s / 2) * TILE);
        if (u) {
          u.invested = t.cost || 0;
          this.fx.push({ k: 'build', x: u.x, y: u.y, r: s * TILE * 0.6 });
        }
        break;
      }
      case 'sell': {
        const u = this.ownUnits(p, [c.u])[0];
        if (!u || !u.building || !u.invested) break;
        const refund = Math.floor(u.invested * (this.rules.sellRatio ?? 0.75));
        P.gold += refund;
        this.fx.push({ k: 'text', x: u.x, y: u.y - 20, text: '+' + refund, color: '#ffd54a', p: [p], gold: true });
        this.fx.push({ k: 'death', x: u.x, y: u.y, r: u.radius, color: P.color, model: u.t.model, building: true });
        this.removeUnit(u);
        break;
      }
      case 'upgrade': {
        const u = this.ownUnits(p, [c.u])[0];
        if (!u || !u.building || !(u.t.upgradesTo || []).includes(c.to)) break;
        const nt = this.content.units[c.to];
        if (!nt || !nt.building || (nt.building.size || 1) !== u.fp[2]) break;
        if ((nt.cost || 0) > P.gold) {
          if (P.ctrl === 'human') this.message('Not enough gold.', [p], 2.5, '#ff8080');
          break;
        }
        P.gold -= nt.cost || 0;
        const ratio = u.hp / u.s.maxHp;
        u.type = c.to;
        u.t = nt;
        u.radius = nt.radius;
        u.baseHp = nt.hp;
        u.invested += nt.cost || 0;
        u.s = null;
        this._refreshStats(u);
        u.hp = u.s.maxHp * ratio;
        this.fx.push({ k: 'build', x: u.x, y: u.y, r: u.radius * 1.4 });
        break;
      }
      case 'buy': {
        const u = this.ownUnits(p, [c.u])[0];
        const item = this.content.items[c.item];
        if (!u || !u.items || !item) break;
        const shop = this.findShop(u);
        if (!shop || !shop.t.shop.includes(c.item)) {
          if (P.ctrl === 'human') this.message('Move your hero next to a shop.', [p], 2.5, '#ff8080');
          break;
        }
        const slot = u.items.indexOf(null);
        if (slot < 0 || P.gold < item.cost) {
          if (P.ctrl === 'human') this.message(slot < 0 ? 'Inventory is full.' : 'Not enough gold.', [p], 2.5, '#ff8080');
          break;
        }
        P.gold -= item.cost;
        u.items[slot] = { id: c.item, charges: item.charges || 0 };
        u.statsDirty = true;
        this.fx.push({ k: 'text', x: u.x, y: u.y - 22, text: item.icon, color: '#fff', p: [p] });
        break;
      }
      case 'sellItem': {
        const u = this.ownUnits(p, [c.u])[0];
        const slot = num(c.slot) | 0;
        if (!u || !u.items || !u.items[slot] || !this.findShop(u)) break;
        const item = this.content.items[u.items[slot].id];
        P.gold += Math.floor((item ? item.cost : 0) * 0.5);
        u.items[slot] = null;
        u.statsDirty = true;
        break;
      }
      case 'use': {
        const u = this.ownUnits(p, [c.u])[0];
        const slot = num(c.slot) | 0;
        const it = u && u.items && u.items[slot];
        const d = it && this.content.items[it.id];
        if (!d || !d.use || u.s.stunned) break;
        if (d.use.heal) {
          u.hp = Math.min(u.s.maxHp, u.hp + d.use.heal);
          this.fx.push({ k: 'text', x: u.x, y: u.y - 16, text: '+' + d.use.heal, color: '#7dff8a' });
        }
        if (d.use.mana) u.mana = Math.min(u.s.maxMana, u.mana + d.use.mana);
        if (d.charges) {
          it.charges--;
          if (it.charges <= 0) u.items[slot] = null;
        }
        u.statsDirty = true;
        break;
      }
      case 'pick': {
        const hs = this.rules.heroSelect;
        if (!hs || P.hero || !P.slot || !(hs.pool || []).includes(c.type)) break;
        if (hs.unique && this.units.some((u) => u.type === c.type && this.players[u.owner].team === P.team)) {
          if (P.ctrl === 'human') this.message('That hero is already taken.', [p], 2.5, '#ff8080');
          break;
        }
        const r = P.start ? this.regions[P.start] : null;
        if (!r) break;
        const u = this.createUnit(c.type, p, r.cx + this.rng.range(-16, 16), r.cy + this.rng.range(-16, 16));
        if (u) {
          P.hero = u.id;
          this.fx.push({ k: 'revive', x: u.x, y: u.y });
          this.triggers.fire('heroPicked', { unit: u, player: p });
        }
        break;
      }
      case 'leave': {
        if (P.left) break;
        P.left = true;
        this.message(`${P.name} has left the game.`, null, 5, '#ffb347');
        if (P.ctrl === 'human' && this.rules.botTakeover !== false) P.ctrl = 'bot';
        this.triggers.fire('playerLeaves', { player: p });
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ desync check
  checksum() {
    let h = 0x811c9dc5;
    const mix = (v) => {
      h = Math.imul(h ^ (v | 0), 0x01000193);
    };
    mix(this.tick);
    mix(this.units.length);
    mix(this.rng.s);
    for (const u of this.units) {
      mix(u.id);
      mix(Math.round(u.x * 16));
      mix(Math.round(u.y * 16));
      mix(Math.round(u.hp * 4));
    }
    for (const P of this.players) mix(P.gold);
    return h >>> 0;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function regionTiles(r) {
  const out = [];
  for (let y = r.ty; y < r.ty + r.th; y++) for (let x = r.tx; x < r.tx + r.tw; x++) out.push([x, y]);
  return out;
}
