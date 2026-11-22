// Notula: page layout and SVG engraving of a score model.
import * as G from './glyphs.js';
import { prettyChord } from './chords.js';
import { keyAccidentals, NAT_PC } from './theory.js';

export const SP_IN = 0.072;     // inches per staff space
export const SYS_TOP = 6;       // room above the staff (tempo, labels, high notes)
export const SYS_H = 14;        // sp, total height of one system
export const SYS_GAP = 1.6;
const PAD_L = 1.3, PAD_R = 1.0;
export const CHORD_ROW = 3.4, LYR_ROW = 3.6, TAB_SP = 1.0;
const CLEF_W = { treble: 4.2, bass: 5.6 };
const MARGIN_X = 0.6, MARGIN_Y = 0.55;
export const HEADER_IN = 1.05;  // title block on page 1 (inches)

const lyrW = (t) => t.length * 0.88 + 1.0;
const noteW = (dur) => Math.max(2.4, 2.9 + 1.25 * Math.log2(dur / 12));

function measureMetrics(m) {
  let padL = PAD_L, padR = PAD_R;
  if (m.showTs) padL += 3.2;
  if (m.marks && m.marks.repeatStart) padL += 2.4;
  if (m.marks && m.marks.repeatEnd) padR += 2.4;
  if (m.marks && m.marks.doubleBar) padR += 0.6;
  const items = [];
  let fixed = padL + padR, space = 0;
  if (m.multi) { space = 12; }
  else if (m.items.length === 1 && m.items[0].whole) { space = 8; }
  else {
    for (const it of m.items) {
      const lead = it.kind === 'note' && it.acc != null ? 1.55 : 0;
      let w = noteW(it.dur) + (it.dots ? 0.7 : 0);
      if (it.lyr) w = Math.max(w, lyrW(it.lyr) / 0.8);
      items.push({ lead, w });
      fixed += lead; space += w;
    }
  }
  return { padL, padR, items, fixed, space, minW: fixed + space };
}

export function layoutScore(score, opt) {
  const pageW = opt.pageW, pageH = opt.pageH;
  const mx = opt.marginX != null ? opt.marginX : MARGIN_X;
  const my = opt.marginY != null ? opt.marginY : MARGIN_Y;
  const contentW = (pageW - 2 * mx) / SP_IN;
  const keyW = G.keySigWidth(score.key.sf);
  const clefW = CLEF_W[score.clef] || 4.2;
  const headerW = clefW + keyW;
  const metrics = score.measures.map(measureMetrics);
  const top = SYS_TOP + (score.chordRow ? CHORD_ROW : 0);
  const tabN = score.tabInfo ? score.tabInfo.strings : 0;
  const tabTop = top + 8.4 + (score.lyricRow ? LYR_ROW : 0);
  const sysH = tabN ? tabTop + (tabN - 1) * TAB_SP + 1.6 : top + 8 + (score.lyricRow ? LYR_ROW : 0);
  const systems = [];
  let cur = null, used = 0;
  score.measures.forEach((m, i) => {
    const mm = metrics[i];
    if (!cur || (cur.ms.length > 0 && used + mm.minW > contentW)) {
      cur = { ms: [], headerW }; systems.push(cur); used = headerW;
    }
    cur.ms.push(i); used += mm.minW;
  });
  const out = [];
  systems.forEach((sy, si) => {
    const last = si === systems.length - 1;
    let fixed = 0, space = 0;
    sy.ms.forEach((i) => { fixed += metrics[i].fixed; space += metrics[i].space; });
    let f = (contentW - headerW - fixed) / space;
    if (last) f = Math.min(f, 1.3);
    f = Math.max(0.55, f);
    let x = headerW;
    const ms = sy.ms.map((i) => {
      const m = score.measures[i], mm = metrics[i];
      let cx = x + mm.padL;
      const items = mm.items.map((q, k) => { cx += q.lead; const r = { x: cx, it: m.items[k] }; cx += q.w * f; return r; });
      const W = mm.padL + mm.padR + mm.items.reduce((a, q) => a + q.lead + q.w * f, 0) + (mm.items.length ? 0 : mm.space * f);
      const geo = { m, x, W, items, padL: mm.padL, padR: mm.padR };
      x += W;
      return geo;
    });
    out.push({ index: si, ms, endX: x, headerW, contentW, top, h: sysH, tabTop: tabN ? tabTop : null });
  });
  // pages
  const pageContentH = (pageH - 2 * my) / SP_IN;
  const pages = [];
  let page = { systems: [] }, h = HEADER_IN / SP_IN;
  for (const sy of out) {
    if (!opt.single && page.systems.length && h + sysH > pageContentH) { pages.push(page); page = { systems: [] }; h = 0; }
    page.systems.push(sy); h += sysH + SYS_GAP;
  }
  pages.push(page);
  return { systems: out, pages, sysH, contentW, pageW, pageH, marginX: mx, marginY: my };
}

