// Base content library. Every unit, hero, ability and item here is original.
// Maps may add new entries or override these by id (optionally using
// "extends": "<baseId>" to inherit and tweak an existing definition).
//
// Distances are in world units (1 tile = 32). Times are in seconds.
// Ability numbers may be a single value or an array indexed by level.

export const BASE_UNITS = {
  // ---------------------------------------------------------------- heroes
  hero_warden: {
    name: 'Ember Warden', model: 'hero_knight', color: '#ff8a3d', radius: 12,
    hp: 680, mana: 200, armor: 3, damage: [26, 32], range: 14, cooldown: 1.3, speed: 88,
    hero: { hpPerLevel: 90, manaPerLevel: 18, dmgPerLevel: 3.2, armorPerLevel: 0.4 },
    abilities: ['ground_slam', 'battle_hymn', 'keen_edge', 'inferno_ring'],
    blurb: 'Melee bruiser. Stuns groups and empowers allies.'
  },
  hero_stormcaller: {
    name: 'Stormcaller', model: 'hero_mage', color: '#6fc8ff', radius: 11,
    hp: 470, mana: 320, armor: 1, damage: [20, 27], range: 150, cooldown: 1.5, speed: 84,
    projectile: { speed: 380, color: '#9be3ff', size: 4 },
    hero: { hpPerLevel: 58, manaPerLevel: 36, dmgPerLevel: 2.4, armorPerLevel: 0.3 },
    abilities: ['arc_bolt', 'forked_spark', 'rime_burst', 'skyfall'],
    blurb: 'Ranged caster. Huge burst damage, fragile.'
  },
  hero_ranger: {
    name: 'Thornwood Ranger', model: 'hero_archer', color: '#8fd16a', radius: 11,
    hp: 520, mana: 230, armor: 2, damage: [24, 30], range: 170, cooldown: 1.2, speed: 92,
    projectile: { speed: 460, color: '#e8f5c8', size: 3 },
    hero: { hpPerLevel: 68, manaPerLevel: 22, dmgPerLevel: 3, armorPerLevel: 0.45 },
    abilities: ['arrow_volley', 'call_of_the_pack', 'fleetfoot', 'the_hunt'],
    blurb: 'Ranged carry with wolf companions.'
  },
  hero_veil: {
    name: 'Veilblade', model: 'hero_rogue', color: '#c48bff', radius: 11,
    hp: 560, mana: 210, armor: 2.5, damage: [28, 34], range: 14, cooldown: 1.0, speed: 96,
    hero: { hpPerLevel: 74, manaPerLevel: 20, dmgPerLevel: 3.4, armorPerLevel: 0.5 },
    abilities: ['shadowstep', 'keen_edge', 'fleetfoot', 'death_mark'],
    blurb: 'Agile assassin. Blinks in and finishes targets.'
  },
  hero_sunpriest: {
    name: 'Sunpriest', model: 'hero_priest', color: '#ffe066', radius: 11,
    hp: 500, mana: 300, armor: 1.5, damage: [18, 24], range: 140, cooldown: 1.6, speed: 84,
    projectile: { speed: 360, color: '#fff3a6', size: 4 },
    hero: { hpPerLevel: 62, manaPerLevel: 34, dmgPerLevel: 2.2, armorPerLevel: 0.35 },
    abilities: ['mend', 'sunlance', 'aegis', 'sanctuary'],
    blurb: 'Support. Heals, shields and smites.'
  },

  // -------------------------------------------------------------- summons
  spirit_wolf: {
    name: 'Spirit Wolf', model: 'wolf', color: '#bfe3ff', radius: 9,
    hp: 260, armor: 1, damage: [13, 17], range: 12, cooldown: 1.0, speed: 100, bounty: 8, xp: 15
  },

  // --------------------------------------------------- arena lane units
  rift_warrior: {
    name: 'Rift Warrior', model: 'soldier', radius: 10,
    hp: 430, armor: 1, damage: [16, 20], range: 12, cooldown: 1.1, speed: 72, bounty: 16, xp: 16
  },
  rift_archer: {
    name: 'Rift Archer', model: 'archer', radius: 9,
    hp: 290, armor: 0, damage: [20, 24], range: 140, cooldown: 1.3, speed: 72, bounty: 14, xp: 14,
    projectile: { speed: 420, color: '#ffeccc', size: 2.5 }
  },
  rift_ram: {
    name: 'Siege Ram', model: 'ram', radius: 13,
    hp: 750, armor: 3, damage: [36, 44], range: 14, cooldown: 2.0, speed: 58, bounty: 30, xp: 30,
    buildingDmgMult: 3.5, acquire: 160
  },
  rift_tower: {
    name: 'Guard Tower', model: 'tower_guard', radius: 22, building: { size: 2 },
    hp: 1500, armor: 5, damage: [55, 65], range: 190, cooldown: 1.0, speed: 0, bounty: 150, xp: 120,
    projectile: { speed: 520, color: '#ffd27a', size: 4 }, hpRegen: 0
  },
  rift_core: {
    name: 'Rift Core', model: 'core', radius: 34, building: { size: 3 },
    hp: 5000, armor: 6, damage: [40, 50], range: 170, cooldown: 1.2, speed: 0, bounty: 0, xp: 0,
    projectile: { speed: 480, color: '#ffffff', size: 5 }, hpRegen: 0
  },
  rift_shop: {
    name: 'Wandering Merchant', model: 'shop', radius: 22, building: { size: 2 },
    hp: 1000, armor: 0, damage: null, speed: 0, invulnerable: true, passive: true,
    shop: ['healing_draught', 'mana_draught', 'brawler_gauntlets', 'ward_plate', 'vital_charm',
      'mana_pearl', 'windstride_boots', 'fervor_blade', 'seers_staff', 'bastion_regalia']
  },

  // --------------------------------------------------------- jungle camps
  wild_boar: {
    name: 'Bristleback Boar', model: 'beast', color: '#a0703c', radius: 11,
    hp: 520, armor: 2, damage: [18, 23], range: 12, cooldown: 1.2, speed: 80, bounty: 32, xp: 45
  },
  wild_shaman: {
    name: 'Mire Shaman', model: 'caster', color: '#6fae68', radius: 9,
    hp: 360, mana: 200, armor: 0, damage: [18, 22], range: 130, cooldown: 1.6, speed: 74,
    projectile: { speed: 330, color: '#b6ff9e', size: 3 }, bounty: 30, xp: 45,
    abilities: ['mend']
  },
  wild_ancient: {
    name: 'Mossback Ancient', model: 'golem', color: '#5c7d4a', radius: 16,
    hp: 1600, armor: 4, damage: [42, 52], range: 14, cooldown: 1.6, speed: 64, bounty: 110, xp: 150,
    abilities: ['ground_slam']
  },

  // ------------------------------------------------------ survival foes
  husk: {
    name: 'Hollow Husk', model: 'ghoul', color: '#8a8f7a', radius: 10,
    hp: 300, armor: 1, damage: [13, 17], range: 12, cooldown: 1.1, speed: 70, bounty: 7, xp: 18
  },
  gloomspitter: {
    name: 'Gloomspitter', model: 'spitter', color: '#a1d36b', radius: 9,
    hp: 210, armor: 0, damage: [15, 19], range: 130, cooldown: 1.5, speed: 68,
    projectile: { speed: 300, color: '#c6ff6b', size: 3 }, bounty: 8, xp: 20
  },
  dread_brute: {
    name: 'Dread Brute', model: 'brute', color: '#7b4a62', radius: 14,
    hp: 900, armor: 3, damage: [32, 42], range: 14, cooldown: 1.5, speed: 62, bounty: 24, xp: 55
  },
  wisp_wraith: {
    name: 'Wisp Wraith', model: 'wraith', color: '#9fb6ff', radius: 9,
    hp: 220, armor: 0, damage: [16, 20], range: 12, cooldown: 0.9, speed: 104, bounty: 6, xp: 16
  },
  abyss_tyrant: {
    name: 'Abyss Tyrant', model: 'tyrant', color: '#d0405a', radius: 20,
    hp: 6000, mana: 400, armor: 6, damage: [70, 90], range: 18, cooldown: 1.6, speed: 60,
    bounty: 300, xp: 500, abilities: ['ground_slam', 'inferno_ring']
  },
  sun_beacon: {
    name: 'Sun Beacon', model: 'beacon', color: '#ffe38a', radius: 34, building: { size: 3 },
    hp: 4000, armor: 5, damage: [30, 40], range: 160, cooldown: 1.0, speed: 0, hpRegen: 2,
    projectile: { speed: 520, color: '#fff2b0', size: 4 }
  },

  // ------------------------------------------------------- TD invaders
  td_rimeling: {
    name: 'Rimeling', model: 'imp', color: '#bfe8ff', radius: 9,
    hp: 55, armor: 0, damage: null, speed: 66, bounty: 3
  },
  td_skitter: {
    name: 'Skitterclaw', model: 'bug', color: '#d8a24a', radius: 8,
    hp: 38, armor: 0, damage: null, speed: 104, bounty: 3
  },
  td_shellback: {
    name: 'Shellback', model: 'turtle', color: '#7aa38a', radius: 11,
    hp: 120, armor: 4, damage: null, speed: 52, bounty: 5
  },
  td_mote: {
    name: 'Ember Mote', model: 'wisp', color: '#ff9b4a', radius: 7,
    hp: 26, armor: 0, damage: null, speed: 84, bounty: 2
  },
  td_colossus: {
    name: 'Glacial Colossus', model: 'colossus', color: '#9fd8ff', radius: 17,
    hp: 1100, armor: 3, damage: null, speed: 44, bounty: 50
  },

  // ------------------------------------------------------- TD towers
  td_barricade: {
    name: 'Barricade', model: 'wall', radius: 20, building: { size: 2 },
    hp: 400, armor: 10, damage: null, speed: 0, cost: 10, passive: true,
    blurb: 'Cheap block for building a maze.'
  },
  td_arrow1: {
    name: 'Arrow Spire', model: 'tower_arrow', color: '#e6d3a3', radius: 20, building: { size: 2 },
    hp: 500, damage: [10, 14], range: 135, cooldown: 0.7, speed: 0, cost: 50,
    projectile: { speed: 520, color: '#fff1c4', size: 2.5 }, upgradesTo: ['td_arrow2'],
    blurb: 'Fast single-target shots.'
  },
  td_arrow2: {
    extends: 'td_arrow1', name: 'Arrow Spire II', damage: [24, 30], range: 140, cost: 110,
    upgradesTo: ['td_arrow3'], tier: 2
  },
  td_arrow3: {
    extends: 'td_arrow1', name: 'Arrow Spire III', damage: [58, 70], range: 150, cooldown: 0.7, cost: 240,
    upgradesTo: [], tier: 3
  },
  td_frost1: {
    name: 'Frost Obelisk', model: 'tower_frost', color: '#8fe3ff', radius: 20, building: { size: 2 },
    hp: 500, damage: [5, 7], range: 115, cooldown: 1.1, speed: 0, cost: 80, splash: 40,
    onHit: { slow: { mult: 0.55, duration: 2 } },
    projectile: { speed: 380, color: '#bff4ff', size: 4 }, upgradesTo: ['td_frost2'],
    blurb: 'Slows everything it hits.'
  },
  td_frost2: {
    extends: 'td_frost1', name: 'Frost Obelisk II', damage: [14, 18], splash: 55, cost: 140,
    onHit: { slow: { mult: 0.45, duration: 2.5 } }, upgradesTo: [], tier: 2
  },
  td_cannon1: {
    name: 'Cannon Bastion', model: 'tower_cannon', color: '#c9a07a', radius: 20, building: { size: 2 },
    hp: 600, damage: [20, 26], range: 125, cooldown: 1.9, speed: 0, cost: 100, splash: 46,
    projectile: { speed: 300, color: '#3a3a3a', size: 5 }, upgradesTo: ['td_cannon2'],
    blurb: 'Slow, heavy splash damage.'
  },
  td_cannon2: {
    extends: 'td_cannon1', name: 'Cannon Bastion II', damage: [55, 68], splash: 56, cost: 180,
    upgradesTo: ['td_cannon3'], tier: 2
  },
  td_cannon3: {
    extends: 'td_cannon1', name: 'Cannon Bastion III', damage: [130, 160], splash: 66, cost: 360,
    upgradesTo: [], tier: 3
  },
  td_storm1: {
    name: 'Storm Pylon', model: 'tower_storm', color: '#c7a6ff', radius: 20, building: { size: 2 },
    hp: 500, damage: [26, 32], range: 135, cooldown: 1.4, speed: 0, cost: 160,
    chain: { bounces: 3, falloff: 0.8, range: 90 }, upgradesTo: ['td_storm2'],
    blurb: 'Lightning that jumps between foes.'
  },
  td_storm2: {
    extends: 'td_storm1', name: 'Storm Pylon II', damage: [70, 84], cost: 300,
    chain: { bounces: 5, falloff: 0.85, range: 100 }, upgradesTo: [], tier: 2
  }
};

