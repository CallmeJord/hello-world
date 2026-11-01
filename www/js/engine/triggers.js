// Declarative trigger system (event -> conditions -> actions), in the spirit
// of classic RTS map editors. Maps are pure JSON, so they can be shared online
// safely: no map ever ships executable code. Everything here is deterministic.
import { TILE } from './grid.js';

export const EVENT_TYPES = [
  'mapInit', 'periodic', 'elapsed', 'unitDies', 'unitEntersRegion',
  'timerExpires', 'playerLeaves', 'heroPicked', 'heroLevel'
];

export const ACTION_TYPES = [
  'setVar', 'addVar', 'spawn', 'message', 'gold', 'if', 'after', 'repeat',
  'timer', 'stopTimer', 'endGame', 'remove', 'kill', 'heal', 'enable',
  'disable', 'order', 'ping'
];

export const EXPR_OPS = [
  'var', 'add', 'sub', 'mul', 'div', 'mod', 'min', 'max', 'floor', 'round', 'abs',
  'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'if', 'random',
  'data', 'at', 'get', 'len', 'count', 'unit', 'player', 'time', 'pending',
  'concat', 'alive', 'playerCount'
];

const MAX_ACTIONS_PER_TICK = 20000;
const MAX_DEPTH = 24;
const MAX_SPAWN = 200;

const sec = (s) => Math.max(0, Math.round(Number(s) * 20));

export class TriggerSystem {
  constructor(game, defs) {
    this.g = game;
    this.byType = {};
    this.byId = new Map();
    this.budget = MAX_ACTIONS_PER_TICK;
    defs.forEach((d, i) => {
      const ev = d.event || { type: 'mapInit' };
      const tr = { id: d.id ?? `trigger${i}`, d, ev, on: d.enabled !== false, fired: false };
      if (ev.type === 'periodic') {
        tr.interval = Math.max(1, sec(ev.interval ?? 1));
        tr.next = ev.start != null ? sec(ev.start) : tr.interval;
      } else if (ev.type === 'elapsed') {
        tr.at = sec(ev.time ?? 0);
      }
      (this.byType[ev.type] ||= []).push(tr);
      this.byId.set(tr.id, tr);
    });
  }

  update() {
    this.budget = MAX_ACTIONS_PER_TICK;
    const t = this.g.tick;
    for (const tr of this.byType.periodic || [])
      if (tr.on && t >= tr.next) {
        tr.next += tr.interval;
        this.run(tr, {});
      }
    for (const tr of this.byType.elapsed || [])
      if (tr.on && !tr.fired && t >= tr.at) {
        tr.fired = true;
        this.run(tr, {});
      }
    const timers = this.g.timers;
    for (let i = 0; i < timers.length; i++) {
      if (t >= timers[i].end) {
        const tm = timers[i];
        timers.splice(i--, 1);
        this.fire('timerExpires', { timer: tm.id });
      }
    }
  }

  fire(type, ctx) {
    const list = this.byType[type];
    if (!list) return;
    for (const tr of list) if (tr.on && this.matches(tr.ev, ctx)) this.run(tr, ctx);
  }

  matches(ev, ctx) {
    switch (ev.type) {
      case 'unitDies':
      case 'unitEntersRegion':
      case 'heroPicked':
      case 'heroLevel':
        if (ev.region && ev.region !== ctx.region) return false;
        if (ev.level != null && ctx.unit && ctx.unit.level !== ev.level) return false;
        return this.matchUnit(ctx.unit, ev, ctx);
      case 'timerExpires':
        return ev.timer == null || ev.timer === ctx.timer;
      default:
        return true;
    }
  }

  run(tr, ctx) {
    const d = tr.d;
    const c = { ...ctx, trigger: tr.id };
    if (d.conditions != null) {
      const conds = Array.isArray(d.conditions) ? d.conditions : [d.conditions];
      for (const cond of conds) if (!this.ev(cond, c)) return;
    }
    if (tr.ev.once) tr.on = false;
    this.exec(d.actions || [], c, 0);
  }

  exec(actions, ctx, depth) {
    if (depth > MAX_DEPTH || !Array.isArray(actions)) return;
    for (const a of actions) {
      if (--this.budget <= 0) return;
      try {
        this.act(a, ctx, depth);
      } catch (e) {
        // A broken action must never desync or crash the game; every client
        // hits the same exception at the same point, so skipping is safe.
        if (this.g.debug) console.warn('trigger action failed', a, e);
      }
    }
  }

