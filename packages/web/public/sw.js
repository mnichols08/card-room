// The service worker: shows the buzz when the server pushes one, and opens the right table when
// it's tapped. It doesn't cache anything; the card room needs the server to play anyway.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let notice = { title: "Card Room 🃏", body: "", url: "./" };
  try {
    notice = { ...notice, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      renotify: !!notice.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      vibrate: [80, 60, 140],
      data: { url: new URL(notice.url, self.registration.scope).href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? self.registration.scope;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a window that's already open on the app, if there is one.
      const win = open.find((c) => c.url.startsWith(self.registration.scope));
      if (win) {
        await win.focus();
        return win.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
