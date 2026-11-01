// Ember Rift — 3-lane hero arena (up to 3v3). Empty slots are filled by bots.
const W = 72, H = 44;
const mirror = ([x, y]) => [W - x, y];

const towersWest = [[6, 9], [16, 5], [17, 22], [27, 22], [6, 35], [16, 39]];
const camps = [
  { region: 'camp_nw', rect: [21, 10, 6, 6], units: [['wild_boar', 23, 12.5], ['wild_boar', 25, 13.5]] },
  { region: 'camp_ne', rect: [45, 10, 6, 6], units: [['wild_boar', 47, 12.5], ['wild_shaman', 49, 13.5]] },
  { region: 'camp_sw', rect: [21, 28, 6, 6], units: [['wild_shaman', 23, 30.5], ['wild_boar', 25, 31.5]] },
  { region: 'camp_se', rect: [45, 28, 6, 6], units: [['wild_boar', 47, 30.5], ['wild_boar', 49, 31.5]] },
  { region: 'camp_n', rect: [33, 10, 7, 7], units: [['wild_ancient', 39, 13]] },
  { region: 'camp_s', rect: [32, 28, 7, 7], units: [['wild_ancient', 33, 31]] }
];

const lanes = {
  dawn: {
    top: { spawn: 'w_top_spawn', path: ['top_nw', 'top_ne', 'e_top', 'east_core'] },
    mid: { spawn: 'w_mid_spawn', path: ['mid_c', 'e_mid', 'east_core'] },
    bot: { spawn: 'w_bot_spawn', path: ['bot_sw', 'bot_se', 'e_bot', 'east_core'] }
  },
  dusk: {
    top: { spawn: 'e_top_spawn', path: ['top_ne', 'top_nw', 'w_top', 'west_core'] },
    mid: { spawn: 'e_mid_spawn', path: ['mid_c', 'w_mid', 'west_core'] },
    bot: { spawn: 'e_bot_spawn', path: ['bot_se', 'bot_sw', 'w_bot', 'west_core'] }
  }
};

const waveActions = [];
for (const [team, ls] of Object.entries(lanes)) {
  const owner = team === 'dawn' ? 'dawn_guard' : 'dusk_guard';
  for (const lane of Object.values(ls)) {
    waveActions.push(
      { do: 'spawn', type: 'rift_warrior', count: { var: 'meleeCount' }, owner, region: lane.spawn, path: lane.path, interval: 0.4 },
      { do: 'spawn', type: 'rift_archer', count: 1, owner, region: lane.spawn, path: lane.path },
      {
        do: 'if', cond: { eq: [{ mod: [{ var: 'waveNo' }, 3] }, 0] },
        then: [{ do: 'spawn', type: 'rift_ram', count: 1, owner, region: lane.spawn, path: lane.path }]
      }
    );
  }
}

const campTriggers = camps.map((c) => ({
  id: `respawn_${c.region}`,
  event: { type: 'periodic', interval: 60, start: 60 },
  conditions: [{ eq: [{ count: { owner: 'neutral', inRegion: c.region } }, 0] }],
  actions: c.units.map(([type]) => ({ do: 'spawn', type, owner: 'neutral', region: c.region, guard: true }))
}));

const units = [
  { type: 'rift_core', owner: 'dawn_guard', at: [6.5, 22.5] },
  { type: 'rift_core', owner: 'dusk_guard', at: [W - 6.5, 22.5] },
  { type: 'rift_shop', owner: 'dawn_guard', at: [4, 17] },
  { type: 'rift_shop', owner: 'dusk_guard', at: [W - 4, 17] },
  ...towersWest.map((p) => ({ type: 'rift_tower', owner: 'dawn_guard', at: p })),
  ...towersWest.map((p) => ({ type: 'rift_tower', owner: 'dusk_guard', at: mirror(p) })),
  ...camps.flatMap((c) => c.units.map(([type, x, y]) => ({ type, owner: 'neutral', at: [x, y] })))
];

const slot = (key, team, color, lane) => ({
  key, type: 'slot', team, color, ai: true,
  start: team === 'dawn' ? 'west_fountain' : 'east_fountain',
  aiPath: lanes[team][lane].path.slice(0, -1).concat(team === 'dawn' ? ['east_core'] : ['west_core']).filter((r, i, a) => a.indexOf(r) === i)
});