  // ------------------------------------------------------------ actions
  act(a, ctx, depth) {
    const g = this.g;
    switch (a.do) {
      case 'setVar':
        g.vars[a.var] = this.ev(a.value, ctx);
        break;
      case 'addVar':
        g.vars[a.var] = (Number(g.vars[a.var]) || 0) + Number(this.ev(a.value ?? 1, ctx));
        break;
      case 'spawn':
        this.spawn(a, ctx);
        break;
      case 'message': {
        const text = this.text(a.text, ctx);
        g.message(text, this.players(a.to ?? 'all', ctx), a.duration ?? 6, a.color);
        break;
      }
      case 'gold': {
        // Amount is evaluated per recipient with $player bound to them.
        for (const p of this.players(a.to ?? 'players', ctx)) {
          const amt = Math.round(Number(this.ev(a.amount, { ...ctx, player: p })) || 0);
          g.players[p].gold = Math.max(0, g.players[p].gold + amt);
          if (amt > 0 && a.show) g.fx.push({ k: 'msg', text: this.text(a.show, { ...ctx, player: p, amount: amt }).replace('{amount}', amt), p: [p], dur: 3, color: '#ffd54a' });
        }
        break;
      }
      case 'if':
        this.exec(this.ev(a.cond, ctx) ? a.then : a.else, ctx, depth + 1);
        break;
      case 'after': {
        const acts = a.actions;
        const c = { ...ctx };
        g.schedule(sec(this.ev(a.delay ?? 1, ctx)), () => this.exec(acts, c, depth + 1));
        break;
      }
      case 'repeat': {
        const n = Math.min(500, Math.max(0, Math.floor(Number(this.ev(a.count, ctx)) || 0)));
        for (let i = 0; i < n; i++) this.exec(a.actions, { ...ctx, i }, depth + 1);
        break;
      }
      case 'timer': {
        const dur = sec(this.ev(a.duration, ctx));
        g.timers = g.timers.filter((t) => t.id !== a.id);
        g.timers.push({ id: a.id, end: g.tick + dur, label: a.label ? this.text(a.label, ctx) : '' });
        break;
      }
      case 'stopTimer':
        g.timers = g.timers.filter((t) => t.id !== a.id);
        break;
      case 'endGame': {
        const w = this.ev(a.winners, ctx);
        g.endGame(Array.isArray(w) ? w : [w], a.text ? this.text(a.text, ctx) : '');
        break;
      }
      case 'remove': {
        const u = this.unitRef(a.unit, ctx);
        if (u) g.removeUnit(u);
        break;
      }
      case 'kill': {
        const u = this.unitRef(a.unit, ctx);
        if (u && !u.dead) g.kill(u, null);
        break;
      }
      case 'heal': {
        const units = a.filter ? this.units(a.filter, ctx) : [this.unitRef(a.unit ?? '$unit', ctx)].filter(Boolean);
        for (const u of units) {
          if (u.dead) continue;
          u.hp = a.amount != null ? Math.min(u.s.maxHp, u.hp + Number(this.ev(a.amount, ctx))) : u.s.maxHp;
          if (a.mana !== false) u.mana = u.s.maxMana;
        }
        break;
      }
      case 'enable':
      case 'disable': {
        const tr = this.byId.get(a.trigger);
        if (tr) tr.on = a.do === 'enable';
        break;
      }
      case 'order': {
        const units = this.units(a.filter || {}, ctx).filter((u) => !u.dead && !u.building && u.s.speed > 0);
        const pts = this.pathPoints(a.path ?? (a.region ? [a.region] : []));
        if (!pts.length) break;
        for (const u of units) g.orderPath(u, a.order === 'move' ? 'move' : 'amove', pts);
        break;
      }
      case 'ping': {
        const r = g.regions[a.region];
        if (r) g.fx.push({ k: 'ping', x: r.cx, y: r.cy, p: this.players(a.to ?? 'all', ctx), color: a.color || '#ffd54a' });
        break;
      }
      default:
        break;
    }
  }

