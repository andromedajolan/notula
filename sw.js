// Notula service worker. Cache-first for its own files only.
// Keep VERSION in step with APP_VERSION in js/main.js and "version" in suite-app.json.
const VERSION = '0.2.0';
const CACHE = 'notula-cache-' + VERSION;
const PREFIX = 'notula-cache-';

const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/main.js', 'js/midi.js', 'js/theory.js', 'js/score.js', 'js/glyphs.js', 'js/engrave.js', 'js/store.js',
  'js/chords.js',
  'js/chart.js',
  'js/play.js',
];
const EXTRA = [
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/favicon-32.png',
  'docs/DATA_FORMAT.md',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.all(EXTRA.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;

  // suite-app.json: always try the network first so the launcher sees the real version
  if (url.pathname.endsWith('/suite-app.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
      catch (e) { return (await cache.match(req)) || Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch (e) {
      if (req.mode === 'navigate') { const home = await cache.match('index.html'); if (home) return home; }
      return Response.error();
    }
  })());
});
