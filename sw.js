// Service worker: estratégia "rede primeiro" para os arquivos do app.
// Assim, com internet, o usuário SEMPRE recebe a versão mais nova;
// sem internet, cai para o cache (funciona offline).
const CACHE = "assistente-v43";
// Bibliotecas externas que valem a pena guardar para o app abrir OFFLINE
// (a lib da Supabase é importada de CDN; sem cache, o boot falharia sem net).
const RUNTIME_CDN = /(^https:\/\/esm\.sh\/)|(cdn\.jsdelivr\.net)|(cdn\.skypack\.dev)/;
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/home.js",
  "./js/agent.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/local.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/nlp.js",
  "./js/capture.js",
  "./js/files.js",
  "./js/planilha.js",
  "./js/gcal.js",
  "./js/gmail.js",
  "./js/assist.js",
  "./js/extract.js",
  "./js/ai.js",
  "./js/docs.js",
  "./js/vendor/jszip.min.js",
  "./templates/procuracao_judicial.docx",
  "./templates/procuracao_extrajudicial.docx",
  "./templates/declaracao.docx",
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

  if (url.origin !== self.location.origin) {
    // Só mexemos em bibliotecas de CDN conhecidas (para o app abrir offline).
    // As chamadas de DADOS da Supabase NÃO passam por aqui — o próprio módulo
    // offline cuida disso. Estratégia: cache primeiro, rede como reforço.
    if (RUNTIME_CDN.test(url.href)) {
      e.respondWith(
        caches.match(req).then((cached) =>
          cached || fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
        )
      );
    }
    return; // demais origens externas: deixa passar direto
  }

  // Arquivos do próprio app — rede primeiro; se falhar (offline), usa o cache.
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
