# Riftforge map format (v1)

A map is one JSON document. It describes terrain, regions, players, pre-placed units, rules and **triggers**. Maps can't contain code, which is what makes them safe to share: the server and every client run the same validator (`www/js/engine/mapformat.js`) before a map is used.

**Units of measure.** Tile coordinates are used for terrain, regions and unit placement. One tile is **32 world units**. Ranges, radii, speeds and AoE sizes are in world units, and times are in seconds. Ability numbers can be a single value or an array indexed by ability level.

## Minimal example

```json
{
  "format": 1,
  "id": "tiny-arena",
  "name": "Tiny Arena",
  "author": "you",
  "genre": "Survival",
  "description": "Survive three waves.",
  "width": 24, "height": 16,
  "terrain": { "fill": "grass", "ops": [ { "border": 1, "t": "trees" } ] },
  "regions": { "home": [10, 6, 4, 4], "gate": [1, 6, 2, 4] },
  "players": [
    { "key": "p1", "type": "slot", "team": "heroes", "start": "home", "ai": true, "defend": "home" },
    { "key": "foes", "type": "computer", "team": "monsters", "color": "#7b4a8a" }
  ],
  "rules": { "startGold": 200, "heroSelect": { "pool": ["hero_warden", "hero_ranger"] }, "heroRevive": { "base": 5, "perLevel": 1 } },
  "variables": { "wave": 0 },
  "hud": { "vars": [ { "var": "wave", "label": "Wave", "icon": "🌊" } ] },
  "triggers": [
    { "event": { "type": "periodic", "interval": 20, "start": 10 },
      "conditions": [ { "lt": [ { "var": "wave" }, 3 ] } ],
      "actions": [
        { "do": "addVar", "var": "wave", "value": 1 },
        { "do": "spawn", "type": "husk", "count": { "mul": [ { "var": "wave" }, 3 ] },
          "owner": "foes", "region": "gate", "path": ["home"], "interval": 0.5 },
        { "do": "message", "text": "Wave {wave}!" } ] },
    { "event": { "type": "periodic", "interval": 1 },
      "conditions": [ { "ge": [ { "var": "wave" }, 3 ] }, { "eq": [ { "count": { "owner": "foes" } }, 0 ] }, { "eq": [ { "pending": true }, 0 ] } ],
      "actions": [ { "do": "endGame", "winners": "heroes", "text": "You survived!" } ] }
  ]
}
```

## Top level

| key | type | notes |
|---|---|---|
| `format` | `1` | required |
| `id`, `name`, `author`, `genre`, `description` | string | `name` required |
| `width`, `height` | int 8–160 | in tiles |
| `terrain` | object | see *Terrain* |
| `regions` | `{ name: [x, y, w, h] }` | rectangles in tiles |
| `players` | array | see *Players* |
| `units` | array | pre-placed units: `{ "type", "owner", "at": [x, y], "guard"?: bool }`. `at` is the centre in tiles. For odd-sized buildings use `.5` (e.g. a 3×3 core at `[6.5, 22.5]`). |
| `unitTypes`, `abilities`, `items` | objects | add new entries or override the base library (`www/js/engine/content.js`). Use `"extends": "baseId"` to inherit from an existing entry. |
| `rules` | object | see *Rules* |
| `variables` | object | initial trigger variables |
| `hud.vars` | array | variables shown in the top bar: `{ "var", "label", "icon"?, "max"?: "otherVar" }` |
| `data` | any JSON | static tables (e.g. wave lists), read with the `data` expression |
| `triggers` | array | see *Triggers* |

## Terrain

`{ "fill": "<type>", "seed"?: n, "ops": [ ... ] }`. Ops are painted in order:

| op | example |
|---|---|
| rectangle | `{ "rect": [x, y, w, h], "t": "water" }` |
| map border | `{ "border": 2, "t": "rock" }` |
| disc | `{ "circle": [cx, cy, r], "t": "stone" }` |
| thick polyline | `{ "path": [[x, y], [x, y], ...], "w": 4, "t": "dirt" }` |
| random speckle | `{ "scatter": [x, y, w, h], "t": "trees", "density": 0.1, "avoid": ["dirt"] }` |
| ASCII block | `{ "rows": ["##..", "#~~."], "at": [x, y], "legend": { "#": "rock", "~": "water", ".": "grass" } }` |

| type | walkable | buildable |
|---|---|---|
| `grass`, `snow`, `stone`, `sand` | ✔ | ✔ |
| `dirt`, `ice` | ✔ | ✘ |
| `water`, `rock`, `trees`, `lava`, `void` | ✘ | ✘ |

## Players

