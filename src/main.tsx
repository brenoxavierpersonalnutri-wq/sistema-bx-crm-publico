import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { recuperarDeChunkQueSumiu, textoDoErro } from "@/lib/recuperacaoDeChunk";
import { iniciarPreCargaConversas } from "@/lib/crm/preCarga";

// /crm/conversas: a lista começa a vir do banco agora, em paralelo com o login e o resto do JS (lib/crm/preCarga).
iniciarPreCargaConversas();

// Pedaço do app que sumiu depois de uma publicação: recarrega pra buscar os
// arquivos novos. A regra de quando recarregar está em lib/recuperacaoDeChunk.
// O evento "error" pega a falha de <script>; o import dinâmico que falha vira
// promessa rejeitada e só aparece em "unhandledrejection". Faltava o segundo,
// que é justamente o caso das rotas preguiçosas.
window.addEventListener("error", (e) => {
  recuperarDeChunkQueSumiu(e.message ?? "", (e as ErrorEvent).filename ?? "");
});

window.addEventListener("unhandledrejection", (e) => {
  recuperarDeChunkQueSumiu(textoDoErro(e.reason));
});

// O Vite avisa por este evento quando um import preguiçoso (ou o CSS dele)
// falha — é o primeiro a saber, antes da TelaComErro. Não chamamos
// preventDefault: o erro segue até a tela, que mostra o aviso se o teto de
// recargas estourar. Chamadas repetidas da mesma falha são ignoradas lá dentro.
window.addEventListener("vite:preloadError", (e) => {
  recuperarDeChunkQueSumiu(textoDoErro((e as Event & { payload?: unknown }).payload));
});

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA install support.
// Skip in iframes / Lovable preview to avoid stale-cache issues.
if ("serviceWorker" in navigator) {
  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const isPreviewHost =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com");

  if (isInIframe || isPreviewHost) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}
