// Service worker: estratégia "rede primeiro" para os arquivos do app.
// Assim, com internet, o usuário SEMPRE recebe a versão mais nova;
// sem internet, cai para o cache (funciona offline).
const CACHE = "assistente-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/nlp.js",
  "./js/capture.js",
  "./js/files.js",
  "./js/planilha.js",
  "./js/gcal.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Não interceptar chamadas externas (nuvem Supabase, CDNs).
  if (url.origin !== self.location.origin) return;

  // Rede primeiro; se falhar (offline), usa o cache.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
