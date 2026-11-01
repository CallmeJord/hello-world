// Bot players: pick a hero, learn skills, shop, push lanes or defend, retreat
// when hurt. Runs inside the deterministic simulation (issues normal commands).
const DEFAULT_BOT_ITEMS = [
  'healing_draught', 'brawler_gauntlets', 'ward_plate', 'vital_charm', 'windstride_boots',
  'fervor_blade', 'bastion_regalia', 'seers_staff'
];

export function updateBots(g) {
  for (const P of g.players) {
    if (P.ctrl !== 'bot') continue;
    if (((g.tick / 5) + P.index) % 2 !== 0) continue; // every 10 ticks, staggered
    runBot(g, P);
  }
}

function dist2(a, x, y) {
  const dx = a.x - x, dy = a.y - y;
  return dx * dx + dy * dy;
}

function runBot(g, P) {
  const hs = g.rules.heroSelect;
  if (!P.hero) {
    if (hs && hs.pool && hs.pool.length) botPick(g, P, hs);
    return;
  }
  const h = g.unitById.get(P.hero);
  if (!h || h.dead) return;
  learn(g, P, h);
  shop(g, P, h);
  behave(g, P, h);
}

function botPick(g, P, hs) {
  // Give human teammates a few seconds to choose first.
  if (g.tick < 60 && g.players.some((o) => o.ctrl === 'human' && o.team === P.team && !o.hero)) return;
  let pool = hs.pool.filter((id) => g.content.units[id]);
  if (hs.unique) {
    const taken = new Set(g.units.filter((u) => g.players[u.owner].team === P.team).map((u) => u.type));
    pool = pool.filter((id) => !taken.has(id));
  }
  if (!pool.length) return;
  g.applyCommand(P.index, { t: 'pick', type: g.rng.pick(pool) });
}

function learn(g, P, h) {
  if (h.skillPoints <= 0) return;
  let best = null;
  for (const ab of h.abilities) {
    if (!g.canLearn(h, ab)) continue;
    const def = g.content.abilities[ab.id];
    const score = (def.ultimate ? -100 : 0) + ab.level * 10 + h.abilities.indexOf(ab);
    if (!best || score < best.score) best = { ab, score };
  }
  if (best) g.applyCommand(P.index, { t: 'learn', u: h.id, a: best.ab.id });
}

function shop(g, P, h) {
  if (!h.items || !h.items.includes(null)) return;
  const s = g.findShop(h);
  if (!s) return;
  const prio = g.rules.botItems || DEFAULT_BOT_ITEMS;
  for (const id of prio) {
    const d = g.content.items[id];
    if (!d || !s.t.shop.includes(id)) continue;
    if (h.items.some((it) => it && it.id === id)) continue;
    if (P.gold < d.cost) return; // save up for the next item in priority order
    g.applyCommand(P.index, { t: 'buy', u: h.id, item: id });
    return;
  }
}

function moveTo(g, P, h, x, y) {
  const o = h.order;
  if (o.type === 'move' && o.pts.length) {
    const last = o.pts[o.pts.length - 1];
    if (Math.abs(last[0] - x) < 30 && Math.abs(last[1] - y) < 30) return;
  }
  g.applyCommand(P.index, { t: 'move', u: [h.id], x, y });
}

function behave(g, P, h) {
  const B = P.bot;
  const home = P.start ? g.regions[P.start] : null;
  const frac = h.hp / h.s.maxHp;

  if (frac < 0.45) {
    const slot = h.items ? h.items.findIndex((it) => it && g.content.items[it.id] && g.content.items[it.id].use && g.content.items[it.id].use.heal) : -1;
    if (slot >= 0) g.applyCommand(P.index, { t: 'use', u: h.id, slot });
  }
  if (B.state === 'retreat') {
    if (frac > 0.92 || !home) B.state = 'push';
    else {
      moveTo(g, P, h, home.cx, home.cy);
      return;
    }
  } else if (frac < 0.3 && home) {
    B.state = 'retreat';
    moveTo(g, P, h, home.cx, home.cy);
    return;
  }

  const enemies = [];
  g.enemiesNear(h.x, h.y, 230, P.index, (e) => {
    // Leave neutral camps alone unless they are fighting us.
    if (e.guard && e.order.type !== 'attack') return;
    enemies.push(e);
  });
  if (enemies.length) {
    // Respect enemy towers: back off while a tower is shooting at us and
    // there are not enough friendly minions around to take the aggro.
    for (const t of enemies) {
      if (!t.building || !t.t.damage) continue;
      const danger = t.s.range + t.radius + h.radius + 30;
      if (dist2(h, t.x, t.y) > danger * danger) continue;
      let tanks = 0;
      g.alliesNear(t.x, t.y, t.s.range + t.radius, P.index, (a) => {
        if (!a.t.hero && !a.building) tanks++;
      });
      const focused = t.target === h.id;
      if ((focused && (frac < 0.65 || tanks < 2)) || (tanks === 0 && h.level < 4)) {
        const dx = h.x - t.x, dy = h.y - t.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        moveTo(g, P, h, h.x + (dx / d) * 90, h.y + (dy / d) * 90);
        return;
      }
    }
    let target = null, bs = Infinity;
    for (const e of enemies) {
      const d = Math.sqrt(dist2(h, e.x, e.y));
      let score = d;
      if (e.t.hero) score -= 120 + (1 - e.hp / e.s.maxHp) * 150;
      if (e.building) score += 200;
      if (score < bs) {
        bs = score;
        target = e;
      }
    }
    if (target && !(h.order.type === 'attack' && h.order.target === target.id) && h.order.type !== 'cast') {
      g.applyCommand(P.index, { t: 'attack', u: [h.id], target: target.id });
    }
    return;
  }

  if (P.defend && g.regions[P.defend]) {
    const r = g.regions[P.defend];
    if (dist2(h, r.cx, r.cy) > 200 * 200 && h.order.type !== 'amove') g.applyCommand(P.index, { t: 'amove', u: [h.id], x: r.cx, y: r.cy });
    return;
  }
  if (P.aiPath && P.aiPath.length) {
    if (h.order.type === 'amove' || h.order.type === 'attack') return;
    const pts = P.aiPath.map((n) => g.regions[n]).filter(Boolean).map((r) => [r.cx, r.cy]);
    if (!pts.length) return;
    // Resume from the closest waypoint that is not behind us.
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => {
      const d = dist2(h, p[0], p[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bd < 90 * 90 && bi < pts.length - 1) bi++;
    g.applyCommand(P.index, { t: 'amove', u: [h.id], x: pts[bi][0], y: pts[bi][1] });
    for (let i = bi + 1; i < pts.length; i++) g.applyCommand(P.index, { t: 'amove', u: [h.id], x: pts[i][0], y: pts[i][1], q: true });
  }
}
