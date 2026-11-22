// Notula: chord parsing, transposing and spelling, and Stilus song reading.
// The chord rules are ported from Stilus (lyric-writer/js/chords.js) so a chord means the same thing in both apps.
// Pure functions, no DOM.

const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// semitones from a mode's tonic up to its relative major (decides flat vs sharp spelling)
export const REL_MAJOR = { major: 0, minor: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5, locrian: 1 };
export const KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
export const MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'];

export const CHORD_RE = /^([A-G])([#b♯♭]?)((?:maj|min|m|M|dim|aug|sus|add|no|alt|[0-9]|[#b♯♭+\-°øΔ()])*)(?:\/([A-G])([#b♯♭]?))?$/;
export const BRACKET_RE = /\[([^\[\]\n]*)\]/g;

export const isChord = (s) => typeof s === 'string' && CHORD_RE.test(s.trim());
const acc = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);
export const pcOf = (letter, a = '') => (((LETTER[letter] + acc(a)) % 12) + 12) % 12;
export const noteName = (pc, flats) => (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];

export function keyPc(name) {
  const m = /^([A-G])([#b]?)$/.exec(name || '');
  return m ? pcOf(m[1], m[2]) : null;
}
function flatsForRel(rel, mode) { return [5, 10, 3, 8, 1].includes(rel) || (rel === 6 && mode !== 'major'); }

export function preferFlats(keyName, mode) {
  if (!keyName) return false;
  if (keyName.includes('b')) return true;
  if (keyName.includes('#')) return false;
  const m = mode || 'major';
  const pc = keyPc(keyName);
  if (pc == null) return false;
  return flatsForRel((pc + (REL_MAJOR[m] ?? 0)) % 12, m);
}
// conventional key name for a pitch class (Eb minor, F# major)
export function keyNameFor(pc, mode) {
  const m = mode || 'major';
  const rel = (pc + (REL_MAJOR[m] ?? 0)) % 12;
  return noteName(pc, flatsForRel(rel, m));
}
// smallest move between two keys; ties go down (you usually lower keys to fit a voice)
export function shortestShift(fromKey, toKey) {
  const a = keyPc(fromKey), b = keyPc(toKey);
  if (a == null || b == null) return 0;
  const d = (b - a + 12) % 12;
  return d >= 6 ? d - 12 : d;
}

export function transposeChord(chord, n, flats) {
  const m = CHORD_RE.exec(String(chord).trim());
  if (!m) return chord;
  const [, L, a, suffix, bL, bA] = m;
  const root = noteName(pcOf(L, a) + n, flats);
  const bass = bL ? '/' + noteName(pcOf(bL, bA || '') + n, flats) : '';
  return root + suffix + bass;
}
export function chordsIn(text) {
  const out = [];
  String(text || '').replace(BRACKET_RE, (m, x) => { if (isChord(x)) out.push(x.trim()); return m; });
  return out;
}
export function chordsUseFlats(texts) {
  return texts.some((t) => chordsIn(t).some((c) => { const m = CHORD_RE.exec(c); return m && (m[2] === 'b' || m[2] === '♭' || m[5] === 'b' || m[5] === '♭'); }));
}

// show accidentals as ♯ and ♭ (root, bass, and extensions such as 7b9)
export function prettyChord(chord) {
  const m = CHORD_RE.exec(String(chord).trim());
  if (!m) return String(chord);
  const g = (a) => (a === '#' ? '♯' : a === 'b' ? '♭' : a || '');
  const suffix = m[3].replace(/#/g, '♯').replace(/b/g, '♭');
  return m[1] + g(m[2]) + suffix + (m[4] ? '/' + m[4] + g(m[5]) : '');
}

/* ---------- Stilus songs ---------- */

// "Verse 1", "Verse 2" when a type repeats, plain "Bridge" when it appears once (same as Stilus)
export function autoLabels(song) {
  const totals = {}, seen = {}, out = {};
  for (const sec of song.sections) totals[sec.type] = (totals[sec.type] || 0) + 1;
  for (const sec of song.sections) {
    seen[sec.type] = (seen[sec.type] || 0) + 1;
    out[sec.id] = totals[sec.type] > 1 ? sec.type + ' ' + seen[sec.type] : sec.type;
  }
  return out;
}

// Light normalisation: keeps every field the song has (unknown fields must be preserved) and fills what the chart needs.
export function normalizeSong(raw) {
  const s = JSON.parse(JSON.stringify(raw || {}));
  s.id = String(s.id || 'song' + Date.now().toString(36));
  s.title = String(s.title || '');
  s.key = KEYS.includes(s.key) ? s.key : '';
  s.mode = MODES.includes(s.mode) ? s.mode : '';
  const bpm = Number(s.bpm);
  s.bpm = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 100) / 100 : null;
  s.timeSig = /^\d+\/\d+$/.test(String(s.timeSig || '')) ? String(s.timeSig) : '4/4';
  s.sections = (Array.isArray(s.sections) ? s.sections : []).map((x, i) => ({
    ...x, id: String(x && x.id || 'sec' + i), type: String(x && x.type || 'Other'),
    label: String(x && x.label || ''), lyrics: String(x && x.lyrics || ''),
  }));
  return s;
}

// Accepts a Stilus backup ({format:'lyricwriter-backup'}), a bare array of songs, or a single song.
// Returns songs (deleted ones left out). Throws a readable Error for anything else.
export function songsFromData(data) {
  let songs;
  if (Array.isArray(data)) songs = data;
  else if (data && data.format === 'lyricwriter-backup') {
    if (!(data.v >= 1) || data.v > 1) throw new Error('This Stilus backup is version ' + data.v + '; Notula reads version 1.');
    songs = data.songs;
  } else if (data && Array.isArray(data.sections)) songs = [data];
  else throw new Error('That file is not a Stilus song or backup.');
  if (!Array.isArray(songs)) throw new Error('The backup has no songs list.');
  return songs.filter((x) => x && typeof x === 'object' && !x.deleted).map(normalizeSong);
}
