// Service Worker — Presensi MTS Al Huda Putri
// Bump CACHE_NAME setiap kali merilis perubahan agar HP scanner otomatis
// mengambil versi terbaru (bukan versi lama yang tersangkut di cache).
const CACHE_NAME = 'presensi-mts-v2';
const ASSETS = [
  '../assets/js/config.js'
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

  // API calls — selalu network, jangan cache
  if (e.request.url.includes('script.google.com')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ success: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Halaman HTML (navigasi) — network-first, supaya perbaikan/rilis baru
  // langsung terpakai. Cache hanya jadi fallback saat benar-benar offline.
  const isNavigation = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // Asset lain (JS/CSS/font/gambar) — cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
    )
  );
});
