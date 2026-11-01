import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { createServer } from '../server/server.js';

const map = JSON.parse(readFileSync(new URL('../www/maps/ember-rift.json', import.meta.url), 'utf8'));

function client(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else queue.push(m);
  });
  const api = {
    ws,
    send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
    wait: (type, pred = () => true) =>
      new Promise((resolve, reject) => {
        const match = (m) => m.type === type && pred(m);
        const i = queue.findIndex(match);
        if (i >= 0) return resolve(queue.splice(i, 1)[0]);
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 4000);
        waiters.push({ pred: match, resolve: (m) => (clearTimeout(t), resolve(m)) });
      })
  };
  return new Promise((res) => ws.on('open', () => {
    api.send('hello', { name });
    res(api);
  }));
}

test('lobby, map sharing and lockstep relay', async () => {
  const srv = await createServer({ port: 0, log: () => {} });
  try {
    // static client is served
    const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
    assert.match(html, /<canvas/);
    const traversal = await fetch(`http://127.0.0.1:${srv.port}/..%2fpackage.json`);
    assert.notEqual(traversal.status, 200);

    const a = await client(srv.port, 'Alice');
    const b = await client(srv.port, 'Bob');
    await a.wait('welcome');
    await b.wait('welcome');

    // invalid maps are rejected
    a.send('create', { name: 'bad', map: { format: 1, name: 'x' } });
    assert.match((await a.wait('error')).msg, /Map rejected/);

    a.send('create', { name: 'Test room', map });
    const joined = await a.wait('joined');
    assert.equal(joined.room.name, 'Test room');
    const listed = await b.wait('rooms', (m) => m.rooms.some((r) => r.id === joined.room.id));
    const roomId = listed.rooms.find((r) => r.id === joined.room.id).id;

    b.send('join', { room: roomId });
    const bj = await b.wait('joined');
    assert.equal(bj.map.name, map.name, 'joining client receives the shared map');
    const roomState = await a.wait('room', (m) => m.room.slots.filter((s) => s.client).length === 2);
    const bSlot = roomState.room.slots.find((s) => s.name === 'Bob').index;

    // only the host may start
    b.send('start');
    a.send('start');
    const sa = await a.wait('start');
    const sb = await b.wait('start');
    assert.equal(sa.seed, sb.seed);
    assert.equal(sa.local, 0);
    assert.equal(sb.local, bSlot);
    assert.equal(sa.slots[0].ctrl, 'human');

    // commands are batched into turns and stamped with the sender's slot
    b.send('cmd', { c: { t: 'pick', type: 'hero_veil' } });
    b.send('cmd', { c: { t: 'leave' } }); // clients may not inject leaves
    const turnA = await a.wait('turn', (m) => m.cmds.length > 0);
    const turnB = await b.wait('turn', (m) => m.n === turnA.n);
    assert.deepEqual(turnA.cmds, turnB.cmds);
    assert.deepEqual(turnA.cmds, [{ p: bSlot, c: { t: 'pick', type: 'hero_veil' } }]);

    // matching hashes are fine, mismatching ones trigger a desync notice
    a.send('hash', { turn: 25, h: 1 });
    b.send('hash', { turn: 25, h: 2 });
    assert.equal((await a.wait('desync')).turn, 25);

    // disconnect -> server injects a leave command for that slot
    b.ws.close();
    await a.wait('playerLeft');
    const leaveTurn = await a.wait('turn', (m) => m.cmds.some((c) => c.c.t === 'leave'));
    assert.equal(leaveTurn.cmds.find((c) => c.c.t === 'leave').p, bSlot);
    a.ws.close();
  } finally {
    await srv.close();
  }
});
