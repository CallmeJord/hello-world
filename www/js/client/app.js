// App shell: menus, map library, solo setup, online lobby, game lifecycle.
import { Session, LocalTransport, NetTransport } from './session.js';
import { Net } from './net.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { validateMap, mapSummary, mapHash } from '../engine/mapformat.js';

const VERSION = '0.1.0';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ------------------------------------------------------------ storage
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }
};
const settings = Object.assign(
  { name: 'Hero' + Math.floor(Math.random() * 900 + 100), server: Net.defaultUrl() },
  store.get('rf.settings', {})
);
const saveSettings = () => store.set('rf.settings', settings);

const library = { bundled: [], imported: store.get('rf.maps', []) };

async function loadBundled() {
  if (library.bundled.length) return library.bundled;
  try {
    const idx = await (await fetch('maps/index.json')).json();
    library.bundled = await Promise.all(
      idx.map(async (e) => ({ ...e, bundled: true, map: await (await fetch('maps/' + e.file)).json() }))
    );
  } catch (e) {
    console.error('failed to load maps', e);
  }
  return library.bundled;
}

function allMaps() {
  return [
    ...library.bundled,
    ...library.imported.map((map) => ({ ...mapSummary(map), map, bundled: false }))
  ];
}

// ------------------------------------------------------------ screens
const screen = $('#screen');
const gameEl = $('#game');
let current = null;
const net = new Net();
let room = null; // online room state
let roomMap = null;
let chatLog = [];

const PARENT = { solo: 'menu', setup: 'solo', online: 'menu', lobby: 'menu', host: 'lobby', room: 'lobby', library: 'menu', settings: 'menu', help: 'menu' };

function render(name, ...args) {
  current = { name, args };
  screen.classList.remove('hidden');
  gameEl.classList.add('hidden');
  screen.scrollTop = 0;
  SCREENS[name](...args);
}

function show(name, ...args) {
  render(name, ...args);
  if (name !== 'menu') history.pushState({ s: name }, '', '#' + name);
}

window.addEventListener('popstate', () => {
  if (game) {
    // Hardware/browser back in-game opens the menu instead of leaving.
    history.pushState({ s: 'game' }, '', '#game');
    game.hud.showMenu();
    return;
  }
  if (!current || current.name === 'menu') return;
  if (current.name === 'room') net.send('leave');
  let parent = PARENT[current.name] || 'menu';
  if (parent === 'lobby' && !net.connected) parent = 'menu';
  render(parent);
});

