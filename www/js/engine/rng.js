// Deterministic PRNG (mulberry32). Only integer ops + one division, so every
// JS engine produces the exact same sequence — required for lockstep netplay.
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Integer in [a, b]
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
}

// FNV-1a over a string -> 32-bit unsigned
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