  spawn(a, ctx) {
    const g = this.g;
    const type = this.ev(a.type, ctx);
    if (!g.content.units[type]) return;
    const owner = this.player(a.owner, ctx);
    if (owner < 0) return;
    const count = Math.min(MAX_SPAWN, Math.max(0, Math.floor(Number(this.ev(a.count ?? 1, ctx)) || 0)));
    const interval = sec(this.ev(a.interval ?? 0, ctx));
    const pts = this.pathPoints(a.path || []);
    const hpMul = Number(this.ev(a.hpMul ?? 1, ctx)) || 1;
    const bountyMul = a.bountyMul != null ? Number(this.ev(a.bountyMul, ctx)) : 1;
    const duration = a.duration != null ? Number(this.ev(a.duration, ctx)) : 0;
    const at = a.at ? this.unitRef(a.at, ctx) : null;
    const region = a.region ? g.regions[this.ev(a.region, ctx)] : null;
    const doOne = () => {
      let x, y;
      if (at) {
        x = at.x + g.rng.range(-20, 20);
        y = at.y + g.rng.range(-20, 20);
      } else if (region) {
        x = g.rng.range(region.x0 + 8, region.x1 - 8);
        y = g.rng.range(region.y0 + 8, region.y1 - 8);
      } else return;
      const u = g.createUnit(type, owner, x, y, { hpMul, bountyMul, duration, guard: !!a.guard });
      if (u && pts.length && !u.building) g.orderPath(u, a.order === 'move' ? 'move' : 'amove', pts);
    };
    if (interval > 0 && count > 1) {
      for (let i = 0; i < count; i++) g.schedule(i * interval, doOne);
    } else for (let i = 0; i < count; i++) doOne();
  }

  pathPoints(regions) {
    const out = [];
    for (const name of regions) {
      const r = this.g.regions[name];
      if (r) out.push([r.cx, r.cy]);
    }
    return out;
  }

  // -------------------------------------------------------- references
  unitRef(ref, ctx) {
    if (ref === '$unit') return ctx.unit || null;
    if (ref === '$killer') return ctx.killer || null;
    if (typeof ref === 'number') return this.g.unitById.get(ref) || null;
    return null;
  }

  player(ref, ctx) {
    const g = this.g;
    if (typeof ref === 'number') return g.players[ref] ? ref : -1;
    if (ref === '$player') return ctx.player ?? (ctx.unit ? ctx.unit.owner : -1);
    if (ref === '$killerPlayer') return ctx.killerOwner ?? -1;
    if (typeof ref === 'string') {
      const p = g.playerByKey[ref];
      return p ? p.index : -1;
    }
    return -1;
  }

  players(ref, ctx) {
    const g = this.g;
    if (Array.isArray(ref)) return [...new Set(ref.flatMap((r) => this.players(r, ctx)))];
    if (ref === 'all') return g.players.map((p) => p.index);
    if (ref === 'players') return g.players.filter((p) => p.ctrl === 'human' || p.ctrl === 'bot').map((p) => p.index);
    if (ref === 'humans') return g.players.filter((p) => p.ctrl === 'human').map((p) => p.index);
    if (ref && typeof ref === 'object' && ref.team != null)
      return g.players.filter((p) => p.team === ref.team && (p.ctrl === 'human' || p.ctrl === 'bot')).map((p) => p.index);
    const p = this.player(ref, ctx);
    return p >= 0 ? [p] : [];
  }

  matchUnit(u, f, ctx) {
    if (!u) return false;
    const g = this.g;
    if (f.owner != null) {
      const owners = Array.isArray(f.owner) ? f.owner : [f.owner];
      if (!owners.some((o) => this.player(o, ctx) === u.owner)) return false;
    }
    if (f.team != null) {
      const teams = Array.isArray(f.team) ? f.team : [f.team];
      if (!teams.includes(g.players[u.owner].team)) return false;
    }
    if (f.unitType != null) {
      const types = Array.isArray(f.unitType) ? f.unitType : [f.unitType];
      if (!types.includes(u.type)) return false;
    }
    if (f.hero != null && !!u.t.hero !== !!f.hero) return false;
    if (f.building != null && !!u.building !== !!f.building) return false;
    if (f.inRegion != null) {
      const r = g.regions[f.inRegion];
      if (!r || u.x < r.x0 || u.x > r.x1 || u.y < r.y0 || u.y > r.y1) return false;
    }
    return true;
  }

  units(filter, ctx) {
    const out = [];
    for (const u of this.g.units) if (!u.dead && !u.removed && this.matchUnit(u, filter, ctx)) out.push(u);
    return out;
  }

  text(t, ctx) {
    if (t == null) return '';
    if (typeof t !== 'string') return String(this.ev(t, ctx));
    const g = this.g;
    return t.replace(/\{([$\w]+)\}/g, (m, k) => {
      if (k === '$player') {
        const p = this.player('$player', ctx);
        return p >= 0 ? g.players[p].name : '';
      }
      if (k === '$killerPlayer') {
        const p = this.player('$killerPlayer', ctx);
        return p >= 0 ? g.players[p].name : '';
      }
      if (k === '$unit') return ctx.unit ? ctx.unit.t.name : '';
      if (k === '$i') return String(ctx.i ?? '');
      const v = g.vars[k];
      return v == null ? m : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    });
  }