const SCREENS = {
  menu() {
    screen.innerHTML = `<div class="wrap">
      <div class="title"><h1>RIFTFORGE</h1><p>Arcade custom maps · tower defense · hero arenas · survival</p></div>
      <div class="menu-buttons">
        <button data-go="solo"><span class="ic">🗡️</span><span>Play Solo<small>Pick a map, bots fill the other slots</small></span></button>
        <button data-go="online"><span class="ic">🌐</span><span>Play Online<small>Host or join games on a Riftforge server</small></span></button>
        <button data-go="library"><span class="ic">🗺️</span><span>Map Library<small>Browse, import and share custom maps</small></span></button>
        <button data-go="settings"><span class="ic">⚙️</span><span>Settings<small>${esc(settings.name)}</small></span></button>
        <button data-go="help"><span class="ic">❔</span><span>How to play</span></button>
      </div>
      <div class="footer">v${VERSION} · original engine & content · maps are shareable JSON</div></div>`;
    for (const b of screen.querySelectorAll('[data-go]')) b.onclick = () => show(b.dataset.go);
  },

  async solo() {
    screen.innerHTML = `<div class="wrap">${topbar('Play Solo')}<div class="cards" id="maps"><div class="empty-note">Loading maps…</div></div></div>`;
    bindBack();
    await loadBundled();
    renderMapCards($('#maps'), allMaps(), (m) => [{ label: 'Play', primary: true, fn: () => show('setup', m) }]);
  },

  setup(entry) {
    const map = entry.map;
    const slots = slotDefaults(map);
    const render = () => {
      screen.innerHTML = `<div class="wrap">${topbar(esc(map.name))}
        <div class="panelbox"><div class="genre" style="color:var(--gold)">${esc(map.genre || 'Custom')}</div><p class="dim">${esc(map.description || '')}</p></div>
        <div class="panelbox"><h3 style="margin-top:0">Players</h3><div class="slots" id="slots"></div></div>
        <button class="btn primary" id="start" style="width:100%;justify-content:center">Start game</button></div>`;
      bindBack();
      const wrap = $('#slots');
      slots.forEach((s, i) => {
        if (!s) return;
        const p = map.players[i];
        const row = document.createElement('div');
        row.className = 'slotrow';
        row.innerHTML = `<span class="dot" style="background:${esc(p.color || '#888')}"></span><span class="team">${esc(p.team || p.key)}</span>
          <span class="who">${s.ctrl === 'human' ? esc(settings.name) + ' (you)' : s.ctrl === 'bot' ? 'Bot' : 'Empty'}</span>
          <select><option value="human">You</option><option value="bot">Bot</option><option value="empty">Empty</option></select>`;
        const sel = row.querySelector('select');
        sel.value = s.ctrl;
        sel.onchange = () => {
          if (sel.value === 'human') slots.forEach((o) => o && o.ctrl === 'human' && (o.ctrl = map.players[slots.indexOf(o)].ai ? 'bot' : 'empty'));
          s.ctrl = sel.value;
          render();
        };
        wrap.appendChild(row);
      });
      $('#start').onclick = () => {
        const local = slots.findIndex((s) => s && s.ctrl === 'human');
        const named = slots.map((s) => (s ? { ...s, name: s.ctrl === 'human' ? settings.name : undefined } : null));
        startGame({ map, seed: (Math.random() * 2 ** 31) | 0, slots: named, local, online: false });
      };
    };
    render();
  },

  async online() {
    if (net.connected) return show('lobby');
    screen.innerHTML = `<div class="wrap">${topbar('Play Online')}
      <div class="panelbox">
        <div class="field"><label>Your name</label><input id="name" maxlength="20" value="${esc(settings.name)}"></div>
        <div class="field"><label>Server address</label><input id="server" value="${esc(settings.server)}" placeholder="ws://host:8080/ws" autocapitalize="off" autocorrect="off"></div>
        <button class="btn primary" id="connect" style="width:100%;justify-content:center">Connect</button>
        <p class="err" id="err"></p>
        <p class="dim" style="font-size:13px">Run your own server with <kbd>npm start</kbd> (see README). Phones on the same Wi-Fi can use your computer's LAN address, e.g. <kbd>ws://192.168.1.10:8080/ws</kbd>.</p>
      </div></div>`;
    bindBack();
    $('#connect').onclick = async () => {
      settings.name = $('#name').value.trim().slice(0, 20) || settings.name;
      settings.server = $('#server').value.trim();
      saveSettings();
      $('#err').textContent = 'Connecting…';
      try {
        await net.connect(settings.server, settings.name);
        show('lobby');
      } catch (e) {
        $('#err').textContent = e.message;
      }
    };
  },

  lobby(rooms) {
    room = null;
    screen.innerHTML = `<div class="wrap">${topbar('Online Games', `<button class="btn small" id="refresh">↻</button><button class="btn small primary" id="create">+ Host</button>`)}
      <div class="cards roomlist" id="rooms"></div>
      <p class="footer">Connected to ${esc(settings.server)} as ${esc(settings.name)} · <a href="#" id="disc" style="color:var(--dim)">disconnect</a></p></div>`;
    bindBack();
    $('#refresh').onclick = () => net.send('list');
    $('#create').onclick = () => show('host');
    $('#disc').onclick = (e) => {
      e.preventDefault();
      net.close();
      show('menu');
    };
    renderRooms(rooms || lastRooms);
    net.send('list');
  },

  async host() {
    screen.innerHTML = `<div class="wrap">${topbar('Host a game')}
      <div class="field"><label>Game name</label><input id="rname" maxlength="32" value="${esc(settings.name)}'s game"></div>
      <p class="dim">Choose a map. Imported maps are uploaded to the server and shared with everyone who joins.</p>
      <div class="cards" id="maps"></div></div>`;
    bindBack();
    await loadBundled();
    renderMapCards($('#maps'), allMaps(), (m) => [
      { label: 'Host', primary: true, fn: () => net.send('create', { name: $('#rname').value, map: m.map }) }
    ]);
  },

  room() {
    if (!room) return show('lobby');
    const isHost = room.host === net.id;
    screen.innerHTML = `<div class="wrap">${topbar(esc(room.name), isHost ? `<button class="btn small primary" id="start">Start ▶</button>` : '<span class="dim">Waiting for host…</span>')}
      <div class="panelbox"><b>${esc(room.map.name)}</b> <span class="dim">· ${esc(room.map.genre)} · ${esc(room.map.size)} · map ${esc(room.map.hash)}</span>
        <p class="dim" style="margin:6px 0 0">${esc(room.map.description)}</p></div>
      <div class="panelbox"><div class="slots" id="slots"></div></div>
      <div class="panelbox"><div class="chatlog" id="chat"></div>
        <div class="row"><input type="text" id="msg" maxlength="200" placeholder="Say something…"><button class="btn small" id="send">Send</button></div></div></div>`;
    bindBack(() => {
      net.send('leave');
      show('lobby');
    });
    if (isHost) $('#start').onclick = () => net.send('start');
    const wrap = $('#slots');
    for (const s of room.slots) {
      const row = document.createElement('div');
      row.className = 'slotrow';
      const who = s.client ? esc(s.name) + (s.client === net.id ? ' (you)' : '') : !s.open ? 'Closed' : s.ctrl === 'bot' ? 'Bot' : 'Open';
      row.innerHTML = `<span class="dot" style="background:${esc(s.color || '#888')}"></span><span class="team">${esc(s.team)}</span><span class="who">${who}</span>`;
      if (!s.client && s.open) {
        const take = document.createElement('button');
        take.textContent = 'Take';
        take.onclick = () => net.send('slot', { index: s.index, action: 'take' });
        row.appendChild(take);
      }
      if (isHost && !s.client) {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="bot">Bot</option><option value="empty">Open</option><option value="closed">Closed</option>';
        sel.value = !s.open ? 'closed' : s.ctrl;
        sel.onchange = () => net.send('slot', { index: s.index, action: 'set', ctrl: sel.value });
        row.appendChild(sel);
      }
      wrap.appendChild(row);
    }
    renderChat();
    const send = () => {
      const v = $('#msg').value.trim();
      if (v) net.send('chat', { text: v });
      $('#msg').value = '';
    };
    $('#send').onclick = send;
    $('#msg').onkeydown = (e) => e.key === 'Enter' && send();
  },

  async library(err = '') {
    screen.innerHTML = `<div class="wrap">${topbar('Map Library', `<label class="btn small primary" style="margin:0">⬆ Import<input type="file" id="file" accept=".json,application/json" hidden></label>`)}
      <p class="err" id="err">${esc(err)}</p>
      <div class="cards" id="maps"></div>
      <div class="panelbox" style="margin-top:12px"><b>Make your own maps</b>
      <p class="dim" style="margin:6px 0 0">Maps are JSON files: terrain paint ops, regions, players, units, rules and triggers (event → conditions → actions). Export a bundled map to use as a template. Format reference: <kbd>docs/MAP_FORMAT.md</kbd>.</p></div></div>`;
    bindBack();
    await loadBundled();
    const render = () =>
      renderMapCards($('#maps'), allMaps(), (m) => [
        { label: 'Play', primary: true, fn: () => show('setup', m) },
        { label: 'Export', fn: () => download(`${m.map.id || 'map'}.json`, JSON.stringify(m.map, null, 2)) },
        ...(m.bundled
          ? []
          : [{ label: 'Delete', danger: true, fn: () => {
            library.imported = library.imported.filter((x) => mapHash(x) !== m.hash);
            store.set('rf.maps', library.imported);
            render();
          } }])
      ]);
    render();
    $('#file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const map = JSON.parse(await f.text());
        const res = validateMap(map);
        if (!res.ok) throw new Error('This map has problems:\n• ' + res.errors.join('\n• '));
        const h = mapHash(map);
        if (allMaps().some((m) => m.hash === h)) throw new Error('That map is already in your library.');
        library.imported.push(map);
        if (!store.set('rf.maps', library.imported)) throw new Error('Not enough storage to save this map.');
        SCREENS.library(`Imported “${map.name}”.`);
      } catch (ex) {
        $('#err').textContent = ex.message || String(ex);
      }
    };
  },

  settings() {
    screen.innerHTML = `<div class="wrap">${topbar('Settings')}
      <div class="panelbox">
        <div class="field"><label>Player name</label><input id="name" maxlength="20" value="${esc(settings.name)}"></div>
        <div class="field"><label>Default server</label><input id="server" value="${esc(settings.server)}" autocapitalize="off"></div>
        <button class="btn primary" id="save">Save</button> <span id="ok" class="dim"></span>
      </div>
      <div class="panelbox"><b>Storage</b><p class="dim">${library.imported.length} imported map(s).</p><button class="btn danger small" id="wipe">Delete imported maps</button></div></div>`;
    bindBack();
    $('#save').onclick = () => {
      settings.name = $('#name').value.trim().slice(0, 20) || settings.name;
      settings.server = $('#server').value.trim() || settings.server;
      saveSettings();
      $('#ok').textContent = 'Saved.';
    };
    $('#wipe').onclick = () => {
      library.imported = [];
      store.set('rf.maps', []);
      SCREENS.settings();
    };
  },

  help() {
    screen.innerHTML = `<div class="wrap">${topbar('How to play')}<div class="prose">
      <h3>Touch controls</h3><ul>
        <li><b>Tap</b> one of your units to select it. <b>Double-tap</b> selects all of that type on screen.</li>
        <li>With units selected, <b>tap the ground</b> to move, or <b>tap an enemy</b> to attack.</li>
        <li><b>Long-press</b> the ground to attack-move (fight anything on the way).</li>
        <li><b>Drag</b> with one finger to pan, <b>pinch</b> to zoom. Tap the minimap to jump.</li>
        <li>The <b>⬚</b> tool lets your next drag box-select. The portrait button selects your hero.</li>
        <li>Abilities: tap the button, then tap a target. Spend skill points with <b>➕ Learn</b>.</li>
        <li>Shops: walk your hero next to a merchant and tap <b>🛒 Shop</b>.</li>
      </ul>
      <h3>Desktop</h3><p>Left-drag to box select, right-click to move/attack, wheel to zoom, arrow keys to scroll. <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> abilities, <kbd>A</kbd> attack-move, <kbd>S</kbd> stop, <kbd>H</kbd> hold, <kbd>B</kbd> build/shop, <kbd>F1</kbd> hero, <kbd>Space</kbd> center, <kbd>Esc</kbd> cancel/menu.</p>
      <h3>Game modes</h3>
      <p><b>Glacier Gate</b> — maze tower defense. Towers can be placed anywhere on the field; shape the path so invaders walk past your towers longer. Upgrade and sell towers by selecting them.</p>
      <p><b>Ember Rift</b> — three-lane hero arena. Minions push lanes on their own; kill them and enemy heroes for gold and XP, take down towers and the enemy Rift Core.</p>
      <p><b>Last Light</b> — co-op survival. Hold the beacon against 15 waves. Heal on the hearth.</p>
      <h3>Online</h3><p>Start a server (<kbd>npm start</kbd>), connect, host a game with any map — imported maps are sent to everyone in the room automatically. Gameplay uses deterministic lockstep, like classic RTS games.</p>
    </div></div>`;
    bindBack();
  }
};

