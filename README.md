# Riftforge Arcade

A mobile-first engine for **custom RTS arcade maps**: tower defense, hero arenas and co-op survival, the kind of user-made games that grew up around classic RTS map editors. It plays online with friends and runs on Android.

Everything here is original: the engine, units, heroes, abilities, items, maps and art (drawn procedurally in code). It does **not** load or use any other game's files, assets or map formats.

| | |
|---|---|
| **Platforms** | Android app (Capacitor), installable PWA, any modern browser |
| **Multiplayer** | Deterministic lockstep over WebSockets, with a lobby, slots, chat and desync detection |
| **Custom maps** | Plain JSON with terrain, regions, units, rules and **triggers** (event → conditions → actions). They are shared automatically when you host. |
| **Bundled maps** | *Glacier Gate* (maze TD, 1–4p co-op) · *Ember Rift* (3-lane hero arena, up to 3v3) · *Last Light* (hero survival, 1–4p co-op) |

## Quick start

```bash
npm install
npm start            # http://localhost:8080  (web client + lobby server, ws://localhost:8080/ws)
npm test             # engine + server tests
```

Open `http://<your-computer-ip>:8080` on a phone on the same Wi-Fi to play in the browser. You can also *Add to Home screen* to install it as a full-screen PWA.

## Android app

The `android/` folder is a ready-made [Capacitor](https://capacitorjs.com) project. It is set to landscape, immersive full screen and keep-screen-on, and is allowed to connect to `ws://` LAN servers.

**Easiest path: let GitHub build it.** Every push runs `.github/workflows/android.yml`, which runs the tests and then builds `app-debug.apk`. Download it from the workflow run's *Artifacts*, copy it to your phone and install it. You'll need to allow installs from unknown sources.

**Build locally** (needs Android Studio / Android SDK and JDK 21):

```bash
npm install
npx cap sync android         # copies www/ into the Android project
npx cap open android         # open in Android Studio, then Run ▶
# or: cd android && ./gradlew assembleDebug
```

Re-run `npx cap sync android` whenever you change anything in `www/`.

## Playing online

1. Run the server somewhere your friends can reach it:
   - LAN: `npm start` on your computer, then connect to `ws://192.168.x.x:8080/ws`
   - Internet: deploy the `Dockerfile` to any container host (Fly.io, Render, a VPS…) and use `wss://your-host/ws`
2. In the app: **Play Online** → enter the server address → **Host** a game with any map, including imported ones.
3. Friends join from the room list. The host can set free slots to Bot, Open or Closed, then press **Start**.

How it works: the server never simulates the game. It batches each player's commands into numbered *turns* (10 per second) and broadcasts them. Every client runs the same deterministic simulation (`www/js/engine/`), so all clients stay identical. Clients send a state checksum every 25 turns, and the server warns everyone on a mismatch. If a player disconnects, a bot takes over their slot.

## Controls

**Touch**
- **Tap** a unit to select it. **Double-tap** selects every unit of that type on screen.
- With units selected, **tap the ground** to move or **tap an enemy** to attack.
- **Long-press** the ground to attack-move.
- **Drag** to pan, **pinch** to zoom, tap the minimap to jump.
- **⬚** makes your next drag a box selection. The portrait button selects your hero; tap it twice to center the camera.
- Abilities: tap the button, then tap the target. Spend skill points with **➕ Learn**, and buy items at merchants with **🛒 Shop**.

**Desktop**
- Left-drag to box select, right-click for smart orders, mouse wheel to zoom, arrow keys to scroll.
- Hotkeys: `Q W E R` abilities, `A` attack-move, `S` stop, `H` hold, `B` build/shop, `F1` hero, `Space` center, `Esc` cancel/menu.

## Making maps

Maps are JSON, so they're safe to share: a map can't contain executable code. The full reference is in **[docs/MAP_FORMAT.md](docs/MAP_FORMAT.md)**.

- In the app, **Map Library → Export** any bundled map to use it as a template, then **Import** your edited `.json`. Imported maps are validated, stored on the device, and uploaded to the room when you host.
- The bundled maps are generated from readable sources in `tools/maps/*.mjs`. Run `npm run build:maps` after editing them; the script validates each map and writes `www/maps/*.json`.

## Project layout

```
www/                     web client (also the Capacitor webDir)
  js/engine/             deterministic simulation shared by client, server & tests
    sim.js               units, orders, combat, abilities, items, building, heroes
    grid.js              terrain painting, A* pathfinding, line of sight
    triggers.js          map trigger interpreter (events / conditions / actions)
    ai.js                bot heroes (pick, learn, shop, push lanes, defend, retreat)
    content.js           base library of units, heroes, abilities, items
    mapformat.js         map validation + hashing
  js/client/             renderer, procedural unit art, HUD, touch input, lockstep session, net
  maps/                  bundled maps (built from tools/maps)
server/server.js         lobby + lockstep relay + static file server
tools/                   map sources and build script
tests/                   node:test suites (determinism, TD rules, heroes, triggers, server)
android/                 Capacitor Android project
```

## Roadmap ideas

- In-app visual map editor (terrain painting, region and trigger editing)
- Fog of war, flying units, more ability effect types, unit training buildings
- Reconnect to a running game, replays (the lockstep command log already makes this cheap), ranked lobbies
