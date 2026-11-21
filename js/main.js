// Notula: sheet music and tab. Stage 2: melody from MIDI (engraved as SVG, with playback) and chord charts from Stilus songs.
import { parseMidi, writeMidi, bytesToBase64, base64ToBytes } from './midi.js';
import { buildScore, trackInfo } from './score.js';
import { keyName, makeKey } from './theory.js';
import { layoutScore, renderSystem, SP_IN, SYS_H, SYS_GAP, HEADER_IN } from './engrave.js';
import * as store from './store.js';
import { songsFromData, KEYS, MODES, shortestShift, keyPc, keyNameFor } from './chords.js';
import { chartModel, renderSections, subtitle, keyLabel } from './chart.js';
import { Player, engravedTimeline, originalTimeline, baseBpm } from './play.js';

export const APP_VERSION = '0.2.0';
const APP_UPDATED = '2026-11-21';
const $ = (id) => document.getElementById(id);

const PAGES = { letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.69 } };
const state = {
  project: null, midi: null, score: null, layout: null,
  selectedBar: null, fit: 1, observer: null, saveTimer: null, sysEls: [],
  player: new Player(), tl: null, raf: 0, bpmFactor: 1, playBars: null,
};
const isChart = () => !!(state.project && state.project.source.kind === 'stilus');

/* ---------- theme (shared key studio.theme) ---------- */
function applyTheme() {
  let t = 'dark';
  try { t = localStorage.getItem('studio.theme') || 'dark'; } catch (e) { /* default */ }
  if (!['dark', 'gray', 'light'].includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = { dark: '#0b0b0c', gray: '#2a2b2e', light: '#eceef1' }[t];
}
window.addEventListener('storage', (e) => { if (e.key === 'studio.theme') applyTheme(); });

/* ---------- small helpers ---------- */
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pname = (p) => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1);
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- saving ---------- */
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 450);
}
async function flushSave() {
  clearTimeout(state.saveTimer);
  const p = state.project;
  if (!p) return;
  const ok = await store.saveProject(p);
  try { localStorage.setItem('notula.lastProject', p.id); } catch (e) { /* ignore */ }
  if (!ok) toast('Could not save. Export the project to keep your work.');
  publishSummary();
}
async function publishSummary() {
  try {
    const list = await store.listProjects();
    const sum = {
      schema: 1, appId: 'notula', version: APP_VERSION, lastOpened: new Date().toISOString(),
      recent: list.slice(0, 10).map((p) => ({ id: p.id, title: p.title, updated: p.updated })),
    };
    localStorage.setItem('notula.summary', JSON.stringify(sum));
  } catch (e) { /* ignore */ }
}
window.addEventListener('pagehide', () => { if (state.project) { store.saveProjectSync(state.project); try { localStorage.setItem('notula.lastProject', state.project.id); } catch (e) { /* ignore */ } flushSave(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state.project) { store.saveProjectSync(state.project); flushSave(); } });

/* ---------- project lifecycle ---------- */
async function openProject(p) {
  stopPlay();
  state.project = p;
  state.selectedBar = null; state.bpmSet = false;
  document.body.dataset.kind = p.source.kind === 'stilus' ? 'stilus' : 'midi';
  if (p.source.kind === 'stilus') {
    state.midi = null; state.score = null; state.layout = null; state.tl = null;
    showBarTools();
    syncControls();
    rebuild();
    try { localStorage.setItem('notula.lastProject', p.id); } catch (e) { /* ignore */ }
    scheduleSave();
    return;
  }
  try { state.midi = parseMidi(base64ToBytes(p.source.midiBase64)); }
  catch (e) { state.midi = null; toast('Could not read the MIDI data: ' + e.message); }
  // make sure the chosen track is usable
  if (state.midi) {
    const t = state.midi.tracks[p.source.trackIndex];
    if (!t || t.drum) {
      const alt = state.midi.tracks.findIndex((x) => !x.drum);
      p.source.trackIndex = alt >= 0 ? alt : 0;
    }
  }
  syncControls();
  rebuild();
  try { localStorage.setItem('notula.lastProject', p.id); } catch (e) { /* ignore */ }
  scheduleSave();
}

async function createFromMidiBytes(bytes, fileName) {
  let midi;
  try { midi = parseMidi(bytes); } catch (e) { toast(e.message); return; }
  if (!midi.tracks.length) { toast('That MIDI file has no notes.'); return; }
  let idx = midi.tracks.findIndex((t) => !t.drum);
  if (idx < 0) idx = 0;
  const title = (fileName || 'Untitled').replace(/\.(mid|midi)$/i, '').replace(/[_]+/g, ' ');
  const p = store.newProject({ title, fileName, midiBase64: bytesToBase64(bytes), trackIndex: idx, version: APP_VERSION });
  if (window.innerWidth < 700) p.settings.page = 'screen';
  await openProject(p);
  if (midi.tracks.every((t) => t.drum)) toast('This file only has drum tracks. Drum notation arrives in stage 4; shown as pitches for now.', 6000);
  else if (midi.tracks[idx] && midi.tracks.length > 1) toast('Loaded "' + midi.tracks[idx].name + '". Pick another track in Chart options.');
}

async function openMidiFile(file) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  await createFromMidiBytes(buf, file.name);
}

