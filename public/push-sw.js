// Web-push handler, injected into the generated Workbox service worker via
// workbox.importScripts (vite.config.js). Runs even when the app/tab is closed:
// shows the OS notification for an incoming push, and focuses/opens the app on
// click. Payload shape (from the web-push edge function): { title, body, url,
// tag, type }.
/* global self, clients */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: (event.data && event.data.text && event.data.text()) || "Mangodoro" };
  }
  const title = data.title || "Mangodoro";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || data.type || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of wins) {
        if ("focus" in c) {
          await c.focus();
          if (url && url !== "/" && "navigate" in c) {
            try { await c.navigate(url); } catch { /* */ }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
