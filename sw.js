// Service Worker passif - pas de skipWaiting, pas de clients.claim
const CACHE = 'mazempro-v9-stable';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
    // PAS de skipWaiting() - évite les rechargements forcés
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
    // PAS de clients.claim() - évite les boucles de rechargement
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  // Network first pour index.html - toujours la version fraîche
  if(e.request.url.includes('index.html') || e.request.url.endsWith('/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Cache first pour les assets statiques
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