function demoBytes() {
  const q = 480;
  // A minor, 4/4, 96 bpm: ties, triplets, rests, a pickup-free phrase
  const seq = [
    [69, 1], [72, 1], [71, 0.5], [69, 0.5], [67, 1],
    [64, 1.5], [67, 0.5], [69, 2],
    [72, 1], [74, 1 / 3], [76, 1 / 3], [74, 1 / 3], [72, 1], [71, 1],
    [69, 3.5], [null, 0.5],
    [76, 1], [76, 0.5], [74, 0.5], [72, 1], [71, 1],
    [69, 0.5], [71, 0.5], [72, 1], [74, 2],
    [72, 1], [71, 1], [69, 2],
    [69, 4],
  ];
  let t = 0; const notes = [];
  for (const [p, b] of seq) { const d = Math.round(b * q); if (p !== null) notes.push({ t, d: Math.max(1, d - 12), p, v: 90 }); t += d; }
  return writeMidi({ ppq: q, bpm: 96, notes, name: 'Vocal melody' });
}

/* ---------- build + layout ---------- */
function curSettings() { return state.project.settings; }
function rebuild() {
  const p = state.project;
  if (p && isChart()) { stopPlay(); renderChart(); updateInfo(); syncControls(); $('transport').hidden = true; return; }
  if (!p || !state.midi) { renderEmpty(); return; }
  stopPlay(); state.tl = null;
  $('transport').hidden = false;
  const s = p.settings;
  state.score = buildScore(state.midi, p.source.trackIndex, {
    feel: s.feel, trim: s.trim, shift: s.shift, transpose: s.transpose, clef: s.clef, keyOverride: s.keyOverride,
  }, p.marks);
  relayout();
  updateInfo();
  syncControls();
}

const isScreen = () => !state.printAs && curSettings().page === 'screen';
function pageDims() {
  const kind = state.printAs || curSettings().page;
  if (kind === 'screen') {
    const z = curSettings().zoom || 1;
    return { w: Math.max(2.6, ($('view').clientWidth - 16) / 96 / z), h: 1e4, mx: 0.12, my: 0.12, single: true };
  }
  return Object.assign({ mx: 0.6, my: 0.55, single: false }, PAGES[kind] || PAGES.letter);
}
function fitZoom() {
  const w = $('view').clientWidth - 18;
  const pw = (PAGES[curSettings().page] || PAGES.letter).w * 96;
  return Math.max(0.3, Math.min(1.25, w / pw));
}
function currentZoom() {
  if (state.printAs) return 1;
  const z = curSettings().zoom;
  if (curSettings().page === 'screen') return z || 1;
  return z ? z : fitZoom();
}

function relayout() {
  if (isChart()) { renderChart(); return; }
  const d = pageDims();
  state.layout = layoutScore(state.score, { pageW: d.w, pageH: d.h, marginX: d.mx, marginY: d.my, single: d.single });
  renderPages();
}

