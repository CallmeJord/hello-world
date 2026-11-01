// Rimecrest Run — co-op maze tower defense for 1-6 players.
//
// Each player owns a walled snowfield ("plot") at the top of the map. Invaders
// spawn at the top of every occupied plot, walk down through it, drop into a
// shared ice corridor and cross the shared Keep field to the exit. Players maze
// their own plot and cooperate in the Keep. Lives are shared.
//
// Wave features: armored, fast, swarms, healers, splitters, flying waves that
// ignore mazes, and a boss every 10 waves.
const W = 80, H = 50;
const LANES = 6;
const PLOT_W = 11;
const plotX = (i) => 2 + i * 13;
const COLORS = ['#e8433f', '#3f7fe8', '#2fc4a8', '#f2d33a', '#9a4fe0', '#f08a2c'];

// ------------------------------------------------------------------ content
const towers = {
  rc_block: {
    extends: 'td_barricade', name: 'Ice Block', cost: 5, color: '#cfe6f2',
    blurb: 'Dirt-cheap block for shaping your maze.'
  },
  rc_arrow1: { extends: 'td_arrow1', name: 'Arrow Spire', damage: [12, 16], upgradesTo: ['rc_arrow2'], blurb: 'Cheap, fast shots. Hits air and ground.' },
  rc_arrow2: { extends: 'td_arrow1', name: 'Arrow Spire II', damage: [24, 30], range: 140, cost: 100, tier: 2, upgradesTo: ['rc_arrow3'] },
  rc_arrow3: { extends: 'td_arrow1', name: 'Arrow Spire III', damage: [56, 66], range: 150, cooldown: 0.65, cost: 200, tier: 3, upgradesTo: ['rc_longshot', 'rc_repeater'] },
  rc_longshot: {
    extends: 'td_arrow1', name: 'Longshot Spire', short: 'Longshot', color: '#ffd27a', damage: [170, 200], range: 230, cooldown: 1.3,
    cost: 320, tier: 4, upgradesTo: [], blurb: 'Huge range and heavy single shots.'
  },
  rc_repeater: {
    extends: 'td_arrow1', name: 'Repeater Spire', short: 'Repeater', color: '#ff9a7a', damage: [50, 58], range: 145, cooldown: 0.28,
    cost: 320, tier: 4, upgradesTo: [], blurb: 'A storm of rapid bolts.'
  },
  rc_frost1: { extends: 'td_frost1', name: 'Frost Obelisk', upgradesTo: ['rc_frost2'], blurb: 'Slows everything it hits.' },
  rc_frost2: { extends: 'td_frost1', name: 'Frost Obelisk II', damage: [14, 18], splash: 55, cost: 140, tier: 2, onHit: { slow: { mult: 0.45, duration: 2.5 } }, upgradesTo: ['rc_frost3'] },
  rc_frost3: {
    extends: 'td_frost1', name: 'Glacier Heart', short: 'Glacier', damage: [34, 40], splash: 70, range: 125, cost: 260, tier: 3,
    onHit: { slow: { mult: 0.35, duration: 2.5 } }, upgradesTo: [], blurb: 'Deep freeze in a wide area.'
  },
  rc_cannon1: { extends: 'td_cannon1', name: 'Cannon Bastion', targets: 'ground', upgradesTo: ['rc_cannon2'], blurb: 'Splash damage. Ground only.' },
  rc_cannon2: { extends: 'td_cannon1', name: 'Cannon Bastion II', targets: 'ground', damage: [55, 68], splash: 56, cost: 180, tier: 2, upgradesTo: ['rc_mortar', 'rc_shrapnel'] },
  rc_mortar: {
    extends: 'td_cannon1', name: 'Siege Mortar', short: 'Mortar', targets: 'ground', color: '#a07a5a', damage: [280, 320], splash: 84, range: 200,
    cooldown: 2.6, cost: 420, tier: 3, upgradesTo: [], projectile: { speed: 240, color: '#2a2a2a', size: 7 }, blurb: 'Long range, crushing blasts.'
  },
  rc_shrapnel: {
    extends: 'td_cannon1', name: 'Shrapnel Bastion', short: 'Shrapnel', targets: 'ground', color: '#c9b07a', damage: [86, 100], splash: 60, range: 130,
    cooldown: 0.9, cost: 380, tier: 3, upgradesTo: [], blurb: 'Rapid splash fire.'
  },
  rc_storm1: { extends: 'td_storm1', name: 'Storm Pylon', upgradesTo: ['rc_storm2'], blurb: 'Lightning that jumps between foes.' },
  rc_storm2: { extends: 'td_storm1', name: 'Storm Pylon II', damage: [70, 84], cost: 300, tier: 2, chain: { bounces: 5, falloff: 0.85, range: 100 }, upgradesTo: ['rc_storm3'] },
  rc_storm3: {
    extends: 'td_storm1', name: 'Tempest Pylon', short: 'Tempest', damage: [170, 200], cost: 520, tier: 3,
    chain: { bounces: 7, falloff: 0.88, range: 110 }, upgradesTo: [], blurb: 'Chain lightning across a whole pack.'
  },
  rc_sky1: {
    name: 'Skyspear', model: 'tower_sky', color: '#bfe3ff', radius: 20, building: { size: 2 }, targets: 'air',
    hp: 500, damage: [44, 54], range: 185, cooldown: 0.9, speed: 0, cost: 90,
    projectile: { speed: 640, color: '#eaf6ff', size: 3 }, upgradesTo: ['rc_sky2'], blurb: 'Anti-air only. Shreds flyers.'
  },
  rc_sky2: { extends: 'rc_sky1', name: 'Skyspear II', damage: [120, 140], cost: 200, tier: 2, upgradesTo: ['rc_sky3'] },
  rc_sky3: { extends: 'rc_sky1', name: 'Stormspear', short: 'Stormspear', damage: [300, 340], cooldown: 0.8, range: 200, cost: 420, tier: 3, upgradesTo: [] },
  rc_drill: {
    name: "Prospector's Drill", model: 'drill', color: '#ffd54a', radius: 20, building: { size: 2 }, passive: true,
    hp: 600, damage: null, speed: 0, cost: 120, limit: 3, income: { amount: 6, every: 10 },
    blurb: 'Earns 6 gold every 10 seconds. Max 3.'
  }
};

