// Last Light — co-op hero survival. Defend the Sun Beacon for 15 waves.
const W = 48, H = 48;

const corners = ['spawn_nw', 'spawn_ne', 'spawn_sw', 'spawn_se'];
// Each wave is a flat list of { r: region, type, count } spawn groups.
const waves = [];
for (let w = 1; w <= 15; w++) {
  const list = [];
  const add = (r, type, count) => count > 0 && list.push({ r, type, count });
  if (w === 15) {
    add('spawn_nw', 'abyss_tyrant', 1);
    for (const r of corners.slice(1)) {
      add(r, 'dread_brute', 1);
      add(r, 'gloomspitter', 2);
    }
  } else if (w % 5 === 0) {
    for (const r of corners) {
      add(r, 'dread_brute', w / 5);
      add(r, 'husk', 2);
    }
  } else {
    // Alternate between the two diagonals.
    const active = w % 2 ? ['spawn_nw', 'spawn_se'] : ['spawn_ne', 'spawn_sw'];
    for (const r of active) {
      add(r, 'husk', 2 + Math.floor(w / 2));
      add(r, 'gloomspitter', Math.floor(w / 3));
      if (w >= 4) add(r, 'wisp_wraith', Math.floor(w / 4));
      if (w >= 8) add(r, 'dread_brute', Math.floor((w - 5) / 3));
    }
  }
  waves.push({ list, hpMul: Math.round((1 + 0.1 * (w - 1)) * 100) / 100 });
}

const group = (k) => ({ get: [{ at: [{ get: [{ var: 'cur' }, 'list'] }, '$i'] }, k] });
const spawnWave = {
  do: 'repeat',
  count: { len: { get: [{ var: 'cur' }, 'list'] } },
  actions: [
    {
      do: 'spawn',
      type: group('type'),
      // More defenders -> more shades.
      count: { max: [1, { round: { mul: [group('count'), { add: [0.5, { mul: [0.2, { playerCount: {} }] }] }] } }] },
      hpMul: { get: [{ var: 'cur' }, 'hpMul'] },
      owner: 'shades',
      region: group('r'),
      path: ['center'],
      interval: 0.6
    }
  ]
};

const slot = (key, color) => ({ key, type: 'slot', team: 'keepers', color, ai: true, start: 'hearth', defend: 'center' });

export default {
  format: 1,
  id: 'last-light',
  name: 'Last Light',
  author: 'Riftforge',
  genre: 'Hero Survival',
  description: 'Co-op survival for 1-4 heroes. Shades pour in from every corner to snuff out the Sun Beacon. Hold for 15 waves and defeat the Abyss Tyrant.',
  width: W,
  height: H,
  terrain: {
    fill: 'grass',
    seed: 77,
    ops: [
      { scatter: [0, 0, W, H], t: 'trees', density: 0.09 },
      { border: 2, t: 'trees' },
      { path: [[3, 3], [24, 24]], w: 4, t: 'dirt' },
      { path: [[45, 3], [24, 24]], w: 4, t: 'dirt' },
      { path: [[3, 45], [24, 24]], w: 4, t: 'dirt' },
      { path: [[45, 45], [24, 24]], w: 4, t: 'dirt' },
      { circle: [24, 24, 7], t: 'stone' },
      { circle: [12, 24, 2.5], t: 'water' },
      { circle: [36, 24, 2.5], t: 'water' },
      { circle: [24, 12, 2.5], t: 'water' },
      { circle: [24, 36, 2.5], t: 'water' },
      { circle: [4, 4, 3], t: 'dirt' },
      { circle: [44, 4, 3], t: 'dirt' },
      { circle: [4, 44, 3], t: 'dirt' },
      { circle: [44, 44, 3], t: 'dirt' }
    ]
  },
  regions: {
    spawn_nw: [2, 2, 4, 4],
    spawn_ne: [W - 6, 2, 4, 4],
    spawn_sw: [2, H - 6, 4, 4],
    spawn_se: [W - 6, H - 6, 4, 4],
    center: [21, 21, 6, 6],
    hearth: [20, 27, 5, 2]
  },
  players: [
    slot('p1', '#e8433f'),
    slot('p2', '#3f7fe8'),
    slot('p3', '#2fc4a8'),
    slot('p4', '#f2d33a'),
    { key: 'sanctum', type: 'computer', team: 'keepers', name: 'Sanctum', color: '#ffe38a' },
    { key: 'shades', type: 'computer', team: 'shade', name: 'The Shades', color: '#7b4a8a' }
  ],
  units: [
    { type: 'sun_beacon', owner: 'sanctum', at: [24.5, 24.5], id: 'beacon' },
    { type: 'rift_shop', owner: 'sanctum', at: [18, 28] }
  ],
  rules: {
    startGold: 250,
    heroSelect: { pool: ['hero_warden', 'hero_stormcaller', 'hero_ranger', 'hero_veil', 'hero_sunpriest'], unique: true },
    heroRevive: { base: 8, perLevel: 1.5 },
    healZones: [{ region: 'hearth', team: 'keepers', hps: 25, mps: 12 }],
    camera: 'center'
  },
  variables: { wave: 0, maxWave: waves.length },
  hud: { vars: [{ var: 'wave', label: 'Wave', icon: '🌒', max: 'maxWave' }] },
  data: { waves },
  triggers: [
    {
      id: 'intro',
      event: { type: 'mapInit' },
      actions: [
        { do: 'message', text: 'The Sun Beacon is the last light. If it falls, all is lost.', duration: 8 },
        { do: 'message', text: 'Pick a hero. Stand on the hearth (south of the beacon) to heal.', duration: 8 },
        { do: 'timer', id: 'next', duration: 35, label: 'Shades arrive' }
      ]
    },
    {
      id: 'wave',
      event: { type: 'timerExpires', timer: 'next' },
      actions: [
        { do: 'addVar', var: 'wave', value: 1 },
        { do: 'setVar', var: 'cur', value: { at: [{ data: 'waves' }, { sub: [{ var: 'wave' }, 1] }] } },
        spawnWave,
        ...corners.map((r) => ({ do: 'ping', region: r, color: '#c070ff' })),
        {
          do: 'if',
          cond: { eq: [{ var: 'wave' }, { var: 'maxWave' }] },
          then: [{ do: 'message', text: 'The Abyss Tyrant approaches!', duration: 6, color: '#ff5070' }],
          else: [{ do: 'message', text: 'Wave {wave} / {maxWave}', duration: 4, color: '#c9a6ff' }]
        },
        { do: 'gold', to: 'players', amount: { add: [40, { mul: [{ var: 'wave' }, 10] }] } },
        {
          do: 'if',
          cond: { lt: [{ var: 'wave' }, { var: 'maxWave' }] },
          then: [{ do: 'timer', id: 'next', duration: 40, label: 'Next wave' }]
        }
      ]
    },
    {
      id: 'beaconFalls',
      event: { type: 'unitDies', unitType: 'sun_beacon' },
      actions: [{ do: 'endGame', winners: 'shade', text: 'The Sun Beacon has gone dark.' }]
    },
    {
      id: 'victory',
      event: { type: 'periodic', interval: 1 },
      conditions: [
        { ge: [{ var: 'wave' }, { var: 'maxWave' }] },
        { eq: [{ count: { owner: 'shades' } }, 0] },
        { eq: [{ pending: true }, 0] }
      ],
      actions: [{ do: 'endGame', winners: 'keepers', text: 'Dawn breaks. The light endures!' }]
    }
  ]
};
