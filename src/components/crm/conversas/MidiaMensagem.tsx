// Mídia dentro da bolha: imagem com prévia e ampliação, áudio com player e duração,
// vídeo, documento com nome, tipo e tamanho.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, FileText, Loader2, Pause, Play } from "lucide-react";
import { baixarNaFila, linkJaBaixado } from "@/lib/crm/filaAudio";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { audioSobDemanda, formatarBytes, formatarDuracao, midiaSobDemanda, tipoMidia, type MensagemCRM } from "@/lib/crm/conversas";

/**
 * Fica true quando o elemento chega perto da tela, e não volta (21/10/2026): áudio, vídeo e documento só
 * vão à rede quando aparecem — abrir uma conversa não baixa a mídia de 50 mensagens de uma vez.
 */
function useNaTela<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [visto, setVisto] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visto || !ref.current) return;
    const obs = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setVisto(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visto]);
  return [ref, visto];
}

interface Props {
  msg: MensagemCRM;
  tamanhoArquivo?: (url: string) => Promise<number | null>;
  /** Mídia importada só com metadado: baixa na hora (media-id) e devolve o link; null = indisponível. */
  baixarMidia?: (msg: MensagemCRM) => Promise<string | null>;
  /** Áudio ainda não baixado: baixa sozinho quando a bolha aparece na tela (fila de 2 por vez). */
  autoBaixarAudio?: boolean;
}

