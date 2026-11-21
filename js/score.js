// Notula: turn one MIDI track into a notation model (quantize, bars, rests, ties, tuplets, beams).
// Time unit: 48 units per quarter note (whole = 192). 16th = 12, 32nd = 6, eighth triplet = 16.
import { spell, diatonicIndex, keyAccidentals, detectKey, keyFromSf, transposeKey, makeKey } from './theory.js';

export const U = 48;

// written values (units -> base + dots)
const STRAIGHT = [192, 144, 96, 72, 48, 36, 24, 18, 12, 9, 6, 3];
const WRITTEN = new Map();
for (const b of [192, 96, 48, 24, 12, 6, 3]) {
  WRITTEN.set(b, { base: b, dots: 0 });
  if (b >= 6 && b * 1.5 <= 144) WRITTEN.set(b * 1.5, { base: b, dots: 1 });
}
WRITTEN.set(9, { base: 6, dots: 1 });
const baseOf = (u) => WRITTEN.get(u).base;
export function flagCount(base) { return base <= 3 ? 4 : base <= 6 ? 3 : base <= 12 ? 2 : base <= 24 ? 1 : 0; }

export function beatSizeFor(ts) {
  if (ts.den === 8 && ts.num >= 6 && ts.num % 3 === 0) return 72;
  return 192 / ts.den;
}
function beamSizeFor(ts) {
  if (ts.den === 8 && ts.num >= 6 && ts.num % 3 === 0) return 72;
  if (ts.den === 2) return 96;
  if (ts.den === 16) return 24;
  return 48;
}

export const DEFAULT_SETTINGS = {
  feel: 'strict',      // strict | natural
  trim: true,          // drop leading empty bars
  shift: 0,            // shift music in 16ths
  transpose: 0,        // semitones
  clef: 'auto',        // auto | treble | bass
  keyOverride: null,   // {tonic, minor} source key
};

