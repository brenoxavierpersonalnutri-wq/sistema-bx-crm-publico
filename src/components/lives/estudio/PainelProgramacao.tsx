// Aba "Programação": data e hora da live, live PROGRAMADA no YouTube (título, descrição, privacidade com padrão
// "Não listado", miniatura, playlist) com o link youtu.be para divulgar, vídeo da aula e "iniciar sozinho".
// Sem vídeo, na hora o painel avisa "começa agora — entre no estúdio". Reprises (várias datas, recorrência): PainelReprises.
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LiveDestino } from "@/lib/lives/api";
import { garantirYoutube, listarContasYt, PRIVACIDADES_YT, type PrivacidadeYt } from "@/lib/lives/youtube";
import { arquivoParaBase64, liveAula, listarVideosAtualizados, paraDatetimeLocal, type LinkProgramado, type LiveVideo } from "@/lib/lives/aula";
import { formatarDuracao, type LiveRoomExtra } from "@/lib/lives/painel";
import { PainelReprises } from "@/components/lives/estudio/PainelReprises";
import { MiniaturaYt } from "@/components/lives/estudio/MiniaturaYt";
import { PainelSemana } from "@/components/lives/estudio/PainelSemana";

const SEM_PLAYLIST = "__nenhuma";
const miniaturaPorSala = new Map<string, File>();
const SEM_VIDEO = "__nenhum";

