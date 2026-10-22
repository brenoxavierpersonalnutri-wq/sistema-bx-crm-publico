// Aba "Vídeo da aula": sobe um arquivo pré-gravado (MP4/MOV, até 8 GB) e toca como participante "Vídeo da aula"
// (LiveKit Ingress na VPS). Fica no palco com banners, marca e faixas, e o Egress leva para os destinos.
// Pausar não existe: o servidor lê o arquivo como uma transmissão; Parar e Tocar de novo recomeça do início.
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2, Play, Square, Trash2, Upload, ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import { concluirVideo, estadoVideo, formatarBytes, liveAula, listarVideos, subirVideo, textoVideoPendente, type LiveVideo } from "@/lib/lives/aula";
import { formatarDuracao, type LiveRoomExtra } from "@/lib/lives/painel";

export function PainelVideoAula({ sala, pessoas, onAlternarPalco, recarregar, demo }: {
  sala: LiveRoomExtra;
  pessoas: PessoaFila[];
  onAlternarPalco: (identity: string, subir: boolean) => void;
  recarregar: () => void;
  demo?: boolean;
}) {
  const [videos, setVideos] = useState<LiveVideo[]>([]);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [envio, setEnvio] = useState<{ nome: string; fracao: number } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [progresso, setProgresso] = useState<Record<string, number>>({});
  const cancelar = useRef<AbortController | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (demo) return;
    try {
      setVideos(await listarVideos());
      setErroLista(null);
    } catch (e) {
      setErroLista(/live_videos/.test((e as Error).message) ? "Falta rodar a migração do vídeo da aula (20261104100000)." : (e as Error).message);
    }
  }, [demo]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // vídeo convertendo na VPS (H.264 720p): pergunta a cada 10 s até ficar pronto ou dar erro
  const convertendo = videos.filter((v) => v.status === "convertendo").map((v) => v.id).join(",");
  useEffect(() => {
    if (!convertendo || demo) return;
    let vivo = true;
    const t = setInterval(async () => {
      let mudou = false;
      for (const id of convertendo.split(",")) {
        try {
          const r = await concluirVideo(id);
          if (!vivo) return;
          if (typeof r.progresso === "number") setProgresso((p) => ({ ...p, [id]: r.progresso as number }));
          if (r.video?.status === "pronto") toast.success(`"${r.video.nome}" pronto para tocar`);
          if (r.video?.status === "erro") toast.error(r.video.erro ?? "a conversão do vídeo falhou");
          if (r.video?.status !== "convertendo") mudou = true;
        } catch {
          mudou = true; // a edge marcou erro: a lista mostra o motivo
        }
      }
      if (vivo && mudou) carregar();
    }, 10_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [convertendo, demo, carregar]);

  const tocando = videos.find((v) => v.id === sala.aula_tocando_video) ?? null;
  const est = estadoVideo({ tocandoDesde: sala.aula_tocando_desde, duracaoSeg: tocando?.duracao_seg ?? null, agora });
  const pessoaAula = pessoas.find((p) => p.identity === sala.aula_identity);

  useEffect(() => {
    if (!sala.aula_tocando_desde) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sala.aula_tocando_desde]);
  // o vídeo acabou: o webhook limpa a sala; recarrega pra tela acompanhar
  useEffect(() => {
    if (est.fase !== "terminando") return;
    const t = setTimeout(recarregar, 5000);
    return () => clearTimeout(t);
  }, [est.fase, recarregar]);

  const enviar = async (f: File) => {
    cancelar.current = new AbortController();
    setEnvio({ nome: f.name, fracao: 0 });
    try {
      const v = await subirVideo(f, { roomId: sala.id, sinal: cancelar.current.signal, onProgresso: (fracao) => setEnvio({ nome: f.name, fracao }) });
      if (v.status === "convertendo") toast.info("Vídeo enviado. Convertendo para tocar no palco: aparece pronto aqui quando terminar (pode fechar a aba).");
      else if (v.status === "erro") toast.error(v.erro ?? "não consegui preparar o vídeo");
      else toast.success("Vídeo pronto para tocar");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
    } finally {
      setEnvio(null);
      carregar();
    }
  };

  const acao = async (chave: string, fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(chave);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
      recarregar();
      carregar();
    }
  };

  const tocar = (v: LiveVideo, palco: boolean) =>
    acao(`tocar:${v.id}`, () => liveAula("video-tocar", { room_id: sala.id, video_id: v.id, palco }), palco ? "Vídeo tocando no palco" : "Vídeo tocando nos bastidores");

  return (
    <div className="space-y-4">
      {sala.aula_tocando_video ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Clapperboard className="h-4 w-4 text-primary" /><span className="truncate">{tocando?.nome ?? "Vídeo da aula"}</span></div>
          <Progress value={(est.progresso ?? 0) * 100} aria-label="Andamento do vídeo" />
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatarDuracao(est.decorrido)}</span>
            <span>{est.restante != null ? `faltam ${formatarDuracao(est.restante)}` : ""}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {pessoaAula ? (pessoaAula.noPalco ? "No palco: está saindo na transmissão." : "Nos bastidores: só você vê.") : "Conectando o vídeo…"}
            {sala.aula_encerrar_ao_fim ? " A live encerra sozinha quando o vídeo acabar." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {pessoaAula && (
              <Button size="sm" variant="outline" onClick={() => onAlternarPalco(pessoaAula.identity, !pessoaAula.noPalco)}>
                {pessoaAula.noPalco ? <><ArrowDownToLine className="mr-1 h-4 w-4" />Tirar do palco</> : <><ArrowUpFromLine className="mr-1 h-4 w-4" />Colocar no palco</>}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={ocupado === "parar"} onClick={() => acao("parar", () => liveAula("video-parar", { room_id: sala.id }), "Vídeo parado")}>
              <Square className="mr-1 h-4 w-4" />Parar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Pausar não existe neste modo: o servidor toca o arquivo como transmissão. Parar e tocar de novo recomeça do início.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Suba a aula gravada e toque como se fosse ao vivo: o vídeo entra no palco com seus banners e sua marca.</p>
      )}

      <div className="space-y-2">
        <input ref={entrada} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) enviar(f);
        }} />
        {envio ? (
          <div className="space-y-1.5 rounded-lg border p-3">
            <div className="truncate text-sm">{envio.nome}</div>
            <Progress value={envio.fracao * 100} aria-label="Envio do vídeo" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular-nums">{Math.floor(envio.fracao * 100)}% enviado</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => cancelar.current?.abort()}>Cancelar</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Não feche esta aba. Se a internet cair, o envio continua de onde parou.</p>
          </div>
        ) : (
          <Button className="w-full" variant="outline" disabled={demo} onClick={() => entrada.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />Enviar vídeo (MP4 ou MOV, até 8 GB)
          </Button>
        )}
      </div>

      {erroLista && <p className="text-xs text-red-600">{erroLista}</p>}
      <ul className="space-y-2">
        {videos.map((v) => (
          <li key={v.id} className="rounded-lg border p-2.5">
            <div className="truncate text-sm font-medium">{v.nome}</div>
            <div className="text-xs text-muted-foreground">
              {v.status === "pronto" ? [v.duracao_seg ? formatarDuracao(v.duracao_seg) : null, formatarBytes(v.bytes), v.altura ? `${v.altura}p` : null].filter(Boolean).join(" · ")
                : textoVideoPendente(v, progresso[v.id])}
            </div>
            {v.status === "pronto" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8" disabled={!!ocupado} onClick={() => tocar(v, true)}>
                  {ocupado === `tocar:${v.id}` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}Tocar no palco
                </Button>
                <Button size="sm" variant="outline" className="h-8" disabled={!!ocupado} onClick={() => tocar(v, false)}>Nos bastidores</Button>
                <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label={`Apagar ${v.nome}`} disabled={!!ocupado} onClick={() => {
                  if (confirm(`Apagar "${v.nome}" do servidor?`)) acao(`apagar:${v.id}`, () => liveAula("video-apagar", { video_id: v.id }), "Vídeo apagado");
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
            {v.status !== "pronto" && (
              <div className="mt-2">
                <Button size="sm" variant="ghost" className="h-8" onClick={() => acao(`apagar:${v.id}`, () => liveAula("video-apagar", { video_id: v.id }))}>Remover</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
