/* No Kapu Tuner service worker.
   Precaches every file of the app so it opens with no connection after the first visit.
   When you change ANY file, bump VERSION so installed copies pick up the update. */
const VERSION = 'v5';
const CACHE = 'no-kapu-tuner-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'maskable-512.png',
  'apple-touch-icon.png', 'favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('no-kapu-tuner-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first (instant + offline). The cache is only refreshed when VERSION changes.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(req); }
    catch (e) {
      if (req.mode === 'navigate') { const home = await caches.match('index.html'); if (home) return home; }
      return Response.error();
    }
  })());
});
