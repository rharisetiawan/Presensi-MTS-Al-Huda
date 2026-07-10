// Service Worker — Landing Page Root — MTS Al Huda Putri
// [FIX-04] Root SW hanya handle halaman landing saja, scope terbatas
// Dashboard dan Scanner punya SW mereka sendiri di subdirektori masing-masing
const CACHE_NAME = 'mts-root-v1';
const ASSETS = ['./index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Hanya handle request untuk index.html di root saja
  if (e.request.url.endsWith('/') || e.request.url.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html'))
    );
  }
  // Biarkan request ke /dashboard/ dan /scanner/ ditangani oleh SW mereka
});