export const BASE_ABILITIES = {
  ground_slam: {
    name: 'Ground Slam', icon: '💥', target: 'none', aoe: 70,
    mana: [90, 100, 110], cooldown: [10, 9, 8],
    effect: { type: 'area', center: 'self', damage: [60, 110, 160], stun: [1, 1.25, 1.5] },
    tip: 'Stuns and damages nearby enemies.'
  },
  battle_hymn: {
    name: 'Battle Hymn', icon: '📯', target: 'none', aoe: 180,
    mana: 75, cooldown: 20,
    effect: { type: 'buff', who: 'allies', buff: { dmgAdd: [6, 12, 18], duration: 12, color: '#ffb347' } },
    tip: 'Nearby allies deal bonus damage.'
  },
  keen_edge: {
    name: 'Keen Edge', icon: '🗡️', passive: true,
    effect: { type: 'crit', chance: [0.12, 0.18, 0.24], mult: [2, 2.2, 2.5] },
    tip: 'Chance to deal critical strikes.'
  },
  inferno_ring: {
    name: 'Inferno Ring', icon: '🔥', target: 'none', aoe: 110, ultimate: true,
    mana: 150, cooldown: 70,
    effect: { type: 'area', center: 'self', damage: 320, slow: { mult: 0.5, duration: 3 } },
    tip: 'Ultimate. Massive fire burst around the hero.'
  },
  arc_bolt: {
    name: 'Arc Bolt', icon: '⚡', target: 'unit', targets: 'enemy', range: 200,
    mana: [75, 90, 105], cooldown: [9, 8, 7],
    effect: { type: 'projectile', damage: [90, 160, 230], stun: [0.6, 0.9, 1.2], speed: 420, color: '#9be3ff', size: 6 },
    tip: 'Damages and stuns a target.'
  },
  forked_spark: {
    name: 'Forked Spark', icon: '🌩️', target: 'unit', targets: 'enemy', range: 190,
    mana: [90, 100, 110], cooldown: [8, 8, 7],
    effect: { type: 'chain', damage: [80, 120, 170], bounces: [3, 4, 5], falloff: 0.85, range: 110, color: '#c9b6ff' },
    tip: 'Lightning that bounces between enemies.'
  },
  rime_burst: {
    name: 'Rime Burst', icon: '❄️', target: 'point', range: 200, aoe: 70,
    mana: [100, 110, 120], cooldown: [11, 10, 9],
    effect: { type: 'area', damage: [70, 120, 170], slow: { mult: 0.5, duration: [2, 3, 4] }, color: '#bff4ff' },
    tip: 'Damages and slows enemies in an area.'
  },
  skyfall: {
    name: 'Skyfall', icon: '☄️', target: 'point', range: 220, aoe: 100, ultimate: true,
    mana: 175, cooldown: 80,
    effect: { type: 'area', damage: 450, delay: 1.2, color: '#ff7b3d' },
    tip: 'Ultimate. A star crashes down after a short delay.'
  },
  arrow_volley: {
    name: 'Arrow Volley', icon: '🏹', target: 'point', range: 200, aoe: 70,
    mana: 85, cooldown: [9, 8, 7],
    effect: { type: 'area', damage: [70, 120, 170], color: '#e8f5c8' },
    tip: 'Rains arrows on an area.'
  },
  call_of_the_pack: {
    name: 'Call of the Pack', icon: '🐺', target: 'none',
    mana: 110, cooldown: 30,
    effect: { type: 'summon', unit: 'spirit_wolf', count: [1, 2, 3], duration: 40 },
    tip: 'Summons spirit wolves.'
  },
  fleetfoot: {
    name: 'Fleetfoot', icon: '💨', passive: true,
    effect: { type: 'evasion', chance: [0.1, 0.17, 0.24] },
    tip: 'Chance to dodge attacks.'
  },
  the_hunt: {
    name: 'The Hunt', icon: '🎯', target: 'none', ultimate: true,
    mana: 120, cooldown: 60,
    effect: { type: 'buff', who: 'self', buff: { cdMult: 0.6, dmgAdd: 25, speedAdd: 20, duration: 15, color: '#8fd16a' } },
    tip: 'Ultimate. Greatly boosts attack speed and damage.'
  },
  shadowstep: {
    name: 'Shadowstep', icon: '🌀', target: 'point', range: [220, 280, 340],
    mana: [60, 50, 40], cooldown: [10, 8, 6],
    effect: { type: 'blink' },
    tip: 'Teleport to a nearby location.'
  },
  death_mark: {
    name: 'Death Mark', icon: '☠️', target: 'unit', targets: 'enemy', range: 140, ultimate: true,
    mana: 150, cooldown: 60,
    effect: { type: 'projectile', damage: 520, speed: 700, color: '#d79bff', size: 7 },
    tip: 'Ultimate. Huge single-target damage.'
  },
  mend: {
    name: 'Mend', icon: '✚', target: 'unit', targets: 'ally', range: 200,
    mana: [70, 80, 90], cooldown: [6, 6, 5],
    effect: { type: 'heal', amount: [150, 250, 350] },
    tip: 'Heals an ally.'
  },
  sunlance: {
    name: 'Sunlance', icon: '🔆', target: 'unit', targets: 'enemy', range: 190,
    mana: 80, cooldown: 7,
    effect: { type: 'projectile', damage: [70, 120, 170], speed: 500, color: '#fff3a6', size: 5 },
    tip: 'A spear of light.'
  },
  aegis: {
    name: 'Aegis', icon: '🛡️', target: 'none', aoe: 180,
    mana: 75, cooldown: 18,
    effect: { type: 'buff', who: 'allies', buff: { armorAdd: [3, 5, 7], duration: 15, color: '#ffe066' } },
    tip: 'Grants armor to nearby allies.'
  },
  sanctuary: {
    name: 'Sanctuary', icon: '🌅', target: 'none', aoe: 220, ultimate: true,
    mana: 200, cooldown: 90,
    effect: { type: 'areaHeal', amount: 400, buff: { armorAdd: 5, duration: 10, color: '#fff3a6' } },
    tip: 'Ultimate. Heals all nearby allies.'
  }
};