const creeps = {
  rc_scuttler: { name: 'Frostscuttler', model: 'bug', color: '#a8d8f0', radius: 9, hp: 60, damage: null, speed: 66, bounty: 4 },
  rc_runner: { name: 'Gale Runner', model: 'wraith', color: '#dff4ff', radius: 8, hp: 42, damage: null, speed: 108, bounty: 4 },
  rc_shell: { name: 'Glacier Tortoise', model: 'turtle', color: '#7fb8c8', radius: 11, hp: 130, armor: 5, damage: null, speed: 50, bounty: 7 },
  rc_mite: { name: 'Rime Mite', model: 'wisp', color: '#bfe8ff', radius: 6, hp: 24, damage: null, speed: 82, bounty: 2 },
  rc_mender: {
    name: 'Hoarfrost Mender', model: 'caster', color: '#9fe0d0', radius: 9, hp: 90, mana: 400, manaRegen: 4,
    damage: null, speed: 58, bounty: 7, abilities: ['rc_frostmend']
  },
  rc_splitter: { name: 'Shardback', model: 'golem', color: '#9fc8e8', radius: 12, hp: 150, armor: 2, damage: null, speed: 54, bounty: 5 },
  rc_shard: { name: 'Ice Shard', model: 'imp', color: '#cdeeff', radius: 7, hp: 50, damage: null, speed: 80, bounty: 2 },
  rc_rimewing: { name: 'Rimewing', model: 'flyer', color: '#bfe3ff', radius: 10, hp: 85, damage: null, speed: 70, flying: true, bounty: 5 },
  rc_titan: { name: 'Avalanche Titan', model: 'colossus', color: '#c8e4f4', radius: 18, hp: 850, armor: 4, damage: null, speed: 40, bounty: 80 },
  rc_wyrm: { name: 'Hoarwyrm', model: 'flyer', color: '#8fb0ff', radius: 18, hp: 1100, armor: 3, damage: null, speed: 46, flying: true, bounty: 150 },
  rc_sovereign: { name: 'The Pale Sovereign', model: 'tyrant', color: '#e8f4ff', radius: 20, hp: 1500, armor: 6, damage: null, speed: 38, bounty: 0 }
};
const BOSSES = ['rc_titan', 'rc_wyrm', 'rc_sovereign'];

const abilities = {
  rc_frostmend: {
    name: 'Frostmend', icon: '💧', target: 'unit', targets: 'ally', range: 140, mana: 60, cooldown: 4,
    effect: { type: 'heal', pct: 0.3 }, tip: 'Heals a wounded invader for 30% of its health.'
  }
};

