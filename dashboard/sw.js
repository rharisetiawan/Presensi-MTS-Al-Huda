// Service Worker — Dashboard Admin — MTS Al Huda Putri
// [FIX-03] Versi v4: absolute paths, cache buster, tidak intercept API
const CACHE_NAME = 'mts-dashboard-v4';
const ASSETS = [
  '/dashboard/index.html',
  '/assets/js/config.js',
  '/assets/icons/icon-192.png',
];

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

// Network-first strategy
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // [FIX-CACHE] Jangan intercept API calls ke Google Apps Script — selalu network
  if (e.request.url.includes('script.google.com')) return;

  // Jangan intercept CDN & Google Fonts
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('jsdelivr.net') ||
      e.request.url.includes('unpkg.com')) return;

  // Network-first untuk semua asset lain
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
