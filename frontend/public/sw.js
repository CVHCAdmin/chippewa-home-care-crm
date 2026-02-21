// sw.js - Service Worker for offline clock-in/out support
const CACHE_NAME = 'homecare-crm-v1';
const OFFLINE_QUEUE_KEY = 'offline-queue';

// Assets to cache for offline use
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

// ── Install & cache ───────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Clock-in / clock-out: try network first, queue if offline
  if (url.pathname.includes('/api/time-entries') && 
      (request.method === 'POST' || request.method === 'PATCH')) {
    event.respondWith(networkFirstWithQueue(request));
    return;
  }

  // GPS tracking: queue when offline (fire and forget)
  if (url.pathname.includes('/api/time-entries') && url.pathname.includes('/gps')) {
    event.respondWith(queueOrNetwork(request));
    return;
  }

  // Auth calls: never intercept, always pass through directly
  if (url.pathname.startsWith('/api/auth/')) {
    return; // Let browser handle it natively
  }

  // API calls: network first, no cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => 
        new Response(JSON.stringify({ error: 'offline', offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets: cache first, fall back to network
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return response;
    }))
  );
});

// ── Offline queue handling ────────────────────────────────────────────────────
async function networkFirstWithQueue(request) {
  const cloned = request.clone();
  try {
    const response = await fetch(request);
    // If we're back online, try to flush the queue
    if (response.ok) {
      await flushQueue();
    }
    return response;
  } catch (err) {
    // We're offline — queue the request
    await queueRequest(cloned);
    return new Response(JSON.stringify({
      queued: true,
      offline: true,
      message: 'Action queued — will sync when online'
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function queueOrNetwork(request) {
  try {
    return await fetch(request);
  } catch {
    const cloned = request.clone();
    await queueRequest(cloned);
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function queueRequest(request) {
  const db = await openDB();
  const body = await request.text().catch(() => '');
  const entry = {
    id: Date.now(),
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: new Date().toISOString(),
  };
  await dbPut(db, 'queue', entry);
  
  // Notify all clients that we queued something
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'QUEUED', entry }));
}

async function flushQueue() {
  const db = await openDB();
  const queue = await dbGetAll(db, 'queue');
  if (!queue.length) return;

  for (const entry of queue) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body || undefined,
      });
      if (response.ok) {
        await dbDelete(db, 'queue', entry.id);
        const clients = await self.clients.matchAll();
        clients.forEach(c => c.postMessage({ type: 'SYNCED', entry }));
      }
    } catch {
      break; // Still offline, stop trying
    }
  }
}

// ── Background sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(flushQueue());
  }
});

// ── Minimal IndexedDB helpers ─────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('homecare-offline', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('queue', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

function dbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}