function renderPages() {
  if (isChart()) { renderChart(); return; }
  const view = $('view');
  const keepTop = view.scrollTop;
  if (state.observer) state.observer.disconnect();
  view.textContent = '';
  const d = pageDims();
  const root = document.documentElement;
  root.style.setProperty('--pw', d.w + 'in');
  root.style.setProperty('--ph', d.h + 'in');
  root.style.setProperty('--z', String(currentZoom()));
  updateZoomLabel();
  const style = $('pageStyle') || Object.assign(document.createElement('style'), { id: 'pageStyle' });
  style.textContent = `@page { size: ${d.w}in ${d.h}in; margin: 0; }`;
  document.head.appendChild(style);

  const sc = state.score, L = state.layout, p = state.project;
  state.sysEls = [];
  state.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target, i = +el.dataset.i;
      if (e.isIntersecting) { if (!el.firstChild) el.innerHTML = renderSystem(sc, L.systems[i], { selectedBar: state.selectedBar, lastSystem: L.systems.length - 1 }); }
      else if (el.firstChild) el.textContent = '';
    }
  }, { root: view, rootMargin: '900px 0px' });

  const key = sc.key;
  const bits = [];
  bits.push('Key: ' + keyName(key));
  const tempo = sc.measures.find((m) => m.tempo != null);
  if (tempo) bits.push(tempo.tempo + ' BPM');
  if (sc.measures.length) bits.push(sc.measures[0].ts.num + '/' + sc.measures[0].ts.den);
  if (p.settings.transpose) bits.push('transposed ' + (p.settings.transpose > 0 ? '+' : '') + p.settings.transpose);
  if (p.meta.part) bits.push(p.meta.part);

  L.pages.forEach((pg, pi) => {
    const page = document.createElement('div');
    page.className = 'page';
    if (d.single) { page.style.height = 'auto'; page.style.padding = `calc(var(--z) * 0.12in)`; page.style.minHeight = '0'; }
    if (pi === 0) {
      const h = document.createElement('div');
      h.className = 'pagehead';
      h.innerHTML = `<h1>${esc(p.meta.title || 'Untitled')}</h1>` + (p.meta.artist ? `<div class="by">${esc(p.meta.artist)}</div>` : '') + `<div class="sub">${esc(bits.join('   ·   '))}</div>`;
      page.appendChild(h);
    }
    pg.systems.forEach((sy) => {
      const el = document.createElement('div');
      el.className = 'sys';
      el.dataset.i = sy.index;
      el.style.height = `calc(var(--z) * ${(SYS_H * SP_IN).toFixed(4)}in)`;
      el.style.marginBottom = `calc(var(--z) * ${(SYS_GAP * SP_IN).toFixed(4)}in)`;
      page.appendChild(el);
      state.sysEls[sy.index] = el;
      state.observer.observe(el);
    });
    const num = document.createElement('div');
    num.className = 'pnum'; num.textContent = (pi + 1) + ' / ' + L.pages.length;
    if (!d.single) page.appendChild(num);
    view.appendChild(page);
  });
  view.scrollTop = keepTop;
}

function chartModelNow() {
  const p = state.project;
  return chartModel(p.source.song, p.settings.transpose | 0);
}
function renderChart() {
  const p = state.project, view = $('view');
  if (state.observer) state.observer.disconnect();
  const kind = state.printAs || p.settings.page;
  const reflow = kind === 'screen';
  const dims = PAGES[kind] || PAGES.letter;
  const root = document.documentElement;
  root.style.setProperty('--pw', dims.w + 'in');
  root.style.setProperty('--ph', dims.h + 'in');
  root.style.setProperty('--z', String(state.printAs ? 1 : (p.settings.zoom || (reflow ? 1 : fitZoom()))));
  updateZoomLabel();
  const style = $('pageStyle') || Object.assign(document.createElement('style'), { id: 'pageStyle' });
  style.textContent = `@page { size: ${dims.w}in ${dims.h}in; margin: 0.6in; }`;
  document.head.appendChild(style);
  const m = chartModelNow();
  const c = p.settings.chart || {};
  const keep = view.scrollTop;
  view.innerHTML = '<article class="chartdoc' + (reflow ? ' reflow' : '') + '"><h1>' + esc(p.meta.title || 'Untitled') + '</h1>'
    + (p.meta.artist ? '<div class="by">' + esc(p.meta.artist) + '</div>' : '')
    + '<div class="sub">' + esc(subtitle(m)) + '</div>'
    + '<div class="chartbody' + (c.columns === 2 && !reflow ? ' cols2' : '') + '">'
    + (m.sections.length ? renderSections(m, c.view || 'both') : '<div class="muted">This song has no sections yet.</div>') + '</div></article>';
  view.scrollTop = keep;
}

async function createFromSong(song, fileName) {
  const ps = (await store.listProjects()).filter((x) => x.songId && x.songId === song.id);
  if (ps.length) {
    const upd = window.confirm('"' + (ps[0].title || song.title) + '" is already in Notula from this Stilus song.\n\nOK = update it with this version (your page settings stay).\nCancel = add it as a separate copy.');
    if (upd) {
      const old = await store.loadProject(ps[0].id);
      if (old && old.source.kind === 'stilus') {
        old.source.song = song; old.source.fileName = fileName || old.source.fileName;
        old.meta.title = song.title || old.meta.title; old.songRef = { id: song.id, title: song.title || '' };
        await openProject(old); toast('Updated from Stilus.'); return;
      }
    }
  }
  const p = store.newStilusProject({ song, fileName, version: APP_VERSION });
  if (window.innerWidth < 700) p.settings.page = 'screen';
  await openProject(p);
  const m = chartModel(song, 0);
  if (!m.chordCount) toast('Loaded "' + (song.title || 'Untitled') + '". It has no chords yet; add them in Stilus and import again.', 6000);
  else toast('Loaded "' + (song.title || 'Untitled') + '".');
}

