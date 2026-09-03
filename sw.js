// Service worker "network-first" : quand tu es en ligne, tu as TOUJOURS la derniere version.
// Le cache ne sert que de secours hors-ligne. Plus besoin de vider le cache a la main.
const CACHE_NAME = "gradezilla-v8";
const CORE = [
  "./",
  "./index.html",
  "./style.css?v=8",
  "./app.js?v=8",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  // Autres domaines (API Gemini, CDN pdf.js/JSZip) : on laisse passer, jamais de cache.
  if (url.hostname !== self.location.hostname) return;

  // network-first : on tente le reseau, on rafraichit le cache, et on retombe sur le cache si hors-ligne.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
