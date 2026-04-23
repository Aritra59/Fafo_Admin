/* FaFo Admin — lightweight offline shell; network-first for requests */
const VERSION = "fafo-admin-sw-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      cache.addAll(["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"]).catch(() => undefined)
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        if (res.status === 200) {
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match("/index.html")))
  );
});
