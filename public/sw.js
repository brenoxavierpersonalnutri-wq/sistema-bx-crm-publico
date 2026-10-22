// Service worker — garante que o HTML nunca fica obsoleto no cache do Chrome.
// A cada novo deploy da Lovable os bundles JS mudam de hash; se o HTML antigo
// ficar em cache o app carrega arquivos que não existem mais → tela branca.
// Solução: requisições de navegação (HTML) sempre vão direto à rede.

const SW_VERSION = "v2"; // atualize este valor para forçar reinstalação do SW

self.addEventListener("install", (event) => {
  // Ativa imediatamente sem esperar a aba ser fechada
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove todos os caches antigos que possam existir de versões anteriores
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Requisições de navegação (HTML) → sempre busca da rede, sem cache
  // Isso garante que após um deploy o usuário recebe o index.html novo
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Se offline, tenta servir do cache como fallback
        return caches.match(event.request);
      })
    );
    return;
  }
  // Tudo mais (JS, CSS, imagens) → rede direta, sem interceptar
});