function pickSong(songs, fileName) {
  const box = $('songList'), filter = $('songFilter');
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    box.textContent = '';
    const shown = songs.filter((s) => !q || (s.title || '').toLowerCase().includes(q));
    if (!shown.length) box.textContent = 'No songs match.';
    for (const s of shown) {
      const b = document.createElement('button');
      b.className = 'songbtn';
      const nch = chartModel(s, 0).chordCount;
      b.innerHTML = '<b>' + esc(s.title || 'Untitled') + '</b><small>' + esc([s.key ? keyLabel(s.key, s.mode) : '', s.bpm ? s.bpm + ' BPM' : '', nch ? nch + (nch === 1 ? ' chord' : ' chords') : 'no chords'].filter(Boolean).join(' · ')) + '</small>';
      b.onclick = () => { $('dlgSongs').close(); createFromSong(s, fileName); };
      box.appendChild(b);
    }
  };
  filter.value = ''; filter.oninput = draw; draw();
  $('dlgSongs').showModal();
}

async function handleJsonFile(f) {
  let data;
  try { data = JSON.parse(await f.text()); } catch (e) { toast('That file is not valid JSON.'); return; }
  if (data && data.format === 'notula-project') { await importProjectFile(f, data); return; }
  let songs;
  try { songs = songsFromData(data); } catch (e) { toast(e.message, 5000); return; }
  if (!songs.length) { toast('No songs in that file.'); return; }
  if (songs.length === 1) await createFromSong(songs[0], f.name); else pickSong(songs, f.name);
}

function refreshRendered() {
  if (isChart()) return;
  const L = state.layout; if (!L) return;
  state.sysEls.forEach((el, i) => {
    if (el && el.firstChild) el.innerHTML = renderSystem(state.score, L.systems[i], { selectedBar: state.selectedBar, lastSystem: L.systems.length - 1 });
  });
}
function renderAll() {
  if (isChart()) return;
  const L = state.layout; if (!L) return;
  state.sysEls.forEach((el, i) => {
    if (el && !el.firstChild) el.innerHTML = renderSystem(state.score, L.systems[i], { selectedBar: null, lastSystem: L.systems.length - 1 });
  });
}

function renderEmpty() {
  const view = $('view');
  if (state.observer) state.observer.disconnect();
  view.innerHTML = `<div class="empty"><h2>Notula</h2><p>Sheet music from your own MIDI, and chord charts from your Stilus songs. Open a MIDI file from Sonorum or a Stilus song or backup, or drop one here.</p>
  <div class="row"><button class="primary" id="emOpen">Open MIDI</button><button class="primary" id="emStilus">Stilus song</button><button id="emDemo">Try a demo melody</button><button id="emProj">Saved projects</button></div></div>`;
  $('emOpen').onclick = () => $('fileMidi').click();
  $('emStilus').onclick = () => $('fileStilus').click();
  $('emDemo').onclick = () => createFromMidiBytes(demoBytes(), 'Demo melody.mid');
  $('emProj').onclick = showProjects;
  $('infoBar').textContent = '';
  $('transport').hidden = true;
}

/* ---------- info + controls ---------- */
function updateInfo() {
  if (isChart()) {
    const m = chartModelNow();
    $('infoBar').textContent = 'Stilus chart · ' + m.sections.length + ' section' + (m.sections.length === 1 ? '' : 's') + ' · ' + m.chordCount + ' chord' + (m.chordCount === 1 ? '' : 's') + (m.key ? ' · key ' + keyLabel(m.newKey, m.mode) : '');
    return;
  }
  const sc = state.score, p = state.project;
  if (!sc || !state.midi) return;
  const t = state.midi.tracks[p.source.trackIndex];
  const st = sc.stats;
  const range = st.lo != null ? pname(st.lo) + '–' + pname(st.hi) : 'no notes';
  const src = { midi: 'from MIDI', detected: 'detected', manual: 'set by you' }[sc.keySource];
  let h = `${esc(t ? t.name : '')} · ${sc.measures.length ? st.bars : 0} bars · ${st.notes} notes · ${range} · key ${esc(keyName(sc.key))} (${src}) · ${sc.clef} clef`;
  if (st.tripBeats) h += ` · ${st.tripBeats} triplet beat${st.tripBeats > 1 ? 's' : ''}`;
  for (const w of sc.warnings) h += ` · <span class="warn">${esc(w)}</span>`;
  $('infoBar').innerHTML = h;
}

