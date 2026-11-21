// Notula: chord chart from a Stilus song. Builds an HTML string; no DOM needed.
import { isChord, BRACKET_RE, transposeChord, prettyChord, preferFlats, chordsUseFlats, keyPc, keyNameFor, autoLabels } from './chords.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// one lyric line -> [{c: chord|null, w: text}] ; a chord sits over the word that follows it
function unitsOf(line) {
  const segs = [];
  let last = 0;
  line.replace(BRACKET_RE, (m, x, idx) => {
    if (!isChord(x)) return m;
    if (idx > last) segs.push({ t: 'text', v: line.slice(last, idx) });
    segs.push({ t: 'chord', v: x.trim() });
    last = idx + m.length;
    return m;
  });
  if (last < line.length) segs.push({ t: 'text', v: line.slice(last) });
  const out = [];
  let pending = null;
  for (const seg of segs) {
    if (seg.t === 'chord') { if (pending) out.push({ c: pending, w: '' }); pending = seg.v; continue; }
    let first = true;
    for (const m of seg.v.matchAll(/\S+\s*|\s+/g)) {
      out.push({ c: first ? pending : null, w: m[0] });
      if (first) pending = null;
      first = false;
    }
  }
  if (pending) out.push({ c: pending, w: '' });
  return out;
}

export function keyLabel(keyName, mode) { return keyName ? keyName.replace('#', '♯').replace(/b$/, '♭') + ' ' + (mode || 'major') : ''; }

// model for the chart: transposed chords, section titles, lines of units
export function chartModel(song, transpose = 0) {
  const n = transpose | 0;
  const texts = song.sections.map((s) => s.lyrics);
  let flats, newKey = '';
  if (song.key) {
    const pc = keyPc(song.key);
    newKey = n ? keyNameFor((pc + n + 120) % 12, song.mode || 'major') : song.key;
    flats = n ? preferFlats(newKey, song.mode || 'major') : preferFlats(song.key, song.mode || 'major');
  } else flats = chordsUseFlats(texts);
  const labels = autoLabels(song);
  const sections = song.sections.map((sec) => {
    const lines = String(sec.lyrics || '').split('\n').map((ln) => unitsOf(ln).map((u) => ({
      c: u.c ? (n ? transposeChord(u.c, n, flats) : u.c) : null, w: u.w,
    })));
    return { id: sec.id, title: sec.label.trim() || labels[sec.id], lines };
  });
  let chordCount = 0;
  for (const s of sections) for (const l of s.lines) for (const u of l) if (u.c) chordCount++;
  return {
    title: song.title || 'Untitled', key: song.key, mode: song.mode, newKey, bpm: song.bpm, timeSig: song.timeSig,
    transpose: n, flats, sections, chordCount,
  };
}

export function subtitle(model) {
  const bits = [];
  if (model.key) {
    let k = 'Key: ' + keyLabel(model.newKey, model.mode);
    if (model.transpose) k += ' (original ' + keyLabel(model.key, model.mode) + ', ' + (model.transpose > 0 ? '+' : '') + model.transpose + ')';
    bits.push(k);
  } else if (model.transpose) bits.push('Transposed ' + (model.transpose > 0 ? '+' : '') + model.transpose);
  if (model.bpm) bits.push(model.bpm + ' BPM');
  if (model.timeSig) bits.push(model.timeSig);
  return bits.join('   ·   ');
}

const chip = (c) => '<span class="c">' + esc(prettyChord(c)) + '</span>';

// view: 'both' (chords over lyrics) | 'chords' (progression per line) | 'lyrics'
export function renderSections(model, view = 'both') {
  let h = '';
  for (const sec of model.sections) {
    let body = '';
    if (view === 'both') {
      for (const line of sec.lines) {
        if (!line.length) { body += '<div class="cl blank"></div>'; continue; }
        const has = line.some((u) => u.c);
        body += '<div class="cl' + (has ? '' : ' nochip') + '">';
        for (const u of line) body += '<span class="u">' + (u.c ? chip(u.c) : '<span class="c ph"> </span>') + '<span class="w">' + esc(u.w || ' ') + '</span></span>';
        body += '</div>';
      }
    } else if (view === 'chords') {
      let any = false;
      for (const line of sec.lines) {
        const cs = line.filter((u) => u.c).map((u) => u.c);
        if (!cs.length) continue;
        any = true;
        body += '<div class="pl">' + cs.map(chip).join('') + '</div>';
      }
      if (!any) body = '<div class="muted">No chords in this section.</div>';
    } else {
      let any = false;
      for (const line of sec.lines) {
        const t = line.map((u) => u.w).join('').trim();
        if (!t) { body += '<div class="ll blank"></div>'; continue; }
        any = true;
        body += '<div class="ll">' + esc(t) + '</div>';
      }
      if (!any) body = '<div class="muted">No lyrics in this section.</div>';
    }
    h += '<section class="sec"><h3>' + esc(sec.title) + '</h3>' + body + '</section>';
  }
  return h;
}