// ------------------------------------------------------------------ waves
// [groups as "type:count" pairs], interval between spawns
const WAVE_SPEC = [
  'rc_scuttler:10', 'rc_runner:12', 'rc_scuttler:14', 'rc_shell:9', 'rc_mite:24',
  'rc_scuttler:10 rc_mender:2', 'rc_rimewing:10', 'rc_splitter:8', 'rc_runner:14 rc_mender:2', 'rc_titan:1 rc_scuttler:8',
  'rc_shell:12', 'rc_mite:30', 'rc_splitter:9 rc_mender:3', 'rc_rimewing:14', 'rc_runner:18',
  'rc_shell:12 rc_mender:3', 'rc_mite:36', 'rc_splitter:12', 'rc_rimewing:10 rc_runner:10', 'rc_wyrm:1 rc_rimewing:6',
  'rc_shell:16', 'rc_runner:22', 'rc_splitter:12 rc_mender:4', 'rc_mite:42', 'rc_rimewing:18',
  'rc_shell:16 rc_mender:5', 'rc_runner:24 rc_mite:16', 'rc_splitter:14 rc_rimewing:8', 'rc_shell:10 rc_runner:12 rc_mender:4 rc_rimewing:8', 'rc_sovereign:1 rc_shell:8 rc_mender:4'
];
const waves = WAVE_SPEC.map((spec, i) => {
  const w = i + 1;
  return {
    groups: spec.split(' ').map((g) => {
      const [type, count] = g.split(':');
      return { type, count: +count };
    }),
    hpMul: Math.round((1 + 0.1 * (w - 1) + 0.011 * (w - 1) * (w - 1)) * 100) / 100,
    bountyMul: Math.round((1 + 0.04 * (w - 1)) * 100) / 100
  };
});

// ------------------------------------------------------------------ layout
const ops = [
  { scatter: [0, 0, W, H], t: 'trees', density: 0.28 },
  { circle: [10, 41, 4.5], t: 'water' },
  { circle: [69, 41, 4.5], t: 'water' },
  { circle: [10, 41, 2], t: 'ice' },
  { circle: [69, 41, 2], t: 'ice' },
  { rect: [2, 28, W - 4, 4], t: 'ice' }, // shared corridor
  { rect: [22, 32, 36, 13], t: 'snow' }, // the Keep (shared build field)
  { rect: [38, 45, 4, 4], t: 'dirt' } // exit chute
];
const regions = {
  keep: [22, 32, 36, 13],
  exit: [38, 47, 4, 2]
};
for (let i = 0; i < LANES; i++) {
  const x = plotX(i);
  ops.push(
    { rect: [x, 2, PLOT_W, 2], t: 'dirt' }, // spawn strip
    { rect: [x, 4, PLOT_W, 22], t: 'snow' }, // plot
    { rect: [x + 4, 26, 3, 2], t: 'dirt' } // gap into the corridor
  );
  regions[`spawn${i + 1}`] = [x + 3, 2, 5, 2];
  regions[`plot${i + 1}`] = [x, 4, PLOT_W, 22];
  regions[`gap${i + 1}`] = [x + 4, 26, 3, 2];
}

// ------------------------------------------------------------------ triggers
const cur = (k) => ({ get: [{ var: 'cur' }, k] });
const group = (k) => ({ get: [{ at: [cur('groups'), '$i'] }, k] });
const laneSpawns = [];
for (let i = 1; i <= LANES; i++) {
  laneSpawns.push({
    do: 'if',
    cond: { ne: [{ player: [`p${i}`, 'ctrl'] }, 'empty'] },
    then: [{
      do: 'repeat',
      count: { len: cur('groups') },
      actions: [{
        do: 'spawn', type: group('type'), count: group('count'), hpMul: cur('hpMul'), bountyMul: cur('bountyMul'),
        owner: 'rimeborn', region: `spawn${i}`, path: [`gap${i}`, 'exit'], order: 'move', interval: 0.8
      }]
    }]
  });
}

