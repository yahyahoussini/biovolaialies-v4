/*
 * BIOVOLAILLES — field app service worker (document 3, ch. 05).
 *
 * Keeps the field app's page and code on the phone so it opens without network. Data never goes
 * through this cache: the entries and the snapshot live in IndexedDB, written by the app itself,
 * and /api/ requests always go to the network. Registered with scope /terrain only.
 */
const CACHE = "bvu-terrain-v1";
const SHELL = "/terrain";
const PRECACHE = [SHELL, "/manifest.webmanifest", "/icons/terrain-192.png", "/icons/terrain-512.png"];
/** On a weak signal, the page from the phone after this long rather than a spinner. */
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of PRECACHE) {
        try {
          const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
          // A redirect means no session (login page): never cache that as the app.
          if (response.ok && !response.redirected) await cache.put(url, response);
        } catch {
          /* offline at install: the page caches itself on its next online visit */
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("bvu-terrain-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

function cachedShellOrNotice(cache) {
  return cache.match(SHELL).then(
    (cached) =>
      cached ||
      new Response(
        "<!doctype html><html lang=fr><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Hors ligne</title><body style='font-family:sans-serif;padding:24px'><h1>Pas de réseau</h1><p>L'application terrain doit être ouverte une première fois avec du réseau pour fonctionner ensuite hors ligne.</p></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
  );
}

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then(async (response) => {
    if (response.ok && !response.redirected) await cache.put(SHELL, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const first = await Promise.race([fromNetwork, timeout]);
    if (first) return first;
    const cached = await cache.match(SHELL);
    return cached || (await fromNetwork);
  } catch {
    return cachedShellOrNotice(cache);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && (url.pathname === SHELL || url.pathname.startsWith(`${SHELL}/`))) {
    event.respondWith(networkFirstShell(request));
    return;
  }
  // Hashed build files never change under the same name: the phone's copy is always right.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * The page tells the worker what it loaded: WARM caches it (the first visit happens before the
 * worker is in control), PRUNE drops build files no longer used by the current page.
 */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "WARM" && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        for (const href of data.urls) {
          const url = new URL(href, self.location.origin);
          if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
          if (await cache.match(url.pathname + url.search)) continue;
          try {
            const response = await fetch(url, { credentials: "same-origin" });
            if (response.ok) await cache.put(url.pathname + url.search, response);
          } catch {
            /* offline: next time */
          }
        }
      })()
    );
  }
  if (data.type === "PRUNE" && Array.isArray(data.keep)) {
    event.waitUntil(
      (async () => {
        const keep = new Set(data.keep.map((href) => new URL(href, self.location.origin).pathname));
        const cache = await caches.open(CACHE);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          if (path.startsWith("/_next/static/chunks/") && !keep.has(path)) await cache.delete(request);
        }
      })()
    );
  }
});