function fillChartKeys() {
  const k = $('selChartKey');
  k.innerHTML = '<option value="orig">Original key</option>';
  for (let t = 0; t < 12; t++) {
    for (const mode of ['major', 'minor']) {
      const o = document.createElement('option');
      o.value = t + ':' + mode;
      o.textContent = keyLabel(keyNameFor(t, mode), mode);
      k.appendChild(o);
    }
  }
}
function fillSelects() {
  fillChartKeys();
  const k = $('selKey');
  k.innerHTML = '<option value="auto">Auto (from file)</option>';
  for (let m = 0; m < 2; m++) for (let t = 0; t < 12; t++) {
    const o = document.createElement('option');
    o.value = t + (m ? 'm' : 'M');
    o.textContent = keyName(makeKey(t, !!m));
    k.appendChild(o);
  }
}
function syncControls() {
  const p = state.project;
  if (!p) return;
  const s = p.settings;
  $('inTitle').value = p.meta.title || '';
  $('inArtist').value = p.meta.artist || '';
  if (isChart()) {
    $('selPage').value = s.page;
    $('trVal').textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
    $('selView').value = (s.chart && s.chart.view) || 'both';
    $('selCols').value = String((s.chart && s.chart.columns) || 1);
    const song = p.source.song;
    const kk = $('selChartKey');
    kk.disabled = !song.key;
    kk.value = 'orig';
    if (song.key && s.transpose) {
      const t = (keyPc(song.key) + s.transpose + 120) % 12;
      const v = t + ':' + (song.mode || 'major');
      if ([...kk.options].some((o) => o.value === v)) kk.value = v;
    }
    updateZoomLabel();
    return;
  }
  $('selFeel').value = s.feel;
  $('selClef').value = s.clef;
  $('selPage').value = s.page;
  $('chkTrim').checked = !!s.trim;
  $('trVal').textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  $('shVal').textContent = String(s.shift);
  $('selKey').value = s.keyOverride ? s.keyOverride.tonic + (s.keyOverride.minor ? 'm' : 'M') : 'auto';
  const tr = $('selTrack');
  tr.innerHTML = '';
  if (state.midi) state.midi.tracks.forEach((t, i) => {
    const info = trackInfo(state.midi, i);
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = info.name + ' · ' + info.count + ' notes' + (info.drum ? ' · drums (stage 4)' : '');
    o.disabled = info.drum && state.midi.tracks.some((x) => !x.drum);
    tr.appendChild(o);
  });
  tr.value = String(p.source.trackIndex);
  updateZoomLabel();
}
function updateZoomLabel() { $('zVal').textContent = Math.round(currentZoom() * 100) + '%'; }

function change(fn) {
  if (!state.project) return;
  fn(state.project);
  rebuild();
  scheduleSave();
}

