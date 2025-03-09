const CACHE_NAME = 'apsara-bazaar-cache-v1';

// Install event
self.addEventListener('install', event => {
  // Skip the waiting phase and activate the service worker immediately
  self.skipWaiting();
});

// Optimized service worker (sw.js)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker for Telegram images
  if (
    url.hostname === 'api.telegram.org' &&
    url.pathname.startsWith('/file/')
  ) {
    return; // Let browser handle Telegram image requests normally
  }

  // Bypass service worker for other image routes (if needed)
  if (url.pathname.startsWith('/post/images/')) {
    return; // Let browser handle normally
  }
  if (url.pathname.startsWith('/api/images/')) {
    return; // Let browser handle normally
  }

  // Cache-first strategy for all other assets
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      // Take control of any clients as soon as the service worker activates
      return self.clients.claim();
    })
  );
});
