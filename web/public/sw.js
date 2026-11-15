// The service worker: it shows the game's notifications, and opens the game where a tap on one points, counting the tap
// by the notification's kind (for the admin page). Nothing else: no caching, so the game is always the one on the
// server.

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
      data: { url: m.url || "/", kind: m.kind || "" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "/", self.location.origin).href;
  const counted = data.kind
    ? fetch("/api/tally", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `push:open:${data.kind}` }),
        keepalive: true,
      }).catch(() => {})
    : Promise.resolve();
  event.waitUntil(
    Promise.all([
      counted,
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
        for (const w of windows) {
          if (w.url === url && "focus" in w) return w.focus();
        }
        return self.clients.openWindow(url);
      }),
    ]),
  );
});