function bindControls() {
  $('inTitle').addEventListener('input', (e) => { if (!state.project) return; state.project.meta.title = e.target.value; const h = document.querySelector('.pagehead h1'); if (h) h.textContent = e.target.value || 'Untitled'; scheduleSave(); });
  $('inArtist').addEventListener('input', (e) => { if (!state.project) return; state.project.meta.artist = e.target.value; rebuild(); scheduleSave(); });
  $('selView').onchange = (e) => change((p) => { p.settings.chart.view = e.target.value; });
  $('selCols').onchange = (e) => change((p) => { p.settings.chart.columns = +e.target.value; });
  $('selChartKey').onchange = (e) => change((p) => {
    const v = e.target.value, song = p.source.song;
    if (v === 'orig' || !song.key) { p.settings.transpose = 0; return; }
    const target = keyNameFor(+v.split(':')[0], song.mode || 'major');
    p.settings.transpose = shortestShift(song.key, target);
  });
  $('selTrack').onchange = (e) => change((p) => { p.source.trackIndex = +e.target.value; });
  $('selFeel').onchange = (e) => change((p) => { p.settings.feel = e.target.value; });
  $('selClef').onchange = (e) => change((p) => { p.settings.clef = e.target.value; });
  $('selPage').onchange = (e) => change((p) => { p.settings.page = e.target.value; });
  $('chkTrim').onchange = (e) => change((p) => { p.settings.trim = e.target.checked; });
  $('selKey').onchange = (e) => change((p) => {
    const v = e.target.value;
    p.settings.keyOverride = v === 'auto' ? null : { tonic: parseInt(v, 10), minor: v.endsWith('m') };
  });
  $('trDown').onclick = () => change((p) => { p.settings.transpose = Math.max(-24, p.settings.transpose - 1); });
  $('trUp').onclick = () => change((p) => { p.settings.transpose = Math.min(24, p.settings.transpose + 1); });
  $('shDown').onclick = () => change((p) => { p.settings.shift = Math.max(-64, p.settings.shift - 1); });
  $('shUp').onclick = () => change((p) => { p.settings.shift = Math.min(64, p.settings.shift + 1); });
  const zoomTo = (z) => {
    if (!state.project) return;
    state.project.settings.zoom = Math.max(0.3, Math.min(2.5, Math.round(z * 20) / 20));
    if (state.project.settings.page === 'screen') relayout(); else renderPages();
    scheduleSave();
  };
  $('zIn').onclick = () => zoomTo(currentZoom() * 1.15);
  $('zOut').onclick = () => zoomTo(currentZoom() / 1.15);
  $('zFit').onclick = () => { if (!state.project) return; state.project.settings.zoom = null; if (state.project.settings.page === 'screen') relayout(); else renderPages(); scheduleSave(); };
  let rz = null;
  window.addEventListener('resize', () => {
    if (state.project && isChart()) { if (!state.project.settings.zoom && state.project.settings.page !== 'screen') { document.documentElement.style.setProperty('--z', String(fitZoom())); updateZoomLabel(); } return; }
    if (!state.project || !state.score) return;
    if (state.project.settings.page === 'screen') { clearTimeout(rz); rz = setTimeout(relayout, 150); }
    else if (!state.project.settings.zoom) { document.documentElement.style.setProperty('--z', String(fitZoom())); updateZoomLabel(); }
  });

  $('btnOpen').onclick = () => $('fileMidi').click();
  $('fileMidi').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; await openMidiFile(f); };
  $('btnStilus').onclick = () => $('fileStilus').click();
  $('fileStilus').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await handleJsonFile(f); };
  $('btnProjects').onclick = showProjects;
  $('btnPrint').onclick = () => { if (!state.project) { toast('Open a MIDI file or Stilus song first.'); return; } window.print(); };
  // printing always uses a real paper page: the phone layout is swapped for Letter while printing
  window.addEventListener('beforeprint', () => {
    if (state.project && isChart()) { if (state.project.settings.page === 'screen') { state.printAs = 'letter'; } renderChart(); return; }
    if (!state.project || !state.score) return;
    if (state.project.settings.page === 'screen') { state.printAs = 'letter'; relayout(); }
    renderAll();
  });
  window.addEventListener('afterprint', () => { if (state.printAs) { state.printAs = null; relayout(); } else if (state.project && isChart()) renderChart(); });
  $('btnMenu').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });
  $('miExport').onclick = () => { $('menu').hidden = true; exportProject(); };
  $('miImport').onclick = () => { $('menu').hidden = true; $('fileProject').click(); };
  $('fileProject').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await handleJsonFile(f); };
  $('miAbout').onclick = () => {
    $('menu').hidden = true;
    $('aboutText').textContent = 'Notula ' + APP_VERSION + ' (' + APP_UPDATED + '). Part of the Abditum suite. Melody from MIDI with playback, and chord charts from Stilus songs. Everything stays on this device; nothing is sent anywhere.';
    $('dlgAbout').showModal();
  };

  // bar selection + tools
  $('view').addEventListener('click', (e) => {
    if (isChart()) return;
    const r = e.target.closest && e.target.closest('[data-bar]');
    if (!r) { if (state.selectedBar !== null) { state.selectedBar = null; showBarTools(); refreshRendered(); } return; }
    state.selectedBar = +r.dataset.bar;
    showBarTools(); refreshRendered();
  });
  $('barTools').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || state.selectedBar === null) return;
    const act = b.dataset.mark, i = state.selectedBar, p = state.project;
    p.marks[i] = p.marks[i] || {};
    const mk = p.marks[i];
    if (act === 'close') { state.selectedBar = null; showBarTools(); refreshRendered(); return; }
    if (act === 'clear') delete p.marks[i];
    else if (act === 'label') {
      const v = window.prompt('Section label for this bar (empty to remove):', mk.label || '');
      if (v === null) return;
      if (v.trim()) mk.label = v.trim().slice(0, 24); else delete mk.label;
    } else { if (mk[act]) delete mk[act]; else mk[act] = true; }
    if (p.marks[i] && !Object.keys(p.marks[i]).length) delete p.marks[i];
    rebuild(); showBarTools(); scheduleSave();
  });

  // drag and drop
  const view = $('view');
  ['dragenter', 'dragover'].forEach((ev) => view.addEventListener(ev, (e) => { e.preventDefault(); view.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => view.addEventListener(ev, (e) => { e.preventDefault(); view.classList.remove('drag'); }));
  view.addEventListener('drop', async (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.json$/i.test(f.name)) await handleJsonFile(f); else await openMidiFile(f);
  });
}