export const BASE_ITEMS = {
  healing_draught: { name: 'Healing Draught', icon: '🧪', cost: 90, use: { heal: 320 }, charges: 2, tip: 'Restores 320 HP. 2 uses.' },
  mana_draught: { name: 'Mana Draught', icon: '🔮', cost: 80, use: { mana: 160 }, charges: 2, tip: 'Restores 160 mana. 2 uses.' },
  brawler_gauntlets: { name: "Brawler's Gauntlets", icon: '🥊', cost: 250, dmg: 8, tip: '+8 damage' },
  ward_plate: { name: 'Ward Plate', icon: '🛡️', cost: 250, armor: 3, tip: '+3 armor' },
  vital_charm: { name: 'Vital Charm', icon: '❤️', cost: 300, hp: 180, tip: '+180 max HP' },
  mana_pearl: { name: 'Mana Pearl', icon: '💠', cost: 250, mana: 150, manaRegen: 1, tip: '+150 mana, +1 mana regen' },
  windstride_boots: { name: 'Windstride Boots', icon: '👢', cost: 300, speed: 14, tip: '+14 move speed' },
  fervor_blade: { name: 'Fervor Blade', icon: '⚔️', cost: 750, dmg: 18, attackSpeed: 0.15, tip: '+18 damage, +15% attack speed' },
  seers_staff: { name: "Seer's Staff", icon: '🪄', cost: 700, mana: 250, manaRegen: 2, dmg: 6, tip: '+250 mana, +2 regen, +6 damage' },
  bastion_regalia: { name: 'Bastion Regalia', icon: '👑', cost: 900, armor: 5, hp: 300, hpRegen: 2, tip: '+5 armor, +300 HP, +2 HP regen' }
};

