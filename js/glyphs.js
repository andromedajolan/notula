// Notula: hand-built music glyphs as SVG fragments. Units are staff spaces (1 sp = distance between lines).
// All functions return SVG strings. y grows downward; the top staff line sits at y0.

const K = 0.5523;
export function ell(cx, cy, rx, ry, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const P = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  const pts = [
    [[rx, 0], [rx, K * ry], [K * rx, ry], [0, ry]],
    [[0, ry], [-K * rx, ry], [-rx, K * ry], [-rx, 0]],
    [[-rx, 0], [-rx, -K * ry], [-K * rx, -ry], [0, -ry]],
    [[0, -ry], [K * rx, -ry], [rx, -K * ry], [rx, 0]],
  ];
  const f = (p) => p.map((n) => n.toFixed(3)).join(' ');
  let d = 'M' + f(P(...pts[0][0]));
  for (const seg of pts) d += ' C' + f(P(...seg[1])) + ' ' + f(P(...seg[2])) + ' ' + f(P(...seg[3]));
  return d + 'Z';
}

export const HEAD_RX = 0.68;

export function head(base, cx, cy) {
  if (base >= 192) {
    return `<path fill-rule="evenodd" d="${ell(cx, cy, 0.98, 0.52, 0)} ${ell(cx, cy, 0.42, 0.62, 28)}"/>`;
  }
  if (base >= 96) {
    return `<path fill-rule="evenodd" d="${ell(cx, cy, HEAD_RX, 0.5, -24)} ${ell(cx, cy, 0.5, 0.2, -42)}"/>`;
  }
  return `<path d="${ell(cx, cy, HEAD_RX, 0.5, -24)}"/>`;
}

export function sharp(x, y) {
  return `<g transform="translate(${x} ${y})" stroke="#000" fill="none" stroke-linecap="butt">`
    + `<path d="M-0.28 -1.55V1.75M0.28 -1.75V1.55" stroke-width="0.13"/>`
    + `<path d="M-0.62 0.5L0.62 0.05M-0.62 -0.4L0.62 -0.85" stroke-width="0.42"/></g>`;
}
export function flat(x, y) {
  return `<g transform="translate(${x} ${y})"><path d="M-0.3 -2.1V0.55" stroke="#000" stroke-width="0.13" fill="none"/>`
    + `<path d="M-0.3 0.6C0.35 0.35 0.85 0 0.82 -0.5C0.78 -1.1 0.05 -1.15 -0.3 -0.45L-0.3 -0.8C-0.1 -1.35 0.95 -1.35 1.0 -0.5C1.04 0.1 0.5 0.55 -0.3 0.9Z" fill="#000"/></g>`;
}
export function natural(x, y) {
  return `<g transform="translate(${x} ${y})" stroke="#000" fill="none">`
    + `<path d="M-0.32 -1.65V0.75M0.32 -0.75V1.65" stroke-width="0.13"/>`
    + `<path d="M-0.32 -0.5L0.32 -0.75M-0.32 0.85L0.32 0.6" stroke-width="0.38"/></g>`;
}
export function accidental(alt, x, y) { return alt > 0 ? sharp(x, y) : alt < 0 ? flat(x, y) : natural(x, y); }

// clefs: origin at left edge, y0 = top staff line
export function trebleClef(x, y0) {
  // centre line drawn as a stroked path; G line (2nd from bottom) is y0+3
  const d = 'M1.0 6.55C1.05 7.25 0.15 7.35 0.1 6.6C0.05 5.9 0.95 5.75 1.3 6.3'
    + 'C1.6 5.6 1.45 1.5 1.35 -0.6C1.3 -2.0 1.8 -3.0 2.4 -3.0C3.0 -3.0 3.2 -1.9 2.7 -0.6C2.2 0.8 0.1 1.5 -0.05 3.4C-0.15 5.0 1.2 5.2 2.1 4.6C2.9 4.0 2.8 2.6 1.9 2.2C1.0 1.8 0.3 2.5 0.5 3.3C0.65 3.9 1.4 3.9 1.55 3.4';
  return `<g transform="translate(${x} ${y0})"><path d="${d}" fill="none" stroke="#000" stroke-width="0.34" stroke-linecap="round" stroke-linejoin="round"/><circle cx="0.62" cy="6.6" r="0.3"/></g>`;
}
export function bassClef(x, y0) {
  return `<g transform="translate(${x} ${y0})"><circle cx="0.75" cy="1" r="0.5"/>`
    + `<path d="M0.8 0.55C2.9 0.5 3.7 1.7 3.1 3.1C2.5 4.4 1.3 5.3 0.0 5.7" fill="none" stroke="#000" stroke-width="0.38" stroke-linecap="round"/>`
    + `<circle cx="4.3" cy="0.5" r="0.26"/><circle cx="4.3" cy="1.5" r="0.26"/></g>`;
}

