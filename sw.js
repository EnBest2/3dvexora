/**
 * 3DVEXORA PWA Service Worker
 * Gyors betöltés, offline működés és iPhone PWA támogatás.
 */

const CACHE_NAME = '3dvexora-pwa-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css?v=4',
  './js/app.js?v=5',
  './manifest.json',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-first cache fallback strategy
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Do not intercept API requests, GitHub API, or dynamic sync.json
  const url = event.request.url;
  if (url.includes('/api/') || url.includes('sync.json') || url.includes('api.github.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