const UNIT_DEFAULTS = {
  name: 'Unit', model: 'soldier', radius: 10, hp: 100, mana: 0, armor: 0,
  damage: null, range: 12, cooldown: 1.2, speed: 70, bounty: 0, xp: 0
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function resolveExtends(table, id, seen = new Set()) {
  const def = table[id];
  if (!def || !def.extends) return def;
  if (seen.has(id)) throw new Error(`Circular "extends" on ${id}`);
  seen.add(id);
  const base = resolveExtends(table, def.extends, seen);
  if (!base) throw new Error(`${id} extends unknown "${def.extends}"`);
  const out = { ...base, ...def };
  delete out.extends;
  return out;
}

// Merge map-provided content over the base library and normalise defaults.
export function buildContent(map = {}) {
  const rawUnits = { ...BASE_UNITS, ...(isObj(map.unitTypes) ? map.unitTypes : {}) };
  const rawAbilities = { ...BASE_ABILITIES, ...(isObj(map.abilities) ? map.abilities : {}) };
  const rawItems = { ...BASE_ITEMS, ...(isObj(map.items) ? map.items : {}) };

  const units = {};
  for (const id of Object.keys(rawUnits)) {
    const d = { ...UNIT_DEFAULTS, ...resolveExtends(rawUnits, id) };
    d.id = id;
    if (d.acquire == null) d.acquire = Math.max(220, (d.range || 0) + 60);
    if (d.hpRegen == null) d.hpRegen = d.hero ? 1.5 : d.building ? 0 : 0.5;
    if (d.manaRegen == null) d.manaRegen = d.mana > 0 ? (d.hero ? 0.9 : 0.6) : 0;
    if (d.building) d.speed = 0;
    d.abilities = Array.isArray(d.abilities) ? d.abilities.slice(0, 6) : [];
    units[id] = d;
  }
  const abilities = {};
  for (const id of Object.keys(rawAbilities)) {
    const d = resolveExtends(rawAbilities, id);
    abilities[id] = { id, maxLevel: d.ultimate ? 1 : 3, target: 'none', icon: '✦', ...d };
  }
  const items = {};
  for (const id of Object.keys(rawItems)) {
    items[id] = { id, icon: '◆', cost: 100, ...resolveExtends(rawItems, id) };
  }
  return { units, abilities, items };
}

// Value for a given (0-based) level; scalars apply to all levels.
export function lv(v, level) {
  if (Array.isArray(v)) return v[Math.max(0, Math.min(level, v.length - 1))];
  return v;
}
