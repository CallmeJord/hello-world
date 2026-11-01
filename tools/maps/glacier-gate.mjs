// Glacier Gate — co-op maze tower defense for 1-4 players.
const W = 44, H = 30;

// 24 waves. hpMul scales each wave; bounty grows a little too.
const roster = ['td_rimeling', 'td_skitter', 'td_rimeling', 'td_shellback', 'td_mote', 'td_colossus'];
const waves = [];
for (let w = 1; w <= 24; w++) {
  const type = w % 6 === 0 ? 'td_colossus' : roster[(w - 1) % 6];
  const count = type === 'td_colossus' ? Math.ceil(w / 6) : type === 'td_mote' ? 22 : type === 'td_skitter' ? 14 : w === 1 ? 10 : 12;
  const hpMul = Math.round((1 + 0.2 * (w - 1) + 0.03 * (w - 1) * (w - 1)) * 100) / 100;
  waves.push({ type, count, hpMul, bountyMul: Math.round((1 + 0.06 * (w - 1)) * 100) / 100, interval: type === 'td_mote' ? 0.35 : 0.7 });
}

const slots = [
  { key: 'p1', color: '#e8433f' },
  { key: 'p2', color: '#3f7fe8' },
  { key: 'p3', color: '#2fc4a8' },
  { key: 'p4', color: '#f2d33a' }
].map((p) => ({ ...p, type: 'slot', team: 'wardens', start: 'field' }));

export default {
  format: 1,
  id: 'glacier-gate',
  name: 'Glacier Gate',
  author: 'Riftforge',
  genre: 'Tower Defense',
  description: 'Co-op maze TD. Build towers anywhere on the snowfield to shape the invaders\' route. Don\'t fully block the path! 24 waves; survive them all.',
  width: W,
  height: H,
  terrain: {
    fill: 'snow',
    ops: [
      { border: 2, t: 'rock' },
      { scatter: [0, 0, W, H], t: 'trees', density: 0.35, avoid: ['snow', 'dirt'] },
      { rect: [0, 12, 3, 6], t: 'dirt' },
      { rect: [W - 3, 12, 3, 6], t: 'dirt' },
      { rect: [3, 3, 3, 24], t: 'ice' },
      { rect: [W - 6, 3, 3, 24], t: 'ice' },
      { circle: [22, 3, 2.2], t: 'rock' },
      { circle: [22, 27, 2.2], t: 'rock' }
    ]
  },
  regions: {
    spawn: [0, 12, 2, 6],
    exit: [W - 2, 12, 2, 6],
    field: [6, 3, W - 12, 24],
    center: [20, 13, 4, 4]
  },
  players: [
    ...slots,
    { key: 'invaders', type: 'computer', team: 'frost', name: 'The Frostborn', color: '#6a2fc0' }
  ],
  rules: {
    startGold: 300,
    sellRatio: 0.8,
    buildList: ['td_barricade', 'td_arrow1', 'td_frost1', 'td_cannon1', 'td_storm1'],
    buildZones: { all: ['field'] },
    pathChecks: [['spawn', 'exit']],
    camera: 'center'
  },
  variables: { wave: 0, lives: 30, maxWave: waves.length },
  hud: {
    vars: [
      { var: 'lives', label: 'Lives', icon: '❤️' },
      { var: 'wave', label: 'Wave', icon: '🌊', max: 'maxWave' }
    ]
  },
  data: { waves },
  triggers: [
    {
      id: 'intro',
      event: { type: 'mapInit' },
      actions: [
        { do: 'message', text: 'Welcome to Glacier Gate! Tap 🏗 Build, pick a tower, then tap the snowfield.', duration: 10 },
        { do: 'message', text: 'Invaders walk from the left gate to the right gate. Each one that escapes costs a life.', duration: 10 },
        { do: 'timer', id: 'next', duration: 30, label: 'First wave' },
        { do: 'ping', region: 'spawn' },
        { do: 'ping', region: 'exit', color: '#ff6060' }
      ]
    },
    {
      id: 'wave',
      event: { type: 'timerExpires', timer: 'next' },
      actions: [
        { do: 'addVar', var: 'wave', value: 1 },
        { do: 'setVar', var: 'cur', value: { at: [{ data: 'waves' }, { sub: [{ var: 'wave' }, 1] }] } },
        {
          do: 'spawn',
          type: { get: [{ var: 'cur' }, 'type'] },
          count: { get: [{ var: 'cur' }, 'count'] },
          // Scale toughness with the number of players defending.
          hpMul: { mul: [{ get: [{ var: 'cur' }, 'hpMul'] }, { add: [0.65, { mul: [0.2, { playerCount: {} }] }] }] },
          bountyMul: { get: [{ var: 'cur' }, 'bountyMul'] },
          interval: { get: [{ var: 'cur' }, 'interval'] },
          owner: 'invaders',
          region: 'spawn',
          path: ['exit'],
          order: 'move'
        },
        { do: 'message', text: 'Wave {wave} / {maxWave}', duration: 4, color: '#9fd8ff' },
        { do: 'gold', to: 'players', amount: { add: [20, { mul: [{ var: 'wave' }, 5] }] } },
        {
          do: 'if',
          cond: { lt: [{ var: 'wave' }, { var: 'maxWave' }] },
          then: [{ do: 'timer', id: 'next', duration: { if: [{ eq: [{ mod: [{ var: 'wave' }, 6] }, 5] }, 40, 30] }, label: 'Next wave' }]
        }
      ]
    },
    {
      id: 'leak',
      event: { type: 'unitEntersRegion', region: 'exit', owner: 'invaders' },
      actions: [
        {
          do: 'addVar', var: 'lives',
          value: { if: [{ eq: [{ unit: ['$unit', 'type'] }, 'td_colossus'] }, -5, -1] }
        },
        { do: 'remove', unit: '$unit' },
        { do: 'message', text: 'An invader slipped through! Lives: {lives}', duration: 3, color: '#ff8080' },
        {
          do: 'if',
          cond: { le: [{ var: 'lives' }, 0] },
          then: [{ do: 'endGame', winners: 'frost', text: 'The gate has fallen.' }]
        }
      ]
    },
    {
      id: 'victory',
      event: { type: 'periodic', interval: 1 },
      conditions: [
        { ge: [{ var: 'wave' }, { var: 'maxWave' }] },
        { eq: [{ count: { owner: 'invaders' } }, 0] },
        { eq: [{ pending: true }, 0] }
      ],
      actions: [{ do: 'endGame', winners: 'wardens', text: 'Every wave repelled. Glacier Gate holds!' }]
    }
  ]
};
