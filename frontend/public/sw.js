// sw.js - Unregister self and clear all caches
// Previous versions of this SW were intercepting API calls in the native app

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Clear all caches
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
      // Unregister this service worker
      self.registration.unregister()
    ])
  );
  self.clients.claim();
});