export function PainelProgramacao({ sala, destinos, recarregar, demo }: {
  sala: LiveRoomExtra;
  destinos: LiveDestino[];
  recarregar: () => void;
  demo?: boolean;
}) {
  const yt = destinos.find((d) => d.modo === "youtube_api" && d.ativo) ?? null;
  const [quando, setQuando] = useState(paraDatetimeLocal(sala.agendada_em));
  const [titulo, setTitulo] = useState(yt?.yt_titulo ?? sala.titulo.slice(0, 100));
  const [descricao, setDescricao] = useState(yt?.yt_descricao ?? sala.descricao ?? "");
  const [privacidade, setPrivacidade] = useState<PrivacidadeYt>((yt?.yt_privacidade as PrivacidadeYt) ?? "unlisted");
  const [playlists, setPlaylists] = useState<{ id: string; titulo: string }[]>([]);
  const [playlist, setPlaylist] = useState(yt?.yt_playlist_id ?? SEM_PLAYLIST);
  // a imagem escolhida sobrevive se o painel remontar (troca de aba, estúdio re-renderizando com o LiveKit)
  const [miniatura, setMiniaturaEstado] = useState<File | null>(() => miniaturaPorSala.get(sala.id) ?? null);
  const setMiniatura = (f: File | null) => {
    if (f) miniaturaPorSala.set(sala.id, f);
    else miniaturaPorSala.delete(sala.id);
    setMiniaturaEstado(f);
  };
  const [videos, setVideos] = useState<LiveVideo[]>([]);
  const [videoId, setVideoId] = useState(sala.aula_video_id ?? SEM_VIDEO);
  const [auto, setAuto] = useState(!!sala.auto_iniciar);
  const [salvando, setSalvando] = useState(false);
  const [links, setLinks] = useState<LinkProgramado[]>([]);
  const [temConta, setTemConta] = useState(false);
  const [usandoCanal, setUsandoCanal] = useState(false);

  useEffect(() => {
    if (demo) return;
    listarVideosAtualizados().then((v) => setVideos(v.filter((x) => x.status === "pronto"))).catch(() => setVideos([]));
  }, [demo]);
  useEffect(() => {
    if (demo || !yt?.yt_conta_id) return;
    liveAula<{ playlists: { id: string; titulo: string }[] }>("yt-playlists", { yt_conta_id: yt.yt_conta_id })
      .then((r) => setPlaylists(r.playlists ?? []))
      .catch(() => setPlaylists([]));
  }, [demo, yt?.yt_conta_id]);

  useEffect(() => {
    if (demo || yt) return;
    listarContasYt().then((c) => setTemConta(c.some((x) => x.status === "conectado"))).catch(() => setTemConta(false));
  }, [demo, yt]);

  // sem destino YouTube na sala (ou desligado) e com conta conectada: cria/religa na hora e segue a programação
  const usarCanal = async () => {
    setUsandoCanal(true);
    try {
      const r = await garantirYoutube(sala.id, { ativar: true });
      if (!r) return toast.error("Não consegui adicionar o canal agora. Tente de novo ou use a aba Destinos.");
      if (!r.criado && !r.ativado && r.motivo === "sem_conta") return toast.error("Nenhuma conta do YouTube conectada: conecte na aba Destinos.");
      if (r.motivo === "no_ar") return toast.error("A live está no ar: encerre antes de trocar os destinos.");
      if (r.motivo === "webinario") return toast.error("Esta sala é de um webinário: o YouTube entra só pela aba Destinos.");
      toast.success("Canal do YouTube nesta live (Não listado)");
      recarregar();
      if (quando) await programar();
    } finally {
      setUsandoCanal(false);
    }
  };

  const linkAtual = useMemo(() => (yt?.yt_estado === "agendado" && yt.yt_video_id ? `https://youtu.be/${yt.yt_video_id}` : null), [yt]);
  const temVideo = videoId !== SEM_VIDEO;
  const videoEscolhido = videos.find((v) => v.id === videoId);

  // o que a programação e as reprises herdam da aba
  const campos = async () => ({
    auto_iniciar: temVideo && auto,
    aula_video_id: temVideo ? videoId : null,
    titulo,
    descricao,
    privacidade,
    playlist_id: playlist === SEM_PLAYLIST ? null : playlist,
    miniatura: miniatura ? { base64: await arquivoParaBase64(miniatura), mime: miniatura.type } : null,
  });
  const corpo = async (data: string) => ({ agendada_em: new Date(data).toISOString(), ...(await campos()) });

  const mostrarAvisos = (avisos?: string[]) => (avisos ?? []).forEach((a) => toast.warning(a, { duration: 10_000 }));

  const programar = async () => {
    if (!quando) return toast.error("Escolha data e hora");
    if (miniatura && miniatura.size > 2 * 1024 * 1024) return toast.error("Miniatura acima de 2 MB (limite do YouTube)");
    setSalvando(true);
    try {
      const r = await liveAula<{ links: LinkProgramado[]; avisos: string[] }>("programar", { room_id: sala.id, ...(await corpo(quando)) });
      setLinks(r.links ?? []);
      toast.success(r.links?.length ? "Live programada no YouTube" : "Data salva");
      mostrarAvisos(r.avisos);
      setMiniatura(null);
      recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const cancelar = async () => {
    if (!confirm("Cancelar a programação? A live programada some do canal do YouTube (o link deixa de valer).")) return;
    setSalvando(true);
    try {
      const r = await liveAula<{ avisos: string[] }>("cancelar-programacao", { room_id: sala.id });
      mostrarAvisos(r.avisos);
      setLinks([]);
      setQuando("");
      toast.success("Programação cancelada");
      recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const copiar = (l: string) => navigator.clipboard.writeText(l).then(() => toast.success("Link copiado"));
  const listaLinks = links.length ? links.map((l) => ({ nome: l.nome, link: l.link })) : linkAtual ? [{ nome: yt?.nome ?? "YouTube", link: linkAtual }] : [];

  return (
    <div className="space-y-4">
      {sala.agenda_erro && <p className="rounded border border-red-300/60 bg-red-50 p-2 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-300">Agenda: {sala.agenda_erro}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="prog-quando">Data e hora</Label>
        <Input id="prog-quando" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
      </div>

      {yt ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="text-sm font-medium">{yt.nome}</div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-titulo">Título no YouTube</Label>
            <Input id="prog-titulo" maxLength={100} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-desc">Descrição</Label>
            <Textarea id="prog-desc" rows={3} maxLength={5000} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Privacidade</Label>
            <Select value={privacidade} onValueChange={(v) => setPrivacidade(v as PrivacidadeYt)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIVACIDADES_YT.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Playlist (opcional)</Label>
            <Select value={playlist} onValueChange={setPlaylist}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_PLAYLIST}>Nenhuma</SelectItem>
                {playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.titulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <MiniaturaYt valor={miniatura} onChange={setMiniatura} jaEnviada={!!yt.yt_miniatura_ok} />
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-xs text-muted-foreground">
            {temConta
              ? "Esta live ainda não transmite no seu canal do YouTube. Adicione com um clique (Não listado) e a programação gera o link."
              : "Para gerar a live programada e o link no YouTube, conecte o canal na aba Destinos."}
          </p>
          {temConta && (
            <Button size="sm" variant="secondary" disabled={usandoCanal || demo} onClick={usarCanal}>
              {usandoCanal ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Usar meu canal do YouTube nesta live
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-lg border p-3">
        <Label>Vídeo da aula</Label>
        <Select value={videoId} onValueChange={(v) => { setVideoId(v); if (v === SEM_VIDEO) setAuto(false); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_VIDEO}>Nenhum (vou apresentar ao vivo)</SelectItem>
            {videos.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}{v.duracao_seg ? ` (${formatarDuracao(v.duracao_seg)})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-start gap-2">
          <Switch id="prog-auto" checked={temVideo && auto} disabled={!temVideo} onCheckedChange={setAuto} />
          <Label htmlFor="prog-auto" className="text-sm font-normal leading-snug">
            Iniciar sozinho na hora agendada
            <span className="block text-xs text-muted-foreground">
              {temVideo
                ? `Na hora, a transmissão liga, o vídeo${videoEscolhido?.duracao_seg ? ` (${formatarDuracao(videoEscolhido.duracao_seg)})` : ""} toca no palco com seus banners e, quando ele acabar, a live encerra.`
                : "Só com vídeo da aula. Sem vídeo, na hora o painel avisa para você entrar no estúdio."}
            </span>
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={salvando || demo} onClick={programar}>
          {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
          {sala.agendada_em ? "Atualizar programação" : "Programar"}
        </Button>
        {sala.agendada_em && <Button variant="ghost" disabled={salvando || demo} onClick={cancelar}>Cancelar programação</Button>}
      </div>

      {listaLinks.length > 0 && (
        <div className="space-y-1.5">
          <Label>Link para divulgar</Label>
          {listaLinks.map((l) => (
            <div key={l.link} className="flex items-center gap-1.5">
              <Input readOnly value={l.link} className="h-8 text-xs" aria-label={`Link ${l.nome}`} />
              <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label="Copiar link" onClick={() => copiar(l.link)}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Abrir no YouTube" asChild><a href={l.link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
            </div>
          ))}
        </div>
      )}

      <PainelReprises
        salaId={sala.id}
        corpoBase={campos}
        temMiniatura={!!miniatura}
        temPlaylist={playlist !== SEM_PLAYLIST}
        destinosYt={destinos.filter((d) => d.modo === "youtube_api" && d.ativo).length}
        contaYtDaLive={yt?.yt_conta_id ?? null}
        demo={demo}
      />
      <PainelSemana salaId={sala.id} videos={videos} playlists={playlists} temCanal={!!yt} contaYtDaLive={yt?.yt_conta_id ?? null} demo={demo} />
    </div>
  );
}