| key | notes |
|---|---|
| `key` | unique id used everywhere else (`"p1"`, `"invaders"`) |
| `type` | `"slot"` (human or bot) or `"computer"` (always computer-run) |
| `team` | players on the same team are allies |
| `name`, `color` | optional |
| `ai` | `true`: an empty slot is filled by a bot by default |
| `start` | region where the hero spawns and revives, and where bots retreat to |
| `aiPath` | regions a bot hero pushes through, in order (lanes) |
| `defend` | region a bot hero guards |
| `gold` | starting gold (overrides `rules.startGold`) |
| `passive` | nobody fights this player (decoration, neutral shops) |

## Rules

| key | notes |
|---|---|
| `startGold` | gold for every slot player |
| `buildList` | buildable types: an array for everyone, or `{ "p1": [...], "all": [...] }` |
| `buildZones` | `{ "all" or player key: [region, ...] }`: buildings must fit inside one of these |
| `pathChecks` | `[["spawn", "exit"]]`: refuses buildings that would fully block that route (or trap enemies) |
| `sellRatio` | refund fraction when selling (default `0.75`) |
| `heroSelect` | `{ "pool": [heroTypes], "unique"?: true }`: shows the hero picker |
| `heroRevive` | `{ "base": 5, "perLevel": 2 }` seconds. Omit it for permanent death. |
| `healZones` | `[{ "region", "team"?, "hps", "mps"? }]` |
| `botTakeover` | `false` stops bots from taking over for players who leave |
| `botItems` | item ids in the order bots buy them |
| `camera` | region the camera starts on when the player has no `start` |

## Unit types

```json
"my_golem": {
  "extends": "wild_ancient",
  "name": "Frost Golem", "model": "golem", "color": "#9fd8ff", "radius": 16,
  "hp": 1200, "mana": 0, "armor": 3, "hpRegen": 0.5,
  "damage": [30, 40], "range": 14, "cooldown": 1.5, "speed": 60, "acquire": 220,
  "projectile": null, "splash": 0, "onHit": { "slow": { "mult": 0.6, "duration": 2 } },
  "chain": null, "bounty": 40, "xp": 60, "abilities": ["ground_slam"]
}
```

Other fields:
- `building: { "size": 1..4 }`: occupies tiles and never moves.
- `cost`, `upgradesTo: [types]`, `tier`: for buildable towers. Several `upgradesTo` entries make a branching upgrade; `short` sets the button label (e.g. `"Longshot"`).
- `limit`: maximum number of this building per player.
- `income: { "amount": 6, "every": 10 }`: pays its owner gold periodically.
- `flying: true`: ignores terrain, walls and mazes, flies straight between waypoints, and never blocks building placement.
- `targets: "ground" | "air" | "both"`: what this unit can attack. Default: `both` for ranged units, `ground` for melee.
- `hero: { hpPerLevel, manaPerLevel, dmgPerLevel, armorPerLevel }`
- `shop: [itemIds]`
- `invulnerable`, `passive` (never attacks), `buildingDmgMult`, `blurb`
- `chain: { bounces, falloff, range }`: makes attacks jump between targets.

Models (procedural art): `hero_knight hero_mage hero_archer hero_rogue hero_priest soldier archer wolf beast caster golem ghoul spitter brute wraith tyrant imp bug turtle wisp colossus ram tower_guard core shop wall tower_arrow tower_frost tower_cannon tower_storm beacon`.

## Abilities

```json
"frost_lance": {
  "name": "Frost Lance", "icon": "🧊", "target": "unit", "targets": "enemy",
  "range": 200, "mana": [80, 90, 100], "cooldown": 8,
  "effect": { "type": "projectile", "damage": [90, 150, 210], "slow": { "mult": 0.5, "duration": 2 }, "speed": 450, "color": "#bff4ff" },
  "tip": "Damages and slows a target."
}
```

- `target`: `"none"` (instant), `"unit"` or `"point"`.
- `targets`: `"enemy"` or `"ally"`, for unit-targeted abilities.
- Also: `aoe`, `passive`, `ultimate` (learnable at hero level 6), `maxLevel`.