function showBarTools() {
  const bt = $('barTools'), i = state.selectedBar, p = state.project;
  if (i === null || !p) { bt.hidden = true; return; }
  bt.hidden = false;
  $('btLabel').textContent = 'Bar ' + (i + 1);
  const mk = p.marks[i] || {};
  bt.querySelectorAll('button[data-mark]').forEach((b) => { b.classList.toggle('on', !!mk[b.dataset.mark]); });
}

/* ---------- projects ---------- */
async function showProjects() {
  const list = await store.listProjects();
  const box = $('projList');
  box.textContent = '';
  if (!list.length) box.textContent = 'Nothing saved yet. Open a MIDI file or a Stilus song to start.';
  for (const it of list) {
    const row = document.createElement('div'); row.className = 'prow';
    const t = document.createElement('div'); t.className = 't';
    t.innerHTML = `<b>${esc(it.title)}</b><small>${it.kind === 'stilus' ? 'Chord chart · ' : ''}${esc((it.updated || '').slice(0, 16).replace('T', ' '))}${it.bars ? ' · ' + esc(it.bars) : ''}</small>`;
    const open = document.createElement('button'); open.textContent = 'Open';
    open.onclick = async () => { const p = await store.loadProject(it.id); if (p) { $('dlgProjects').close(); await openProject(p); } else toast('Could not open that project.'); };
    const del = document.createElement('button'); del.textContent = 'Delete';
    del.onclick = async () => {
      if (!window.confirm('Delete "' + it.title + '" from this device? Export it first if you want a copy.')) return;
      await store.deleteProject(it.id);
      if (state.project && state.project.id === it.id) { stopPlay(); state.project = null; state.midi = null; state.score = null; document.body.dataset.kind = 'midi'; renderEmpty(); }
      showProjects(); publishSummary();
    };
    row.append(t, open, del); box.appendChild(row);
  }
  if (!$('dlgProjects').open) $('dlgProjects').showModal();
}

function exportProject() {
  const p = state.project;
  if (!p) { toast('Nothing to export yet.'); return; }
  p.updated = new Date().toISOString();
  const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  const safe = (p.meta.title || 'notula').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'notula';
  a.href = URL.createObjectURL(blob);
  a.download = safe + '.notula.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Project exported.');
}
async function importProjectFile(f, parsed) {
  try {
    const obj = parsed || JSON.parse(await f.text());
    const ids = new Set((await store.listProjects()).map((x) => x.id));
    const p = store.importProjectObject(obj, ids);
    await openProject(p);
    toast('Project imported.');
  } catch (e) { toast('Import failed: ' + e.message, 5000); }
}

