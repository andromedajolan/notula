// Notula: the editable note list, undo snapshots, lyrics (syllables) and chord helpers. Pure functions, no DOM.
// An edited project keeps its notes as { u, d, p } in score units (48 per quarter note) in "stored" terms:
// before the project's shift and transpose settings are applied.
import { U } from './score.js';
import { keyAccidentals, NAT_PC } from './theory.js';
import { chordsIn, REL_MAJOR, keyPc, transposeChord } from './chords.js';

export const TPU = 10;                       // MIDI ticks per unit at 480 ppq (480 / 48)

/* ---------- the edit model ---------- */
export function emptyEdit({ num = 4, den = 4, bpm = 100 } = {}) {
  return { notes: [], tempos: [{ u: 0, bpm }], timeSigs: [{ u: 0, num, den }] };
}

// a MIDI-shaped object so the score builder can read an edit exactly like a file
export function pseudoMidi(edit) {
  const notes = edit.notes.map((n) => ({ t: Math.round(n.u * TPU), d: Math.max(1, Math.round(n.d * TPU)), p: n.p, v: 90, ch: 0 }));
  const ts = edit.timeSigs && edit.timeSigs.length ? edit.timeSigs : [{ u: 0, num: 4, den: 4 }];
  const tp = edit.tempos && edit.tempos.length ? edit.tempos : [{ u: 0, bpm: 100 }];
  return {
    format: 0, ppq: 480,
    tracks: [{ id: 0, name: 'Melody', channel: 0, program: 0, drum: false, notes }],
    tempos: tp.map((e) => ({ t: Math.round(e.u * TPU), bpm: e.bpm })),
    timeSigs: ts.map((e) => ({ t: Math.round(e.u * TPU), num: e.num, den: e.den })),
    keySigs: [], endTick: 0,
  };
}

// freeze what is on the page now (ties merged back into notes) as the starting point for editing
export function bakeEdit(timelineNotes, midi) {
  const notes = timelineNotes.map((n) => ({ u: Math.round(n.u), d: Math.max(1, Math.round(n.d)), p: n.p })).sort((a, b) => a.u - b.u);
  const ts = midi.timeSigs.filter((e) => e.num >= 1 && e.num <= 32 && [1, 2, 4, 8, 16, 32].includes(e.den));
  return {
    notes,
    tempos: midi.tempos.length ? midi.tempos.map((e) => ({ u: Math.round(e.t * U / midi.ppq), bpm: e.bpm })) : [{ u: 0, bpm: 120 }],
    timeSigs: ts.length ? ts.map((e) => ({ u: Math.round(e.t * U / midi.ppq), num: e.num, den: e.den })) : [{ u: 0, num: 4, den: 4 }],
  };
}

/* ---------- note operations (monophonic: a new note replaces what it overlaps) ---------- */
const sorted = (a) => a.sort((x, y) => x.u - y.u || x.p - y.p);

// remove everything inside [u, e); a note that starts earlier is cut short at u
function carve(notes, u, e, keep) {
  const out = [];
  for (const n of notes) {
    if (n === keep) { out.push(n); continue; }
    const ne = n.u + n.d;
    if (ne <= u || n.u >= e) { out.push(n); continue; }
    if (n.u >= u) continue;
    out.push({ ...n, d: u - n.u });
  }
  return out;
}
export function placeNote(notes, u, d, p) {
  const note = { u, d, p };
  const out = carve(notes, u, u + d, null);
  out.push(note);
  return { notes: sorted(out), note };
}
export function placeRest(notes, u, d) { return { notes: sorted(carve(notes, u, u + d, null)) }; }
export function deleteNote(notes, note) { return notes.filter((n) => n !== note); }
export function moveNote(notes, note, newU) {
  newU = Math.max(0, newU);
  const moved = { ...note, u: newU };
  const rest = notes.filter((n) => n !== note);
  const out = carve(rest, newU, newU + note.d, null);
  out.push(moved);
  return { notes: sorted(out), note: moved };
}
export function setLength(notes, note, d) {
  const ch = { ...note, d };
  const rest = notes.filter((n) => n !== note);
  const out = carve(rest, note.u, note.u + d, null);
  out.push(ch);
  return { notes: sorted(out), note: ch };
}
export function setPitch(notes, note, p) {
  p = Math.max(0, Math.min(127, p));
  const ch = { ...note, p };
  return { notes: sorted(notes.map((n) => (n === note ? ch : n))), note: ch };
}
export function noteAt(notes, u, p) {
  let best = null;
  for (const n of notes) if (u >= n.u && u < n.u + n.d) { if (p === undefined || n.p === p) return n; best = best || n; }
  return p === undefined ? best : null;
}

