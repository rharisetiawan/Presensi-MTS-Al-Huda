// Service Worker — Scanner Presensi — MTS Al Huda Putri
// [FIX-03] Versi v3: absolute paths, perbaikan scope conflict
const CACHE_NAME = 'presensi-scanner-v3';
const ASSETS = [
  '/scanner/index.html',
  '/assets/js/config.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
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
  // [FIX-CACHE] API calls ke Google Apps Script — selalu network, jangan cache
  if (e.request.url.includes('script.google.com')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() =>
      new Response(JSON.stringify({ success: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Jangan intercept CDN & Google Fonts/APIs
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('jsdelivr.net') ||
      e.request.url.includes('unpkg.com')) return;

  // Cache-first untuk assets lokal scanner
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
    ).catch(() => caches.match('/scanner/index.html'))
  );
});