const fx = (n) => (Math.round(n * 100) / 100);

export function renderSystem(score, sys, state = {}) {
  const y0 = sys.top != null ? sys.top : SYS_TOP;
  const yl = SYS_TOP;                  // tempo and labels stay at the top edge, chords sit between them and the staff
  const sel = state.selectedBar;
  const selNote = state.selNote || null;
  const clef = score.clef;
  const yOf = (dpos) => y0 + 4 - (dpos - (clef === 'bass' ? 18 : 30)) / 2;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fx(sys.contentW)} ${sys.h || SYS_H}" preserveAspectRatio="xMinYMin meet" fill="#000" stroke="none">`;
  // staff
  let lines = '';
  for (let i = 0; i < 5; i++) lines += `M0 ${y0 + i}H${fx(sys.endX)}`;
  s += `<path d="${lines}" stroke="#000" stroke-width="0.11" fill="none"/>`;
  s += `<path d="M0.05 ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.14"/>`;
  s += clef === 'bass' ? G.bassClef(0.7, y0) : G.trebleClef(0.9, y0);
  s += G.keySig(score.key.sf, CLEF_W[clef] || 4.2, y0, clef);
  const first = sys.ms[0].m;
  s += `<text x="0.3" y="${yl - 1.1}" font-size="1.7" font-family="Georgia,serif" font-style="italic" fill="#000">${first.num}</text>`;

  const allItems = [];
  sys.ms.forEach((g, gi) => {
    const m = g.m, xs = g.x, xe = g.x + g.W;
    const isLast = gi === sys.ms.length - 1 && sys.index === state.lastSystem;
    const mk = m.marks || {};
    s += `<rect data-bar="${m.idx}" x="${fx(xs)}" y="0" width="${fx(g.W)}" height="${sys.h || SYS_H}" fill="${sel === m.idx ? 'rgba(46,204,113,0.16)' : 'transparent'}"/>`;
    // time signature
    let cx0 = xs + 0.9;
    if (mk.repeatStart) {
      s += `<path d="M${fx(xs + 0.3)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.5"/><path d="M${fx(xs + 0.95)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.12"/>`
        + `<circle cx="${fx(xs + 1.7)}" cy="${y0 + 1.5}" r="0.22"/><circle cx="${fx(xs + 1.7)}" cy="${y0 + 2.5}" r="0.22"/>`;
      cx0 += 2.4;
    }
    if (m.showTs) { s += G.timeSig(m.ts.num, m.ts.den, fx(cx0 + 0.9), y0); }
    // tempo and labels
    let tx = xs + (mk.repeatStart ? 2.4 : 0) + 0.6;
    if (mk.label) {
      const lw = Math.max(2.4, mk.label.length * 1.15 + 1.2);
      s += `<rect x="${fx(tx)}"  y="${yl - 6}" width="${fx(lw)}" height="2.1" fill="none" stroke="#000" stroke-width="0.12"/>`
        + `<text x="${fx(tx + 0.6)}" y="${yl - 4.5}" font-size="1.45" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="#000">${esc(mk.label)}</text>`;
    }
    if (m.tempo != null) {
      s += G.quarterSymbol(fx(tx + 0.7), yl - 2.2);
      s += `<text x="${fx(tx + 1.9)}" y="${yl - 2.0}" font-size="1.6" font-family="Arial,Helvetica,sans-serif" fill="#000">= ${m.tempo}</text>`;
    }
    // content
    if (m.multi) {
      const cx = xs + g.W / 2, a = xs + g.padL + 0.5, b = xe - g.padR - 0.5;
      s += `<path d="M${fx(a)} ${y0 + 2}H${fx(b)}M${fx(a)} ${y0 + 1}V${y0 + 3}M${fx(b)} ${y0 + 1}V${y0 + 3}" stroke="#000" stroke-width="0.14" fill="none"/>`
        + `<rect x="${fx(a + 0.2)}" y="${y0 + 1.5}" width="${fx(b - a - 0.4)}" height="1" fill="#000"/>`
        + `<text x="${fx(cx)}" y="${y0 - 0.8}" font-size="2.2" font-family="Georgia,serif" font-weight="bold" text-anchor="middle" fill="#000">${m.multi}</text>`;
    } else if (g.items.length === 1 && g.items[0].it.whole) {
      s += G.restGlyph(192, 0, fx(xs + g.W / 2 + (m.showTs ? 1.3 : 0)), y0);
    } else {
      s += renderItems(g, y0, yOf, clef, allItems, m, selNote);
    }
    // chord symbols
    for (const c of score.chords || []) {
      if (c.u < m.start - 1e-6 || c.u >= m.start + (m.multi || 1) * m.len - 1e-6) continue;
      const cxp = xOfUnit(g, c.u);
      s += `<text x="${fx(cxp - 0.1)}" y="${fx(y0 - 2.9)}" font-size="1.95" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="#000">${esc(prettyChord(c.t))}</text>`;
    }
    // barline
    if (isLast) {
      s += `<path d="M${fx(xe - 0.9)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.12"/><path d="M${fx(xe - 0.25)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.5"/>`;
    } else if (mk.repeatEnd) {
      s += `<circle cx="${fx(xe - 2.1)}" cy="${y0 + 1.5}" r="0.22"/><circle cx="${fx(xe - 2.1)}" cy="${y0 + 2.5}" r="0.22"/>`
        + `<path d="M${fx(xe - 1.35)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.12"/><path d="M${fx(xe - 0.25)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.5"/>`;
    } else if (mk.doubleBar) {
      s += `<path d="M${fx(xe - 0.6)} ${y0}V${y0 + 4}M${fx(xe)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.12"/>`;
    } else {
      s += `<path d="M${fx(xe)} ${y0}V${y0 + 4}" stroke="#000" stroke-width="0.12"/>`;
    }
  });
  // ties
  s += renderTies(allItems, sys, y0, yOf);
  if (score.tabInfo && sys.tabTop != null) s += renderTab(score, sys, allItems);
  s += '</svg>';
  return s;
}

