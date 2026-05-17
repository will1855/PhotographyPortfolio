'use strict';

const CACHE_NAME = 'willdaviesphoto-cache-v3';
const STATIC_ASSETS = [
  '/',
  '/about',
  '/style.css?v=2',
  '/script.js?v=2',
  '/logo.png'
];

// 1. Install event: Cache critical UI shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 2. Activate event: Clear legacy caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch event: Cache-first for images, stale-while-revalidate for static shell, bypass for API
self.addEventListener('fetch', (e) => {
  // Caching is only supported for GET requests. Bypass completely for POST, PUT, DELETE, etc.
  if (e.request.method !== 'GET') {
    return;
  }

  const url = new URL(e.request.url);

  // Bypass cache completely for API endpoints and Admin panel
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/login')) {
    return;
  }

  // Cache-First strategy for thumbnails and static shell assets only.
  // High-resolution original photos (/full/) are intentionally bypassed so they use
  // standard browser HTTP cache, which the phone OS can automatically clean up when low on space.
  const isImageRequest = 
    (url.hostname.includes('supabase.co') && url.pathname.includes('/thumbs/')) ||
    (!url.hostname.includes('supabase.co') && url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg|ico)$/));

  if (isImageRequest) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          return fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Silence network errors for offline image requests
          });
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate strategy for static UI shell assets
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cachedResponse) => {
        const fetchPromise = fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Serve cached asset if network offline
        });

        return cachedResponse || fetchPromise;
      });
    })
  );
});