// diatonic position -> MIDI pitch inside a key (what you get by clicking a staff line or space)
export function pitchFromDpos(dpos, sf) {
  const letter = ((dpos % 7) + 7) % 7, oct = Math.floor(dpos / 7);
  return 12 * (oct + 1) + NAT_PC[letter] + keyAccidentals(sf)[letter];
}

/* ---------- undo snapshots ---------- */
export function snapshot(p) {
  return JSON.stringify({
    edit: p.edit, chords: p.chords, lyrics: p.lyrics, song: p.song,
    s: { shift: p.settings.shift, transpose: p.settings.transpose, keyOverride: p.settings.keyOverride, bars: p.settings.bars },
  });
}
export function restore(p, snap) {
  const o = JSON.parse(snap);
  p.edit = o.edit; p.chords = o.chords || []; p.lyrics = o.lyrics || null; p.song = o.song || null;
  Object.assign(p.settings, o.s);
}

/* ---------- lyrics: pasted text -> one syllable per note ---------- */
const VOW = /[aeiouyAEIOUY]/;
const DIGRAPH = ['th', 'ch', 'sh', 'ph', 'wh', 'gh', 'qu', 'tr', 'br', 'cr', 'dr', 'fr', 'gr', 'pr', 'bl', 'cl', 'fl', 'gl', 'pl', 'sl', 'str', 'spr', 'spl', 'scr', 'thr', 'shr'];

// rule-based English syllable split; right most of the time, and the text box lets you fix the rest
const SUFFIX = ['thing', 'ing', 'ness', 'less', 'ful', 'ment', 'ly'];
function splitStem(low) {
  // returns cut positions inside the lowercase stem (no suffix handling)
  let end = low.length;
  if (/[^aeiouy]e$/.test(low) && !/[^aeiouy]le$/.test(low)) end -= 1;
  else if (/[^aeiouy]es$/.test(low) && !/(ch|sh|s|x|z|c|g|[^aeiouy]l)es$/.test(low)) end -= 2;
  else if (/[^aeiouytd]ed$/.test(low)) end -= 2;
  const groups = [];
  let i = 0;
  while (i < end) {
    if (VOW.test(low[i])) { let j = i; while (j < end && VOW.test(low[j])) j++; groups.push([i, j]); i = j; } else i++;
  }
  const cuts = [];
  for (let g = 0; g + 1 < groups.length; g++) {
    const a = groups[g][1], b = groups[g + 1][0];
    const cons = low.slice(a, b);
    const finalLe = g + 2 === groups.length && /[^aeiouy]le$/.test(low) && groups[g + 1][0] === low.length - 1;
    let cut;
    if (cons.length <= 1) cut = a;
    else if (finalLe) cut = a + cons.length - 2;
    else {
      let onset = cons.length - 1;
      for (let k = 0; k < cons.length - 1; k++) if (DIGRAPH.includes(cons.slice(k))) { onset = k; break; }
      if (/^(ck|ng|nk)/.test(cons) && cons.length > 2) onset = Math.max(onset, 2);
      cut = a + onset;
    }
    if (cut > 0 && cut < low.length) cuts.push(cut);
  }
  return cuts;
}
export function splitWord(word) {
  const m = /^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$/.exec(word);
  if (!m) return [word];
  const [, pre, core, post] = m;
  const low = core.toLowerCase();
  if (low.length <= 3 || (low.match(/[aeiouy]+/g) || []).length < 2) return [word];
  let cuts = [];
  let stemEnd = low.length;
  for (const suf of SUFFIX) {
    if (low.endsWith(suf) && low.length - suf.length >= 2 && /[aeiouy]/.test(low.slice(0, low.length - suf.length))) {
      stemEnd = low.length - suf.length;
      // a doubled consonant before the suffix (run-ning) splits between the two
      if (suf === 'ing' && /([^aeiouylsfz])\1$/.test(low.slice(0, stemEnd))) stemEnd -= 1;
      break;
    }
  }
  const stem = low.slice(0, stemEnd);
  if ((stem.match(/[aeiouy]+/g) || []).length >= 2) cuts = splitStem(stem);
  if (stemEnd < low.length) cuts.push(stemEnd);
  cuts = [...new Set(cuts)].sort((x, y) => x - y);
  if (!cuts.length) return [word];
  const parts = [];
  let prev = 0;
  for (const c of cuts) { parts.push(core.slice(prev, c)); prev = c; }
  parts.push(core.slice(prev));
  parts[0] = pre + parts[0];
  parts[parts.length - 1] += post;
  return parts;
}
export function autoSplit(text) {
  return String(text).split('\n').map((line) => line.split(/(\s+)/).map((tok) => {
    if (!tok.trim() || tok.includes('-') || tok === '_') return tok;
    return splitWord(tok).join('-');
  }).join('')).join('\n');
}
// "stand-ing" -> ["stand-", "ing"] ; "_" keeps a note without a syllable
export function tokenizeLyrics(text) {
  const out = [];
  for (const tok of String(text || '').split(/\s+/)) {
    if (!tok) continue;
    if (tok === '_') { out.push(''); continue; }
    if (/^-+$/.test(tok)) { if (out.length && !out[out.length - 1].endsWith('-')) out[out.length - 1] += '-'; continue; }
    const parts = tok.split('-');
    parts.forEach((x, i) => {
      if (i < parts.length - 1) { if (x) out.push(x + '-'); else if (out.length && !out[out.length - 1].endsWith('-')) out[out.length - 1] += '-'; }
      else if (x) out.push(x);
    });
  }
  return out;
}
export const stripChords = (t) => String(t || '').replace(/\[[^\[\]\n]*\]/g, '').replace(/[ \t]+/g, ' ').replace(/ +\n/g, '\n');

