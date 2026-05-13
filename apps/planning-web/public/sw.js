// ─── Tracey Service Worker ────────────────────────────────────────────────────
// "Tracey got you covered" — including when WiFi drops on the production floor.
//
// Strategy:
//   - Static assets (JS/CSS/fonts): Cache-first, update in background
//   - Department pages (/, /dept/*, /plans, /items, /bom): Network-first, cache fallback
//   - Supabase API calls (POST mutations): Queued to IndexedDB when offline
//   - Supabase API calls (GET data): Network-first with cache fallback
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = "tracey-v2";
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

// Pages to pre-cache on install (shell)
const PRECACHE_URLS = [
  "/",
  "/dept/production",
  "/dept/filling",
  "/dept/cooking",
  "/dept/packing",
  "/dept/dispatch",
  "/plans",
  "/items",
  "/offline",
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Pre-cache shells best-effort (don't fail install if a page 404s)
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {/* ignore */})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("tracey-") && k !== STATIC_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for Supabase REST/Auth — those go through IndexedDB queue in the client
  if (request.method !== "GET") return;

  // Skip chrome-extension and non-http
  if (!url.protocol.startsWith("http")) return;

  // Skip Next.js server action POSTs (handled by client queue)
  if (request.headers.get("next-action")) return;

  // ── Static assets: Cache-first ──
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.match(/\.(ico|png|svg|woff2?|ttf)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Supabase GET data: Network-first with cache fallback ──
  if (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.in")) {
    event.respondWith(networkFirstWithCache(request, DATA_CACHE));
    return;
  }

  // ── App pages: Network-first with offline fallback ──
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirstWithCache(request, STATIC_CACHE).catch(() =>
        caches.match("/offline") || new Response("Offline", { status: 503 })
      )
    );
    return;
  }

  // Default: network only
});

// ─── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Network error", { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("No network and no cache for: " + request.url);
  }
}

// ─── Background Sync (Web Background Sync API) ────────────────────────────────
// When the browser supports Background Sync, the client registers a sync tag
// "tracey-queue-drain" and we trigger the drain here.

self.addEventListener("sync", (event) => {
  if (event.tag === "tracey-queue-drain") {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage({ type: "SYNC_QUEUE" }));
}

// ─── Push messages from app ───────────────────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CACHE_URLS") {
    const urls = event.data.urls || [];
    caches.open(DATA_CACHE).then((cache) => {
      urls.forEach((url) => fetch(url).then((r) => r.ok && cache.put(url, r)).catch(() => {}));
    });
  }
});