export default {
  format: 1,
  id: 'rimecrest-run',
  name: 'Rimecrest Run',
  author: 'Riftforge',
  genre: 'Tower Defense',
  description: 'Co-op maze TD for 1-6 players. Each player mazes their own lane, then every lane merges into the shared Keep. 30 waves with armored, fast, healing, splitting and flying invaders, plus a boss every 10 waves. Shared lives, interest on banked gold, branching tower upgrades.',
  width: W,
  height: H,
  terrain: { fill: 'rock', seed: 4242, ops },
  regions,
  players: [
    ...COLORS.map((color, i) => ({ key: `p${i + 1}`, type: 'slot', team: 'wardens', color, start: `plot${i + 1}` })),
    { key: 'rimeborn', type: 'computer', team: 'rimeborn', name: 'The Rimeborn', color: '#4a2a8a' }
  ],
  unitTypes: { ...towers, ...creeps },
  abilities,
  rules: {
    startGold: 300,
    sellRatio: 0.75,
    buildList: ['rc_block', 'rc_arrow1', 'rc_frost1', 'rc_cannon1', 'rc_storm1', 'rc_sky1', 'rc_drill'],
    buildZones: Object.fromEntries(Array.from({ length: LANES }, (_, i) => [`p${i + 1}`, [`plot${i + 1}`, 'keep']])),
    pathChecks: Array.from({ length: LANES }, (_, i) => [`spawn${i + 1}`, 'exit']),
    camera: 'keep'
  },
  variables: { wave: 0, lives: 40, maxWave: waves.length },
  hud: {
    vars: [
      { var: 'lives', label: 'Lives', icon: '❤️' },
      { var: 'wave', label: 'Wave', icon: '❄️', max: 'maxWave' }
    ]
  },
  data: { waves },
  triggers: [
    {
      id: 'intro',
      event: { type: 'mapInit' },
      actions: [
        // More defenders -> more lanes -> more lives.
        { do: 'setVar', var: 'lives', value: { add: [20, { mul: [10, { playerCount: {} }] }] } },
        { do: 'message', text: 'Welcome to Rimecrest Run! Build a maze in your snowfield; invaders enter at its top.', duration: 10 },
        { do: 'message', text: 'All lanes merge into the Keep at the bottom: everyone can build there. Lives are shared.', duration: 10 },
        { do: 'message', text: 'Tips: 🦅 Skyspears for flying waves · ⛏️ Drills earn gold · banked gold earns interest.', duration: 12, color: '#ffe9a8' },
        { do: 'timer', id: 'next', duration: 45, label: 'First wave' },
        { do: 'ping', region: 'exit', color: '#ff6060' }
      ]
    },
    {
      id: 'wave',
      event: { type: 'timerExpires', timer: 'next' },
      actions: [
        { do: 'addVar', var: 'wave', value: 1 },
        { do: 'setVar', var: 'cur', value: { at: [{ data: 'waves' }, { sub: [{ var: 'wave' }, 1] }] } },
        ...laneSpawns,
        {
          do: 'if',
          cond: { eq: [{ mod: [{ var: 'wave' }, 10] }, 0] },
          then: [{ do: 'message', text: 'BOSS WAVE {wave}!', duration: 5, color: '#ff7a7a' }],
          else: [{ do: 'message', text: 'Wave {wave} / {maxWave}', duration: 4, color: '#9fd8ff' }]
        },
        {
          do: 'if',
          cond: { or: [{ eq: [{ var: 'wave' }, 7] }, { eq: [{ var: 'wave' }, 14] }, { eq: [{ var: 'wave' }, 20] }, { eq: [{ var: 'wave' }, 25] }] },
          then: [{ do: 'message', text: 'Flying wave! They ignore your maze.', duration: 5, color: '#bfe3ff' }]
        },
        { do: 'gold', to: 'players', amount: { add: [30, { mul: [{ var: 'wave' }, 5] }] } },
        {
          do: 'gold', to: 'players', show: 'Interest +{amount} gold',
          amount: { min: [{ floor: { mul: [{ player: ['$player', 'gold'] }, 0.04] } }, { add: [20, { mul: [{ var: 'wave' }, 4] }] }] }
        },
        {
          do: 'if',
          cond: { lt: [{ var: 'wave' }, { var: 'maxWave' }] },
          then: [{ do: 'timer', id: 'next', duration: { if: [{ eq: [{ mod: [{ var: 'wave' }, 10] }, 0] }, 40, 30] }, label: 'Next wave' }]
        }
      ]
    },
    {
      id: 'split',
      event: { type: 'unitDies', unitType: 'rc_splitter' },
      actions: [{ do: 'spawn', type: 'rc_shard', count: 2, at: '$unit', owner: 'rimeborn', path: ['exit'], order: 'move', hpMul: cur('hpMul') }]
    },
    {
      id: 'leak',
      event: { type: 'unitEntersRegion', region: 'exit', owner: 'rimeborn' },
      actions: [
        {
          do: 'addVar', var: 'lives',
          value: { if: [{ or: BOSSES.map((b) => ({ eq: [{ unit: ['$unit', 'type'] }, b] })) }, -5, -1] }
        },
        { do: 'remove', unit: '$unit' },
        { do: 'message', text: 'A {$unit} got through! Lives: {lives}', duration: 3, color: '#ff8080' },
        {
          do: 'if',
          cond: { le: [{ var: 'lives' }, 0] },
          then: [{ do: 'endGame', winners: 'rimeborn', text: 'The Rimeborn have overrun the crest.' }]
        }
      ]
    },
    {
      id: 'victory',
      event: { type: 'periodic', interval: 1 },
      conditions: [
        { ge: [{ var: 'wave' }, { var: 'maxWave' }] },
        { eq: [{ count: { owner: 'rimeborn' } }, 0] },
        { eq: [{ pending: true }, 0] }
      ],
      actions: [{ do: 'endGame', winners: 'wardens', text: 'The Pale Sovereign is shattered. Rimecrest holds!' }]
    }
  ]
};
