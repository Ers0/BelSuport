/**
 * Belenergy Support Pro — Service Worker
 * Strategy: Network-first for API, Cache-first for assets
 */

const CACHE_VERSION = 'belenergy-v1';
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;
const API_CACHE     = `${CACHE_VERSION}-api`;

// Static assets to pre-cache on install
const PRE_CACHE = [
  '/',
  '/assets/main.js',
  '/assets/main.css',
];

// ── Install ────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== ASSET_CACHE && k !== API_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ──────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and cross-origin except fonts
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.hostname.includes('fonts.g')) return;

  // API: network-first, short cache for offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache safe reads
          if (res.ok && ['cases','reminders','products'].some(p => url.pathname.includes(p))) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Assets (JS, CSS, fonts): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ── Background sync (for offline form submissions) ─────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-cases') {
    event.waitUntil(syncPendingCases());
  }
});

async function syncPendingCases() {
  // Handled by offline-queue.js in the backend when online
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE' }));
}

// ── Push notifications ─────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Belenergy Support Pro', {
      body:    data.body    || '',
      icon:    '/icons/icon-192x192.svg',
      badge:   '/icons/icon-72x72.svg',
      tag:     data.tag     || 'belenergy',
      data:    data.url     ? { url: data.url } : {},
      actions: data.actions || [],
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
