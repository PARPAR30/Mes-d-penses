/* Service worker : met l'appli en cache pour qu'elle démarre sans connexion.
   Changer CACHE à chaque version force le rafraîchissement des fichiers. */

const CACHE = "mon-budget-1.0.0";

const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "fonts/fonts.css",
  "fonts/fredoka-500-latin.woff2",
  "fonts/fredoka-500-latin-ext.woff2",
  "fonts/fredoka-600-latin.woff2",
  "fonts/fredoka-600-latin-ext.woff2",
  "fonts/nunito-400-latin.woff2",
  "fonts/nunito-400-latin-ext.woff2",
  "fonts/nunito-600-latin.woff2",
  "fonts/nunito-600-latin-ext.woff2",
  "fonts/nunito-800-latin.woff2",
  "fonts/nunito-800-latin-ext.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && new URL(request.url).origin === location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => (request.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});
