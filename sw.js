// sw.js — MAzemPro V7 Pro Plus
// Version bumped to force cache invalidation on all clients
const CACHE = 'mazempro-v8-20260329';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  // Skip waiting immediately — don't queue behind old SW
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Cache only what exists — don't fail on missing icons
      return Promise.allSettled(ASSETS.map(a => c.add(a)));
    })
  );
});

self.addEventListener('activate', e => {
  // Delete ALL old caches immediately
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  const url = new URL(e.request.url);
  
  // API calls: NEVER cache, always network
  if (url.pathname.startsWith('/api/')) return;
  
  // For HTML pages: Network-first (always get fresh index.html)
  if (e.request.headers.get('accept') && 
      e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        // Update cache with fresh copy
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback: serve cached version
        return caches.match('/index.html');
      })
    );
    return;
  }
  
  // For other assets: Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', e => {
  if (e.data) {
    const d = e.data.json();
    self.registration.showNotification(d.title || 'MAzemPro V7', {
      body: d.body, icon: '/icon-192.png', vibrate: [200, 100, 200]
    });
  }
});
