// Procedural unit & building art. Everything is drawn with canvas primitives
// so the game ships with zero art assets. Each model is drawn centred at the
// origin, facing +x, with radius r (world units).

function shade(hex, amt) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export { shade };

function circle(ctx, x, y, r, fill, stroke, lw = 1.5) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function poly(ctx, pts, fill, stroke, lw = 1.5) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function body(ctx, r, team, accent) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(accent, 0.35));
  g.addColorStop(1, shade(accent, -0.25));
  circle(ctx, 0, 0, r, g, team, Math.max(1.5, r * 0.18));
}

const HERO_EMBLEM = {
  hero_knight(ctx, r, a) {
    ctx.strokeStyle = '#e8e8f0'; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.2); ctx.lineTo(r * 1.35, -r * 0.2); ctx.stroke();
    poly(ctx, [[-r * 0.1, r * 0.25], [r * 0.55, r * 0.25], [r * 0.55, r * 0.95], [r * 0.22, r * 1.15], [-r * 0.1, r * 0.95]], shade(a, -0.2), '#ffd27a', 1.2);
  },
  hero_mage(ctx, r, a, t) {
    ctx.strokeStyle = '#8a6a4a'; ctx.lineWidth = r * 0.14;
    ctx.beginPath(); ctx.moveTo(r * 0.3, r * 0.7); ctx.lineTo(r * 0.9, -r * 0.9); ctx.stroke();
    circle(ctx, r * 0.95, -r * 1.05, r * (0.28 + 0.05 * Math.sin(t * 6)), '#bff4ff', '#fff', 1);
  },
  hero_archer(ctx, r) {
    ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = r * 0.14;
    ctx.beginPath(); ctx.arc(r * 0.35, 0, r * 0.95, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(r * 0.35 + Math.cos(-1.2) * r * 0.95, Math.sin(-1.2) * r * 0.95); ctx.lineTo(r * 0.35 + Math.cos(1.2) * r * 0.95, Math.sin(1.2) * r * 0.95); ctx.stroke();
  },
  hero_rogue(ctx, r) {
    ctx.strokeStyle = '#dcd6ff'; ctx.lineWidth = r * 0.13;
    ctx.beginPath(); ctx.moveTo(r * 0.4, -r * 0.5); ctx.lineTo(r * 1.25, -r * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.4, r * 0.5); ctx.lineTo(r * 1.25, r * 0.75); ctx.stroke();
  },
  hero_priest(ctx, r, a, t) {
    ctx.save();
    ctx.rotate(t * 0.8);
    ctx.strokeStyle = 'rgba(255,230,120,0.85)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      const an = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 1.15, Math.sin(an) * r * 1.15); ctx.lineTo(Math.cos(an) * r * 1.45, Math.sin(an) * r * 1.45); ctx.stroke();
    }
    ctx.restore();
  }
};