function topbar(title, right = '') {
  return `<div class="topbar"><button class="back" id="back">←</button><h2>${title}</h2>${right}</div>`;
}
function bindBack(fn) {
  $('#back').onclick = fn || (() => history.back());
}

function slotDefaults(map) {
  let haveHuman = false;
  return map.players.map((p) => {
    if (p.type === 'computer') return null;
    if (!haveHuman) {
      haveHuman = true;
      return { ctrl: 'human' };
    }
    return { ctrl: p.ai ? 'bot' : 'empty' };
  });
}

function renderMapCards(el, maps, actions) {
  el.innerHTML = '';
  if (!maps.length) el.innerHTML = '<div class="empty-note">No maps found.</div>';
  for (const m of maps) {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<div class="genre">${esc(m.genre)}${m.bundled ? '' : '<span class="badge">imported</span>'}</div><h3>${esc(m.name)}</h3>
      <p>${esc(m.description)}</p><div class="meta">${esc(m.size)} · ${m.slots} slot${m.slots === 1 ? '' : 's'} · by ${esc(m.author)}</div><div class="actions"></div>`;
    for (const a of actions(m)) {
      const b = document.createElement('button');
      b.className = 'btn small' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.onclick = a.fn;
      c.querySelector('.actions').appendChild(b);
    }
    el.appendChild(c);
  }
}

let lastRooms = [];
function renderRooms(rooms) {
  lastRooms = rooms || [];
  const el = $('#rooms');
  if (!el) return;
  el.innerHTML = '';
  if (!lastRooms.length) el.innerHTML = '<div class="empty-note">No open games yet. Host one!</div>';
  for (const r of lastRooms) {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<div class="genre">${esc(r.map.genre)}</div><h3>${esc(r.name)}</h3><p>${esc(r.map.name)}</p>
      <div class="meta">${r.players} player(s) · ${r.open} open slot(s)</div><div class="actions"><button class="btn small primary">Join</button></div>`;
    c.querySelector('button').onclick = () => net.send('join', { room: r.id });
    el.appendChild(c);
  }
}

