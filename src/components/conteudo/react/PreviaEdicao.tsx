// Prévia CONTÍNUA da tela de edição: toca o vídeo inteiro como vai sair da montagem, sem parar entre blocos. Os dois
// vídeos (prévias leves da VPS ou os arquivos deste aparelho) tocam juntos e, a cada quadro, o pedaço do plano
// (src/lib/conteudo/react/plano.ts) diz o layout, se o original está parado, o som do original e para onde pular
// (gancho, trecho removido, corte da IA, silêncio). O relógio exposto é o do VÍDEO FINAL (tempo de saída).
// Os dois vídeos preenchem a área deles (object-fit: cover), igual à montagem: nunca sobra faixa preta.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { Snowflake, VolumeX } from "lucide-react";
import type { LayoutPrevia, TrechoEd } from "@/lib/conteudo/react/edicao";
import { duracaoSaida, pedacoEmSaida, quadroEm, type Pedaco, type QuadroPrevia } from "@/lib/conteudo/react/plano";

export interface PreviaHandle {
  tocar: () => void;
  pausar: () => void;
  /** vai para o segundo s do vídeo final */
  ir: (s: number) => void;
  tocando: () => boolean;
}

export interface TituloPrevia { texto: string; estilo: "caixa" | "gancho"; ate: number | null }

interface Props {
  srcOriginal: string | null;
  srcReacao: string | null;
  /** fontes da VPS (precisam de crossOrigin para o volume por Web Audio funcionar) */
  remoto: boolean;
  trechos: TrechoEd[];
  plano: Pedaco[];
  titulo: TituloPrevia | null;
  onTempo: (s: number) => void;
  onTocando: (tocando: boolean) => void;
}

const ESCONDIDO: CSSProperties = { opacity: 0, pointerEvents: "none", top: 0, left: 0, width: "10%", height: "10%" };
const COVER: CSSProperties = { objectFit: "cover" };
// rosto um pouco acima do centro, como o crop do montagem.py ((ih-oh)*0.35)
const ELE: CSSProperties = { objectFit: "cover", objectPosition: "50% 35%" };

/**
 * Posição dos dois vídeos no quadro 9:16 para cada layout (as proporções do montagem.py, 1080x1920): dividido = painel
 * 1080x960 em cima; canto dele = 372x492 a 48 px da direita, y 110 (330 com título); quadrinho do original = 444x396.
 */
export function estilosLayout(l: LayoutPrevia, comTitulo = false): { orig: CSSProperties; ele: CSSProperties } {
  const cheio: CSSProperties = { top: 0, left: 0, width: "100%", height: "100%" };
  const y = comTitulo ? "17.2%" : "5.7%";
  switch (l) {
    case "ele": return { orig: ESCONDIDO, ele: { ...cheio, ...ELE } };
    case "original": return { orig: { ...cheio, ...COVER }, ele: ESCONDIDO };
    case "original_pip": return {
      orig: { ...cheio, ...COVER },
      ele: { ...ELE, top: y, right: "4.4%", left: "auto", width: "34.4%", height: "25.6%", border: "2px solid white", zIndex: 2 },
    };
    case "cheia": return {
      orig: { ...COVER, top: y, left: "4.4%", width: "41.1%", height: "20.6%", border: "2px solid white", zIndex: 2 },
      ele: { ...cheio, ...ELE },
    };
    default: return { orig: { ...COVER, top: 0, left: 0, width: "100%", height: "50%" }, ele: { ...ELE, top: "50%", left: 0, width: "100%", height: "50%" } };
  }
}

const mesmo = (a: QuadroPrevia | null, b: QuadroPrevia | null) =>
  !!a && !!b && a.i === b.i && a.layout === b.layout && a.congelado === b.congelado && Math.abs(a.volume - b.volume) < 0.005;