export function MidiaMensagem({ msg, tamanhoArquivo, baixarMidia, autoBaixarAudio }: Props) {
  const [baixada, setBaixada] = useState<string | null>(() => (msg.message_id ? linkJaBaixado(msg.message_id) : null));
  const [estado, setEstado] = useState<"parado" | "baixando" | "indisponivel" | "erro">("parado");
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const caixa = useRef<HTMLSpanElement>(null);
  const [visivel, setVisivel] = useState(false);
  const ehAudio = audioSobDemanda(msg);
  const tentou = useRef(false);

  // só o que está na tela: IntersectionObserver na bolha do áudio ainda não baixado
  useEffect(() => {
    if (!autoBaixarAudio || !ehAudio || baixada || !caixa.current || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((es) => setVisivel(es.some((e) => e.isIntersecting)), { rootMargin: "100px" });
    obs.observe(caixa.current);
    return () => obs.disconnect();
  }, [autoBaixarAudio, ehAudio, baixada]);

  const baixar = async () => {
    if (!baixarMidia || !msg.message_id) return;
    setEstado("baixando");
    setErroMsg(null);
    try {
      const link = await baixarNaFila(msg.message_id, () => baixarMidia(msg));
      if (link) setBaixada(link);
      else setEstado("indisponivel");
    } catch (e) {
      setErroMsg(e instanceof Error && e.message ? e.message : "falha ao baixar");
      setEstado("erro");
    }
  };

  // uma única tentativa automática por bolha; erro volta o botão manual
  useEffect(() => {
    if (!visivel || !autoBaixarAudio || !ehAudio || baixada || tentou.current) return;
    tentou.current = true;
    void baixar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visivel, autoBaixarAudio, ehAudio, baixada]);
  const comUrl = baixada && !msg.media_url ? { ...msg, media_url: baixada } : msg;
  const tipo = tipoMidia(comUrl);
  const url = comUrl.media_url;
  if (!url && baixarMidia && midiaSobDemanda(msg)) {
    if (estado === "indisponivel") {
      return <span className="block mb-1 text-[11px] italic opacity-70">mídia indisponível (o WhatsApp não entregou o arquivo)</span>;
    }
    return (
      <span ref={caixa} className="block">
        <button
          type="button"
          onClick={baixar}
          disabled={estado === "baixando"}
          data-testid="baixar-midia"
          className="flex items-center gap-1.5 mb-1 rounded-md bg-black/5 dark:bg-white/5 px-2 py-1.5 text-xs hover:bg-black/10 disabled:opacity-70"
        >
          {estado === "baixando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {estado === "baixando" ? "baixando do WhatsApp…" : "Baixar mídia"}
        </button>
        {estado === "erro" && (
          <span data-testid="erro-midia" className="block mb-1 text-[11px] italic opacity-70">não consegui baixar ({erroMsg})</span>
        )}
      </span>
    );
  }
  if (!url && (msg.media_status === "pendente" || msg.media_status === "falhou")) {
    return (
      <span className="block mb-1 text-[11px] italic opacity-70">
        {msg.media_status === "pendente" ? "baixando a mídia do WhatsApp…" : "mídia indisponível (o WhatsApp não entregou o arquivo)"}
      </span>
    );
  }
  if (!url || !tipo) return null;
  if (tipo === "sticker") return <FigurinhaMensagem url={url} />;
  if (tipo === "image") return <ImagemMensagem url={url} alt={msg.caption || "imagem"} />;
  if (tipo === "audio") return <AudioMensagem url={url} />;
  if (tipo === "video") return <VideoMensagem url={url} />;
  if (tipo === "document") return <DocumentoMensagem msg={msg} url={url} tamanhoArquivo={tamanhoArquivo} />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline text-xs block mb-1">
      abrir mídia
    </a>
  );
}

/** Figurinha como no WhatsApp: sem bolha, ~140px; webp animado anima sozinho no <img>. */
function FigurinhaMensagem({ url }: { url: string }) {
  return <img src={url} alt="figurinha" loading="lazy" data-testid="figurinha" className="h-[140px] w-[140px] object-contain" />;
}

function ImagemMensagem({ url, alt }: { url: string; alt: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className="block mb-1 -mx-1 -mt-1 overflow-hidden rounded-md">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="max-h-80 w-full min-w-48 object-cover"
        />
      </button>
      <Dialog open={aberta} onOpenChange={setAberta}>
        <DialogContent className="max-w-4xl p-2 bg-black/90 border-none">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={url} alt={alt} className="max-h-screen w-full object-contain" />
          <a href={url} target="_blank" rel="noopener noreferrer" download className="text-xs text-white/80 underline text-center">
            Abrir original
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VideoMensagem({ url }: { url: string }) {
  const [caixa, naTela] = useNaTela<HTMLVideoElement>();
  return <video ref={caixa} controls preload={naTela ? "metadata" : "none"} src={url} className="rounded-md w-full max-h-80 mb-1 bg-black" />;
}

function AudioMensagem({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [caixa, naTela] = useNaTela<HTMLDivElement>();
  const [tocando, setTocando] = useState(false);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [atual, setAtual] = useState(0);

  const alternar = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setTocando(false));
    else a.pause();
  };

  return (
    <div ref={caixa} className="flex items-center gap-3 w-64 max-w-full py-1 mb-1">
      <audio
        ref={ref}
        src={url}
        preload={naTela ? "metadata" : "none"}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuracao(d);
        }}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setAtual(0); }}
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? "Pausar áudio" : "Tocar áudio"}
        className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center crm-chat-meta hover:opacity-80"
      >
        {tocando ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
      </button>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duracao ?? 0}
          step={0.1}
          value={Math.min(atual, duracao ?? 0)}
          onChange={(e) => {
            const a = ref.current;
            if (a) a.currentTime = Number(e.target.value);
            setAtual(Number(e.target.value));
          }}
          aria-label="Posição do áudio"
          className="w-full crm-audio-faixa"
        />
        <div className="text-xs crm-chat-meta tabular-nums">
          {tocando || atual > 0 ? formatarDuracao(atual) : formatarDuracao(duracao)}
        </div>
      </div>
    </div>
  );
}

function DocumentoMensagem({ msg, url, tamanhoArquivo }: { msg: MensagemCRM; url: string; tamanhoArquivo?: Props["tamanhoArquivo"] }) {
  const [tamanho, setTamanho] = useState<number | null>(null);
  const [caixa, naTela] = useNaTela<HTMLAnchorElement>();
  useEffect(() => {
    if (!naTela) return;
    let vivo = true;
    tamanhoArquivo?.(url).then((n) => vivo && setTamanho(n));
    return () => { vivo = false; };
  }, [url, tamanhoArquivo, naTela]);

  const nome = msg.file_name || "Documento";
  const ext = (nome.includes(".") ? nome.split(".").pop() : msg.mime_type?.split("/").pop())?.toUpperCase() ?? "";
  const detalhe = [ext, formatarBytes(tamanho)].filter(Boolean).join(" · ");

  return (
    <a
      ref={caixa}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={msg.file_name || true}
      className="flex items-center gap-3 rounded-md bg-black/5 dark:bg-white/5 p-2 mb-1 w-64 max-w-full hover:bg-black/10"
    >
      <FileText className="h-8 w-8 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{nome}</p>
        {detalhe && <p className="text-xs crm-chat-meta">{detalhe}</p>}
      </div>
      <Download className="h-5 w-5 shrink-0 crm-chat-meta" />
    </a>
  );
}