| effect `type` | fields |
|---|---|
| `projectile` | `damage, stun, slow{mult,duration}, speed, color, size` |
| `area` | `damage, stun, slow, delay, color`. Centred on the target point, or on the caster when `target` is `"none"`. |
| `heal` | `amount`, `pct` (fraction of the target's max HP) |
| `areaHeal` | `amount`, `pct`, `buff` |
| `blink` | teleports up to `range` |
| `buff` | `who: "self" or "allies"`, `buff: { dmgAdd, armorAdd, speedAdd, speedMult, cdMult, duration, color }` |
| `summon` | `unit, count, duration` |
| `chain` | `damage, bounces, falloff, range, color` |
| `crit` (passive) | `chance, mult` |
| `evasion` (passive) | `chance` |
| `lifesteal` (passive) | `amount` (fraction) |

## Items

`{ "name", "icon", "cost", "tip", "dmg", "armor", "hp", "mana", "speed", "hpRegen", "manaRegen", "attackSpeed", "lifesteal", "use": { "heal", "mana" }, "charges" }`

Heroes have 6 slots and buy from any non-hostile unit with a `shop` list within reach.

## Triggers

```json
{ "id": "name", "enabled": true, "event": { "type": "...", ...filters }, "conditions": [expr, ...], "actions": [action, ...] }
```

All conditions must be truthy for the actions to run. Add `"once": true` to an event to fire it only one time.

### Events

| type | fields | context |
|---|---|---|
| `mapInit` | | |
| `periodic` | `interval`, `start`? | |
| `elapsed` | `time` | |
| `unitDies` | unit filter | `$unit`, `$killer`, `$player`, `$killerPlayer` |
| `unitEntersRegion` | `region` + unit filter | `$unit`, `$player`, `$region` |
| `timerExpires` | `timer` | `$timer` |
| `playerLeaves` | | `$player` |
| `heroPicked` | unit filter | `$unit`, `$player` |
| `heroLevel` | `level`? + unit filter | `$unit`, `$player` |

**Unit filter keys:** `owner` (player key or list), `team`, `unitType`, `hero`, `building`, `inRegion`.

### Actions (`"do"`)

| action | fields |
|---|---|
| `setVar` / `addVar` | `var`, `value` |
| `spawn` | `type, count, owner, region` or `at` (unit ref), `path: [regions]`, `order: "amove"/"move"`, `interval`, `hpMul`, `bountyMul`, `duration`, `guard` |
| `message` | `text`, `to`, `duration`, `color` |
| `gold` | `to`, `amount` (evaluated per recipient with `$player` bound to them, e.g. interest), `show`? (message with `{amount}`) |
| `if` | `cond`, `then`, `else` |
| `after` | `delay`, `actions` |
| `repeat` | `count`, `actions` (`$i` is the index) |
| `timer` / `stopTimer` | `id`, `duration`, `label` (a labelled timer is shown in the HUD) |
| `endGame` | `winners` (team or list), `text` |
| `remove` / `kill` | `unit` |
| `heal` | `unit` or `filter`, `amount`? (full if omitted), `mana`? |
| `enable` / `disable` | `trigger` (id) |
| `order` | `filter`, `order`, `region` or `path` |
| `ping` | `region`, `to`, `color` |

**Player sets** (`to`): `"all"`, `"players"` (human and bot slots), `"humans"`, a player key, `"$player"`, `"$killerPlayer"`, `{ "team": "x" }`, or an array of these.

**Text templates:** `{varName}`, `{$player}`, `{$killerPlayer}`, `{$unit}`, `{$i}`.

### Expressions

An expression is a literal (number, string, boolean) or a single-key object:

| op | example |
|---|---|
| `var` | `{ "var": "wave" }` |
| `add sub mul div mod min max` | `{ "add": [1, { "var": "wave" }] }` |
| `floor round abs` | `{ "floor": 2.7 }` |
| `eq ne lt le gt ge` | `{ "lt": [{ "var": "lives" }, 1] }` |
| `and or not` | `{ "and": [a, b] }` |
| `if` | `{ "if": [cond, a, b] }` |
| `random` | `{ "random": [1, 6] }` (integer, deterministic) |
| `data at get len` | `{ "get": [{ "at": [{ "data": "waves" }, 0] }, "type"] }` |
| `count` | `{ "count": { "owner": "foes", "inRegion": "home" } }` |
| `unit` | `{ "unit": ["$unit", "type"] }`. Props: `owner team type hp maxHp level x y hero` |
| `player` | `{ "player": ["$killerPlayer", "gold"] }`. Props: `gold team name kills ctrl key` |
| `playerCount` | `{ "playerCount": { "team": "heroes" } }` (active human and bot slots) |
| `time` `pending` | elapsed seconds; number of scheduled spawns and delayed actions still waiting |
| `concat` `alive` | `{ "concat": ["Wave ", { "var": "wave" }] }`, `{ "alive": "$killer" }` |

## Limits

| | limit |
|---|---|
| Map file | 512 KB |
| Size | 160 × 160 tiles |
| Players | 12 |
| Pre-placed units | 800 |
| Regions | 200 |
| Triggers | 400 |
| Units alive at once | 1500 |
| Units per `spawn` | 200 |
| Iterations per `repeat` | 500 |

Trigger execution is capped per tick. A broken action is skipped on every client in the same way, so it can never cause a desync.
