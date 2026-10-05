const CACHE_NAME = "energy-dds-jsy-pwa-v2.0.12";
const CACHE_PREFIX = "energy-dds-jsy-pwa-";
const APP_SCOPE = new URL("./", self.location.href).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=2.0.12",
  "./app.js?v=2.0.12",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // The new cache must download fresh bytes rather than reuse the HTTP cache.
    await cache.addAll(APP_SHELL.map((path) =>
      new Request(new URL(path, APP_SCOPE).href, { cache: "no-store" })
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldAppKeys = keys.filter(
      (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME
    );
    await Promise.all(oldAppKeys.map((key) => caches.delete(key)));
    await self.clients.claim();
    if (oldAppKeys.length) {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      await Promise.all(
        windows.filter((client) => client.url.startsWith(APP_SCOPE))
          .map((client) => client.navigate(client.url).catch(() => null))
      );
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(APP_SCOPE)) return;
  let resource = event.request;
  if (["app.js", "style.css"].some((file) => url.pathname === new URL(file, APP_SCOPE).pathname)) {
    // Older cached HTML may still request ?v=2.0.0; serve the current asset URL.
    url.search = "?v=2.0.12";
    resource = new Request(url.href, { cache: "no-store" });
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(resource, { cache: "no-store" });
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(resource, copy).catch(() => null));
      }
      return response;
    } catch (_) {
      const cached = await cache.match(resource);
      if (cached) return cached;
      // Offline HTML fallback is for navigations, not for JS/CSS asset requests.
      if (event.request.mode === "navigate") {
        const page = await cache.match(new URL("./index.html", APP_SCOPE).href);
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