  // -------------------------------------------------------- expressions
  ev(e, ctx) {
    if (e == null || typeof e === 'number' || typeof e === 'boolean') return e;
    if (typeof e === 'string') {
      if (e === '$i') return ctx.i ?? 0;
      if (e === '$timer') return ctx.timer ?? null;
      if (e === '$region') return ctx.region ?? null;
      return e;
    }
    if (Array.isArray(e)) return e.map((x) => this.ev(x, ctx));
    const g = this.g;
    const k = Object.keys(e)[0];
    const v = e[k];
    const args = () => (Array.isArray(v) ? v.map((x) => this.ev(x, ctx)) : [this.ev(v, ctx)]);
    const num = (x) => Number(x) || 0;
    switch (k) {
      case 'var': return g.vars[v] ?? 0;
      case 'add': return args().reduce((a, b) => num(a) + num(b), 0);
      case 'sub': { const [a, ...r] = args(); return r.reduce((x, y) => x - num(y), num(a)); }
      case 'mul': return args().reduce((a, b) => num(a) * num(b), 1);
      case 'div': { const [a, b] = args(); return num(b) === 0 ? 0 : num(a) / num(b); }
      case 'mod': { const [a, b] = args(); return num(b) === 0 ? 0 : num(a) % num(b); }
      case 'min': return Math.min(...args().map(num));
      case 'max': return Math.max(...args().map(num));
      case 'floor': return Math.floor(num(this.ev(v, ctx)));
      case 'round': return Math.round(num(this.ev(v, ctx)));
      case 'abs': return Math.abs(num(this.ev(v, ctx)));
      case 'eq': { const [a, b] = args(); return a === b; }
      case 'ne': { const [a, b] = args(); return a !== b; }
      case 'lt': { const [a, b] = args(); return num(a) < num(b); }
      case 'le': { const [a, b] = args(); return num(a) <= num(b); }
      case 'gt': { const [a, b] = args(); return num(a) > num(b); }
      case 'ge': { const [a, b] = args(); return num(a) >= num(b); }
      case 'and': return (Array.isArray(v) ? v : [v]).every((x) => this.ev(x, ctx));
      case 'or': return (Array.isArray(v) ? v : [v]).some((x) => this.ev(x, ctx));
      case 'not': return !this.ev(v, ctx);
      case 'if': return this.ev(v[0], ctx) ? this.ev(v[1], ctx) : this.ev(v[2], ctx);
      case 'random': { const [a, b] = args(); return g.rng.int(Math.floor(num(a)), Math.floor(num(b))); }
      case 'data': return g.map.data ? g.map.data[v] : undefined;
      case 'at': {
        const [list, idx] = args();
        if (!Array.isArray(list) || !list.length) return undefined;
        const i = Math.max(0, Math.min(list.length - 1, Math.floor(num(idx))));
        return list[i];
      }
      case 'get': {
        const [o, key] = args();
        return o && typeof o === 'object' ? o[key] : undefined;
      }
      case 'len': { const l = this.ev(v, ctx); return Array.isArray(l) ? l.length : 0; }
      case 'count': return this.units(v || {}, ctx).length;
      case 'unit': {
        const u = this.unitRef(v[0], ctx);
        if (!u) return null;
        switch (v[1]) {
          case 'owner': return g.players[u.owner].key;
          case 'team': return g.players[u.owner].team;
          case 'type': return u.type;
          case 'hp': return u.hp;
          case 'maxHp': return u.s.maxHp;
          case 'level': return u.level;
          case 'x': return u.x / TILE;
          case 'y': return u.y / TILE;
          case 'hero': return !!u.t.hero;
          default: return null;
        }
      }
      case 'player': {
        const p = g.players[this.player(v[0], ctx)];
        if (!p) return null;
        switch (v[1]) {
          case 'gold': return p.gold;
          case 'team': return p.team;
          case 'name': return p.name;
          case 'kills': return p.kills;
          case 'ctrl': return p.ctrl;
          case 'key': return p.key;
          default: return null;
        }
      }
      case 'time': return g.tick / 20;
      case 'pending': return g.scheduled.length;
      case 'concat': return args().map((x) => (x == null ? '' : String(x))).join('');
      case 'alive': { const u = this.unitRef(v, ctx); return !!(u && !u.dead && !u.removed); }
      case 'playerCount': {
        const f = v || {};
        return g.players.filter((p) =>
          (f.ctrl ? p.ctrl === f.ctrl : p.ctrl === 'human' || p.ctrl === 'bot') &&
          (f.team == null || p.team === f.team) && !p.left).length;
      }
      default:
        return undefined;
    }
  }
}
