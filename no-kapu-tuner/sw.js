/* No Kapu Tuner — service worker. Caches the app shell so it works fully offline. */
var CACHE = 'nokapu-v8';
var SHELL = [
  './',
  'index.html',
  'tuner-core.js',
  'manifest.webmanifest',
  'img/nokapu-tuner-wordmark.svg',
  'img/tuna-fish.webp',
  'img/tuna-opening-bg.webp',
  'img/tuna-tuner-bg.webp',
  'img/wordmark-tuna.svg',
  'manifest-tuna.webmanifest',
  'icons/tuna/icon-192.png',
  'icons/tuna/icon-512.png',
  'icons/tuna/icon-maskable-512.png',
  'icons/tuna/apple-touch-icon.png',
  'icons/tuna/favicon-32.png',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Cache first (instant, offline), refreshed from the network in the background.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      var refresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          return caches.open(CACHE).then(function (cache) { return cache.put(req, copy); }).then(function () { return res; });
        }
        return res;
      }).catch(function () { return cached; });
      event.waitUntil(refresh.catch(function () {}));   // let the background refresh finish
      return cached || refresh;
    })
  );
});
