// Map file validation. Maps are plain JSON documents (see docs/MAP_FORMAT.md).
// The same validator runs on clients and on the lobby server, so a map shared
// online is checked before anyone downloads or plays it.
import { buildContent } from './content.js';
import { TERRAIN_INDEX } from './grid.js';
import { EVENT_TYPES, ACTION_TYPES, EXPR_OPS } from './triggers.js';
import { hashString } from './rng.js';

export const MAP_FORMAT = 1;
export const MAX_MAP_BYTES = 512 * 1024;

const LIMITS = { size: 160, players: 12, units: 800, regions: 200, triggers: 400, depth: 40 };

export function canonicalJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export function mapHash(map) {
  return hashString(canonicalJSON(map)).toString(16).padStart(8, '0');
}

function depthOf(v, d = 0) {
  if (d > LIMITS.depth) return d;
  if (v && typeof v === 'object') {
    let m = d;
    for (const k in v) m = Math.max(m, depthOf(v[k], d + 1));
    return m;
  }
  return d;
}

export function validateMap(map) {
  const errors = [];
  const err = (m) => {
    if (errors.length < 50) errors.push(m);
  };
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, errors: ['Map must be a JSON object.'] };
  let size = 0;
  try {
    size = JSON.stringify(map).length;
  } catch {
    return { ok: false, errors: ['Map is not serialisable.'] };
  }
  if (size > MAX_MAP_BYTES) err(`Map is too large (${size} bytes, max ${MAX_MAP_BYTES}).`);
  if (depthOf(map) > LIMITS.depth) err('Map is nested too deeply.');
  if (map.format !== MAP_FORMAT) err(`Unsupported map format ${map.format} (expected ${MAP_FORMAT}).`);
  if (typeof map.name !== 'string' || !map.name.trim()) err('Map needs a "name".');
  for (const k of ['width', 'height']) {
    if (!Number.isInteger(map[k]) || map[k] < 8 || map[k] > LIMITS.size) err(`"${k}" must be an integer 8..${LIMITS.size}.`);
  }
  if (errors.length) return { ok: false, errors };

  // Terrain
  const tr = map.terrain || {};
  if (tr.fill && TERRAIN_INDEX[tr.fill] == null) err(`Unknown terrain fill "${tr.fill}".`);
  for (const op of tr.ops || []) if (op.t && TERRAIN_INDEX[op.t] == null) err(`Unknown terrain "${op.t}".`);
  if ((tr.ops || []).length > 2000) err('Too many terrain ops.');

  // Content
  let content;
  try {
    content = buildContent(map);
  } catch (e) {
    err(String(e.message || e));
    return { ok: false, errors };
  }
  for (const [id, u] of Object.entries(content.units)) {
    for (const a of u.abilities) if (!content.abilities[a]) err(`Unit ${id} has unknown ability "${a}".`);
    for (const to of u.upgradesTo || []) if (!content.units[to]) err(`Unit ${id} upgrades to unknown "${to}".`);
    for (const it of u.shop || []) if (!content.items[it]) err(`Shop ${id} sells unknown item "${it}".`);
    if (!(u.hp > 0)) err(`Unit ${id} needs hp > 0.`);
  }
  for (const [id, a] of Object.entries(content.abilities)) {
    if (a.effect && a.effect.type === 'summon' && !content.units[a.effect.unit]) err(`Ability ${id} summons unknown unit.`);
  }

  // Regions
  const regions = map.regions || {};
  if (Object.keys(regions).length > LIMITS.regions) err('Too many regions.');
  for (const [name, r] of Object.entries(regions)) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === 'number')) err(`Region "${name}" must be [x, y, w, h].`);
  }
  const hasRegion = (n) => typeof n === 'string' && Object.prototype.hasOwnProperty.call(regions, n);

  // Players
  const players = map.players;
  if (!Array.isArray(players) || !players.length) err('Map needs at least one player.');
  else {
    if (players.length > LIMITS.players) err(`At most ${LIMITS.players} players.`);
    const keys = new Set();
    let slots = 0;
    for (const p of players) {
      if (!p || typeof p.key !== 'string') {
        err('Every player needs a "key".');
        continue;
      }
      if (keys.has(p.key)) err(`Duplicate player key "${p.key}".`);
      keys.add(p.key);
      if (p.type !== 'computer') slots++;
      if (p.start && !hasRegion(p.start)) err(`Player ${p.key} start region "${p.start}" not found.`);
      if (p.defend && !hasRegion(p.defend)) err(`Player ${p.key} defend region "${p.defend}" not found.`);
      for (const n of p.aiPath || []) if (!hasRegion(n)) err(`Player ${p.key} aiPath region "${n}" not found.`);
    }
    if (!slots) err('Map needs at least one player slot (type "slot").');
    for (const u of map.units || []) {
      if (!content.units[u.type]) err(`Placed unit has unknown type "${u.type}".`);
      if (!keys.has(u.owner)) err(`Placed unit owner "${u.owner}" not found.`);
      if (!Array.isArray(u.at) || u.at.length !== 2) err('Placed unit needs "at": [x, y].');
    }
    if ((map.units || []).length > LIMITS.units) err('Too many placed units.');
  }

  // Rules
  const rules = map.rules || {};
  if (rules.heroSelect) for (const h of rules.heroSelect.pool || []) if (!content.units[h] || !content.units[h].hero) err(`heroSelect pool has non-hero "${h}".`);
  const bl = rules.buildList;
  const blAll = Array.isArray(bl) ? bl : bl && typeof bl === 'object' ? Object.values(bl).flat() : [];
  for (const b of blAll) if (!content.units[b] || !content.units[b].building) err(`buildList entry "${b}" is not a building.`);
  for (const z of rules.healZones || []) if (!hasRegion(z.region)) err(`healZone region "${z.region}" not found.`);
  for (const pc of rules.pathChecks || []) for (const n of pc) if (!hasRegion(n)) err(`pathChecks region "${n}" not found.`);
  if (rules.buildZones) for (const list of Object.values(rules.buildZones)) for (const n of list) if (!hasRegion(n)) err(`buildZones region "${n}" not found.`);

  // Triggers
  const trigs = map.triggers || [];
  if (!Array.isArray(trigs)) err('"triggers" must be an array.');
  else {
    if (trigs.length > LIMITS.triggers) err('Too many triggers.');
    trigs.forEach((t, i) => {
      const where = `trigger ${t && t.id ? t.id : i}`;
      if (!t || !t.event || !EVENT_TYPES.includes(t.event.type)) err(`${where}: unknown event type "${t && t.event && t.event.type}".`);
      else if (t.event.region && !hasRegion(t.event.region)) err(`${where}: region "${t.event.region}" not found.`);
      checkActions(t && t.actions, where, err, content, hasRegion);
      if (t && t.conditions != null) checkExpr(t.conditions, where, err);
    });
  }
  return { ok: errors.length === 0, errors };
}

