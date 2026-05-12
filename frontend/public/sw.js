// sw.js — minimal service worker focused on web push notifications.
// Does NOT intercept fetch (that broke the Capacitor native app previously).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Show a notification when a push arrives from the backend (web-push library).
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'CVHC HomeCare', body: event.data ? event.data.text() : 'You have a new notification.' };
  }

  const title = payload.title || 'CVHC HomeCare';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || undefined,
    data: payload.data || {},
    requireInteraction: payload.requireInteraction || false,
    silent: payload.silent || false
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus the app (or open it) when the user taps the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'notification_click', data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
