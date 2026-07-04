// Service Worker — Presensi MTS Al Huda Putri
const CACHE_NAME = 'presensi-mts-v1';
const ASSETS = [
  '/scanner/',
  '/scanner/index.html',
  '/assets/js/config.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
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
  // Network first untuk API calls, cache first untuk assets
  if (e.request.url.includes('script.google.com')) {
    // API calls — selalu network, jangan cache
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ success: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Untuk assets — cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
    ).catch(() => caches.match('/scanner/index.html'))
  );
});