function renderTab(score, sys, allItems) {
  const n = score.tabInfo.strings, y1 = sys.tabTop, y2 = y1 + (n - 1) * TAB_SP;
  let s = '';
  let lines = '';
  for (let i = 0; i < n; i++) lines += `M0 ${fx(y1 + i * TAB_SP)}H${fx(sys.endX)}`;
  s += `<path d="${lines}" stroke="#000" stroke-width="0.11" fill="none"/>`;
  let bars = `M0.05 ${fx(y1)}V${fx(y2)}`;
  sys.ms.forEach((g) => { bars += `M${fx(g.x + g.W)} ${fx(y1)}V${fx(y2)}`; });
  s += `<path d="${bars}" stroke="#000" stroke-width="0.12" fill="none"/>`;
  const mid = (y1 + y2) / 2, fs = Math.min(1.9, (y2 - y1) / 3.2 + 0.6);
  ['T', 'A', 'B'].forEach((ch, i) => { s += `<text x="1.9" y="${fx(mid + (i - 1) * fs * 1.05 + fs * 0.36)}" font-size="${fx(fs)}" font-weight="bold" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="#000">${ch}</text>`; });
  for (const q of allItems) {
    const t = q.it.tab;
    if (!t) continue;
    const y = t.s >= 0 ? y2 - t.s * TAB_SP : mid;
    const txt = t.s >= 0 ? String(t.f) : '?';
    const w = txt.length > 1 ? 1.5 : 1.0;
    s += `<rect x="${fx(q.cx - w / 2 - 0.1)}" y="${fx(y - 0.55)}" width="${fx(w + 0.2)}" height="1.1" fill="#fff"/>`;
    s += `<text x="${fx(q.cx)}" y="${fx(y + 0.5)}" font-size="1.5" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="#000">${txt}</text>`;
  }
  return s;
}

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderItems(g, y0, yOf, clef, allItems, m, selNote) {
  let s = '';
  const items = g.items;
  // stem directions & geometry
  const info = items.map((q) => {
    const it = q.it;
    if (it.kind !== 'note') return null;
    const y = yOf(it.dpos);
    return { q, it, y, cx: q.x + G.HEAD_RX, up: y > y0 + 2, rec: null };
  });
  // beam groups: direction by extreme note
  const groups = new Map();
  info.forEach((n) => { if (n && n.it.beam !== null) { if (!groups.has(n.it.beam)) groups.set(n.it.beam, []); groups.get(n.it.beam).push(n); } });
  for (const [, list] of groups) {
    let far = list[0];
    for (const n of list) if (Math.abs(n.y - (y0 + 2)) > Math.abs(far.y - (y0 + 2))) far = n;
    const up = far.y > y0 + 2;
    list.forEach((n) => { n.up = up; });
  }
  for (const n of info) if (n) {
    allItems.push(n);
    const { it, y, cx } = n;
    // ledger lines
    let led = '';
    if (y < y0 - 0.01) for (let ly = y0 - 1; ly >= y - 0.01; ly--) led += `M${fx(cx - 1.1)} ${ly}H${fx(cx + 1.1)}`;
    if (y > y0 + 4.01) for (let ly = y0 + 5; ly <= y + 0.01; ly++) led += `M${fx(cx - 1.1)} ${ly}H${fx(cx + 1.1)}`;
    if (led) s += `<path d="${led}" stroke="#000" stroke-width="0.12" fill="none"/>`;
    if (it.acc != null) s += G.accidental(it.acc, fx(n.q.x - 0.85), fx(y));
    s += G.head(it.base, fx(cx), fx(y));
    if (selNote && it.pitch === selNote.p && m.start + it.pos >= selNote.u - 1e-6 && m.start + it.pos < selNote.e - 1e-6) s += `<circle cx="${fx(cx)}" cy="${fx(y)}" r="1.15" fill="rgba(31,168,90,0.18)" stroke="#1fa85a" stroke-width="0.22"/>`;
    if (it.lyr) s += `<text x="${fx(n.q.x - 0.15)}" y="${fx(y0 + 9.4)}" font-size="1.7" font-family="Arial,Helvetica,sans-serif" fill="#000">${esc(it.lyr)}</text>`;
    if (it.dots) { const dy = Math.abs((y - y0) % 1) < 0.01 ? y - 0.5 : y; s += `<circle cx="${fx(cx + 1.15)}" cy="${fx(dy)}" r="0.23"/>`; }
  }
  // stems, flags, beams
  const stemX = (n) => (n.up ? n.cx + 0.64 : n.cx - 0.64);
  for (const n of info) if (n && n.it.base < 192 && n.it.beam === null) {
    const x = stemX(n), len = 3.5;
    const end = n.up ? Math.min(n.y - len, y0 + 2) : Math.max(n.y + len, y0 + 2);
    s += `<path d="M${fx(x)} ${fx(n.y + (n.up ? -0.1 : 0.1))}V${fx(end)}" stroke="#000" stroke-width="0.13" fill="none"/>`;
    n.tip = end;
    if (n.it.flags) s += G.flags(n.it.flags, fx(x - 0.065), fx(end), n.up ? 1 : -1);
  }
  for (const [, list] of groups) {
    const up = list[0].up, d = up ? -1 : 1;
    const x0 = stemX(list[0]), x1 = stemX(list[list.length - 1]);
    const dx = Math.max(0.01, x1 - x0);
    const idealA = list[0].y + d * 3.4, idealB = list[list.length - 1].y + d * 3.4;
    const slope = Math.max(-1.4, Math.min(1.4, idealB - idealA)) / dx;
    let by0 = up ? Infinity : -Infinity;
    for (const n of list) {
      const need = n.y + d * 3.0 - slope * (stemX(n) - x0);
      by0 = up ? Math.min(by0, need) : Math.max(by0, need);
    }
    const yAt = (x) => by0 + slope * (x - x0);
    // stems
    for (const n of list) {
      const x = stemX(n);
      s += `<path d="M${fx(x)} ${fx(n.y + (up ? -0.1 : 0.1))}V${fx(yAt(x) + (up ? 0 : 0))}" stroke="#000" stroke-width="0.13" fill="none"/>`;
      n.tip = yAt(x);
    }
    // beams, level by level
    const levels = list.map((n) => flagCount(n.it.base));
    const T = 0.5, STEP = 0.78;
    const poly = (xa, xb, lvl) => {
      const off = (lvl - 1) * STEP * (up ? 1 : -1);
      const ya = yAt(xa) + off, yb = yAt(xb) + off;
      const t = up ? T : -T;
      return `<path d="M${fx(xa)} ${fx(ya)}L${fx(xb)} ${fx(yb)}L${fx(xb)} ${fx(yb + t)}L${fx(xa)} ${fx(ya + t)}Z"/>`;
    };
    const maxL = Math.max(...levels);
    for (let L = 1; L <= maxL; L++) {
      let i = 0;
      while (i < list.length) {
        if (levels[i] < L) { i++; continue; }
        let j = i;
        while (j + 1 < list.length && levels[j + 1] >= L) j++;
        if (j > i) s += poly(stemX(list[i]) - 0.065, stemX(list[j]) + 0.065, L);
        else if (L > 1) {
          const x = stemX(list[i]);
          const toRight = i === 0;
          s += toRight ? poly(x - 0.065, x + 1.2, L) : poly(x - 1.2, x + 0.065, L);
        }
        i = j + 1;
      }
    }
  }
  // rests
  items.forEach((q) => {
    const it = q.it;
    if (it.kind === 'rest') s += G.restGlyph(it.base, it.dots, fx(q.x + 0.7), y0);
  });
  // tuplets
  for (const tp of m.tuplets || []) {
    const part = info.slice(tp.first, tp.last + 1);
    const notes = part.filter(Boolean);
    const upMajor = notes.length ? notes.filter((n) => n.up).length >= notes.length / 2 : true;
    const xa = items[tp.first].x - 0.1, xb = items[tp.last].x + 1.5;
    const tips = notes.map((n) => n.tip).filter((v) => v !== undefined);
    const allBeamed = notes.length === part.length && notes.length > 1 && new Set(notes.map((n) => n.it.beam)).size === 1 && notes[0].it.beam !== null;
    let yb;
    if (upMajor) yb = Math.min(y0 - 0.4, ...tips) - 1.1; else yb = Math.max(y0 + 4.4, ...tips) + 1.4;
    const mid = (xa + xb) / 2;
    const txt = `<text x="${fx(mid)}" y="${fx(yb + (upMajor ? 0.55 : 0.55))}" font-size="1.6" font-style="italic" font-family="Georgia,serif" text-anchor="middle" fill="#000">${tp.n}</text>`;
    if (allBeamed) s += txt;
    else {
      const tick = upMajor ? 0.7 : -0.7;
      s += `<path d="M${fx(xa)} ${fx(yb + tick)}V${fx(yb)}H${fx(mid - 0.9)}M${fx(mid + 0.9)} ${fx(yb)}H${fx(xb)}V${fx(yb + tick)}" stroke="#000" stroke-width="0.11" fill="none"/>` + txt;
    }
  }
  return s;
}

