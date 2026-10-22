// Tema das telas de Lives: claro por padrão (como os estúdios de transmissão), escuro opcional e
// "automático" (segue o sistema). A escolha fica no navegador; a classe vai no <html> para os portais herdarem.
import { useCallback, useEffect, useState } from "react";
import "@/components/lives/tema/lives-tema.css";

export type PreferenciaTema = "auto" | "claro" | "escuro";
const CHAVE = "lives:tema";
const EVENTO = "lives:tema";

function lerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === "claro" || v === "escuro" || v === "auto" ? v : "claro";
  } catch {
    return "claro";
  }
}

function escuroAgora(p: PreferenciaTema) {
  if (p === "escuro") return true;
  if (p === "claro") return false;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/**
 * Liga o tema de Lives no <html> enquanto a tela está aberta e devolve a preferência e o setter.
 * forcarEscuro: telas de câmera (a prévia antes de entrar) ficam sempre escuras, como nos apps de vídeo.
 */
export function useTemaLives(forcarEscuro = false) {
  const [pref, setPref] = useState<PreferenciaTema>(lerPreferencia);
  useEffect(() => {
    const ouvir = () => setPref(lerPreferencia());
    window.addEventListener(EVENTO, ouvir);
    return () => window.removeEventListener(EVENTO, ouvir);
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    const tinhaDark = html.classList.contains("dark");
    const aplicar = () => html.classList.toggle("dark", forcarEscuro || escuroAgora(pref));
    html.classList.add("lives-sy");
    aplicar();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", aplicar);
    return () => {
      mq?.removeEventListener?.("change", aplicar);
      html.classList.remove("lives-sy");
      html.classList.toggle("dark", tinhaDark);
    };
  }, [pref, forcarEscuro]);
  const trocar = useCallback((p: PreferenciaTema) => {
    try {
      localStorage.setItem(CHAVE, p);
    } catch {
      /* navegador sem armazenamento: vale só nesta tela */
    }
    setPref(p);
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return { pref, trocar, escuro: forcarEscuro || escuroAgora(pref) };
}

/** Compatibilidade: telas antigas chamavam o hook do tema escuro; agora aplica o tema de Lives. */
export function useTemaEscuro() {
  useTemaLives();
}
