// Lockstep session: owns a Game and feeds it numbered turns of commands.
// Works with a LocalTransport (solo, zero latency) or NetTransport (online).
import { Game, TICK_RATE, TICKS_PER_TURN } from '../engine/sim.js';

const TICK_MS = 1000 / TICK_RATE;
const HASH_EVERY = 25; // turns

export class LocalTransport {
  constructor(localPlayer) {
    this.local = localPlayer;
    this.pending = [];
    this.local = localPlayer;
  }
  sendCmd(c) {
    this.pending.push({ p: this.local, c });
  }
  // Solo play produces turns on demand, so there is no input latency.
  poll() {
    const cmds = this.pending;
    this.pending = [];
    return cmds;
  }
  sendHash() {}
  close() {}
}

export class NetTransport {
  constructor(net) {
    this.net = net;
    this.onTurn = null;
    this._off = net.on('turn', (m) => this.onTurn && this.onTurn(m.n, m.cmds));
  }
  sendCmd(c) {
    this.net.send('cmd', { c });
  }
  sendHash(turn, h) {
    this.net.send('hash', { turn, h });
  }
  close() {
    this._off && this._off();
  }
}

export class Session {
  constructor({ map, seed, slots, local, transport, online = false }) {
    this.game = new Game(map, { seed, slots });
    this.local = local;
    this.online = online;
    this.transport = transport;
    this.turns = new Map();
    this.nextTurn = 1;
    this.sub = 0;
    this.acc = 0;
    this.alpha = 1;
    this.paused = false;
    this.stalled = false;
    this.stallMs = 0;
    this.fxSinks = [];
    transport.onTurn = (n, cmds) => this.turns.set(n, cmds);
  }

  get localPlayer() {
    return this.game.players[this.local];
  }

  issue(cmd) {
    if (this.local < 0 || this.game.ended) return;
    this.transport.sendCmd(cmd);
  }

  bufferedTicks() {
    let n = 0;
    for (let t = this.nextTurn; this.turns.has(t); t++) n += TICKS_PER_TURN;
    return n - this.sub;
  }

  _haveTurn() {
    if (this.sub > 0) return true;
    if (this.turns.has(this.nextTurn)) return true;
    if (this.transport.poll) {
      this.turns.set(this.nextTurn, this.transport.poll());
      return true;
    }
    return false;
  }

  _tick() {
    const g = this.game;
    if (this.sub === 0) {
      const cmds = this.turns.get(this.nextTurn) || [];
      this.turns.delete(this.nextTurn);
      for (const { p, c } of cmds) g.applyCommand(p, c);
    }
    g.step();
    if (g.fx.length) {
      const fx = g.fx;
      g.fx = [];
      for (const sink of this.fxSinks) sink(fx);
    }
    this.sub++;
    if (this.sub >= TICKS_PER_TURN) {
      this.sub = 0;
      if (this.nextTurn % HASH_EVERY === 0) this.transport.sendHash(this.nextTurn, g.checksum());
      this.nextTurn++;
    }
  }

  // Advance simulation by real elapsed time (ms). Online, a small jitter
  // buffer is kept and we speed up when turns pile up.
  update(dtMs) {
    if (this.paused) {
      this.alpha = 1;
      return;
    }
    this.acc += Math.min(dtMs, 250);
    let steps = 0;
    const buffered = this.online ? this.bufferedTicks() : 0;
    const maxSteps = buffered > 10 ? 12 : 4;
    while (this.acc >= TICK_MS && steps < maxSteps) {
      if (!this._haveTurn()) {
        this.acc = Math.min(this.acc, TICK_MS);
        break;
      }
      this._tick();
      this.acc -= TICK_MS;
      steps++;
    }
    // Catch-up when far behind the server (e.g. after the app was backgrounded).
    if (this.online && this.bufferedTicks() > 40) {
      let extra = 0;
      while (this.bufferedTicks() > 6 && extra++ < 200) this._tick();
    }
    const waiting = this.online && !this._haveTurn();
    this.stallMs = waiting ? this.stallMs + dtMs : 0;
    this.stalled = this.stallMs > 600;
    this.alpha = Math.max(0, Math.min(1, this.acc / TICK_MS));
  }

  close() {
    this.transport.close();
  }
}
