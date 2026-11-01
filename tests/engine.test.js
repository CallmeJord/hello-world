import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Game, TICKS_PER_TURN } from '../www/js/engine/sim.js';
import { Grid, TILE } from '../www/js/engine/grid.js';
import { validateMap, mapHash } from '../www/js/engine/mapformat.js';

const MAPS_DIR = new URL('../www/maps/', import.meta.url);
const loadMap = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, MAPS_DIR), 'utf8'));
const botSlots = (map) => map.players.map((p) => (p.type === 'computer' ? null : { ctrl: 'bot' }));

test('all bundled maps validate', () => {
  const index = JSON.parse(readFileSync(new URL('index.json', MAPS_DIR), 'utf8'));
  assert.ok(index.length >= 3);
  for (const f of readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    const map = JSON.parse(readFileSync(new URL(f, MAPS_DIR), 'utf8'));
    const res = validateMap(map);
    assert.ok(res.ok, `${f}: ${res.errors.join('; ')}`);
    assert.equal(index.find((e) => e.file === f).hash, mapHash(map), `${f}: index hash is stale (run npm run build:maps)`);
  }
});

test('validator rejects bad maps', () => {
  assert.equal(validateMap(null).ok, false);
  const bad = { format: 1, name: 'x', width: 20, height: 20, players: [{ key: 'p1' }], triggers: [{ event: { type: 'nope' }, actions: [{ do: 'explode' }] }] };
  const res = validateMap(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown event')));
  assert.ok(res.errors.some((e) => e.includes('unknown action')));
});

test('A* routes around walls and reports unreachable goals', () => {
  const g = new Grid(20, 10);
  for (let y = 0; y < 9; y++) g.terrain[y * 20 + 10] = 3; // rock wall with a gap at the bottom
  const p = g.findPath(2 * TILE, 2 * TILE, 18 * TILE, 2 * TILE, 8);
  assert.ok(!p.partial);
  assert.ok(p.some(([, y]) => y > 8 * TILE), 'path should dip through the gap');
  g.terrain[9 * 20 + 10] = 3; // close the gap
  const q = g.findPath(2 * TILE, 2 * TILE, 18 * TILE, 2 * TILE, 8);
  assert.ok(q.partial);
});

function runScripted(seed, ticks) {
  const map = loadMap('ember-rift');
  const g = new Game(map, { seed, slots: botSlots(map) });
  const sums = [];
  for (let t = 0; t < ticks; t++) {
    if (t % TICKS_PER_TURN === 0 && t === 400) {
      // A "human" command mid-game: everyone's hero moves to the middle.
      for (const P of g.players) if (P.hero) g.applyCommand(P.index, { t: 'move', u: [P.hero], x: 1150, y: 700 });
    }
    g.step();
    g.fx.length = 0;
    if (t % 100 === 0) sums.push(g.checksum());
  }
  return sums;
}

test('simulation is deterministic for the same seed', () => {
  const a = runScripted(1234, 3000);
  const b = runScripted(1234, 3000);
  assert.deepEqual(a, b);
  const c = runScripted(999, 3000);
  assert.notDeepEqual(a, c);
});

test('tower defense: building, path protection, kills and leaks', () => {
  const map = loadMap('glacier-gate');
  const slots = map.players.map((p, i) => (p.type === 'computer' ? null : i === 0 ? { ctrl: 'human' } : { ctrl: 'empty' }));
  const g = new Game(map, { seed: 5, slots });
  const P = g.players[0];
  assert.equal(P.gold, map.rules.startGold);
  // Build an arrow spire next to the creep route.
  g.applyCommand(0, { t: 'build', type: 'td_arrow1', tx: 12, ty: 12 });
  g.applyCommand(0, { t: 'build', type: 'td_arrow1', tx: 16, ty: 16 });
  const tower = g.units.find((u) => u.type === 'td_arrow1');
  assert.ok(tower, 'tower built');
  assert.equal(P.gold, map.rules.startGold - 100);
  // Cannot build outside the field
  assert.equal(g.canBuild(0, 'td_arrow1', 2, 2).ok, false);
  // A full wall of barricades across the field must be refused at the last gap
  // (checked on a separate game so it doesn't change the creep route here).
  const g2 = new Game(map, { seed: 5, slots });
  g2.players[0].gold = 10000;
  let refused = 0;
  for (let y = 3; y < 27; y += 2) {
    const r = g2.canBuild(0, 'td_barricade', 20, y);
    if (r.ok) g2.applyCommand(0, { t: 'build', type: 'td_barricade', tx: 20, ty: y });
    else if (/block/.test(r.reason)) refused++;
  }
  assert.ok(refused >= 1, 'path check should refuse the final blocking piece');
  P.gold = 1000;
  // Run until the first wave arrives and gets shot.
  let killed = 0;
  const startLives = g.vars.lives;
  for (let i = 0; i < 20 * 120 && !g.ended; i++) {
    g.step();
    for (const f of g.fx) if (f.k === 'death' && !f.building) killed++;
    g.fx.length = 0;
  }
  assert.ok(g.vars.wave >= 2, 'waves advance');
  assert.ok(killed > 0, 'tower killed some invaders');
  assert.ok(g.vars.lives <= startLives);
  // Upgrade + sell
  const goldBefore = P.gold;
  g.applyCommand(0, { t: 'upgrade', u: tower.id, to: 'td_arrow2' });
  assert.equal(tower.type, 'td_arrow2');
  assert.equal(P.gold, goldBefore - 110);
  g.applyCommand(0, { t: 'sell', u: tower.id });
  assert.ok(tower.removed);
  assert.equal(P.gold, goldBefore - 110 + Math.floor(160 * 0.8));
});

test('hero arena: pick, level, learn, buy, cast', () => {
  const map = loadMap('ember-rift');
  const slots = map.players.map((p, i) => (p.type === 'computer' ? null : i === 0 ? { ctrl: 'human', name: 'Tester' } : { ctrl: 'empty' }));
  const g = new Game(map, { seed: 3, slots });
  g.applyCommand(0, { t: 'pick', type: 'hero_stormcaller' });
  const P = g.players[0];
  const h = g.unitById.get(P.hero);
  assert.equal(h.type, 'hero_stormcaller');
  assert.equal(h.skillPoints, 1);
  g.applyCommand(0, { t: 'learn', u: h.id, a: 'skyfall' }); // ultimate needs level 6
  assert.equal(h.abilities.find((a) => a.id === 'skyfall').level, 0);
  g.applyCommand(0, { t: 'learn', u: h.id, a: 'arc_bolt' });
  assert.equal(h.abilities.find((a) => a.id === 'arc_bolt').level, 1);
  g._gainXp(h, 5000);
  assert.equal(h.level, 10);
  assert.equal(h.skillPoints, 9);
  // Shop is next to the fountain where the hero spawned.
  g.step();
  g.applyCommand(0, { t: 'buy', u: h.id, item: 'brawler_gauntlets' });
  assert.equal(h.items[0].id, 'brawler_gauntlets');
  g.step();
  assert.ok(h.s.dmgMin >= h.t.damage[0] + 8);
  // Cast the bolt at a creep.
  const foe = g.createUnit('wild_boar', g.playerByKey.neutral.index, h.x + 100, h.y);
  g.step();
  g.applyCommand(0, { t: 'cast', u: h.id, a: 'arc_bolt', target: foe.id });
  const hp0 = foe.hp;
  for (let i = 0; i < 40; i++) g.step();
  assert.ok(foe.hp < hp0 || foe.dead, 'bolt hit the target');
  assert.ok(h.abilities.find((a) => a.id === 'arc_bolt').cd > 0);
});

test('survival map runs to an outcome with bots', () => {
  const map = loadMap('last-light');
  const g = new Game(map, { seed: 42, slots: botSlots(map) });
  for (let i = 0; i < 20 * 60 * 25 && !g.ended; i++) {
    g.step();
    g.fx.length = 0;
  }
  assert.ok(g.ended, 'game should end within 25 minutes');
});

test('triggers: expressions, timers and messages', () => {
  const map = {
    format: 1, name: 'trigger test', width: 16, height: 16,
    players: [{ key: 'p1', team: 'a' }, { key: 'foes', type: 'computer', team: 'b' }],
    regions: { zone: [4, 4, 4, 4] },
    variables: { n: 0 },
    data: { list: [10, 20, 30] },
    triggers: [
      { event: { type: 'mapInit' }, actions: [
        { do: 'setVar', var: 'n', value: { add: [{ at: [{ data: 'list' }, 2] }, { mul: [2, 3] }] } },
        { do: 'timer', id: 't', duration: 1 },
        { do: 'repeat', count: 3, actions: [{ do: 'spawn', type: 'husk', owner: 'foes', region: 'zone' }] }
      ] },
      { event: { type: 'timerExpires', timer: 't' }, conditions: [{ eq: [{ count: { owner: 'foes' } }, 3] }],
        actions: [{ do: 'message', text: 'n is {n}' }, { do: 'endGame', winners: 'a' }] }
    ]
  };
  assert.ok(validateMap(map).ok, validateMap(map).errors.join(';'));
  const g = new Game(map, { seed: 1, slots: [{ ctrl: 'human' }] });
  assert.equal(g.vars.n, 36);
  const msgs = [];
  for (let i = 0; i < 30; i++) {
    g.step();
    for (const f of g.fx) if (f.k === 'msg') msgs.push(f.text);
    g.fx.length = 0;
  }
  assert.ok(msgs.includes('n is 36'));
  assert.deepEqual(g.ended.winners, ['a']);
});
