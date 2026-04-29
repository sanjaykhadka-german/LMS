// German Butchery Training Portal — service worker
// Bump CACHE version to invalidate the cache on the next visit.
const CACHE = "gb-v1";

// Bypass cache entirely for these path prefixes (auth, admin, API, uploads).
const BYPASS_PREFIXES = [
  "/admin",
  "/uploads",
  "/api",
  "/login",
  "/logout",
];

// Bypass if the URL contains any of these substrings (auth tokens, csrf).
const BYPASS_SUBSTRINGS = ["csrf", "token", "auth"];

self.addEventListener("install", (event) => {
  // Activate as soon as install completes; no precaching — we cache lazily.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldBypass(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return true;
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return true;
  const lower = url.pathname.toLowerCase() + url.search.toLowerCase();
  if (BYPASS_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  return false;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      // Only cache basic same-origin responses; never cache opaque/error.
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last-resort offline page: return a cached navigation if any exists.
    const fallback = await cache.match("/");
    if (fallback) return fallback;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (shouldBypass(request)) return;

  const url = new URL(request.url);

  // Network-first for HTML / page navigations.
  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for /static/ assets (CSS, JS, fonts, icons, images).
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Anything else: just hit the network.
});