function flagCount(base) { return base <= 3 ? 4 : base <= 6 ? 3 : base <= 12 ? 2 : base <= 24 ? 1 : 0; }

function renderTies(all, sys, y0, yOf) {
  let s = '';
  const arc = (x1, x2, y, below) => {
    const h = Math.min(1.5, 0.45 + (x2 - x1) * 0.07), t = 0.3;
    const sgn = below ? 1 : -1;
    const yy = y + sgn * 0.75;
    const xm = (x1 + x2) / 2;
    return `<path d="M${fx(x1)} ${fx(yy)}Q${fx(xm)} ${fx(yy + sgn * (h + t))} ${fx(x2)} ${fx(yy)}Q${fx(xm)} ${fx(yy + sgn * h)} ${fx(x1)} ${fx(yy)}Z"/>`;
  };
  for (let i = 0; i < all.length; i++) {
    const n = all[i], it = n.it;
    const below = n.up;
    if (it.tieNext) {
      const nx = all[i + 1];
      if (nx && nx.it.tieFrom) s += arc(n.cx + 0.7, nx.cx - 0.7, n.y, below);
      else s += arc(n.cx + 0.7, sys.endX - 0.6, n.y, below);
    }
    if (it.tieFrom && (i === 0 || !all[i - 1].it.tieNext)) s += arc(sys.headerW + 0.6, n.cx - 0.7, n.y, below);
  }
  return s;
}

