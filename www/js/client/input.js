// Touch + mouse + keyboard input -> selection and lockstep commands.
//
// Touch:  tap unit = select · tap ground/enemy with units = move/attack
//         long-press ground = attack-move · 1-finger drag = pan · pinch = zoom
//         ⬚ tool = next drag box-selects · double-tap own unit = select same type
// Mouse:  left click/drag = select/box · right click = smart order · wheel = zoom
import { TILE } from '../engine/grid.js';
import { lv } from '../engine/content.js';

const TAP_MOVE = 12;
const LONG_PRESS_MS = 450;

export class Input {
  constructor(canvas, minimap, renderer, session, hud) {
    this.c = canvas;
    this.mini = minimap;
    this.r = renderer;
    this.s = session;
    this.hud = hud;
    this.g = session.game;
    this.local = session.local;
    this.pointers = new Map();
    this.mode = null; // {kind:'target', cmd, ability, def, unit} | {kind:'build', type}
    this.boxNext = false;
    this.lastTap = { t: 0, id: 0 };
    this.keys = new Set();
    this._bind();
  }

  _bind() {
    const c = this.c;
    this._h = {
      down: (e) => this._down(e),
      move: (e) => this._move(e),
      up: (e) => this._up(e),
      cancel: (e) => this._up(e, true),
      wheel: (e) => {
        e.preventDefault();
        this.r.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX, e.offsetY);
      },
      ctx: (e) => e.preventDefault(),
      key: (e) => this._key(e, true),
      keyup: (e) => this.keys.delete(e.key),
      miniDown: (e) => this._mini(e),
      miniMove: (e) => {
        if (e.buttons) this._mini(e);
      }
    };
    c.addEventListener('pointerdown', this._h.down);
    window.addEventListener('pointermove', this._h.move);
    window.addEventListener('pointerup', this._h.up);
    window.addEventListener('pointercancel', this._h.cancel);
    c.addEventListener('wheel', this._h.wheel, { passive: false });
    c.addEventListener('contextmenu', this._h.ctx);
    window.addEventListener('keydown', this._h.key);
    window.addEventListener('keyup', this._h.keyup);
    this.mini.addEventListener('pointerdown', this._h.miniDown);
    this.mini.addEventListener('pointermove', this._h.miniMove);
    this.mini.addEventListener('contextmenu', this._h.ctx);
  }

  destroy() {
    const c = this.c;
    c.removeEventListener('pointerdown', this._h.down);
    window.removeEventListener('pointermove', this._h.move);
    window.removeEventListener('pointerup', this._h.up);
    window.removeEventListener('pointercancel', this._h.cancel);
    c.removeEventListener('wheel', this._h.wheel);
    c.removeEventListener('contextmenu', this._h.ctx);
    window.removeEventListener('keydown', this._h.key);
    window.removeEventListener('keyup', this._h.keyup);
    this.mini.removeEventListener('pointerdown', this._h.miniDown);
    this.mini.removeEventListener('pointermove', this._h.miniMove);
    clearTimeout(this._lp);
  }

  // ------------------------------------------------------------ helpers
  pt(e) {
    const r = this.c.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  myUnits(mobileOnly = true) {
    return this.hud.selectedUnits().filter((u) => u.owner === this.local && (!mobileOnly || (!u.building && u.t.speed)));
  }

  select(units, add = false) {
    if (!add) this.r.selection.clear();
    for (const u of units) this.r.selection.add(u.id);
    this.hud.learnMode = false;
    this.hud.buildMenu = false;
  }

  hero() {
    const P = this.g.players[this.local];
    const h = P && P.hero ? this.g.unitById.get(P.hero) : null;
    return h && !h.dead ? h : null;
  }

  selectHero(center = false) {
    const h = this.hero();
    if (!h) return;
    const again = this.r.selection.size === 1 && this.r.selection.has(h.id);
    this.select([h]);
    if (center || again) this.r.centerOn(h.x, h.y);
  }

  selectArmy() {
    const list = this.g.units.filter((u) => !u.dead && u.owner === this.local && !u.building && u.t.speed);
    if (!list.length) return this.hud.message('You have no army units.', 2);
    this.select(list);
  }

  toggleBox() {
    this.boxNext = !this.boxNext;
    this.hud.boxBtn.classList.toggle('on', this.boxNext);
    this.hud.hint(this.boxNext ? 'Drag to select units' : '');
  }

  centerSelection() {
    const us = this.hud.selectedUnits();
    if (!us.length) return this.selectHero(true);
    let x = 0, y = 0;
    for (const u of us) {
      x += u.x;
      y += u.y;
    }
    this.r.centerOn(x / us.length, y / us.length);
  }

  startTarget(m) {
    this.mode = { kind: 'target', ...m };
    const verb = m.cmd === 'move' ? 'Tap where to move' : m.cmd === 'amove' ? 'Tap a target or place to attack-move' : `${m.def.name}: tap a ${m.def.target === 'unit' ? (m.def.targets === 'ally' ? 'friendly unit' : 'enemy') : 'location'}`;
    this.hud.hint(verb);
  }

  startBuild(type) {
    this.mode = { kind: 'build', type };
    const t = this.g.content.units[type];
    const [wx, wy] = this.r.screenToWorld(this.r.w / 2, this.r.h / 2);
    this._ghost(wx, wy);
    this.hud.hint(`Tap the map to build ${t.name} (🪙${t.cost}). Keep tapping to build more.`);
  }

  cancelMode() {
    this.mode = null;
    this.r.ghost = null;
    this.hud.hint('');
    this.hud.buildMenu = false;
  }

  cast(u, ab, def) {
    if (ab.cd > 0) return this.hud.message(`${def.name} is not ready.`, 1.5);
    if (u.mana < lv(def.mana || 0, ab.level - 1)) return this.hud.message('Not enough mana.', 1.5, '#7ab0ff');
    if (def.target === 'none') return this.s.issue({ t: 'cast', u: u.id, a: ab.id });
    this.startTarget({ cmd: 'cast', unit: u.id, ability: ab, def });
  }

  _ghost(wx, wy) {
    const t = this.g.content.units[this.mode.type];
    const size = t.building.size || 1;
    const tx = Math.round(wx / TILE - size / 2), ty = Math.round(wy / TILE - size / 2);
    const ok = this.g.canBuild(this.local, this.mode.type, tx, ty).ok;
    this.r.ghost = { type: this.mode.type, tx, ty, size, ok };
  }

  // ------------------------------------------------------------ actions
  smartOrder(wx, wy, queue = false) {
    const mine = this.myUnits();
    const all = this.myUnits(false);
    if (!all.length) return false;
    const u = this.r.unitAt(wx, wy);
    if (u && u.owner !== this.local && this.g.areEnemies(this.local, u.owner) && !u.t.invulnerable) {
      this.s.issue({ t: 'attack', u: all.map((x) => x.id), target: u.id });
      return true;
    }
    if (u && u.t.shop && mine.length === 1 && mine[0].items && !this.g.areEnemies(this.local, u.owner)) {
      if (this.g.findShop(mine[0])) this.hud.showShop(mine[0]);
      else {
        this.s.issue({ t: 'move', u: [mine[0].id], x: u.x, y: u.y + u.radius + 14 });
        this._pendingShop = { hero: mine[0].id, until: performance.now() + 15000 };
      }
      return true;
    }
    if (!mine.length) return false;
    this.s.issue({ t: 'move', u: mine.map((x) => x.id), x: wx, y: wy, q: queue });
    return true;
  }

  _execTarget(wx, wy) {
    const m = this.mode;
    const ids = this.myUnits().map((u) => u.id);
    if (m.cmd === 'move') this.s.issue({ t: 'move', u: ids, x: wx, y: wy });
    else if (m.cmd === 'amove') {
      const tgt = this.r.unitAt(wx, wy);
      if (tgt && this.g.areEnemies(this.local, tgt.owner)) this.s.issue({ t: 'attack', u: this.myUnits(false).map((u) => u.id), target: tgt.id });
      else this.s.issue({ t: 'amove', u: ids, x: wx, y: wy });
    } else if (m.cmd === 'cast') {
      if (m.def.target === 'unit') {
        const tgt = this.r.unitAt(wx, wy, 16);
        if (!tgt) return this.hud.message('Tap directly on a unit.', 1.5);
        const enemy = this.g.areEnemies(this.local, tgt.owner);
        if (m.def.targets === 'enemy' && !enemy) return this.hud.message('Must target an enemy.', 1.5);
        if (m.def.targets === 'ally' && enemy) return this.hud.message('Must target an ally.', 1.5);
        this.s.issue({ t: 'cast', u: m.unit, a: m.ability.id, target: tgt.id });
      } else this.s.issue({ t: 'cast', u: m.unit, a: m.ability.id, x: wx, y: wy });
    }
    this.cancelMode();
  }

  _tap(sx, sy, button = 0, shift = false) {
    const [wx, wy] = this.r.screenToWorld(sx, sy);
    if (this.mode && this.mode.kind === 'build') {
      if (button === 2) return this.cancelMode();
      this._ghost(wx, wy);
      const gh = this.r.ghost;
      const res = this.g.canBuild(this.local, gh.type, gh.tx, gh.ty);
      if (!res.ok) return this.hud.message(res.reason, 2, '#ff8080');
      this.s.issue({ t: 'build', type: gh.type, tx: gh.tx, ty: gh.ty });
      if (navigator.vibrate) navigator.vibrate(10);
      return;
    }
    if (this.mode && this.mode.kind === 'target') {
      if (button === 2) return this.cancelMode();
      return this._execTarget(wx, wy);
    }
    const mouse = this._lastPointerType === 'mouse';
    if (mouse && button === 2) {
      this.smartOrder(wx, wy, shift);
      return;
    }
    const u = this.r.unitAt(wx, wy);
    const now = performance.now();
    if (u) {
      if (u.owner === this.local) {
        if (now - this.lastTap.t < 320 && this.lastTap.id === u.id) {
          // double tap: all of this type on screen
          const [x0, y0] = this.r.screenToWorld(0, 0), [x1, y1] = this.r.screenToWorld(this.r.w, this.r.h);
          this.select(this.g.units.filter((v) => !v.dead && v.owner === this.local && v.type === u.type && v.x > x0 && v.x < x1 && v.y > y0 && v.y < y1));
        } else if (shift) {
          if (this.r.selection.has(u.id)) this.r.selection.delete(u.id);
          else this.r.selection.add(u.id);
        } else this.select([u]);
        this.lastTap = { t: now, id: u.id };
        return;
      }
      if (!mouse && this.smartOrder(wx, wy)) return;
      this.select([u]);
      return;
    }
    if (!mouse && this.smartOrder(wx, wy)) return;
    if (!mouse || !shift) this.select([]);
  }

  _longPress(sx, sy) {
    const mine = this.myUnits();
    if (!mine.length) return;
    const [wx, wy] = this.r.screenToWorld(sx, sy);
    this.s.issue({ t: 'amove', u: mine.map((u) => u.id), x: wx, y: wy });
    if (navigator.vibrate) navigator.vibrate(20);
  }

  _boxSelect(b) {
    const [x0, y0] = this.r.screenToWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const [x1, y1] = this.r.screenToWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const inside = this.g.units.filter((u) => !u.dead && u.owner === this.local && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
    const mobile = inside.filter((u) => !u.building);
    this.select(mobile.length ? mobile : inside);
  }

  // ------------------------------------------------------------ pointer
  _down(e) {
    this.c.setPointerCapture?.(e.pointerId);
    this._lastPointerType = e.pointerType;
    const [x, y] = this.pt(e);
    const p = { x, y, sx: x, sy: y, t0: performance.now(), moved: false, button: e.button, shift: e.shiftKey, type: e.pointerType };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      const boxing = (e.pointerType === 'mouse' && e.button === 0 && !this.mode) || this.boxNext;
      p.box = boxing;
      if (e.pointerType !== 'mouse') {
        clearTimeout(this._lp);
        this._lp = setTimeout(() => {
          if (!p.moved && this.pointers.size === 1 && !this.mode) {
            p.long = true;
            this._longPress(p.x, p.y);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      clearTimeout(this._lp);
      for (const q of this.pointers.values()) q.moved = true;
      this.r.box = null;
      this._pinch = this._pinchState();
    }
  }

  _pinchState() {
    const ps = [...this.pointers.values()];
    if (ps.length < 2) return null;
    const [a, b] = ps;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    const [x, y] = this.pt(e);
    if (!p) {
      // hover (mouse)
      if (e.pointerType === 'mouse' && e.target === this.c) {
        const [wx, wy] = this.r.screenToWorld(x, y);
        if (this.mode && this.mode.kind === 'build') this._ghost(wx, wy);
        const u = this.r.unitAt(wx, wy);
        this.r.hoverId = u ? u.id : 0;
      }
      return;
    }
    const dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (!p.moved && Math.hypot(x - p.sx, y - p.sy) > TAP_MOVE) {
      p.moved = true;
      clearTimeout(this._lp);
    }
    if (this.pointers.size >= 2) {
      const st = this._pinchState();
      if (this._pinch && st) {
        this.r.pan(st.cx - this._pinch.cx, st.cy - this._pinch.cy);
        if (this._pinch.d > 10) this.r.zoomAt(st.d / this._pinch.d, st.cx, st.cy);
      }
      this._pinch = st;
      return;
    }
    if (!p.moved) return;
    if (p.box) {
      this.r.box = { x0: p.sx, y0: p.sy, x1: x, y1: y };
      return;
    }
    if (p.type === 'mouse' && this.mode && this.mode.kind === 'build' && p.button === 0) {
      const [wx, wy] = this.r.screenToWorld(x, y);
      this._ghost(wx, wy);
      return;
    }
    this.r.pan(dx, dy);
  }

  _up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this._lp);
    if (this.pointers.size === 0) this._pinch = null;
    if (cancelled) {
      this.r.box = null;
      return;
    }
    if (p.box && p.moved && this.r.box) {
      this._boxSelect(this.r.box);
      this.r.box = null;
      if (this.boxNext) this.toggleBox();
      return;
    }
    this.r.box = null;
    if (!p.moved && !p.long && this.pointers.size === 0) this._tap(p.x, p.y, p.button, p.shift || e.shiftKey);
  }

  _mini(e) {
    e.preventDefault();
    e.stopPropagation();
    const r = this.mini.getBoundingClientRect();
    const w = this.r.minimapToWorld(e.clientX - r.left, e.clientY - r.top);
    if (!w) return;
    if (e.button === 2) {
      const mine = this.myUnits();
      if (mine.length) this.s.issue({ t: 'move', u: mine.map((u) => u.id), x: w[0], y: w[1] });
      return;
    }
    this.r.centerOn(w[0], w[1]);
  }

  _key(e, down) {
    if (!down || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key;
    this.keys.add(k);
    if (k === 'Escape') {
      if (this.mode) this.cancelMode();
      else if (this.hud.overlay && this.hud.overlay !== 'pick' && this.hud.overlay !== 'end') {
        this.s.paused = false;
        this.hud.closeOverlay();
      } else this.hud.showMenu();
      return;
    }
    if (k === 'F1' || k === '`') {
      e.preventDefault();
      return this.selectHero();
    }
    if (k === ' ') {
      e.preventDefault();
      return this.centerSelection();
    }
    if (k === 'Tab') {
      e.preventDefault();
      return this.selectArmy();
    }
    if (k.length === 1 && this.hud.runHotkey(k)) e.preventDefault();
  }

  // Called every frame: keyboard camera scroll, pending shop open.
  update(dtMs) {
    const sp = (dtMs / 1000) * 700;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx += sp;
    if (this.keys.has('ArrowRight')) dx -= sp;
    if (this.keys.has('ArrowUp')) dy += sp;
    if (this.keys.has('ArrowDown')) dy -= sp;
    if (dx || dy) this.r.pan(dx, dy);
    const ps = this._pendingShop;
    if (ps) {
      const h = this.g.unitById.get(ps.hero);
      if (!h || h.dead || performance.now() > ps.until) this._pendingShop = null;
      else if (this.g.findShop(h)) {
        this._pendingShop = null;
        this.hud.showShop(h);
      }
    }
  }
}
