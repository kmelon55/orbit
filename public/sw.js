const CACHE_PREFIX = "orbit-static";
const CACHE_VERSION = "v2";
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

// Mail bodies, credentials and attachments are never cached by this worker.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }
  const requested = typeof data.url === "string" ? data.url : "/mail";
  const url = new URL(requested, self.location.origin);
  const target = url.origin === self.location.origin && url.pathname === "/mail"
    ? url.pathname + url.search : "/mail";
  event.waitUntil(self.registration.showNotification(String(data.title || "Orbit 메일").slice(0, 200), {
    body: String(data.body || "새 메일이 도착했습니다.").slice(0, 500),
    icon: "/icons/orbit-192.png", badge: "/icons/orbit-192.png",
    tag: String(data.tag || "orbit-mail").slice(0, 100),
    data: { url: target },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || "/mail", self.location.origin);
  const target = requested.origin === self.location.origin && requested.pathname === "/mail"
    ? requested.href : new URL("/mail", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find(c => new URL(c.url).origin === self.location.origin);
    if (client) { await client.navigate(target); await client.focus(); }
    else await self.clients.openWindow(target);
  }));
});