// x position (staff spaces) of a time position inside a laid-out measure
export function xOfUnit(g, u) {
  const m = g.m, nb = m.multi || 1;
  const a = g.x + g.padL, b = g.x + g.W - g.padR;
  if (nb > 1 || !g.items.length || (g.items.length === 1 && g.items[0].it.whole)) return a + (b - a) * Math.max(0, Math.min(1, (u - m.start) / (nb * m.len)));
  const pts = [{ pos: 0, x: a }];
  for (const q of g.items) {
    const ps = q.it.pos;
    if (ps > pts[pts.length - 1].pos + 1e-6) pts.push({ pos: ps, x: q.x });
    else if (ps === 0) pts[0] = { pos: 0, x: q.x };
  }
  if (m.len > pts[pts.length - 1].pos) pts.push({ pos: m.len, x: b });
  const rel = u - m.start;
  for (let i = 1; i < pts.length; i++) {
    if (rel < pts[i].pos) { const f = (rel - pts[i - 1].pos) / (pts[i].pos - pts[i - 1].pos); return pts[i - 1].x + f * (pts[i].x - pts[i - 1].x); }
  }
  return pts[pts.length - 1].x;
}
export function staffY(clef, y0, dpos) { return y0 + 4 - (dpos - (clef === 'bass' ? 18 : 30)) / 2; }
export function dposFromY(clef, y0, y) { return (clef === 'bass' ? 18 : 30) + Math.round((y0 + 4 - y) * 2); }
