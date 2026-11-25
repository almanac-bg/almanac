// The service worker: it shows the game's notifications, and opens the game where a tap on one points: in a window of
// the game's already open (that page brought forward, or the window taken there), else in a new one. Nothing else: no
// caching, so the game is always the one on the server. A notification's tag names it: one sent again (after a restart
// of the server's) shows in its place.
//
// A new worker takes over at once (skipWaiting), never waits for every window of the game to close: with no cache
// there's nothing for an older page and a newer worker to disagree on, and a fix here reaches a player who keeps the
// game open on their next page. The one thing the two say to each other is {open: url}, which a page goes to itself
// (sw.test.ts holds both: a window is never navigated from here).

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(m.title || "АЛМАНАХ", {
      body: m.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "bg",
      ...(m.tag ? { tag: m.tag } : {}),
      data: { url: m.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const w = windows.find((w) => w.url === url) ?? windows[0];
      if (!w) return self.clients.openWindow(url);
      await w.focus();
      // The page goes there itself (lib/push.ts → router's navigate), as a tapped link would: a game under way asks
      // first, never left in the middle of a question by a load from here.
      if (w.url !== url) w.postMessage({ open: url });
    }),
  );
});
