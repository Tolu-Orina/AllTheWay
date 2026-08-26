/*
 * The push service worker.
 *
 * ## Why this is plain, with no Firebase SDK
 *
 * The usual recipe `importScripts()`s the Firebase compat bundles from gstatic
 * inside the worker. That makes every service-worker install depend on a third
 * party being reachable, and it is the one script this app would load from
 * somewhere it does not control.
 *
 * FCM delivers over the standard Web Push protocol, so a plain `push` listener
 * receives the same message. The cost is that we render the notification
 * ourselves rather than getting it for free — a few lines, in exchange for no
 * external dependency in the most privileged context the app has.
 *
 * ## Deliberately conservative about what it shows
 *
 * A push payload arrives from the network. It is rendered as text into a
 * notification and never evaluated, and the fields are read individually rather
 * than spread, so a payload cannot set options this worker did not intend —
 * `requireInteraction`, `actions` and `silent` are ours, not the sender's.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON. A push we cannot read is not a reason to show nothing at all,
    // but it is a reason not to guess at a body.
    payload = {};
  }

  const data = payload.notification || payload.data || {};
  const title = typeof data.title === "string" && data.title ? data.title : "AllTheWay";
  const body =
    typeof data.body === "string" && data.body
      ? data.body
      : "Something is waiting for you.";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
      // Collapses repeats: a retried delivery replaces the existing
      // notification rather than stacking a second identical one.
      tag: typeof data.tag === "string" ? data.tag : "alltheway-digest",
      data: { url: typeof data.url === "string" ? data.url : "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Same-origin only. A url from the payload that could point anywhere would
  // turn a push into an open redirect out of the installed app.
  const target = new URL(event.notification.data?.url || "/app", self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing window rather than opening a second one. Someone who
      // already has the app open does not want a duplicate tab.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
