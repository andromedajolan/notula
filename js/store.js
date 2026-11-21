// Notula: crash-proof local storage (IndexedDB "notula-db", with localStorage fallback) and project helpers.
// Every save keeps the previous version in the "prev" store, so a bad write can always be rolled back.

const DB_NAME = 'notula-db';
const DB_VERSION = 1;
let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('prev')) db.createObjectStore('prev', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  return dbp;
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const LS = 'notula.p.';
function lsList() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS)) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) { /* skip */ } }
  }
  return out;
}

export async function saveProject(p) {
  p.updated = new Date().toISOString();
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'prev'], 'readwrite');
      const ps = tx.objectStore('projects'), pv = tx.objectStore('prev');
      const g = ps.get(p.id);
      g.onsuccess = () => {
        if (g.result) pv.put(g.result);
        ps.put(JSON.parse(JSON.stringify(p)));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(LS + p.id, JSON.stringify(p)); } catch (e2) { return false; }
  }
  return true;
}

export async function loadProject(id) {
  try {
    const db = await openDb();
    const tx = db.transaction(['projects', 'prev'], 'readonly');
    let r = await wrap(tx.objectStore('projects').get(id));
    if (!validProject(r)) r = await wrap(tx.objectStore('prev').get(id));
    if (validProject(r)) return r;
  } catch (e) { /* fall through */ }
  try { const raw = localStorage.getItem(LS + id); if (raw) { const r = JSON.parse(raw); if (validProject(r)) return r; } } catch (e) { /* none */ }
  return null;
}

export async function listProjects() {
  let all = [];
  try { const db = await openDb(); all = await wrap(db.transaction('projects').objectStore('projects').getAll()); } catch (e) { /* fallback below */ }
  const seen = new Set(all.map((p) => p.id));
  for (const p of lsList()) if (!seen.has(p.id)) all.push(p);
  return all.filter(validProject).map((p) => ({ id: p.id, title: p.meta && p.meta.title || 'Untitled', updated: p.updated, bars: p.source && p.source.fileName || '' }))
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

export async function deleteProject(id) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'prev'], 'readwrite');
      tx.objectStore('projects').delete(id); tx.objectStore('prev').delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* ignore */ }
  try { localStorage.removeItem(LS + id); } catch (e) { /* ignore */ }
}

export function validProject(p) {
  return !!(p && p.format === 'notula-project' && typeof p.schema === 'number' && p.id && p.source && p.source.midiBase64);
}

export function newId() { return 'np_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function newProject({ title, fileName, midiBase64, trackIndex, version }) {
  const now = new Date().toISOString();
  return {
    format: 'notula-project', schema: 1, id: newId(),
    created: now, updated: now, app: { name: 'Notula', version },
    meta: { title: title || 'Untitled', artist: 'Andromeda Dunn', part: '' },
    songRef: null,
    source: { kind: 'midi', fileName: fileName || '', midiBase64, trackIndex: trackIndex || 0 },
    settings: { feel: 'strict', trim: true, shift: 0, transpose: 0, clef: 'auto', keyOverride: null, page: 'letter', zoom: null },
    marks: {},
  };
}

// accept a parsed JSON object; returns a clean project or throws
export function importProjectObject(obj, existingIds) {
  if (!obj || obj.format !== 'notula-project') throw new Error('This is not a Notula project file.');
  if (typeof obj.schema !== 'number' || obj.schema > 1) throw new Error('This project was saved by a newer version of Notula.');
  if (!obj.source || !obj.source.midiBase64) throw new Error('The project has no MIDI data.');
  const p = JSON.parse(JSON.stringify(obj));
  p.meta = Object.assign({ title: 'Untitled', artist: '', part: '' }, p.meta || {});
  p.settings = Object.assign({ feel: 'strict', trim: true, shift: 0, transpose: 0, clef: 'auto', keyOverride: null, page: 'letter', zoom: null }, p.settings || {});
  p.marks = p.marks || {};
  p.songRef = p.songRef || null;
  if (!p.id || (existingIds && existingIds.has(p.id))) {
    if (p.id) p.meta.title += ' (imported)';
    p.id = newId();
  }
  return p;
}