function checkActions(list, where, err, content, hasRegion) {
  if (list == null) return;
  if (!Array.isArray(list)) return err(`${where}: actions must be an array.`);
  for (const a of list) {
    if (!a || !ACTION_TYPES.includes(a.do)) {
      err(`${where}: unknown action "${a && a.do}".`);
      continue;
    }
    if (a.do === 'spawn' && typeof a.type === 'string' && !content.units[a.type]) err(`${where}: spawn of unknown unit "${a.type}".`);
    if (typeof a.region === 'string' && !hasRegion(a.region)) err(`${where}: region "${a.region}" not found.`);
    for (const n of a.path || []) if (!hasRegion(n)) err(`${where}: path region "${n}" not found.`);
    for (const k of ['then', 'else', 'actions']) if (a[k]) checkActions(a[k], where, err, content, hasRegion);
    for (const k of ['value', 'cond', 'count', 'amount', 'type', 'hpMul', 'delay', 'duration']) if (a[k] != null) checkExpr(a[k], where, err);
  }
}

function checkExpr(e, where, err) {
  if (e == null || typeof e !== 'object') return;
  if (Array.isArray(e)) return e.forEach((x) => checkExpr(x, where, err));
  const keys = Object.keys(e);
  if (keys.length !== 1 || !EXPR_OPS.includes(keys[0])) {
    // Filter objects (used by count/order) are allowed to have several keys.
    if (keys.some((k) => ['owner', 'team', 'unitType', 'hero', 'building', 'inRegion', 'ctrl'].includes(k))) return;
    return err(`${where}: unknown expression ${JSON.stringify(e).slice(0, 60)}.`);
  }
  const v = e[keys[0]];
  if (keys[0] === 'count' || keys[0] === 'playerCount') return;
  checkExpr(v, where, err);
}

// Small summary used in lobbies / map browsers.
export function mapSummary(map) {
  const slots = (map.players || []).filter((p) => p.type !== 'computer');
  const teams = [...new Set(slots.map((p) => p.team || p.key))];
  return {
    name: map.name,
    id: map.id || '',
    author: map.author || 'Unknown',
    genre: map.genre || 'Custom',
    description: map.description || '',
    size: `${map.width}×${map.height}`,
    slots: slots.length,
    teams: teams.length,
    hash: mapHash(map)
  };
}
