'use strict';

const CACHE_NAME = 'willdaviesphoto-cache-v9';
const STATIC_ASSETS = [
  '/',
  '/about',
  '/style.css?v=14',
  '/js/main.js?v=14',
  '/favicon.png?v=3',
  '/apple-touch-icon.png?v=3',
  '/logo.png'
];

// 1. Install event: Cache critical UI shell assets & force immediate activation
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Safari optimization: force new service worker to install immediately
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell...');
        return cache.addAll(STATIC_ASSETS);
      })
  );
});

// 2. Activate event: Clear legacy caches starting with prefix & claim control immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('willdaviesphoto-cache') && key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Claim active clients immediately to apply updates on first load
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

  // Cache-First strategy for local static assets and local same-origin images only.
  // We completely bypass all cross-origin Supabase images (e.g. hostname zohxfhuczcfjsstzxuwb.supabase.co)
  // to avoid service worker caching large media assets cross-origin and keeping them
  // persistently. The browser's native HTTP cache will naturally and efficiently handle them.
  const isImageRequest = 
    !url.hostname.includes('supabase.co') && url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg|ico)$/);

  if (isImageRequest) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(e.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          return fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
              const contentType = networkResponse.headers.get('content-type');
              // Only cache actual images to prevent caching portal login/block pages
              if (contentType && (contentType.includes('image/') || contentType.includes('application/octet-stream'))) {
                cache.put(e.request, networkResponse.clone());
              }
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
          if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
            const contentType = networkResponse.headers.get('content-type');
            const isHtmlRoute = url.pathname === '/' || url.pathname === '/about';
            
            // Failsafe validation: ensure we do not cache portal HTML in place of styles/scripts
            if (isHtmlRoute) {
              if (contentType && contentType.includes('text/html')) {
                cache.put(e.request, networkResponse.clone());
              }
            } else {
              if (contentType && !contentType.includes('text/html')) {
                cache.put(e.request, networkResponse.clone());
              }
            }
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
