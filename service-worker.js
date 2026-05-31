// Offline support for the "Browser Games" collection PWA (whole-site scope).
// NETWORK-FIRST: always try the network so updates reach players immediately, and
// fall back to the runtime cache only when offline. Precaches the landing page.
// Bump CACHE whenever you want to force-purge old caches.
const CACHE = 'browser-games-v2';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './tic-tac-toe.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Network-first: fetch fresh, cache a copy, fall back to cache (then landing page) offline.
  event.respondWith(
    fetch(event.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return res;
    }).catch(() =>
      caches.match(event.request).then(hit => hit || caches.match('./index.html'))
    )
  );
});