export const PreviaEdicao = forwardRef<PreviaHandle, Props>(function PreviaEdicao(
  { srcOriginal, srcReacao, remoto, trechos, plano, titulo, onTempo, onTocando }, ref,
) {
  const vO = useRef<HTMLVideoElement>(null);
  const vE = useRef<HTMLVideoElement>(null);
  const audio = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const raf = useRef<number | null>(null);
  const tocandoRef = useRef(false);
  const pi = useRef(0);
  const sRef = useRef(0);
  const dados = useRef({ trechos, plano });
  dados.current = { trechos, plano };
  const cb = useRef({ onTempo, onTocando });
  cb.current = { onTempo, onTocando };
  const [quadro, setQuadro] = useState<QuadroPrevia | null>(null);
  const [s, setS] = useState(0);

  /** Volume do original: GainNode (o iPhone ignora video.volume); sem Web Audio, cai para volume/muted. */
  const ligarAudio = useCallback(() => {
    const o = vO.current;
    if (!o || audio.current) { void audio.current?.ctx.resume(); return; }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(o).connect(gain).connect(ctx.destination);
      audio.current = { ctx, gain };
      void ctx.resume();
    } catch {
      audio.current = null;
    }
  }, []);

  const volume = useCallback((v: number) => {
    const o = vO.current;
    if (!o) return;
    if (audio.current) {
      audio.current.gain.gain.value = v;
      o.muted = false;
    } else {
      try { o.volume = Math.max(0, Math.min(1, v)); } catch { /* iPhone: só leitura */ }
      o.muted = v <= 0.001;
    }
  }, []);

  /** Põe os dois vídeos no ponto s da saída (o original segue o trecho; congelado = parado no quadro dele). */
  const sincronizar = useCallback((sx: number, rodando: boolean) => {
    const { trechos: tr, plano: pl } = dados.current;
    const q = quadroEm(pl, tr, sx);
    setQuadro((ant) => (mesmo(ant, q) ? ant : q));
    const o = vO.current;
    if (!o || !q) return;
    volume(q.volume);
    if (q.congelado || !rodando) {
      if (!o.paused) o.pause();
      if (Math.abs(o.currentTime - q.orig) > 0.04 && !o.seeking) o.currentTime = q.orig;
    } else {
      if (Math.abs(o.currentTime - q.orig) > 0.3 && !o.seeking) o.currentTime = q.orig;
      if (o.paused) void o.play().catch(() => undefined);
    }
  }, [volume]);

  const publicar = (sx: number) => {
    sRef.current = sx;
    setS(sx);
    cb.current.onTempo(sx);
  };

  const pausar = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    vE.current?.pause();
    vO.current?.pause();
    tocandoRef.current = false;
    cb.current.onTocando(false);
  }, []);

  // um quadro: onde a câmera dele está -> pedaço do plano -> tempo de saída; acabou o pedaço = pula para o próximo
  const passo = useCallback(() => {
    const v = vE.current;
    if (!v || !tocandoRef.current) return;
    const pl = dados.current.plano;
    let p = pl[pi.current];
    if (!p) { pausar(); return; }
    let t = v.currentTime;
    if (t >= p.fim - 0.015 || v.ended) {
      pi.current += 1;
      p = pl[pi.current];
      if (!p) { publicar(duracaoSaida(pl)); pausar(); return; }
      if (Math.abs(v.currentTime - p.ini) > 0.06) v.currentTime = p.ini;   // gancho, removido, corte, silêncio: pula
      t = p.ini;
      if (v.paused) void v.play().catch(() => undefined);
    }
    const sx = p.s0 + Math.max(0, Math.min(p.fim, t) - p.ini);
    sincronizar(sx, true);
    publicar(sx);
    raf.current = requestAnimationFrame(passo);
  }, [pausar, sincronizar]);

  const ir = useCallback((sx: number) => {
    const v = vE.current;
    const pl = dados.current.plano;
    const alvo = Math.max(0, Math.min(sx, duracaoSaida(pl)));
    const i = pedacoEmSaida(pl, alvo);
    if (!v || i < 0) { publicar(alvo); return; }
    pi.current = i;
    const p = pl[i];
    v.currentTime = Math.min(p.fim - 0.02, p.ini + (alvo - p.s0));
    sincronizar(alvo, tocandoRef.current);
    publicar(alvo);
  }, [sincronizar]);

  const tocar = useCallback(() => {
    const v = vE.current;
    const o = vO.current;
    const pl = dados.current.plano;
    if (!v || !o || !pl.length) return;
    ligarAudio();
    if (sRef.current >= duracaoSaida(pl) - 0.05) ir(0);       // no fim: recomeça
    else ir(sRef.current);
    // os dois play() no mesmo toque: o iPhone só deixa tocar com som assim
    void o.play().then(() => {
      const q = quadroEm(dados.current.plano, dados.current.trechos, sRef.current);
      if (q?.congelado) o.pause();
    }).catch(() => undefined);
    tocandoRef.current = true;
    cb.current.onTocando(true);
    void v.play().then(() => {
      if (raf.current === null) raf.current = requestAnimationFrame(passo);
    }).catch(() => pausar());
  }, [ir, ligarAudio, passo, pausar]);

  useImperativeHandle(ref, () => ({ tocar, pausar, ir, tocando: () => tocandoRef.current }), [tocar, pausar, ir]);

  // escolhas mudaram (plano novo): redesenha no ponto atual, parado ou tocando
  useEffect(() => {
    const pl = plano;
    const alvo = Math.min(sRef.current, duracaoSaida(pl));
    pi.current = Math.max(0, pedacoEmSaida(pl, alvo));
    if (!tocandoRef.current && vE.current) ir(alvo);
  }, [plano, trechos, ir]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    void audio.current?.ctx.close().catch(() => undefined);
  }, []);

  const tituloVisivel = !!titulo?.texto && (titulo.ate === null || s < titulo.ate);
  const lay = estilosLayout(quadro?.layout ?? "dividido", tituloVisivel && titulo?.estilo === "caixa");
  const cross = remoto ? "anonymous" : undefined;
  return (
    <div data-testid="previa-edicao" data-layout={quadro?.layout ?? ""} data-bloco={quadro?.k ?? -1}
      className="relative h-full overflow-hidden rounded-lg bg-neutral-900" style={{ aspectRatio: "9 / 16", maxWidth: "100%" }}>
      {srcOriginal && (
        <video ref={vO} src={srcOriginal} crossOrigin={cross} playsInline preload="auto" muted={false} data-testid="previa-original"
          className="absolute bg-neutral-900" style={lay.orig} onLoadedData={() => ir(sRef.current)} />
      )}
      {srcReacao && (
        <video ref={vE} src={srcReacao} crossOrigin={cross} playsInline preload="auto" className="absolute bg-neutral-900" data-testid="previa-reacao"
          style={lay.ele} onLoadedData={() => ir(sRef.current)} />
      )}
      {tituloVisivel && titulo && (
        titulo.estilo === "caixa" ? (
          <span className="pointer-events-none absolute inset-x-[8%] top-[3.3%] z-10 mx-auto w-fit max-w-[84%] rounded bg-white px-2 py-0.5 text-center text-[11px] font-bold leading-tight text-black">
            {titulo.texto}
          </span>
        ) : (
          <span className="pointer-events-none absolute inset-x-[6%] top-[40%] z-10 text-center text-base font-black uppercase leading-tight text-white"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.8)" }}>{titulo.texto}</span>
        )
      )}
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 flex flex-col gap-1">
        {quadro?.gancho && <span className="rounded bg-fuchsia-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">GANCHO DA IA</span>}
        {quadro?.congelado && !quadro.gancho && <span className="flex items-center gap-1 rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"><Snowflake className="h-3 w-3" /> ORIGINAL PARADO</span>}
        {quadro && !quadro.congelado && quadro.volume < 0.995 && (
          <span className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {quadro.volume <= 0.001 ? <><VolumeX className="h-3 w-3" /> ORIGINAL MUDO</> : `SOM DO ORIGINAL ${Math.round(quadro.volume * 100)}%`}
          </span>
        )}
      </div>
      {(!srcOriginal || !srcReacao) && (
        <p className="absolute inset-x-3 top-1/2 z-30 -translate-y-1/2 rounded bg-black/70 p-2 text-center text-xs text-white">
          A prévia aparece quando a VPS terminar a primeira montagem (ou grave neste aparelho).
        </p>
      )}
    </div>
  );
});
