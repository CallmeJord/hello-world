// DOM HUD: resources, timers, messages, selection panel, command card,
// hero picker, shop and end-of-game overlays. Touch-first, big targets.
import { lv } from '../engine/content.js';
import { XP_TABLE, MAX_LEVEL, SHOP_RANGE } from '../engine/sim.js';
import { drawPortrait } from './models.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class Hud {
  constructor(root, { onQuit, onPause }) {
    this.root = root;
    this.onQuit = onQuit;
    this.onPause = onPause;
    this.el = {
      gold: $('#h-gold', root), vars: $('#h-vars', root), timer: $('#h-timer', root), net: $('#h-net', root),
      msgs: $('#h-msgs', root), banner: $('#h-banner', root), sel: $('#h-sel', root), cmd: $('#h-cmd', root),
      overlay: $('#h-overlay', root), tools: $('#h-tools', root), hint: $('#h-hint', root)
    };
    this.cmdKey = '';
    this.selKey = '';
    this.learnMode = false;
    this.buildMenu = false;
    this.overlay = null;
    this.endShown = false;
    this._t = 0;
    $('#h-menu', root).onclick = () => this.showMenu();
    this.el.cmd.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  attach(session, renderer, input) {
    this.s = session;
    this.g = session.game;
    this.r = renderer;
    this.input = input;
    this.local = session.local;
    this.cmdKey = '';
    this.selKey = '';
    this.learnMode = false;
    this.buildMenu = false;
    this.endShown = false;
    this.pickPending = 0;
    this.closeOverlay();
    this.el.msgs.innerHTML = '';
    session.fxSinks.push((fx) => {
      for (const f of fx) {
        if (f.k === 'msg' && (!f.p || f.p.includes(this.local))) this.message(f.text, f.dur, f.color);
      }
    });
    this._buildTools();
  }

  get P() {
    return this.g.players[this.local];
  }

  message(text, dur = 5, color) {
    const d = document.createElement('div');
    d.className = 'msg';
    d.textContent = text;
    if (color) d.style.color = color;
    this.el.msgs.appendChild(d);
    while (this.el.msgs.children.length > 5) this.el.msgs.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), Math.max(1000, dur * 1000 - 600));
    setTimeout(() => d.remove(), dur * 1000);
  }

  hint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.style.display = text ? 'block' : 'none';
  }

  _buildTools() {
    const t = this.el.tools;
    t.innerHTML = '';
    const btn = (label, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'tool ' + cls;
      b.innerHTML = label;
      b.title = title;
      b.onclick = (e) => {
        e.stopPropagation();
        fn(b);
      };
      t.appendChild(b);
      return b;
    };
    this.heroBtn = btn('<canvas width="72" height="72"></canvas><span class="lvl"></span>', 'Select hero (F1). Tap twice to center.', () => this.input.selectHero(true), 'hero-btn');
    btn('⚔️', 'Select all army units', () => this.input.selectArmy());
    this.boxBtn = btn('⬚', 'Box select: drag to select units', () => this.input.toggleBox());
    btn('🎯', 'Center camera on selection (Space)', () => this.input.centerSelection());
  }

  // ------------------------------------------------------------ per frame
  update() {
    const g = this.g, P = this.P;
    const now = performance.now();
    this.el.gold.textContent = P ? Math.floor(P.gold) : '-';
    if (now - this._t > 150) {
      this._t = now;
      // map variables
      const vars = (g.map.hud && g.map.hud.vars) || [];
      this.el.vars.innerHTML = vars
        .map((v) => {
          const val = g.vars[v.var];
          const max = v.max ? g.vars[v.max] : null;
          return `<span class="var">${esc(v.icon || '')} ${esc(v.label)} <b>${esc(typeof val === 'number' ? Math.round(val) : val ?? 0)}${max != null ? '/' + esc(max) : ''}</b></span>`;
        })
        .join('');
      const tm = g.timers.find((t) => t.label);
      if (tm) {
        const s = Math.max(0, Math.ceil((tm.end - g.tick) / 20));
        this.el.timer.textContent = `${tm.label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.el.timer.style.display = '';
      } else this.el.timer.style.display = 'none';
      const ping = this.s.online && this.s.net ? `${this.s.net.ping}ms` : '';
      this.el.net.textContent = ping;
      this._updateHeroBtn();
    }
    // banners
    let banner = '';
    if (this.s.desync) banner = '⚠️ Desync detected — the game state differs between players.';
    else if (this.s.stalled) banner = 'Waiting for the server…';
    else if (this.s.paused && !this.overlay) banner = 'Paused';
    this.el.banner.textContent = banner;
    this.el.banner.style.display = banner ? '' : 'none';

    this._updateSelection();
    this._updateCommands();
    if (this.overlay === 'shop') this._refreshShop();

    if (P && g.rules.heroSelect && P.slot && P.ctrl === 'human' && !P.hero && !this.overlay && !g.ended && !(this.pickPending > now)) this.showHeroPicker();
    if (this.overlay === 'pick' && P && P.hero) this.closeOverlay();
    else if (this.overlay === 'pick' && this._takenKey !== this._taken().join()) this._refreshPicker();
    if (g.ended && !this.endShown) {
      this.endShown = true;
      setTimeout(() => this.showEnd(), 900);
    }
  }

  _updateHeroBtn() {
    const g = this.g, P = this.P;
    const h = P && P.hero ? g.unitById.get(P.hero) : null;
    this.heroBtn.style.display = h ? '' : 'none';
    if (!h) return;
    const key = h.type + (h.dead ? 'd' : '');
    if (this.heroBtn.dataset.key !== key) {
      this.heroBtn.dataset.key = key;
      drawPortrait(this.heroBtn.querySelector('canvas'), h.t, P.color);
    }
    const lvl = this.heroBtn.querySelector('.lvl');
    lvl.textContent = h.dead ? `⏳${Math.max(0, Math.ceil((h.reviveTick - g.tick) / 20))}` : h.skillPoints > 0 ? `${h.level}+` : h.level;
    this.heroBtn.classList.toggle('dead', h.dead);
    this.heroBtn.classList.toggle('points', h.skillPoints > 0 && !h.dead);
  }

  selectedUnits() {
    const out = [];
    for (const id of this.r.selection) {
      const u = this.g.unitById.get(id);
      if (u && !u.dead) out.push(u);
      else this.r.selection.delete(id);
    }
    return out;
  }

  // ------------------------------------------------------------ selection
  _updateSelection() {
    const g = this.g;
    const units = this.selectedUnits();
    const key = units.map((u) => u.id + ':' + u.type).join(',');
    if (key !== this.selKey) {
      this.selKey = key;
      this._renderSelection(units);
    }
    if (units.length === 1) {
      const u = units[0];
      const hpEl = this.el.sel.querySelector('.hp');
      if (hpEl) {
        hpEl.querySelector('i').style.width = `${(100 * u.hp) / u.s.maxHp}%`;
        hpEl.querySelector('span').textContent = u.t.invulnerable ? 'Invulnerable' : `${Math.ceil(u.hp)} / ${Math.round(u.s.maxHp)}`;
      }
      const mpEl = this.el.sel.querySelector('.mp');
      if (mpEl && u.s.maxMana) {
        mpEl.querySelector('i').style.width = `${(100 * u.mana) / u.s.maxMana}%`;
        mpEl.querySelector('span').textContent = `${Math.floor(u.mana)} / ${Math.round(u.s.maxMana)}`;
      }
      const xpEl = this.el.sel.querySelector('.xp');
      if (xpEl && u.t.hero) {
        const lo = XP_TABLE[u.level - 1] || 0, hi = XP_TABLE[u.level] || lo;
        const f = u.level >= MAX_LEVEL ? 1 : (u.xp - lo) / Math.max(1, hi - lo);
        xpEl.querySelector('i').style.width = `${100 * Math.max(0, Math.min(1, f))}%`;
        xpEl.querySelector('span').textContent = `Level ${u.level}${u.skillPoints ? ` · ${u.skillPoints} skill point${u.skillPoints > 1 ? 's' : ''}` : ''}`;
      }
      const st = this.el.sel.querySelector('.stats');
      if (st) st.innerHTML = this._stats(u);
      const inv = this.el.sel.querySelector('.inv');
      if (inv && u.items) {
        const k = u.items.map((i) => (i ? i.id + i.charges : '-')).join();
        if (inv.dataset.k !== k) {
          inv.dataset.k = k;
          this._renderInv(inv, u);
        }
      }
    } else if (units.length > 1) {
      for (const el of this.el.sel.querySelectorAll('.mini')) {
        const u = g.unitById.get(+el.dataset.id);
        if (u) el.querySelector('i').style.width = `${(100 * u.hp) / u.s.maxHp}%`;
      }
    }
  }

  _stats(u) {
    const s = u.s;
    const parts = [];
    if (u.t.damage && !u.t.passive) parts.push(`⚔️ ${Math.round(s.dmgMin)}-${Math.round(s.dmgMax)}`);
    if (!u.t.invulnerable) parts.push(`🛡️ ${Math.round(s.armor * 10) / 10}`);
    if (s.speed) parts.push(`👟 ${Math.round(s.speed)}`);
    if (u.t.damage && !u.t.passive) parts.push(`🎯 ${u.s.range > 40 ? Math.round(u.s.range) : 'melee'}`);
    if (u.t.splash) parts.push('💥 splash');
    if (u.t.onHit && u.t.onHit.slow) parts.push('❄️ slows');
    if (u.t.targets === 'air') parts.push('🦅 air only');
    else if (u.t.targets === 'ground') parts.push('⛰️ ground only');
    if (u.t.flying) parts.push('🪽 flying');
    if (u.t.income) parts.push(`🪙 +${u.t.income.amount}/${u.t.income.every}s`);
    if (u.t.chain) parts.push('⚡ chains');
    return parts.join(' &nbsp;');
  }

  _renderSelection(units) {
    const g = this.g, el = this.el.sel;
    if (!units.length) {
      el.innerHTML = `<div class="empty">${g.buildList(this.P).length ? 'Tap 🏗️ Build to place towers' : 'Tap a unit to select it'}</div>`;
      return;
    }
    if (units.length === 1) {
      const u = units[0];
      const P = g.players[u.owner];
      el.innerHTML = `
        <div class="single">
          <canvas class="portrait" width="128" height="128"></canvas>
          <div class="info">
            <div class="name">${esc(u.t.name)} <small style="color:${esc(P.color)}">${esc(P.name)}</small></div>
            <div class="bar hp"><i></i><span></span></div>
            ${u.s.maxMana ? '<div class="bar mp"><i></i><span></span></div>' : ''}
            ${u.t.hero ? '<div class="bar xp"><i></i><span></span></div>' : ''}
            <div class="stats"></div>
          </div>
          ${u.items ? '<div class="inv"></div>' : ''}
        </div>`;
      drawPortrait(el.querySelector('canvas'), u.t, P.color);
      return;
    }
    el.innerHTML = '<div class="multi"></div>';
    const wrap = el.querySelector('.multi');
    for (const u of units.slice(0, 18)) {
      const d = document.createElement('button');
      d.className = 'mini';
      d.dataset.id = u.id;
      d.innerHTML = '<canvas width="64" height="64"></canvas><b><i></i></b>';
      drawPortrait(d.querySelector('canvas'), u.t, g.players[u.owner].color);
      d.onclick = () => {
        this.r.selection.clear();
        this.r.selection.add(u.id);
      };
      wrap.appendChild(d);
    }
    if (units.length > 18) wrap.insertAdjacentHTML('beforeend', `<span class="more">+${units.length - 18}</span>`);
  }

  _renderInv(inv, u) {
    inv.innerHTML = '';
    const mine = u.owner === this.local;
    u.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'slot';
      if (it) {
        const d = this.g.content.items[it.id];
        b.innerHTML = `${esc(d ? d.icon : '?')}${it.charges ? `<sub>${it.charges}</sub>` : ''}`;
        b.title = d ? `${d.name}: ${d.tip || ''}${d.use ? ' (tap to use)' : ''}` : it.id;
        if (mine && d && d.use) b.onclick = () => this.s.issue({ t: 'use', u: u.id, slot: i });
        else if (mine) b.onclick = () => this.message(`${d.name}: ${d.tip || ''}`, 3);
      } else b.classList.add('free');
      inv.appendChild(b);
    });
  }

  // ------------------------------------------------------------ commands
  _commands() {
    const g = this.g, P = this.P;
    const units = this.selectedUnits();
    const mine = units.filter((u) => u.owner === this.local);
    const cmds = [];
    const mode = this.input.mode;
    if (mode) {
      cmds.push({ id: 'cancel', icon: '✖', label: 'Cancel', key: 'Esc', fn: () => this.input.cancelMode() });
      return cmds;
    }
    if (this.buildMenu) {
      for (const type of g.buildList(P)) {
        const t = g.content.units[type];
        cmds.push({
          id: 'b_' + type, portrait: t, label: t.name, cost: t.cost, disabled: (t.cost || 0) > P.gold,
          tip: t.blurb, fn: () => this.input.startBuild(type)
        });
      }
      cmds.push({ id: 'back', icon: '↩', label: 'Back', fn: () => (this.buildMenu = false) });
      return cmds;
    }
    const mobile = mine.filter((u) => !u.building && u.t.speed);
    if (mobile.length) {
      cmds.push({ id: 'move', icon: '👣', label: 'Move', key: 'M', fn: () => this.input.startTarget({ cmd: 'move' }) });
      cmds.push({ id: 'amove', icon: '⚔️', label: 'Attack', key: 'A', fn: () => this.input.startTarget({ cmd: 'amove' }) });
      cmds.push({ id: 'stop', icon: '✋', label: 'Stop', key: 'S', fn: () => this.s.issue({ t: 'stop', u: mobile.map((u) => u.id) }) });
      cmds.push({ id: 'hold', icon: '🛑', label: 'Hold', key: 'H', fn: () => this.s.issue({ t: 'hold', u: mobile.map((u) => u.id) }) });
    }
    if (mine.length === 1) {
      const u = mine[0];
      const keys = ['Q', 'W', 'E', 'R'];
      u.abilities.forEach((ab, i) => {
        const def = g.content.abilities[ab.id];
        if (!def) return;
        const L = Math.max(0, ab.level - 1);
        const learnable = this.learnMode && g.canLearn(u, ab);
        cmds.push({
          id: 'ab_' + ab.id, icon: def.icon, label: def.name, key: keys[i], ability: ab, def,
          mana: def.passive ? null : lv(def.mana || 0, L),
          disabled: this.learnMode ? !learnable : ab.level === 0 || def.passive,
          glow: learnable, passive: def.passive,
          tip: `${def.name}${def.ultimate ? ' (Ultimate)' : ''}: ${def.tip || ''}`,
          fn: () => {
            if (this.learnMode) {
              this.s.issue({ t: 'learn', u: u.id, a: ab.id });
              if (u.skillPoints <= 1) this.learnMode = false;
              return;
            }
            if (def.passive) return this.message(`${def.name} is passive.`, 2);
            this.input.cast(u, ab, def);
          }
        });
      });
      if (u.t.hero && u.skillPoints > 0) {
        cmds.push({ id: 'learn', icon: '➕', label: this.learnMode ? 'Done' : `Learn (${u.skillPoints})`, key: 'L', glow: !this.learnMode, fn: () => (this.learnMode = !this.learnMode) });
      }
      if (u.items && g.findShop(u)) cmds.push({ id: 'shop', icon: '🛒', label: 'Shop', key: 'B', glow: true, fn: () => this.showShop(u) });
      if (u.building) {
        for (const to of u.t.upgradesTo || []) {
          const nt = g.content.units[to];
          if (!nt) continue;
          cmds.push({ id: 'up_' + to, icon: '⬆️', label: nt.short || 'Upgrade', cost: nt.cost, disabled: (nt.cost || 0) > P.gold, tip: `${nt.name}: ${nt.blurb || ''}`, fn: () => this.s.issue({ t: 'upgrade', u: u.id, to }) });
        }
        if (u.invested) {
          const refund = Math.floor(u.invested * (g.rules.sellRatio ?? 0.75));
          cmds.push({ id: 'sell', icon: '💰', label: `Sell +${refund}`, fn: () => this.s.issue({ t: 'sell', u: u.id }) });
        }
      }
    }
    if (g.buildList(P).length) cmds.push({ id: 'build', icon: '🏗️', label: 'Build', key: 'B', glow: !mine.length && g.tick < 400, fn: () => (this.buildMenu = true) });
    if (g.rules.heroSelect && P && !P.hero && P.slot) cmds.push({ id: 'pick', icon: '🦸', label: 'Choose hero', glow: true, fn: () => this.showHeroPicker() });
    return cmds;
  }

  _updateCommands() {
    const cmds = this._commands();
    const g = this.g;
    const key = cmds.map((c) => `${c.id}${c.disabled ? 'd' : ''}${c.glow ? 'g' : ''}${c.label}`).join('|') + (this.learnMode ? 'L' : '');
    if (key !== this.cmdKey) {
      this.cmdKey = key;
      this.cmdList = cmds;
      const el = this.el.cmd;
      el.innerHTML = '';
      for (const c of cmds) {
        const b = document.createElement('button');
        b.className = 'cmd' + (c.disabled ? ' disabled' : '') + (c.glow ? ' glow' : '') + (c.passive ? ' passive' : '');
        b.title = (c.tip || c.label) + (c.key ? ` [${c.key}]` : '');
        b.innerHTML = `${c.portrait ? '<canvas width="80" height="80"></canvas>' : `<span class="ic">${esc(c.icon)}</span>`}
          <span class="lb">${esc(c.label)}</span>
          ${c.cost != null ? `<span class="cost">🪙${c.cost}</span>` : ''}
          ${c.mana ? `<span class="mana">${c.mana}</span>` : ''}
          ${c.ability ? `<span class="pips">${'●'.repeat(c.ability.level)}${'○'.repeat(Math.max(0, c.def.maxLevel - c.ability.level))}</span>` : ''}
          ${c.key ? `<span class="hk">${esc(c.key)}</span>` : ''}
          <span class="cd"></span>`;
        if (c.portrait) drawPortrait(b.querySelector('canvas'), c.portrait, this.P.color);
        b.onclick = (e) => {
          e.stopPropagation();
          if (c.disabled && !this.learnMode) {
            if (c.cost != null) this.message('Not enough gold.', 2, '#ff8080');
            else if (c.ability && c.ability.level === 0) this.message('Learn this ability first (➕).', 2.5);
            return;
          }
          if (c.disabled) return;
          c.fn();
        };
        c.el = b;
        el.appendChild(b);
      }
    }
    // cooldown overlays
    for (const c of this.cmdList || []) {
      if (!c.ability || !c.el) continue;
      const def = c.def, ab = c.ability;
      const total = lv(def.cooldown || 0, Math.max(0, ab.level - 1)) || 1;
      const f = ab.cd > 0 ? ab.cd / total : 0;
      const cd = c.el.querySelector('.cd');
      cd.style.background = f > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${f * 360}deg, transparent 0)` : 'none';
      cd.textContent = f > 0 ? Math.ceil(ab.cd) : '';
      const u = this.selectedUnits()[0];
      c.el.classList.toggle('nomana', !!(u && c.mana && u.mana < c.mana));
    }
  }

  runHotkey(k) {
    const c = (this.cmdList || []).find((c) => c.key && c.key.toLowerCase() === k.toLowerCase());
    if (c && !c.disabled) {
      c.fn();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ overlays
  closeOverlay() {
    this.overlay = null;
    this.el.overlay.innerHTML = '';
    this.el.overlay.style.display = 'none';
  }

  _open(kind, html) {
    this.overlay = kind;
    this.el.overlay.innerHTML = html;
    this.el.overlay.style.display = 'flex';
    this.el.overlay.onpointerdown = (e) => e.stopPropagation();
  }

  showHeroPicker() {
    const g = this.g, P = this.P;
    const hs = g.rules.heroSelect;
    if (!hs) return;
    this._open('pick', `<div class="panel picker"><h2>Choose your hero</h2><div class="heroes"></div></div>`);
    const wrap = this.el.overlay.querySelector('.heroes');
    this.pickCards = new Map();
    for (const id of hs.pool) {
      const t = g.content.units[id];
      if (!t) continue;
      const card = document.createElement('button');
      card.className = 'hero-card';
      card.innerHTML = `<canvas width="120" height="120"></canvas><b>${esc(t.name)}</b><small>${esc(t.blurb || '')}</small>
        <div class="abil">${t.abilities.map((a) => g.content.abilities[a]).filter(Boolean).map((a) => `<span title="${esc(a.name + ': ' + (a.tip || ''))}">${esc(a.icon)}</span>`).join('')}</div>
        <em>Taken</em>`;
      drawPortrait(card.querySelector('canvas'), t, P.color);
      card.onclick = () => {
        if (card.classList.contains('taken')) return;
        this.s.issue({ t: 'pick', type: id });
        this.pickPending = performance.now() + 2500;
        this.closeOverlay();
        this.message(`You chose ${t.name}. Tap the hero button (top-left) to select them.`, 6);
        setTimeout(() => this.input.selectHero(true), 300);
      };
      this.pickCards.set(id, card);
      wrap.appendChild(card);
    }
    this._refreshPicker();
  }

  _refreshPicker() {
    const taken = this._taken();
    this._takenKey = taken.join();
    for (const [id, card] of this.pickCards || []) card.classList.toggle('taken', taken.includes(id));
  }

  showShop(hero) {
    this.shopHero = hero.id;
    const shop = this.g.findShop(hero);
    if (!shop) return this.message('Move your hero next to a shop.', 2.5);
    const items = shop.t.shop.map((id) => this.g.content.items[id]).filter(Boolean);
    this._open('shop', `<div class="panel shop"><h2>${esc(shop.t.name)} <span class="gold">🪙 <b class="sg"></b></span></h2>
      <div class="items">${items.map((it) => `<button class="item" data-id="${esc(it.id)}"><span class="ic">${esc(it.icon)}</span><b>${esc(it.name)}</b><small>${esc(it.tip || '')}</small><span class="cost">🪙${it.cost}</span></button>`).join('')}</div>
      <button class="close">Close</button></div>`);
    for (const b of this.el.overlay.querySelectorAll('.item')) b.onclick = () => this.s.issue({ t: 'buy', u: hero.id, item: b.dataset.id });
    this.el.overlay.querySelector('.close').onclick = () => this.closeOverlay();
    this._refreshShop();
  }

  _refreshShop() {
    const h = this.g.unitById.get(this.shopHero);
    if (!h || h.dead || !this.g.findShop(h)) return this.closeOverlay();
    const sg = this.el.overlay.querySelector('.sg');
    if (sg) sg.textContent = Math.floor(this.P.gold);
    const full = !h.items.includes(null);
    for (const b of this.el.overlay.querySelectorAll('.item')) {
      const it = this.g.content.items[b.dataset.id];
      b.classList.toggle('disabled', full || it.cost > this.P.gold);
    }
  }

  _taken() {
    const g = this.g, P = this.P;
    if (!g.rules.heroSelect || !g.rules.heroSelect.unique || !P) return [];
    return g.units.filter((u) => u.t.hero && g.players[u.owner].team === P.team).map((u) => u.type).sort();
  }

  showMenu() {
    const solo = !this.s.online;
    if (solo) this.s.paused = true;
    this._open('menu', `<div class="panel menu"><h2>${solo ? 'Paused' : 'Menu'}</h2>
      <button class="resume primary">Resume</button>
      <label class="row"><input type="checkbox" class="ranges" ${this.r.showRanges ? 'checked' : ''}> Show attack ranges</label>
      <div class="help">
        <b>Controls</b><br>
        Tap unit: select · Tap ground: move · Tap enemy: attack<br>
        Long-press ground: attack-move · Drag: pan · Pinch: zoom<br>
        Desktop: left-drag box select, right-click to order, wheel to zoom, Q/W/E/R abilities.
      </div>
      <button class="quit danger">${solo ? 'Quit to menu' : 'Leave game'}</button></div>`);
    const ov = this.el.overlay;
    ov.querySelector('.resume').onclick = () => {
      this.s.paused = false;
      this.closeOverlay();
    };
    ov.querySelector('.ranges').onchange = (e) => (this.r.showRanges = e.target.checked);
    ov.querySelector('.quit').onclick = () => this.onQuit();
  }

  showEnd() {
    const g = this.g, P = this.P;
    const won = P && g.ended.winners.includes(P.team);
    const watching = !P;
    const rows = g.players
      .filter((p) => p.slot && p.ctrl !== 'empty')
      .map((p) => {
        const h = p.hero ? g.unitById.get(p.hero) : null;
        return `<tr><td style="color:${esc(p.color)}">${esc(p.name)}${p.index === this.local ? ' (you)' : ''}</td><td>${esc(p.team)}</td><td>${h ? esc(h.t.name) + ' L' + h.level : '-'}</td><td>${p.kills}/${p.deaths}</td><td>${Math.floor(p.gold)}</td></tr>`;
      })
      .join('');
    this._open('end', `<div class="panel end ${won ? 'won' : 'lost'}">
      <h1>${watching ? 'Game over' : won ? 'Victory!' : 'Defeat'}</h1>
      <p>${esc(g.ended.text || '')}</p>
      <table><tr><th>Player</th><th>Team</th><th>Hero</th><th>K/D</th><th>Gold</th></tr>${rows}</table>
      <p class="dim">Game time ${Math.floor(g.tick / 20 / 60)}:${String(Math.floor(g.tick / 20) % 60).padStart(2, '0')}</p>
      <div class="row"><button class="watch">Keep watching</button><button class="quit primary">Back to menu</button></div></div>`);
    this.el.overlay.querySelector('.watch').onclick = () => this.closeOverlay();
    this.el.overlay.querySelector('.quit').onclick = () => this.onQuit();
  }
}

export { SHOP_RANGE };
