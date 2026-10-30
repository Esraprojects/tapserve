/*
 * Tapserve service worker: keeps the POS usable when the internet drops.
 * - App code (/_next/static) is cached on first use and served from cache afterwards.
 * - Pages are fetched from the network first; the last good copy of each work screen
 *   (POS, orders, tables, kitchen) is kept, so it still opens offline.
 * - Orders taken offline are queued in IndexedDB by the page itself and sent on reconnect.
 * Nothing is cached for public receipts, and caches are cleared on log-out.
 */
const VERSION = "tapserve-v2";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const WORK_SCREENS = /^\/(am|en)\/(pos|orders|tables|kitchen|dashboard)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(["/offline.html", "/icon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "logout") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // server actions and form posts always go to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    const cacheable = WORK_SCREENS.test(url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable && res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(PAGES);
          const locale = url.pathname.split("/")[1] === "en" ? "en" : "am";
          return (await cache.match(url.pathname))
            || (await cache.match(`/${locale}/pos`))
            || (await caches.match("/offline.html"));
        }),
    );
  }
});