function renderChat() {
  const el = $('#chat');
  if (!el) return;
  el.innerHTML = chatLog.map((m) => `<div><b>${esc(m.from)}:</b> ${esc(m.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------ net events
net.on('rooms', (m) => {
  if (current && current.name === 'lobby') renderRooms(m.rooms);
  else lastRooms = m.rooms;
});
net.on('joined', (m) => {
  room = m.room;
  roomMap = m.map;
  chatLog = [];
  const res = validateMap(roomMap);
  if (!res.ok) {
    net.send('leave');
    alert('The shared map failed validation on this device:\n' + res.errors.join('\n'));
    return show('lobby');
  }
  show('room');
});
net.on('room', (m) => {
  room = m.room;
  if (current && current.name === 'room') SCREENS.room();
});
net.on('chat', (m) => {
  chatLog.push(m);
  if (chatLog.length > 100) chatLog.shift();
  if (game) game.hud.message(`${m.from}: ${m.text}`, 6, '#ffe9a8');
  else renderChat();
});
net.on('error', (m) => {
  if (game) game.hud.message(m.msg, 4, '#ff8080');
  else alert(m.msg);
});
net.on('start', (m) => {
  const slots = [];
  for (const s of m.slots) slots[s.index] = { ctrl: s.ctrl, name: s.name || undefined };
  startGame({ map: roomMap, seed: m.seed, slots, local: m.local, online: true });
});
net.on('desync', () => {
  if (game) game.session.desync = true;
});
net.on('playerLeft', (m) => {
  if (game) game.hud.message(`${m.name} ${m.reason === 'disconnected' ? 'disconnected' : 'left'}.`, 5, '#ffb347');
});
net.on('disconnected', () => {
  if (game && game.session.online) {
    game.hud.message('Lost connection to the server.', 10, '#ff8080');
    game.session.stalled = true;
  } else if (current && ['lobby', 'room', 'host'].includes(current.name)) {
    alert('Disconnected from server.');
    show('online');
  }
});

// ------------------------------------------------------------ game
let game = null;

function startGame({ map, seed, slots, local, online }) {
  const transport = online ? new NetTransport(net) : new LocalTransport(local);
  const session = new Session({ map, seed, slots, local, transport, online });
  session.net = online ? net : null;
  screen.classList.add('hidden');
  gameEl.classList.remove('hidden');
  history.pushState({ s: 'game' }, '', '#game');
  const renderer = new Renderer($('#view'), $('#minimap'));
  const hud = new Hud(gameEl, { onQuit: () => quitGame() });
  renderer.attach(session);
  renderer.resize();
  const input = new Input($('#view'), $('#minimap'), renderer, session, hud);
  hud.attach(session, renderer, input);
  $('#h-chat').classList.toggle('hidden', !online);
  $('#h-chat').onclick = () => {
    const t = prompt('Chat message');
    if (t) net.send('chat', { text: t });
  };
  game = { session, renderer, hud, input, raf: 0, last: performance.now() };
  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  game.onResize = onResize;
  const frame = (now) => {
    if (!game) return;
    const dt = Math.min(100, now - game.last);
    game.last = now;
    session.update(dt);
    input.update(dt);
    hud.update();
    renderer.draw();
    game.raf = requestAnimationFrame(frame);
  };
  game.raf = requestAnimationFrame(frame);
  // Pause solo games when the app goes to the background.
  game.onVis = () => {
    if (document.hidden && !online) {
      session.paused = true;
      if (!hud.overlay) hud.showMenu();
    }
  };
  document.addEventListener('visibilitychange', game.onVis);
  window.__rf = game; // handy for debugging / automated tests
}

function quitGame() {
  if (!game) return;
  const online = game.session.online;
  cancelAnimationFrame(game.raf);
  game.input.destroy();
  game.session.close();
  window.removeEventListener('resize', game.onResize);
  document.removeEventListener('visibilitychange', game.onVis);
  game = null;
  window.__rf = null;
  if (online) {
    net.send('leave');
    show('lobby');
  } else show('menu');
}

// ------------------------------------------------------------ boot
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
history.replaceState({ s: 'menu' }, '', '#menu');
render('menu');
loadBundled();
