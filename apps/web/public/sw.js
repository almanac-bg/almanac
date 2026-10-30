// The installed app's one offline behaviour: a page that can't be fetched at all (no connection) shows /offline.html
// instead of the browser's error page. Nothing else is cached here — the app's files are cached by the browser already
// (hashed, immutable), and pages always come from the network, so a deploy is picked up exactly as without a worker.
// The build stamps the offline page's hash into this name (vite.config.ts → offline-cache-name).
const CACHE = 'offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Web push (Settings → „Известия на телефона“): what the server sends is shown as it is; a tap opens the app there
// (a window already open goes to it, rather than a second one).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'АЛМАНАХ', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'АЛМАНАХ', {
      body: data.body || '',
      icon: '/icon-192.png',
      // Android draws the badge from its alpha channel alone: the mark in white (scripts/icons.mjs).
      badge: '/badge-96.png',
      tag: data.tag,
      lang: 'bg',
      data: { url: data.url || '/' },
    }),
  );
});

// A window already open is brought up and told where to go (the app moves there itself, as a link in it would): no
// reload of a tab that may be mid-match, and navigate() fails anyway for a window this worker doesn't control.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url.href);
      open.postMessage({ navigate: url.pathname + url.search });
      return open.focus();
    }),
  );
});

/** The server's key as the browser wants it (it gives it base64url). */
function keyBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const post = (path, body) =>
  fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// The push service replaced this device's subscription, or let it lapse: subscribe again with the site's key and tell
// the server (as the player, with their cookie), or the reminders would stop on this device without a word.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let sub = event.newSubscription;
      if (!sub) {
        const known = old?.options?.applicationServerKey;
        const key = known ?? (await (await fetch('/api/push/key', { credentials: 'include' })).json()).key;
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: typeof key === 'string' ? keyBytes(key) : key,
        });
      }
      await post('/api/push/subscribe', sub.toJSON());
      if (old && old.endpoint !== sub.endpoint) await post('/api/push/unsubscribe', { endpoint: old.endpoint });
    })().catch(() => {}),
  );
});