// Draw one unit model. `face` is the facing angle in radians.
export function drawModel(ctx, m, r, team, accent, face, t, opt = {}) {
  accent = accent || '#9aa0a6';
  ctx.save();
  if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
  const rotating = !BUILDINGS.has(m);
  if (rotating) ctx.rotate(face);
  switch (m) {
    case 'hero_knight': case 'hero_mage': case 'hero_archer': case 'hero_rogue': case 'hero_priest': {
      // cape
      poly(ctx, [[-r * 0.2, -r * 0.95], [-r * 1.45, -r * 0.6], [-r * 1.55, r * 0.6], [-r * 0.2, r * 0.95]], shade(team, -0.25));
      body(ctx, r, team, accent);
      circle(ctx, 0, 0, r * 1.18, null, '#ffd54a', 1.4);
      HERO_EMBLEM[m](ctx, r, accent, t);
      circle(ctx, r * 0.15, 0, r * 0.42, shade(accent, 0.5));
      break;
    }
    case 'soldier':
      body(ctx, r, team, accent || '#a0a0a8');
      poly(ctx, [[r * 0.1, -r * 1.1], [r * 0.75, -r * 0.85], [r * 0.75, -r * 0.2], [r * 0.1, -r * 0.35]], shade(team, -0.1), '#ddd', 1);
      ctx.strokeStyle = '#e0e0e8'; ctx.lineWidth = r * 0.16;
      ctx.beginPath(); ctx.moveTo(r * 0.3, r * 0.5); ctx.lineTo(r * 1.3, r * 0.5); ctx.stroke();
      circle(ctx, r * 0.1, 0, r * 0.4, '#8a8f99');
      break;
    case 'archer':
      body(ctx, r, team, accent || '#7a9a6a');
      ctx.strokeStyle = '#b08a5a'; ctx.lineWidth = r * 0.17;
      ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 1.0, -1.1, 1.1); ctx.stroke();
      poly(ctx, [[r * 0.5, 0], [-r * 0.4, -r * 0.45], [-r * 0.4, r * 0.45]], shade(team, -0.3));
      break;
    case 'wolf':
      poly(ctx, [[-r * 1.5, 0], [-r * 0.9, -r * 0.3], [-r * 0.9, r * 0.3]], shade(accent, -0.2));
      ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 1.6; ctx.stroke();
      circle(ctx, r * 0.95, 0, r * 0.48, shade(accent, 0.15));
      poly(ctx, [[r * 0.85, -r * 0.35], [r * 0.75, -r * 0.8], [r * 1.1, -r * 0.4]], shade(accent, -0.3));
      poly(ctx, [[r * 0.85, r * 0.35], [r * 0.75, r * 0.8], [r * 1.1, r * 0.4]], shade(accent, -0.3));
      break;
    case 'beast':
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.strokeStyle = '#f2ead8'; ctx.lineWidth = r * 0.15;
      ctx.beginPath(); ctx.moveTo(r * 0.9, -r * 0.35); ctx.lineTo(r * 1.35, -r * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.9, r * 0.35); ctx.lineTo(r * 1.35, r * 0.6); ctx.stroke();
      for (let i = -2; i <= 2; i++) poly(ctx, [[-r * 0.2 + i * r * 0.25, -r * 0.7], [-r * 0.1 + i * r * 0.25, -r * 1.05], [i * r * 0.25, -r * 0.7]], shade(accent, -0.35));
      break;
    case 'caster':
      poly(ctx, [[r * 0.9, 0], [-r * 0.9, -r * 0.9], [-r * 0.6, 0], [-r * 0.9, r * 0.9]], accent, team, 1.6);
      circle(ctx, r * 0.95, -r * 0.6, r * (0.3 + 0.06 * Math.sin(t * 5)), '#c6ff9e', '#fff', 0.8);
      break;
    case 'golem':
      ctx.beginPath(); roundRect(ctx, -r, -r * 0.9, r * 2, r * 1.8, r * 0.4);
      ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 2; ctx.stroke();
      circle(ctx, -r * 0.3, -r * 0.3, r * 0.25, '#7fa865');
      circle(ctx, r * 0.35, r * 0.35, r * 0.2, '#7fa865');
      circle(ctx, r * 0.6, -r * 0.2, r * 0.12, '#ffe58a');
      circle(ctx, r * 0.6, r * 0.2, r * 0.12, '#ffe58a');
      break;
    case 'ghoul':
      body(ctx, r, team, accent);
      for (let i = 0; i < 5; i++) {
        const an = -2.4 + i * 0.4 + Math.PI;
        poly(ctx, [[Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8], [Math.cos(an + 0.15) * r * 1.4, Math.sin(an + 0.15) * r * 1.4], [Math.cos(an + 0.3) * r * 0.8, Math.sin(an + 0.3) * r * 0.8]], shade(accent, -0.4));
      }
      circle(ctx, r * 0.55, -r * 0.25, r * 0.13, '#ff5a5a');
      circle(ctx, r * 0.55, r * 0.25, r * 0.13, '#ff5a5a');
      break;
    case 'spitter':
      circle(ctx, -r * 0.35, 0, r * 0.85, shade(accent, -0.2), team, 1.6);
      circle(ctx, r * 0.45, 0, r * 0.6, accent, team, 1.4);
      circle(ctx, r * 0.85, 0, r * 0.22, '#2b3a12');
      break;
    case 'brute':
      body(ctx, r, team, accent);
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = r * 0.18;
      ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.95, r * 0.45, 0.4, 2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.3, r * 0.95, r * 0.45, -2.2, -0.4); ctx.stroke();
      circle(ctx, r * 0.6, 0, r * 0.18, '#ffb000');
      break;
    case 'wraith': {
      const fl = 0.75 + 0.2 * Math.sin(t * 9);
      ctx.globalAlpha *= fl;
      poly(ctx, [[r * 1.0, 0], [-r * 0.2, -r * 0.9], [-r * 1.6, -r * 0.3], [-r * 1.1, 0], [-r * 1.6, r * 0.3], [-r * 0.2, r * 0.9]], accent, team, 1.4);
      circle(ctx, r * 0.45, 0, r * 0.25, '#e8f0ff');
      break;
    }
    case 'tyrant':
      body(ctx, r, team, accent);
      for (let i = -2; i <= 2; i++) {
        const an = i * 0.45;
        poly(ctx, [[Math.cos(an - 0.15) * r * 0.85, Math.sin(an - 0.15) * r * 0.85], [Math.cos(an) * r * 1.5, Math.sin(an) * r * 1.5], [Math.cos(an + 0.15) * r * 0.85, Math.sin(an + 0.15) * r * 0.85]], '#2a0d16');
      }
      circle(ctx, r * 0.5, -r * 0.25, r * 0.12, '#ffea00');
      circle(ctx, r * 0.5, r * 0.25, r * 0.12, '#ffea00');
      break;
    case 'imp':
      body(ctx, r, team, accent);
      poly(ctx, [[0, -r * 0.7], [-r * 0.5, -r * 1.3], [-r * 0.2, -r * 0.6]], shade(accent, -0.3));
      poly(ctx, [[0, r * 0.7], [-r * 0.5, r * 1.3], [-r * 0.2, r * 0.6]], shade(accent, -0.3));
      circle(ctx, r * 0.5, 0, r * 0.18, '#103050');
      break;
    case 'bug':
      ctx.strokeStyle = shade(accent, -0.4); ctx.lineWidth = 1.2;
      for (let i = -1; i <= 1; i++) {
        const k = Math.sin(t * 20 + i) * 0.2;
        ctx.beginPath(); ctx.moveTo(i * r * 0.5, 0); ctx.lineTo(i * r * 0.5 + r * k, -r * 1.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * r * 0.5, 0); ctx.lineTo(i * r * 0.5 - r * k, r * 1.2); ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 1.4; ctx.stroke();
      break;
    case 'turtle':
      circle(ctx, r * 0.95, 0, r * 0.35, shade(accent, 0.2));
      circle(ctx, 0, 0, r, shade(accent, -0.15), team, 1.8);
      poly(ctx, hex(r * 0.5), shade(accent, 0.15), shade(accent, -0.4), 1);
      break;
    case 'wisp': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.4, accent);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      circle(ctx, 0, 0, r * 1.5, g);
      circle(ctx, 0, 0, r * 0.5, '#fff8e0', team, 1);
      break;
    }
    case 'colossus':
      poly(ctx, hex(r), shade(accent, -0.1), team, 2.2);
      poly(ctx, hex(r * 0.6), shade(accent, 0.35));
      circle(ctx, r * 0.55, -r * 0.3, r * 0.12, '#0b3b6b');
      circle(ctx, r * 0.55, r * 0.3, r * 0.12, '#0b3b6b');
      break;
    case 'ram':
      ctx.beginPath(); roundRect(ctx, -r * 1.1, -r * 0.75, r * 1.9, r * 1.5, r * 0.25);
      ctx.fillStyle = '#7a5a3a'; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#4a4a50';
      ctx.fillRect(r * 0.6, -r * 0.25, r * 0.9, r * 0.5);
      circle(ctx, r * 1.5, 0, r * 0.3, '#5a5a62');
      for (const [x, y] of [[-r * 0.7, -r * 0.85], [r * 0.4, -r * 0.85], [-r * 0.7, r * 0.85], [r * 0.4, r * 0.85]]) circle(ctx, x, y, r * 0.25, '#3a2a1a');
      break;

    case 'flyer': {
      const flap = Math.sin(t * 12) * 0.35;
      for (const side of [-1, 1]) {
        poly(ctx, [[r * 0.2, side * r * 0.2], [-r * 0.5, side * r * (1.7 + flap)], [-r * 0.9, side * r * (1.2 + flap)], [-r * 0.5, side * r * 0.3]], shade(accent, -0.15), team, 1.2);
      }
      poly(ctx, [[-r * 0.6, 0], [-r * 1.5, -r * 0.3], [-r * 1.3, 0], [-r * 1.5, r * 0.3]], shade(accent, -0.3));
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill(); ctx.strokeStyle = team; ctx.lineWidth = 1.4; ctx.stroke();
      circle(ctx, r * 0.95, 0, r * 0.32, shade(accent, 0.25));
      circle(ctx, r * 1.1, -r * 0.1, r * 0.08, '#102040');
      break;
    }

    // ---------------------------------------------------------- buildings
    case 'tower_sky': {
      const s = r * 0.95;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#4a5568', '#1a2030', 2);
      circle(ctx, 0, 0, s * 0.62, '#6a7a90');
      ctx.save();
      ctx.rotate(face);
      ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = s * 0.14;
      ctx.beginPath(); ctx.arc(-s * 0.1, 0, s * 0.7, -1.0, 1.0); ctx.stroke();
      ctx.strokeStyle = '#e8eef8'; ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.moveTo(-s * 0.4, 0); ctx.lineTo(s * 1.05, 0); ctx.stroke();
      poly(ctx, [[s * 1.2, 0], [s * 0.95, -s * 0.12], [s * 0.95, s * 0.12]], accent);
      ctx.restore();
      circle(ctx, 0, 0, s * 0.16, team);
      tierPips(ctx, s, opt.tier);
      break;
    }
    case 'drill': {
      const s = r * 0.95;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#6a5232', '#2a1a08', 2);
      ctx.save();
      ctx.rotate(t * 3);
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2;
        poly(ctx, [[Math.cos(an - 0.15) * s * 0.5, Math.sin(an - 0.15) * s * 0.5], [Math.cos(an) * s * 0.8, Math.sin(an) * s * 0.8], [Math.cos(an + 0.15) * s * 0.5, Math.sin(an + 0.15) * s * 0.5]], '#9aa0a8');
      }
      circle(ctx, 0, 0, s * 0.5, '#7a8088', '#3a3a40', 1.5);
      ctx.restore();
      circle(ctx, 0, 0, s * 0.22, '#ffd54a', team, 2);
      for (const [x, y] of [[-s * 0.7, s * 0.7], [s * 0.7, -s * 0.7], [s * 0.72, s * 0.65]]) circle(ctx, x, y, s * 0.1, '#ffd54a');
      break;
    }
    case 'tower_guard': {
      const s = r * 1.05;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#6c6a70', '#2a2830', 2);
      poly(ctx, [[-s * 0.7, -s * 0.7], [s * 0.7, -s * 0.7], [s * 0.7, s * 0.7], [-s * 0.7, s * 0.7]], '#8a8890');
      for (const [x, y] of [[-s, -s], [s, -s], [s, s], [-s, s]]) poly(ctx, [[x - 4, y - 4], [x + 4, y - 4], [x + 4, y + 4], [x - 4, y + 4]], '#55535a');
      circle(ctx, 0, 0, s * 0.45, team, '#222', 1.5);
      break;
    }
    case 'core': {
      const p = 0.9 + 0.08 * Math.sin(t * 2.5);
      circle(ctx, 0, 0, r * 1.05, 'rgba(0,0,0,0.25)');
      poly(ctx, hex(r), '#3a3446', team, 3);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, team);
      g.addColorStop(1, shade(team, -0.5));
      poly(ctx, hex(r * 0.62 * p, Math.PI / 6), g);
      break;
    }
    case 'shop':
      poly(ctx, [[-r, -r * 0.2], [0, -r * 1.1], [r, -r * 0.2], [r, r * 0.9], [-r, r * 0.9]], '#8a5a3a', '#3a2010', 2);
      poly(ctx, [[-r * 1.1, -r * 0.15], [0, -r * 1.2], [r * 1.1, -r * 0.15]], '#c8443a', '#5a1a10', 1.5);
      poly(ctx, [[-r * 0.25, r * 0.9], [-r * 0.25, r * 0.25], [r * 0.25, r * 0.25], [r * 0.25, r * 0.9]], '#3a2010');
      circle(ctx, 0, -r * 0.45, r * 0.18, '#ffd54a');
      break;
    case 'wall': {
      const s = r * 1.1;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#77736c', '#3a3630', 2);
      ctx.strokeStyle = '#5a5650'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, 0); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 0.5, s); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.5, s);
      ctx.stroke();
      circle(ctx, 0, 0, 3, team);
      break;
    }
    case 'tower_arrow': {
      const s = r * 0.95;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#6a4a2a', '#2a1a0a', 2);
      poly(ctx, [[0, -s * 0.9], [s * 0.6, 0], [0, s * 0.9], [-s * 0.6, 0]], accent, '#3a2a1a', 1.5);
      circle(ctx, 0, 0, s * 0.28, team, '#222', 1.2);
      tierPips(ctx, s, opt.tier);
      break;
    }
    case 'tower_frost': {
      const s = r * 0.95;
      poly(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]], '#3a5a72', '#12283a', 2);
      const g = ctx.createLinearGradient(0, -s, 0, s);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, accent);
      poly(ctx, [[0, -s * 1.15], [s * 0.45, 0], [0, s * 0.8], [-s * 0.45, 0]], g, '#bff4ff', 1);
      circle(ctx, 0, 0, s * 0.2, team);
      tierPips(ctx, s, opt.tier);
      break;
    }
    case 'tower_cannon': {
      const s = r * 0.95;
      circle(ctx, 0, 0, s, '#7a6a5a', '#2a2018', 2.5);
      circle(ctx, 0, 0, s * 0.62, '#9a8a7a');
      ctx.save();
      ctx.rotate(face);
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(0, -s * 0.2, s * 1.05, s * 0.4);
      ctx.restore();
      circle(ctx, 0, 0, s * 0.3, team, '#111', 1.2);
      tierPips(ctx, s, opt.tier);
      break;
    }
    case 'tower_storm': {
      const s = r * 0.95;
      poly(ctx, hex(s), '#3e3456', '#18122a', 2);
      const orb = s * (0.38 + 0.05 * Math.sin(t * 8));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, orb * 1.8);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.5, accent);
      g.addColorStop(1, 'rgba(160,120,255,0)');
      circle(ctx, 0, 0, orb * 1.8, g);
      circle(ctx, 0, 0, s * 0.15, team);
      tierPips(ctx, s, opt.tier);
      break;
    }
    case 'beacon': {
      ctx.save();
      ctx.rotate(t * 0.3);
      ctx.strokeStyle = 'rgba(255,225,120,0.35)'; ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 0.9, Math.sin(an) * r * 0.9); ctx.lineTo(Math.cos(an) * r * 1.45, Math.sin(an) * r * 1.45); ctx.stroke();
      }
      ctx.restore();
      poly(ctx, hex(r * 0.95), '#7a6a4a', '#3a2a10', 2.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.7);
      g.addColorStop(0, '#fffbe6');
      g.addColorStop(0.6, '#ffd54a');
      g.addColorStop(1, '#c08a10');
      circle(ctx, 0, 0, r * 0.6 * (0.95 + 0.05 * Math.sin(t * 3)), g);
      break;
    }
    default:
      body(ctx, r, team, accent);
      circle(ctx, r * 0.5, 0, r * 0.2, '#fff');
  }
  ctx.restore();
}

export const BUILDINGS = new Set(['tower_guard', 'core', 'shop', 'wall', 'tower_arrow', 'tower_frost', 'tower_cannon', 'tower_storm', 'beacon', 'tower_sky', 'drill']);

function tierPips(ctx, s, tier) {
  if (!tier || tier < 2) return;
  for (let i = 0; i < tier; i++) circle(ctx, -s * 0.6 + i * 7, s * 0.72, 2.4, '#ffd54a', '#5a4000', 0.8);
}

function hex(r, rot = 0) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Small square portrait for HUD buttons/panels.
export function drawPortrait(canvas, t, team) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width;
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#2a2638');
  g.addColorStop(1, '#14121c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.translate(s / 2, s / 2);
  const r = t.building ? s * 0.32 : s * 0.3;
  drawModel(ctx, t.model, r, team || '#888', t.color, t.building ? 0 : -0.5, performance.now() / 1000, { tier: t.tier });
  ctx.restore();
}
