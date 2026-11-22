// Notula: guitar and bass tab from the notes on the page. Pure functions, no DOM.
// Pitches are the sounding pitches (the same numbers as in the MIDI), strings are listed lowest first.

export const TUNINGS = {
  'gtr-std': { name: 'Guitar, standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64], frets: 22 },
  'gtr-dropd': { name: 'Guitar, drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64], frets: 22 },
  'gtr-halfdown': { name: 'Guitar, half step down (E♭ tuning)', strings: [39, 44, 49, 54, 58, 63], frets: 22 },
  'gtr-fulldown': { name: 'Guitar, whole step down (D tuning)', strings: [38, 43, 48, 53, 57, 62], frets: 22 },
  'gtr-dadgad': { name: 'Guitar, DADGAD', strings: [38, 45, 50, 55, 57, 62], frets: 22 },
  'gtr-openg': { name: 'Guitar, open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62], frets: 22 },
  'gtr-opend': { name: 'Guitar, open D (D A D F♯ A D)', strings: [38, 45, 50, 54, 57, 62], frets: 22 },
  'bass-4': { name: 'Bass, 4 string (E A D G)', strings: [28, 33, 38, 43], frets: 20 },
  'bass-dropd': { name: 'Bass, drop D (D A D G)', strings: [26, 33, 38, 43], frets: 20 },
  'bass-halfdown': { name: 'Bass, half step down (E♭ A♭ D♭ G♭)', strings: [27, 32, 37, 42], frets: 20 },
  'bass-5': { name: 'Bass, 5 string (B E A D G)', strings: [23, 28, 33, 38, 43], frets: 20 },
};
export const TAB_POSITIONS = {
  auto: 'Auto (smooth, few jumps)',
  low: 'Low frets (open position)',
  mid: 'Around the 5th fret',
  high: 'Around the 12th fret',
};
export const TAB_DEFAULT = { tuning: 'off', pos: 'auto' };

function candidates(pitch, t) {
  const out = [];
  t.strings.forEach((open, s) => {
    const f = pitch - open;
    if (f >= 0 && f <= t.frets) out.push({ s, f });
  });
  return out;
}

// Choose a string and fret for every note: a path with the smallest total cost (Viterbi),
// where cost is hand movement between notes plus a pull toward the chosen fret position.
export function fretNotes(pitches, tuning, pos) {
  const t = TUNINGS[tuning];
  if (!t) return pitches.map(() => null);
  const target = pos === 'mid' ? 5 : pos === 'high' ? 12 : null;
  const pull = (c) => {
    if (pos === 'low') return 0.45 * c.f;
    if (target !== null) return 0.4 * Math.abs(c.f - target);
    return 0.16 * c.f;
  };
  const cands = pitches.map((p) => candidates(p, t));
  const best = [];            // best[i][k] = { cost, prev }
  let prevIdx = -1;
  const result = pitches.map(() => null);
  const order = [];
  pitches.forEach((_, i) => { if (cands[i].length) order.push(i); });
  order.forEach((i, oi) => {
    const row = cands[i].map((c, k) => {
      const base = pull(c) + (c.f === 0 ? -0.15 : 0);
      if (oi === 0) return { cost: base, prev: -1 };
      const pr = best[oi - 1];
      const pc = cands[order[oi - 1]];
      let bc = Infinity, bp = 0;
      for (let q = 0; q < pc.length; q++) {
        const a = pc[q];
        const move = (a.f === 0 || c.f === 0 ? 0.35 * Math.abs(a.f - c.f) : Math.abs(a.f - c.f)) + 0.45 * Math.abs(a.s - c.s);
        const tot = pr[q].cost + move;
        if (tot < bc) { bc = tot; bp = q; }
      }
      return { cost: bc + base, prev: bp };
    });
    best.push(row);
  });
  if (order.length) {
    let k = 0, bc = Infinity;
    best[order.length - 1].forEach((r, q) => { if (r.cost < bc) { bc = r.cost; k = q; } });
    for (let oi = order.length - 1; oi >= 0; oi--) {
      result[order[oi]] = cands[order[oi]][k];
      k = best[oi][k].prev;
    }
  }
  return result;
}

// writes it.tab = { s, f } (s = string index from the lowest) onto each note on the page; score.tabInfo tells the engraver
export function assignTab(score, tabSettings) {
  const ts = tabSettings || TAB_DEFAULT;
  const t = TUNINGS[ts.tuning];
  score.tabInfo = null;
  if (!t) return;
  const its = [];
  for (const m of score.measures) for (const it of m.items) if (it.kind === 'note' && !it.tieFrom) its.push(it);
  const res = fretNotes(its.map((it) => it.pitch), ts.tuning, ts.pos || 'auto');
  its.forEach((it, i) => { it.tab = res[i] || { s: -1, f: -1 }; });
  const missing = its.filter((it) => it.tab.s < 0).length;
  score.tabInfo = { strings: t.strings.length, name: t.name, missing };
}