export function trackInfo(midi, id) {
  const t = midi.tracks[id];
  if (!t) return null;
  let lo = 127, hi = 0;
  for (const n of t.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  return { name: t.name, count: t.notes.length, lo, hi, drum: t.drum };
}

export function buildScore(midi, trackId, settings = {}, marks = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const track = midi.tracks[trackId];
  const warnings = [];
  if (!track) return { measures: [], key: makeKey(0, false), clef: 'treble', warnings: ['No track selected.'], stats: {} };
  const ppq = midi.ppq;
  const strict = s.feel !== 'natural';
  const S = strict ? 12 : 6;       // straight grid step
  const T = strict ? 16 : 8;       // triplet grid step
  const gapMerge = strict ? 12 : 6;
  const tr = s.transpose | 0;
  const shiftU = (s.shift | 0) * 12;

  // 1. notes in units, transposed
  let raw = [];
  for (const n of track.notes) {
    const p = n.p + tr;
    if (p < 0 || p > 127) continue;
    let on = n.t * U / ppq + shiftU, off = (n.t + n.d) * U / ppq + shiftU;
    if (off <= 0) continue;
    if (on < 0) on = 0;
    raw.push({ on, off, p, src: n.p });
  }
  raw.sort((a, b) => a.on - b.on || b.p - a.p);

  // 2. monophonic: chords keep the top note; overlaps are cut at the next onset
  let dropped = 0;
  const mono = [];
  for (const n of raw) {
    const last = mono[mono.length - 1];
    if (last && n.on - last.on <= 3) { dropped++; continue; }
    mono.push({ ...n });
  }
  for (let i = 0; i < mono.length - 1; i++) {
    if (mono[i].off > mono[i + 1].on) mono[i].off = mono[i + 1].on;
  }
  if (dropped > 0) warnings.push(dropped + ' simultaneous note' + (dropped > 1 ? 's' : '') + ' dropped (top note kept).');

  // key (from the original, untransposed pitches)
  let srcKey, keySource;
  if (s.keyOverride) { srcKey = makeKey(s.keyOverride.tonic, s.keyOverride.minor); keySource = 'manual'; }
  else if (midi.keySigs.length) { srcKey = keyFromSf(midi.keySigs[0].sf, midi.keySigs[0].minor); keySource = 'midi'; }
  else { srcKey = detectKey(track.notes.map((n) => ({ p: n.p, d: n.d }))); keySource = 'detected'; }
  const key = transposeKey(srcKey, tr);
  if (tr === 0 && keySource === 'midi') { key.sf = midi.keySigs[0].sf; }

  // clef
  let clef = s.clef;
  if (clef === 'auto') {
    const ps = mono.map((n) => n.p).sort((a, b) => a - b);
    const med = ps.length ? ps[Math.floor(ps.length / 2)] : 72;
    clef = med < 57 ? 'bass' : 'treble';
  }

  // 3. choose a grid per beat: straight or triplet
  const onsetsByBeat = new Map();
  for (const n of mono) {
    const b = Math.floor(n.on / U + 1e-9);
    if (!onsetsByBeat.has(b)) onsetsByBeat.set(b, []);
    onsetsByBeat.get(b).push(n.on - b * U);
  }
  const trip = new Set();
  for (const [b, list] of onsetsByBeat) {
    if (list.length < 2) continue;
    let e12 = 0, e16 = 0;
    for (const x of list) {
      e12 += Math.abs(x - Math.round(x / 12) * 12);
      e16 += Math.abs(x - Math.round(x / 16) * 16);
    }
    if (e12 > 4 && e16 < e12 * 0.55) trip.add(b);
  }
  const stepAt = (u) => (trip.has(Math.floor(u / U + 1e-9)) ? T : S);
  const snap = (u) => { const st = stepAt(u); return Math.round(u / st) * st; };

  // 4. quantize
  let q = [];
  for (const n of mono) {
    const on = snap(n.on);
    let off = snap(n.off);
    const st = stepAt(on);
    if (off <= on) off = on + st;
    q.push({ on, off, p: n.p });
  }
  // same onset: keep the longer
  const q2 = [];
  for (const n of q) {
    const last = q2[q2.length - 1];
    if (last && last.on === n.on) { if (n.off - n.on > last.off - last.on) q2[q2.length - 1] = n; continue; }
    q2.push(n);
  }
  q = q2;
  for (let i = 0; i < q.length; i++) {
    const nx = q[i + 1];
    if (nx) {
      if (q[i].off > nx.on) q[i].off = nx.on;
      else if (nx.on - q[i].off > 0 && nx.on - q[i].off <= gapMerge) q[i].off = nx.on;
    }
  }
  q = q.filter((n) => n.off > n.on);
  const lastEnd = q.length ? q[q.length - 1].off : 0;

  // 5. bars with time signatures
  const tsEv = midi.timeSigs.map((e) => ({ u: e.t * U / ppq, num: e.num, den: e.den }))
    .filter((e) => e.num >= 1 && e.num <= 32 && [1, 2, 4, 8, 16, 32].includes(e.den));
  let ti = 0, ts = { num: 4, den: 4 };
  while (ti < tsEv.length && tsEv[ti].u <= 1e-6) { ts = { num: tsEv[ti].num, den: tsEv[ti].den }; ti++; }
  const bars = [];
  let u = 0, prevTs = null;
  while ((u < lastEnd - 1e-6 || bars.length === 0) && bars.length < 1500) {
    while (ti < tsEv.length && tsEv[ti].u <= u + 1e-6) { ts = { num: tsEv[ti].num, den: tsEv[ti].den }; ti++; }
    const len = ts.num * 192 / ts.den;
    const changed = !prevTs || prevTs.num !== ts.num || prevTs.den !== ts.den;
    bars.push({ idx: bars.length, start: u, len, ts: { ...ts }, tsChange: changed });
    prevTs = ts; u += len;
  }
  if (bars.length >= 1500) warnings.push('Very long file: only the first 1500 bars are shown.');
  const totalEnd = u;

  // 6. note and rest sequence covering [0,totalEnd)
  const evs = [];
  let cur = 0;
  for (const n of q) {
    if (n.on > cur) evs.push({ rest: true, on: cur, off: n.on });
    evs.push({ rest: false, on: n.on, off: n.off, p: n.p });
    cur = n.off;
  }
  if (cur < totalEnd) evs.push({ rest: true, on: cur, off: totalEnd });

  // 7. split into bars and decompose into engravable pieces
  const ka = keyAccidentals(key.sf);
  let evi = 0;
  let noteCount = 0;
  for (const bar of bars) {
    const bEnd = bar.start + bar.len;
    const beatSize = beatSizeFor(bar.ts);
    const beamSize = beamSizeFor(bar.ts);
    const items = [];
    while (evi < evs.length && evs[evi].off <= bar.start + 1e-6) evi++;
    let k = evi;
    while (k < evs.length && evs[k].on < bEnd - 1e-6) {
      const e = evs[k];
      const a = Math.max(e.on, bar.start), z = Math.min(e.off, bEnd);
      if (z > a + 1e-6) {
        const pieces = decompose(a, z - a, e.rest, bar, trip, beatSize, strict);
        pieces.forEach((pc, i) => {
          const it = { kind: e.rest ? 'rest' : 'note', pos: pc.pos, dur: pc.dur, base: pc.base, dots: pc.dots, tup: pc.tup };
          if (!e.rest) {
            it.pitch = e.p;
            it.tieFrom = i > 0 || e.on < bar.start - 1e-6;
            it.tieNext = i < pieces.length - 1 || e.off > bEnd + 1e-6;
          }
          items.push(it);
        });
      }
      k++;
    }
    // whole-measure rest
    if (items.length && items.every((x) => x.kind === 'rest')) {
      bar.empty = true;
      bar.items = [{ kind: 'rest', pos: 0, dur: bar.len, base: 192, dots: 0, tup: null, whole: true }];
    } else {
      bar.empty = false;
      bar.items = items;
    }
    // pitch spelling and accidentals
    const state = new Map();
    for (const it of bar.items) {
      if (it.kind !== 'note') continue;
      if (!it.tieFrom) noteCount++;
      const sp = spell(it.pitch, key.sf);
      it.sp = sp; it.dpos = diatonicIndex(sp);
      const id = sp.oct * 7 + sp.letter;
      const curAlt = state.has(id) ? state.get(id) : ka[sp.letter];
      if (curAlt !== sp.alt && !it.tieFrom) { it.acc = sp.alt; state.set(id, sp.alt); }
      else { it.acc = null; if (!state.has(id)) state.set(id, sp.alt); }
      if (it.tieFrom && curAlt !== sp.alt) state.set(id, sp.alt);
    }
    // beams
    assignBeams(bar.items, beamSize);
    // tuplet labels
    const tg = new Map();
    for (const it of bar.items) if (it.tup !== null && it.tup !== undefined) {
      if (!tg.has(it.tup)) tg.set(it.tup, []);
      tg.get(it.tup).push(it);
    }
    bar.tuplets = [];
    for (const [beat, list] of tg) {
      const six = list.some((x) => x.dur === 8 || x.dur === 24);
      bar.tuplets.push({ beat, n: six ? 6 : 3, first: bar.items.indexOf(list[0]), last: bar.items.indexOf(list[list.length - 1]) });
    }
  }

  // 8. tempo marks (in effect at each bar)
  const tempoEv = midi.tempos.map((e) => ({ u: e.t * U / ppq, bpm: e.bpm }));
  let tIdx = -1, shown = null;
  for (const bar of bars) {
    while (tIdx + 1 < tempoEv.length && tempoEv[tIdx + 1].u < bar.start + bar.len - 1e-6) tIdx++;
    if (tIdx >= 0) {
      const bpm = Math.round(tempoEv[tIdx].bpm);
      if (shown === null || Math.abs(bpm - shown) >= 1) { bar.tempo = bpm; shown = bpm; }
    }
  }

  // 9. trim leading empty bars, collapse empty runs into multi-rests, attach marks
  let first = 0;
  if (s.trim) while (first < bars.length - 1 && bars[first].empty) first++;
  // tempo / ts in effect at first kept bar
  const keptSrc = bars.slice(first);
  if (first > 0) {
    let tp = null; for (let i = 0; i <= first; i++) if (bars[i].tempo != null) tp = bars[i].tempo;
    if (tp != null) keptSrc[0].tempo = tp;
  }
  const measures = [];
  for (let i = 0; i < keptSrc.length; i++) {
    const b = keptSrc[i];
    const m = { ...b, num: b.idx + 1, marks: marks[b.idx] || null, showTs: i === 0 || b.tsChange };
    const plain = (x) => x.empty && !(marks[x.idx]) && x.tempo == null && !x.tsChange;
    if (m.empty && !m.marks && (i === 0 || true)) {
      let n = 1;
      while (i + n < keptSrc.length && plain(keptSrc[i + n]) && keptSrc[i + n].ts.num === b.ts.num && keptSrc[i + n].ts.den === b.ts.den) n++;
      if (n >= 2) { m.multi = n; i += n - 1; }
    }
    measures.push(m);
  }

  let lo = 127, hi = 0;
  for (const n of q) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  return {
    measures, key, srcKey, keySource, clef, warnings,
    stats: { notes: noteCount, bars: bars.length, firstBar: first + 1, lo: q.length ? lo : null, hi: q.length ? hi : null, tripBeats: trip.size, dropped },
  };
}

// split [absStart, absStart+dur) into writable pieces
function decompose(absStart, dur, isRest, bar, trip, beatSize, strict) {
  const out = [];
  let p = absStart, rem = dur, guard = 0;
  while (rem > 1e-6 && guard++ < 64) {
    const b = Math.floor(p / U + 1e-9);
    const rel = p - bar.start;
    if (trip.has(b)) {
      const avail = Math.min(rem, (b + 1) * U - p);
      const off = Math.round(p - b * U);
      let a = 0;
      if (off === 0 && avail >= U - 1e-6) a = U;
      else {
        const cand = strict ? [32, 16] : [32, 24, 16, 8];
        for (const c of cand) {
          if (c > avail + 1e-6) continue;
          if (off % 8 !== 0) continue;
          if ((c === 32 || c === 16) && off % 16 !== 0 && strict) continue;
          if (c === 32 && off % 16 !== 0) continue;
          if (c === 24 && off % 24 !== 0) continue;
          a = c; break;
        }
      }
      if (a === U) { out.push({ pos: rel, dur: U, base: 48, dots: 0, tup: null }); p += U; rem -= U; continue; }
      if (a && WRITTEN.has(a * 1.5)) {
        const w = WRITTEN.get(a * 1.5);
        out.push({ pos: rel, dur: a, base: w.base, dots: w.dots, tup: b });
        p += a; rem -= a; continue;
      }
      // fall through to straight handling if the tuplet spot is unusual
    }
    let limit = rem;
    for (let bb = b + 1; bb * U < p + rem - 1e-6; bb++) if (trip.has(bb)) { limit = bb * U - p; break; }
    const onBeat = rel % beatSize === 0;
    const toBeat = onBeat ? Infinity : beatSize - (rel % beatSize);
    let pick = 0;
    if (isRest) {
      if (!onBeat) limit = Math.min(limit, toBeat);
      for (const v of STRAIGHT) {
        if (v > limit + 1e-6) continue;
        const w = WRITTEN.get(v);
        // rests: plain values only, except the dotted quarter in compound time
        const ok = w.dots ? (v === 72 && beatSize === 72 && rel % 72 === 0) : rel % w.base === 0;
        if (ok) { pick = v; break; }
      }
    } else {
      const lim = Math.min(limit, toBeat);
      for (const v of STRAIGHT) {
        if (v > lim + 1e-6) continue;
        const w = WRITTEN.get(v);
        let ok;
        if (w.dots) ok = onBeat && Math.abs(v - rem) < 1e-6;            // a dotted note must close the segment
        else ok = rel % Math.min(w.base, beatSize) === 0;
        if (ok) { pick = v; break; }
      }
      // a quarter that starts on the "and" and runs into the next beat is common syncopation
      if (!onBeat && beatSize === 48 && rel % 48 === 24 && rem >= 48 && limit >= 48 && (bar.len !== 192 || !(rel < 96 && rel + 48 > 96))) pick = 48;
    }
    if (!pick) for (const v of STRAIGHT) if (v <= limit + 1e-6 && !WRITTEN.get(v).dots) { pick = v; break; }
    if (!pick) break;
    const w = WRITTEN.get(pick);
    out.push({ pos: rel, dur: pick, base: w.base, dots: w.dots, tup: null });
    p += pick; rem -= pick;
  }
  return out;
}

function assignBeams(items, beamSize) {
  items.forEach((it) => { it.beam = null; it.flags = 0; });
  let gid = 0, run = [];
  const flush = () => {
    if (run.length >= 2) { run.forEach((x) => { x.beam = gid; }); gid++; }
    else if (run.length === 1) run[0].flags = flagCount(run[0].base);
    run = [];
  };
  let bucket = -1;
  for (const it of items) {
    const eligible = it.kind === 'note' && it.base <= 24;
    if (!eligible) { flush(); bucket = -1; continue; }
    const bk = Math.floor(it.pos / beamSize + 1e-9);
    if (run.length && bk !== bucket) flush();
    bucket = bk;
    run.push(it);
  }
  flush();
}