export function sectionLyrics(song, id) {
  const secs = song.sections.filter((s) => id === 'all' || s.id === id);
  return secs.map((s) => stripChords(s.lyrics).trim()).filter(Boolean).join('\n\n');
}

/* ---------- chords ---------- */
export function sectionChords(song, id) {
  const secs = song.sections.filter((s) => id === 'all' || s.id === id);
  const out = [];
  for (const s of secs) out.push(...chordsIn(s.lyrics));
  return out;
}
export function keyFromSong(song) {
  const pc = keyPc(song && song.key);
  if (pc == null) return { tonic: 0, minor: false };
  const mode = song.mode || 'major';
  if (mode === 'minor') return { tonic: pc, minor: true };
  return { tonic: (pc + (REL_MAJOR[mode] || 0)) % 12, minor: false };
}

// start unit and length of bar number idx (0-based), also for bars past the end of what is drawn
export function barSpan(score, idx) {
  let last = null;
  for (const m of score.measures) {
    const nb = m.multi || 1;
    if (idx >= m.idx && idx < m.idx + nb) return { start: m.start + (idx - m.idx) * m.len, len: m.len };
    last = { end: m.start + nb * m.len, last: m.idx + nb - 1, len: m.len };
  }
  if (!last) return { start: idx * 192, len: 192 };
  return { start: last.end + (idx - last.last - 1) * last.len, len: last.len };
}
// put chords on bars: perBar chords in each bar, evenly spaced (stored as given, no transposing)
export function layChords(chords, score, startBar, perBar) {
  const out = [];
  chords.forEach((t, k) => {
    const bar = startBar + Math.floor(k / perBar);
    const sp = barSpan(score, bar);
    const off = Math.round((k % perBar) * sp.len / perBar / 12) * 12;
    out.push({ u: sp.start + off, t });
  });
  return out;
}

// put chords (transposed to what is shown) and one syllable per note onto a built score
export function attachExtras(score, p, editing) {
  const tr = p.settings.transpose | 0;
  const flats = score.key.sf < 0;
  score.chords = (p.chords || []).map((c) => ({ u: c.u, t: tr ? transposeChord(c.t, tr, flats) : c.t })).sort((a, b) => a.u - b.u);
  score.chordRow = score.chords.length > 0 || !!editing;
  const syl = p.lyrics && p.lyrics.text ? tokenizeLyrics(p.lyrics.text) : [];
  const start = p.lyrics ? Math.max(0, p.lyrics.start | 0) : 0;
  let k = 0;
  for (const m of score.measures) for (const it of m.items) {
    if (it.kind !== 'note' || it.tieFrom) continue;
    const idx = k - start; k++;
    if (idx >= 0 && idx < syl.length && syl[idx]) it.lyr = syl[idx];
  }
  score.lyricRow = syl.length > 0;
  score.lyrics = { syllables: syl.length, notes: k };
}
