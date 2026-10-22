// Mídia da linha do tempo da edição: miniaturas de um vídeo em instantes pedidos e a forma de onda do áudio.
// Tudo no navegador, a partir das prévias leves (640 px) da VPS ou dos arquivos deste aparelho.
import { useEffect, useRef, useState } from "react";

/** Miniaturas nos instantes pedidos: um <video> escondido, um quadro por vez, em JPEG pequeno. Chave = t.toFixed(1). */
export function useMiniaturas(src: string | null, tempos: number[], remoto: boolean, largura = 72): Record<string, string> {
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const feitas = useRef<Record<string, string>>({});
  const chave = Array.from(new Set(tempos.map((t) => t.toFixed(1)))).sort().join(",");
  useEffect(() => { feitas.current = {}; setMapa({}); }, [src]);
  useEffect(() => {
    if (!src || !chave || typeof document === "undefined") return;
    let vivo = true;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    if (remoto) v.crossOrigin = "anonymous";
    v.src = src;
    const canvas = document.createElement("canvas");
    const fila = chave.split(",").filter((k) => !feitas.current[k]);
    const proximo = () => {
      if (!vivo) return;
      const k = fila.shift();
      if (k === undefined) return;
      const alvo = Math.min(Number(k), Math.max(0, (v.duration || Number(k)) - 0.1));
      const pronto = () => {
        v.removeEventListener("seeked", pronto);
        try {
          const w = largura;
          const h = Math.round((w * (v.videoHeight || 16)) / (v.videoWidth || 9));
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
          feitas.current[k] = canvas.toDataURL("image/jpeg", 0.6);
          if (vivo) setMapa({ ...feitas.current });
        } catch {
          fila.length = 0;   // vídeo sem CORS: fica sem miniatura, a tela segue
          return;
        }
        proximo();
      };
      v.addEventListener("seeked", pronto);
      v.currentTime = alvo;
    };
    v.addEventListener("loadeddata", () => proximo(), { once: true });
    v.addEventListener("error", () => { fila.length = 0; }, { once: true });
    return () => { vivo = false; v.removeAttribute("src"); v.load(); };
  }, [src, chave, remoto, largura]);
  return mapa;
}

export const PASSO_ONDA = 0.05;

/** Pico do áudio a cada 50 ms (0..1), decodificado do arquivo inteiro. null enquanto carrega ou se falhar. */
export function useOnda(src: string | null): Float32Array | null {
  const [picos, setPicos] = useState<Float32Array | null>(null);
  useEffect(() => {
    setPicos(null);
    if (!src || typeof window === "undefined") return;
    let vivo = true;
    void (async () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const buf = await (await fetch(src)).arrayBuffer();
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close().catch(() => undefined);
        const ch = audio.getChannelData(0);
        const por = Math.max(1, Math.round(audio.sampleRate * PASSO_ONDA));
        const n = Math.ceil(ch.length / por);
        const out = new Float32Array(n);
        let max = 0;
        for (let i = 0; i < n; i += 1) {
          let m = 0;
          const fim = Math.min(ch.length, (i + 1) * por);
          for (let j = i * por; j < fim; j += 4) { const a = Math.abs(ch[j]); if (a > m) m = a; }
          out[i] = m;
          if (m > max) max = m;
        }
        if (max > 0) for (let i = 0; i < n; i += 1) out[i] = Math.sqrt(out[i] / max);   // raiz: fala baixa ainda aparece
        if (vivo) setPicos(out);
      } catch {
        /* sem onda: a faixa mostra só as falas */
      }
    })();
    return () => { vivo = false; };
  }, [src]);
  return picos;
}