export default {
  format: 1,
  id: 'ember-rift',
  name: 'Ember Rift',
  author: 'Riftforge',
  genre: 'Hero Arena',
  description: 'Three lanes, two teams, one Rift Core each. Pick a hero, push with your minions (siege rams join every third wave), farm jungle camps, buy items and destroy the enemy core. Up to 3v3 — bots fill empty slots.',
  width: W,
  height: H,
  terrain: {
    fill: 'trees',
    ops: [
      { border: 1, t: 'rock' },
      { circle: [24, 13, 3.5], t: 'grass' },
      { circle: [48, 13, 3.5], t: 'grass' },
      { circle: [24, 31, 3.5], t: 'grass' },
      { circle: [48, 31, 3.5], t: 'grass' },
      { circle: [36, 13, 4], t: 'grass' },
      { circle: [36, 31, 4], t: 'grass' },
      { path: [[24, 5], [24, 39]], w: 3, t: 'grass' },
      { path: [[48, 5], [48, 39]], w: 3, t: 'grass' },
      { path: [[24, 13], [48, 13]], w: 3, t: 'grass' },
      { path: [[24, 31], [48, 31]], w: 3, t: 'grass' },
      { circle: [36, 13, 1.6], t: 'water' },
      { circle: [36, 31, 1.6], t: 'water' },
      { path: [[36, 17], [36, 27]], w: 2, t: 'water' },
      { path: [[12, 22], [60, 22]], w: 6, t: 'dirt' },
      { path: [[6, 16], [6, 5], [66, 5], [66, 16]], w: 6, t: 'dirt' },
      { path: [[6, 28], [6, 39], [66, 39], [66, 28]], w: 6, t: 'dirt' },
      { rect: [1, 14, 13, 17], t: 'stone' },
      { rect: [W - 14, 14, 13, 17], t: 'stone' },
      { scatter: [1, 14, 13, 17], t: 'grass', density: 0.15 },
      { scatter: [W - 14, 14, 13, 17], t: 'grass', density: 0.15 }
    ]
  },
  regions: {
    west_fountain: [1, 20, 3, 5],
    east_fountain: [W - 4, 20, 3, 5],
    west_core: [4, 20, 5, 5],
    east_core: [W - 9, 20, 5, 5],
    w_top_spawn: [5, 14, 2, 2],
    w_mid_spawn: [11, 21, 2, 2],
    w_bot_spawn: [5, 28, 2, 2],
    e_top_spawn: [W - 7, 14, 2, 2],
    e_mid_spawn: [W - 13, 21, 2, 2],
    e_bot_spawn: [W - 7, 28, 2, 2],
    top_nw: [5, 4, 2, 2],
    top_ne: [W - 7, 4, 2, 2],
    w_top: [5, 12, 2, 2],
    e_top: [W - 7, 12, 2, 2],
    mid_c: [35, 21, 2, 2],
    w_mid: [14, 21, 2, 2],
    e_mid: [W - 16, 21, 2, 2],
    bot_sw: [5, 38, 2, 2],
    bot_se: [W - 7, 38, 2, 2],
    w_bot: [5, 30, 2, 2],
    e_bot: [W - 7, 30, 2, 2],
    ...Object.fromEntries(camps.map((c) => [c.region, c.rect]))
  },
  players: [
    slot('p1', 'dawn', '#e8433f', 'top'),
    slot('p2', 'dusk', '#3f7fe8', 'top'),
    slot('p3', 'dawn', '#f08a2c', 'mid'),
    slot('p4', 'dusk', '#2fc4a8', 'mid'),
    slot('p5', 'dawn', '#f2d33a', 'bot'),
    slot('p6', 'dusk', '#9a4fe0', 'bot'),
    { key: 'dawn_guard', type: 'computer', team: 'dawn', name: 'Dawn Legion', color: '#ff9a7a' },
    { key: 'dusk_guard', type: 'computer', team: 'dusk', name: 'Dusk Legion', color: '#7aa8ff' },
    { key: 'neutral', type: 'computer', team: 'wilds', name: 'Wilds', color: '#b9a37a' }
  ],
  units,
  rules: {
    startGold: 300,
    heroSelect: { pool: ['hero_warden', 'hero_stormcaller', 'hero_ranger', 'hero_veil', 'hero_sunpriest'], unique: true },
    heroRevive: { base: 5, perLevel: 2 },
    healZones: [
      { region: 'west_fountain', team: 'dawn', hps: 45, mps: 25 },
      { region: 'east_fountain', team: 'dusk', hps: 45, mps: 25 }
    ],
    botTakeover: true
  },
  variables: { dawnKills: 0, duskKills: 0, meleeCount: 3, waveNo: 0 },
  hud: {
    vars: [
      { var: 'dawnKills', label: 'Dawn', icon: '🔥' },
      { var: 'duskKills', label: 'Dusk', icon: '🌙' }
    ]
  },
  triggers: [
    {
      id: 'intro',
      event: { type: 'mapInit' },
      actions: [
        { do: 'message', text: 'Welcome to Ember Rift! Choose your hero.', duration: 8 },
        { do: 'message', text: 'Destroy the enemy Rift Core to win. Your fountain heals you; the merchant sells items.', duration: 10 }
      ]
    },
    {
      id: 'minions',
      event: { type: 'periodic', interval: 30, start: 8 },
      actions: [
        { do: 'addVar', var: 'waveNo', value: 1 },
        { do: 'setVar', var: 'meleeCount', value: { min: [6, { add: [3, { floor: { div: [{ time: true }, 300] } }] }] } },
        ...waveActions
      ]
    },
    {
      id: 'income',
      event: { type: 'periodic', interval: 2 },
      actions: [{ do: 'gold', to: 'players', amount: 3 }]
    },
    {
      id: 'heroKill',
      event: { type: 'unitDies', hero: true },
      actions: [
        {
          do: 'if',
          cond: { eq: [{ unit: ['$unit', 'team'] }, 'dawn'] },
          then: [{ do: 'addVar', var: 'duskKills', value: 1 }],
          else: [{ do: 'addVar', var: 'dawnKills', value: 1 }]
        },
        { do: 'message', text: '{$killerPlayer} slew {$player}\'s {$unit}!', duration: 4, color: '#ffb347' }
      ]
    },
    {
      id: 'dawnLoses',
      event: { type: 'unitDies', unitType: 'rift_core', owner: 'dawn_guard' },
      actions: [{ do: 'endGame', winners: 'dusk', text: 'The Dawn core has shattered.' }]
    },
    {
      id: 'duskLoses',
      event: { type: 'unitDies', unitType: 'rift_core', owner: 'dusk_guard' },
      actions: [{ do: 'endGame', winners: 'dawn', text: 'The Dusk core has shattered.' }]
    },
    ...campTriggers
  ]
};
