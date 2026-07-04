const CACHE_NAME = 'mts-dashboard-v2';
const ASSETS = [
  './',
  './index.html',
  '../assets/js/config.js',
  '../assets/icons/logo-mts.png',
  '../assets/icons/favicon.ico',
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

// Network-first strategy (always try network, fallback to cache)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Skip Google APIs and CDN requests
  if (e.request.url.includes('googleapis') || e.request.url.includes('jsdelivr') || e.request.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
