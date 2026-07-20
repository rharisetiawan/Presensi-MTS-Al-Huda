// Service Worker — Scanner Presensi — MTS Al Huda Putri
// [FIX-03] Versi v4: absolute paths, perbaikan scope conflict
// Naikkan CACHE_NAME setiap rilis agar HP scanner otomatis mengambil versi baru.
const CACHE_NAME = 'presensi-scanner-v4';
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
  if (e.request.method !== 'GET') return;

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

  // Halaman HTML (navigasi) — network-first, supaya perbaikan/rilis baru
  // langsung terpakai. Cache hanya jadi fallback saat benar-benar offline.
  const isNavigation = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/scanner/index.html')))
    );
    return;
  }

  // Asset lain (JS/CSS/font/gambar) — cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
