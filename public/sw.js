const CACHE_PREFIX = "orbit-static";
const CACHE_VERSION = "v1";
const STATIC_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/orbit.svg",
	"/orbit.png",
	"/icons/orbit-apple-touch.png",
	"/icons/orbit-192.png",
  "/icons/orbit-512.png",
  "/icons/orbit-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Private note pages, navigation HTML and server functions always stay on the network.
  if (request.mode === "navigate" || url.pathname.startsWith("/_server")) return;

	const staticRequest =
		CORE_ASSETS.includes(url.pathname) ||
		url.pathname.startsWith("/assets/") ||
		url.pathname.startsWith("/cursors/");
  if (!staticRequest) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
