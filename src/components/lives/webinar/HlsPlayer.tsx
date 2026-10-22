// Player HLS (Cloudflare Stream). Safari toca nativo; os demais via hls.js. Enquanto a live não
// começou o manifesto dá 404/vazio: tenta de novo a cada 5 s, sem travar a página.
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export function HlsPlayer({ src, className = "" }: { src: string | null; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [aguardando, setAguardando] = useState(true);
  const [mudo, setMudo] = useState(true);

  useEffect(() => {
    const el = video.current;
    if (!el || !src) return;
    let hls: Hls | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let vivo = true;

    const iniciar = () => {
      if (!vivo) return;
      if (Hls.isSupported()) {
        hls?.destroy();
        hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 2 });
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setAguardando(false);
          el.play().catch(() => null);
        });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) {
            setAguardando(true);
            hls?.destroy();
            hls = null;
            timer = setTimeout(iniciar, 5000);
          }
        });
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = src;
        el.onloadedmetadata = () => { setAguardando(false); el.play().catch(() => null); };
        el.onerror = () => { setAguardando(true); timer = setTimeout(() => { el.src = src; }, 5000); };
      }
    };
    iniciar();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      hls?.destroy();
    };
  }, [src]);

  return (
    <div className={`relative w-full aspect-video bg-black rounded-lg overflow-hidden ${className}`}>
      <video ref={video} className="w-full h-full" playsInline muted={mudo} controls={false} />
      {aguardando && (
        <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">A transmissão vai começar em instantes…</div>
      )}
      {!aguardando && mudo && (
        <button type="button" onClick={() => setMudo(false)} className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white text-black text-sm font-semibold shadow">
          Clique para ativar o som
        </button>
      )}
    </div>
  );
}
