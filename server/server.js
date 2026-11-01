// Riftforge lobby + lockstep relay server.
//
//  * Serves the web client (www/) over HTTP so phones can also play in a
//    browser / install it as a PWA.
//  * WebSocket endpoint at /ws: lobby (rooms, slots, chat, map sharing) and
//    in-game lockstep relay. The server never simulates the game; it batches
//    every player's commands into numbered turns (10 per second) and
//    broadcasts them. Clients report state checksums so desyncs are detected.
//
// Usage: node server/server.js [--port 8080]   (or PORT=8080)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { validateMap, mapSummary, MAX_MAP_BYTES } from '../www/js/engine/mapformat.js';

export const PROTOCOL = 1;
const TURN_MS = 100;
const MAX_ROOMS = 200;
const MAX_CMDS_PER_TURN = 24;
const MAX_CMD_BYTES = 2048;
const HASH_EVERY = 25;

const here = dirname(fileURLToPath(import.meta.url));
const WWW = normalize(join(here, '..', 'www'));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

function cleanName(s, fallback = 'Player') {
  const n = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return n || fallback;
}

export function createServer({ port = 8080, host = '0.0.0.0', log = console.log } = {}) {
  const clients = new Map(); // id -> client
  const rooms = new Map(); // id -> room
  let nextClient = 1;

  // ------------------------------------------------------------- http
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size, protocol: PROTOCOL }));
        return;
      }
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(WWW, p));
      if (file !== WWW && !file.startsWith(WWW + sep)) {
        res.writeHead(403).end();
        return;
      }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache'
      });
      res.end(body);
    } catch {
      res.writeHead(500).end();
    }
  });

  // ------------------------------------------------------------- ws
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MAP_BYTES + 4096 });

  const send = (c, type, data = {}) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type, ...data }));
  };
  const roomInfo = (r) => ({
    id: r.id, name: r.name, state: r.state, map: r.summary, host: r.host,
    players: r.members.length, open: r.slots.filter((s) => s.open && !s.client).length,
    slots: r.slots.map((s) => ({
      index: s.index, team: s.team, color: s.color, open: s.open,
      client: s.client || 0, name: s.client ? clients.get(s.client)?.name : null,
      ctrl: s.client ? 'human' : s.ctrl
    }))
  });
  const broadcastRoom = (r) => {
    const info = roomInfo(r);
    for (const id of r.members) {
      const c = clients.get(id);
      if (c) send(c, 'room', { room: info });
    }
  };
  const roomList = () => [...rooms.values()].filter((r) => r.state === 'lobby').map(roomInfo);
  const broadcastList = () => {
    const list = roomList();
    for (const c of clients.values()) if (!c.room) send(c, 'rooms', { rooms: list });
  };

  function leaveRoom(c, reason = 'left') {
    const r = c.room ? rooms.get(c.room) : null;
    c.room = null;
    if (!r) return;
    r.members = r.members.filter((id) => id !== c.id);
    const slot = r.slots.find((s) => s.client === c.id);
    if (slot) {
      slot.client = 0;
      if (r.state === 'playing') r.pending.push({ p: slot.index, c: { t: 'leave' } });
    }
    if (!r.members.length) {
      closeRoom(r);
    } else {
      if (r.host === c.id) r.host = r.members[0];
      if (r.state === 'lobby') broadcastRoom(r);
      else for (const id of r.members) send(clients.get(id), 'playerLeft', { slot: slot ? slot.index : -1, name: c.name, reason });
    }
    broadcastList();
  }

  function closeRoom(r) {
    if (r.timer) clearInterval(r.timer);
    rooms.delete(r.id);
    log(`room ${r.id} closed`);
  }

  function startGame(r) {
    r.state = 'playing';
    r.seed = randomBytes(4).readUInt32LE(0) || 1;
    r.turn = 0;
    r.pending = [];
    r.perTurn = new Map();
    r.hashes = new Map();
    const slots = r.slots.map((s) => ({
      index: s.index,
      ctrl: s.client ? 'human' : s.open ? s.ctrl : 'empty',
      name: s.client ? clients.get(s.client)?.name : null
    }));
    for (const id of r.members) {
      const c = clients.get(id);
      const mine = r.slots.find((s) => s.client === id);
      send(c, 'start', { seed: r.seed, slots, local: mine ? mine.index : -1, turnMs: TURN_MS });
    }
    r.timer = setInterval(() => {
      r.turn++;
      const cmds = r.pending;
      r.pending = [];
      r.perTurn = new Map();
      const msg = JSON.stringify({ type: 'turn', n: r.turn, cmds });
      for (const id of r.members) {
        const c = clients.get(id);
        if (c && c.ws.readyState === 1) c.ws.send(msg);
      }
    }, TURN_MS);
    log(`room ${r.id} started (${r.summary.name}, ${r.members.length} humans)`);
    broadcastList();
  }

  const handlers = {
    hello(c, m) {
      c.name = cleanName(m.name);
      send(c, 'welcome', { id: c.id, name: c.name, protocol: PROTOCOL });
      send(c, 'rooms', { rooms: roomList() });
    },
    list(c) {
      send(c, 'rooms', { rooms: roomList() });
    },
    create(c, m) {
      if (c.room) leaveRoom(c);
      if (rooms.size >= MAX_ROOMS) return send(c, 'error', { msg: 'Server is full, try later.' });
      const v = validateMap(m.map);
      if (!v.ok) return send(c, 'error', { msg: 'Map rejected: ' + v.errors.slice(0, 3).join(' ') });
      const map = m.map;
      const id = randomBytes(3).toString('hex');
      const slots = map.players
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.type !== 'computer')
        .map(({ p, i }) => ({ index: i, team: p.team || p.key, color: p.color || null, open: true, ctrl: p.ai ? 'bot' : 'empty', client: 0 }));
      const r = {
        id, name: cleanName(m.name, `${c.name}'s game`).slice(0, 32), host: c.id, state: 'lobby',
        map, summary: mapSummary(map), slots, members: [c.id], pending: [], timer: null
      };
      slots[0].client = c.id;
      rooms.set(id, r);
      c.room = id;
      send(c, 'joined', { room: roomInfo(r), map });
      broadcastList();
      log(`room ${id} created by ${c.name}: ${r.summary.name}`);
    },
    join(c, m) {
      const r = rooms.get(String(m.room));
      if (!r) return send(c, 'error', { msg: 'That game no longer exists.' });
      if (r.state !== 'lobby') return send(c, 'error', { msg: 'That game has already started.' });
      const slot = r.slots.find((s) => s.open && !s.client);
      if (!slot) return send(c, 'error', { msg: 'That game is full.' });
      if (c.room) leaveRoom(c);
      slot.client = c.id;
      r.members.push(c.id);
      c.room = r.id;
      send(c, 'joined', { room: roomInfo(r), map: r.map });
      broadcastRoom(r);
      broadcastList();
    },
    leave(c) {
      leaveRoom(c);
      send(c, 'rooms', { rooms: roomList() });
    },
    slot(c, m) {
      const r = rooms.get(c.room);
      if (!r || r.state !== 'lobby') return;
      const target = r.slots.find((s) => s.index === m.index);
      if (!target) return;
      if (m.action === 'take') {
        if (target.client || !target.open) return;
        const cur = r.slots.find((s) => s.client === c.id);
        if (cur) cur.client = 0;
        target.client = c.id;
      } else if (m.action === 'set' && r.host === c.id && !target.client) {
        // host toggles a free slot between bot / empty / closed
        if (m.ctrl === 'closed') target.open = false;
        else if (m.ctrl === 'bot' || m.ctrl === 'empty') {
          target.open = true;
          target.ctrl = m.ctrl;
        }
      }
      broadcastRoom(r);
      broadcastList();
    },
    chat(c, m) {
      const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 200).trim();
      if (!text) return;
      const now = Date.now();
      if (now - (c.lastChat || 0) < 400) return;
      c.lastChat = now;
      const r = rooms.get(c.room);
      if (!r) return;
      for (const id of r.members) send(clients.get(id), 'chat', { from: c.name, text });
    },
    start(c) {
      const r = rooms.get(c.room);
      if (!r || r.host !== c.id || r.state !== 'lobby') return;
      startGame(r);
    },
    cmd(c, m) {
      const r = rooms.get(c.room);
      if (!r || r.state !== 'playing' || !m.c || typeof m.c !== 'object') return;
      const slot = r.slots.find((s) => s.client === c.id);
      if (!slot) return;
      if (m.c.t === 'leave') return; // only the server may inject leaves
      const n = (r.perTurn.get(c.id) || 0) + 1;
      if (n > MAX_CMDS_PER_TURN) return;
      if (JSON.stringify(m.c).length > MAX_CMD_BYTES) return;
      r.perTurn.set(c.id, n);
      r.pending.push({ p: slot.index, c: m.c });
    },
    hash(c, m) {
      const r = rooms.get(c.room);
      if (!r || r.state !== 'playing' || !Number.isInteger(m.turn) || m.turn % HASH_EVERY !== 0) return;
      let entry = r.hashes.get(m.turn);
      if (!entry) r.hashes.set(m.turn, (entry = new Map()));
      entry.set(c.id, m.h >>> 0);
      const values = new Set(entry.values());
      if (values.size > 1 && !r.desynced) {
        r.desynced = true;
        log(`room ${r.id} DESYNC at turn ${m.turn}`);
        for (const id of r.members) send(clients.get(id), 'desync', { turn: m.turn });
      }
      for (const t of r.hashes.keys()) if (t < m.turn - HASH_EVERY * 8) r.hashes.delete(t);
    },
    ended(c) {
      const r = rooms.get(c.room);
      if (r) r.endedVotes = (r.endedVotes || 0) + 1;
    },
    ping(c, m) {
      send(c, 'pong', { t: m.t });
    }
  };

  wss.on('connection', (ws) => {
    const c = { id: nextClient++, ws, name: 'Player', room: null, alive: true };
    clients.set(c.id, c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (!m || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, m.type)) return;
      try {
        handlers[m.type](c, m);
      } catch (e) {
        log('handler error', m.type, e);
      }
    });
    ws.on('close', () => {
      leaveRoom(c, 'disconnected');
      clients.delete(c.id);
    });
  });

  const keepAlive = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {}
    }
  }, 15000);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        rooms,
        clients,
        close: () =>
          new Promise((done) => {
            clearInterval(keepAlive);
            for (const r of rooms.values()) if (r.timer) clearInterval(r.timer);
            for (const c of clients.values()) c.ws.terminate();
            wss.close();
            server.close(() => done());
          })
      });
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const i = process.argv.indexOf('--port');
  const port = Number(i > 0 ? process.argv[i + 1] : process.env.PORT) || 8080;
  createServer({ port }).then(({ port }) => {
    console.log(`Riftforge server running:`);
    console.log(`  web client:  http://localhost:${port}/`);
    console.log(`  websocket:   ws://localhost:${port}/ws`);
  });
}
