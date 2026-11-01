// Minimal WebSocket client with typed messages and listeners.
export class Net {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.id = 0;
    this.connected = false;
    this.ping = 0;
    this._pingTimer = null;
  }

  static defaultUrl() {
    const l = globalThis.location;
    if (l && (l.protocol === 'http:' || l.protocol === 'https:') && l.hostname !== 'localhost' && !/capacitor|ionic/.test(l.protocol)) {
      return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/ws`;
    }
    if (l && l.protocol === 'http:' && l.hostname === 'localhost' && l.port) return `ws://${l.host}/ws`;
    return 'ws://192.168.1.10:8080/ws';
  }

  connect(url, name) {
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('Invalid server address.'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('Could not reach the server (timeout).'));
        }
      }, 6000);
      ws.onopen = () => {
        this.send('hello', { name });
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.type === 'welcome' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.id = m.id;
          this.connected = true;
          this._pingTimer = setInterval(() => this.send('ping', { t: performance.now() }), 3000);
          resolve(m);
        }
        if (m.type === 'pong') this.ping = Math.round(performance.now() - m.t);
        this.emit(m.type, m);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Could not connect to the server.'));
        }
      };
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this._pingTimer);
        if (settled) this.emit('disconnected', {});
      };
    });
  }

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, ...data }));
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, m) {
    for (const fn of this.listeners.get(type) || []) fn(m);
  }

  close() {
    clearInterval(this._pingTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.connected = false;
  }
}