/* ---------- playback ---------- */
function buildTimeline() {
  const p = state.project, sc = state.score, s = p.settings;
  const shiftU = (s.shift | 0) * 12;
  return $('selPlay').value === 'orig'
    ? originalTimeline(sc, state.midi, p.source.trackIndex, s.transpose | 0, shiftU)
    : engravedTimeline(sc, state.midi, shiftU);
}
// unit position -> {system index, x in staff spaces}
function posToX(u) {
  const L = state.layout, sc = state.score;
  if (!L || !sc) return null;
  let best = null;
  for (const sy of L.systems) for (const g of sy.ms) {
    const m = g.m, nb = m.multi || 1, end = m.start + nb * m.len;
    if (u >= m.start - 1e-6 && u < end) {
      const a = g.x + g.padL, b = g.x + g.W - g.padR;
      let x;
      if (nb > 1 || !g.items.length) x = a + (b - a) * (u - m.start) / (nb * m.len);
      else {
        const pts = [{ pos: 0, x: a }];
        for (const q of g.items) { const ps = q.it.pos; if (ps > pts[pts.length - 1].pos + 1e-6) pts.push({ pos: ps, x: q.x }); else if (ps === 0) pts[0] = { pos: 0, x: q.x }; }
        if (m.len > pts[pts.length - 1].pos) pts.push({ pos: m.len, x: b });
        const rel = u - m.start;
        x = pts[pts.length - 1].x;
        for (let i = 1; i < pts.length; i++) if (rel < pts[i].pos) { const f = (rel - pts[i - 1].pos) / (pts[i].pos - pts[i - 1].pos); x = pts[i - 1].x + f * (pts[i].x - pts[i - 1].x); break; }
      }
      return { si: sy.index, x, W: sy.contentW };
    }
    best = { si: sy.index, x: g.x + g.W - g.padR, W: sy.contentW };
  }
  return best;
}
function ensurePlayhead() {
  let ph = $('playhead');
  if (!ph) { ph = document.createElement('div'); ph.id = 'playhead'; }
  return ph;
}
function hidePlayhead() { const ph = $('playhead'); if (ph) ph.remove(); }
function frame() {
  state.raf = 0;
  const u = state.player.currentUnit();
  if (u === null) { hidePlayhead(); return; }
  const pos = posToX(u);
  if (pos) {
    const el = state.sysEls[pos.si], ph = ensurePlayhead();
    if (el) {
      if (ph.parentNode !== el) {
        el.appendChild(ph);
        const view = $('view'), r = el.getBoundingClientRect(), vr = view.getBoundingClientRect();
        if (r.top < vr.top + 10 || r.bottom > vr.bottom - 10) view.scrollTop += r.top - vr.top - vr.height * 0.25;
      }
      ph.style.left = (pos.x / pos.W * 100).toFixed(3) + '%';
    }
  }
  state.raf = requestAnimationFrame(frame);
}
function setPlayUi(on) {
  $('btnPlay').classList.toggle('on', on);
}
function stopPlay(keepHead) {
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
  state.player.stop();
  if (!keepHead) hidePlayhead();
  setPlayUi(false);
}
function tempoFactor() { return (+$('rngBpm').value) / (state.tl ? baseBpm(state.tl) : 120); }
function startPlay(fromU) {
  if (!state.project || isChart() || !state.score) return;
  try {
    if (!state.tl) { state.tl = buildTimeline(); const b = Math.round(baseBpm(state.tl)); if (!state.bpmSet) { $('rngBpm').value = String(Math.min(240, Math.max(30, b))); $('bpmVal').textContent = $('rngBpm').value; } }
    const tl = state.tl;
    if (!tl.notes.length) { toast('Nothing to play in this track.'); return; }
    let u = fromU;
    if (u == null) {
      u = tl.startU;
      if (state.selectedBar !== null) { const m = state.score.measures.find((x) => x.idx >= state.selectedBar); if (m) u = m.start; }
    }
    state.player.setVolume(+$('rngVol').value / 100);
    state.player.play(tl, u, tempoFactor(), $('chkClick').checked, () => { stopPlay(); });
    setPlayUi(true);
    if (!state.raf) state.raf = requestAnimationFrame(frame);
  } catch (e) { toast('Could not play: ' + e.message, 5000); stopPlay(); }
}
function bindTransport() {
  $('btnPlay').onclick = () => startPlay();
  $('btnStop').onclick = () => stopPlay();
  const restart = () => { if (state.player.playing) { const u = state.player.currentUnit(); startPlay(u); } };
  $('rngBpm').oninput = () => { state.bpmSet = true; $('bpmVal').textContent = $('rngBpm').value; restart(); };
  $('bpmReset').onclick = () => { state.bpmSet = false; if (state.tl) { const b = Math.round(baseBpm(state.tl)); $('rngBpm').value = String(Math.min(240, Math.max(30, b))); $('bpmVal').textContent = $('rngBpm').value; } restart(); };
  $('selPlay').onchange = () => { const was = state.player.playing, u = was ? state.player.currentUnit() : null; state.tl = null; if (was) startPlay(u); };
  $('chkClick').onchange = restart;
  $('rngVol').oninput = () => state.player.setVolume(+$('rngVol').value / 100);
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !state.project || isChart()) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'BUTTON') return;
    e.preventDefault();
    if (state.player.playing) stopPlay(); else startPlay();
  });
}

/* ---------- start ---------- */
async function init() {
  applyTheme();
  fillSelects();
  bindControls();
  bindTransport();
  if (window.innerWidth < 700) $('controlsWrap').open = false;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* offline install optional */ });
  let last = null;
  try { last = localStorage.getItem('notula.lastProject'); } catch (e) { /* none */ }
  let p = last ? await store.loadProject(last) : null;
  if (!p) { const list = await store.listProjects(); if (list.length) p = await store.loadProject(list[0].id); }
  if (p) await openProject(p); else { renderEmpty(); publishSummary(); }
  window.__notula = { state, handleJsonFile, createFromSong, startPlay, stopPlay, posToX, createFromMidiBytes, rebuild, renderAll, demoBytes };
}
init();
