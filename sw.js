// Cache: il guscio dell'app resta offline, i dati si aggiornano quando c'e' rete.
const SHELL = 'poketrend-shell-v2';
const DATA = 'poketrend-data-v1';
const FILES = ['./', './index.html', './search.mjs', './insight.mjs', './chart.mjs', './export.mjs', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(DATA).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