const SHARP_Y = [0, 1.5, -0.5, 1, 2.5, 0.5, 2];
const FLAT_Y = [2, 0.5, 2.5, 1, 3, 1.5, 3.5];
export function keySig(sf, x, y0, clef) {
  const off = clef === 'bass' ? 1 : 0;
  let s = '';
  for (let i = 0; i < Math.abs(sf); i++) {
    if (sf > 0) s += sharp(x + i * 1.45 + 0.5, y0 + SHARP_Y[i] + off);
    else s += flat(x + i * 1.15 + 0.4, y0 + FLAT_Y[i] + off);
  }
  return s;
}
export function keySigWidth(sf) { return sf === 0 ? 0 : Math.abs(sf) * (sf > 0 ? 1.45 : 1.15) + 0.9; }

export function timeSig(num, den, x, y0) {
  const f = `font-family="Georgia,'Times New Roman',serif" font-weight="bold" font-size="3.2" text-anchor="middle"`;
  return `<text x="${x}" y="${y0 + 2.0}" ${f}>${num}</text><text x="${x}" y="${y0 + 4.0}" ${f}>${den}</text>`;
}

export function restGlyph(base, dots, cx, y0) {
  let s = '';
  if (base >= 192) s = `<rect x="${cx - 0.75}" y="${y0 + 1}" width="1.5" height="0.5"/>`;
  else if (base >= 96) s = `<rect x="${cx - 0.75}" y="${y0 + 1.5}" width="1.5" height="0.5"/>`;
  else if (base >= 48) {
    s = `<path d="M${cx - 0.25} ${y0 + 0.55}L${cx + 0.45} ${y0 + 1.4}L${cx - 0.2} ${y0 + 2.05}L${cx + 0.4} ${y0 + 2.85}C${cx - 0.35} ${y0 + 2.55} ${cx - 0.5} ${y0 + 3.2} ${cx + 0.1} ${y0 + 3.55}" fill="none" stroke="#000" stroke-width="0.36" stroke-linejoin="round" stroke-linecap="round"/>`;
  } else {
    const n = base <= 3 ? 4 : base <= 6 ? 3 : base <= 12 ? 2 : 1;
    const top = y0 + 1.0, bot = y0 + 3.0 + (n - 1) * 1.0;
    const x1 = cx + 0.55, x0 = cx - 0.35 - (n - 1) * 0.35;
    s = `<path d="M${x1} ${top}L${x0} ${bot}" stroke="#000" stroke-width="0.14" fill="none"/>`;
    for (let i = 0; i < n; i++) {
      const bx = cx - 0.15 - i * 0.35 + 0.0, by = y0 + 1.5 + i * 1.0;
      s += `<circle cx="${bx - 0.25}" cy="${by}" r="0.3"/><path d="M${bx - 0.25} ${by + 0.2}C${bx + 0.3} ${by + 0.15} ${bx + 0.6} ${by - 0.2} ${bx + 0.7 - 0.0} ${by - 0.65}" fill="none" stroke="#000" stroke-width="0.2" stroke-linecap="round"/>`;
    }
  }
  if (dots) s += `<circle cx="${cx + 1.1}" cy="${y0 + 1.5}" r="0.22"/>`;
  return s;
}

// flag at a stem end (x, y); dir 1 = stem up (flag hangs down), -1 = stem down
export function flags(n, x, y, dir) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const oy = i * 0.95 * (dir === 1 ? 1 : -1);
    const f = dir === 1
      ? `M0 0C0.1 1.0 1.75 1.5 1.55 3.45C1.45 2.45 0.7 1.85 0 1.5Z`
      : `M0 0C0.1 -1.0 1.75 -1.5 1.55 -3.45C1.45 -2.45 0.7 -1.85 0 -1.5Z`;
    s += `<path transform="translate(${x} ${y + oy})" d="${f}"/>`;
  }
  return s;
}

export function quarterSymbol(x, y) {
  return `<path d="${ell(x, y, 0.62, 0.44, -24)}"/><path d="M${x + 0.56} ${y - 0.1}V${y - 3.0}" stroke="#000" stroke-width="0.13"/>`;
}
