// "Semana de aulas" (aba Programação): nome da semana = nome da playlist, 6 aulas (título, vídeo, dia e hora,
// miniatura opcional; pré-preenche 6 dias seguidos no mesmo horário), privacidade (padrão Não listado) e playlist nova
// ou existente. "Programar semana" cria a playlist e depois cada live NA ORDEM (uma chamada por aula, com progresso;
// cota acabou = para e mostra as que faltaram, com "Tentar de novo"). Lista as semanas com o link da playlist e os
// links youtu.be; "Repetir semana" preenche o formulário com a semana seguinte; "Cancelar semana".
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, Copy, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MiniaturaYt } from "@/components/lives/estudio/MiniaturaYt";
import { arquivoParaBase64, liveAula, type LiveVideo } from "@/lib/lives/aula";
import { PRIVACIDADES_YT, type PrivacidadeYt } from "@/lib/lives/youtube";
import { cn } from "@/lib/utils";
import { SeletorCanalYt } from "@/components/lives/SeletorCanalYt";
import { useContasYt } from "@/lib/lives/useContasYt";
import { COTA_DIARIA_YT, deLocalBrt, formatarBrt, paraLocalBrt, ROTULO_ESTADO_REPRISE, type EstadoReprise } from "../../../../supabase/functions/_shared/reprises.ts";
import {
  AULAS_PADRAO, custoSemana, datasSeguidas, deslocarAulas, MAX_AULAS, nomeDaSemana, programarEmOrdem, validarSemana,
} from "../../../../supabase/functions/_shared/semanaAulas.ts";

const NOVA = "__nova";
type Linha = { titulo: string; video_id: string; quando: string; miniatura: File | null };
type AulaListada = { id: string; ordem: number; titulo: string; agendada_em: string | null; video_id: string | null; estado: EstadoReprise; erro: string | null; link: string | null; pode_cancelar: boolean };
type Semana = { id: string; nome: string; privacidade: string; playlist_id: string | null; playlist_link: string | null; playlist_criada: boolean; aulas: AulaListada[] };
type Progresso = { semanaId: string; feitas: number; total: number; faltaram: { ordem: number; motivo: string }[] };

const linhaVazia = (): Linha => ({ titulo: "", video_id: "", quando: "", miniatura: null });

export function PainelSemana({ salaId, videos, playlists, temCanal, contaYtDaLive, demo }: {
  salaId: string;
  videos: LiveVideo[];
  playlists: { id: string; titulo: string }[];
  temCanal: boolean;
  /** canal do destino YouTube ligado nesta live (padrão do seletor) */
  contaYtDaLive?: string | null;
  demo?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const { contas, padrao } = useContasYt(aberto && !demo);
  const [canal, setCanal] = useState("");
  useEffect(() => setCanal(contaYtDaLive ?? padrao?.id ?? ""), [contaYtDaLive, padrao?.id]);
  // playlist existente é do canal desta live: com outro canal escolhido, só "criar nova"
  const outroCanal = contas.length > 1 && !!canal && canal !== contaYtDaLive;
  const [nome, setNome] = useState("");
  const [privacidade, setPrivacidade] = useState<PrivacidadeYt>("unlisted");
  const [playlist, setPlaylist] = useState(NOVA);
  const [inicio, setInicio] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(() => Array.from({ length: AULAS_PADRAO }, linhaVazia));
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (demo) return;
    try {
      setSemanas((await liveAula<{ semanas: Semana[] }>("semanas", { room_id: salaId })).semanas ?? []);
    } catch {
      setSemanas([]);
    }
  }, [salaId, demo]);
  useEffect(() => {
    if (aberto) carregar();
  }, [aberto, carregar]);

  const preencherDias = (ini: string) => {
    setInicio(ini);
    const ds = datasSeguidas(ini, linhas.length);
    if (!ds.length) return;
    setLinhas((l) => l.map((x, i) => ({ ...x, quando: ds[i] })));
    setNome((n) => nomeDaSemana(n, deLocalBrt(ds[0])));
  };
  const mudar = (i: number, p: Partial<Linha>) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const aulas = useMemo(() => linhas.map((l) => ({ titulo: l.titulo, video_id: l.video_id, agendada_em: deLocalBrt(l.quando)?.toISOString() ?? "", miniatura: !!l.miniatura })), [linhas]);
  const erro = validarSemana({ nome, aulas }, new Date());
  const cota = custoSemana({ aulas: linhas.length, criarPlaylist: playlist === NOVA, miniaturas: linhas.filter((l) => l.miniatura).length });

  /** Cria (ou completa) as aulas da semana, uma por vez e na ordem. */
  const enviarAulas = async (semanaId: string, alvo: { linha: Linha; ordem: number }[]) => {
    const r = await programarEmOrdem(alvo, async ({ linha, ordem }) => {
      const x = await liveAula<{ avisos: string[] }>("semana-aula", {
        semana_id: semanaId, ordem, titulo: linha.titulo, video_id: linha.video_id,
        agendada_em: deLocalBrt(linha.quando)?.toISOString(),
        miniatura: linha.miniatura ? { base64: await arquivoParaBase64(linha.miniatura), mime: linha.miniatura.type } : null,
      });
      (x.avisos ?? []).slice(0, 2).forEach((a) => toast.warning(`Aula ${ordem}: ${a}`, { duration: 8000 }));
    }, (feitas) => setProgresso({ semanaId, feitas, total: alvo.length, faltaram: [] }));
    setProgresso({ semanaId, feitas: r.feitas, total: alvo.length, faltaram: r.faltaram });
    return r;
  };

  const programar = async () => {
    if (erro) return toast.error(erro);
    if (!confirm(`Programar "${nome}": ${playlist === NOVA ? "criar a playlist e " : ""}${linhas.length} lives no YouTube (${PRIVACIDADES_YT.find((p) => p.valor === privacidade)?.rotulo})?`)) return;
    setEnviando(true);
    try {
      const s = await liveAula<{ semana_id: string; playlist_link: string }>("semana-criar", {
        room_id: salaId, nome, privacidade, playlist_id: playlist === NOVA || outroCanal ? null : playlist,
        ...(contas.length > 1 && canal ? { yt_conta_id: canal } : {}),
      });
      const r = await enviarAulas(s.semana_id, linhas.map((linha, i) => ({ linha, ordem: i + 1 })));
      if (r.faltaram.length) toast.warning(`${r.feitas} de ${linhas.length} aulas programadas. Veja as que faltaram.`, { duration: 12_000 });
      else toast.success(`Semana programada: ${r.feitas} lives na playlist`);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const tentarDeNovo = async () => {
    if (!progresso) return;
    setEnviando(true);
    try {
      const alvo = progresso.faltaram.map((f) => ({ linha: linhas[f.ordem - 1], ordem: f.ordem })).filter((x) => x.linha);
      const r = await enviarAulas(progresso.semanaId, alvo);
      if (!r.faltaram.length) toast.success("Semana completa");
      await carregar();
    } finally {
      setEnviando(false);
    }
  };

  const repetir = (s: Semana) => {
    const proximas = deslocarAulas(s.aulas.filter((a) => a.agendada_em && a.estado !== "cancelada") as (AulaListada & { agendada_em: string })[], 7);
    if (!proximas.length) return toast.error("Esta semana não tem aulas para repetir");
    setLinhas(proximas.map((a) => ({ titulo: a.titulo, video_id: a.video_id ?? "", quando: paraLocalBrt(a.agendada_em), miniatura: null })));
    setInicio(paraLocalBrt(proximas[0].agendada_em));
    setNome(nomeDaSemana(s.nome, new Date(proximas[0].agendada_em)));
    setPrivacidade((s.privacidade as PrivacidadeYt) ?? "unlisted");
    setPlaylist(NOVA);
    setProgresso(null);
    toast.info("Formulário preenchido com a semana seguinte (+7 dias, playlist nova). Confira e clique em Programar semana.");
  };

  const cancelarSemana = async (s: Semana) => {
    if (!confirm(`Cancelar a semana "${s.nome}"? As lives que ainda não aconteceram somem do YouTube.`)) return;
    const apagar = s.playlist_criada && confirm("Apagar também a playlist do YouTube? (OK = apagar, Cancelar = manter a playlist)");
    setOcupado(s.id);
    try {
      const r = await liveAula<{ canceladas: string[]; avisos: string[]; playlist_apagada: boolean }>("semana-cancelar", { semana_id: s.id, apagar_playlist: apagar });
      (r.avisos ?? []).slice(0, 4).forEach((a) => toast.warning(a, { duration: 10_000 }));
      toast.success(`${r.canceladas.length} live(s) cancelada(s)${r.playlist_apagada ? " e playlist apagada" : ""}`);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const copiar = (l: string) => navigator.clipboard.writeText(l).then(() => toast.success("Link copiado"));

  return (
    <div className="space-y-3 border-t pt-4">
      <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="flex items-center gap-1.5 text-sm font-medium"><CalendarRange className="h-4 w-4" /> Semana de aulas (playlist)</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="space-y-3">
          {!temCanal && !contas.length && <p className="text-xs text-amber-700 dark:text-amber-300">Precisa de um canal do YouTube conectado nesta live (aba Destinos ou o botão acima).</p>}
          <SeletorCanalYt id="sem-canal-yt" contas={contas} valor={canal} onChange={setCanal} />
          <div className="space-y-1">
            <Label htmlFor="sem-nome" className="text-xs">Nome da semana (nome da playlist)</Label>
            <Input id="sem-nome" maxLength={150} placeholder="LPSG – Semana 27/10" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Privacidade</Label>
              <Select value={privacidade} onValueChange={(v) => setPrivacidade(v as PrivacidadeYt)}>
                <SelectTrigger aria-label="Privacidade da semana"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIVACIDADES_YT.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Playlist</Label>
              <Select value={playlist} onValueChange={setPlaylist}>
                <SelectTrigger aria-label="Playlist da semana"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOVA}>Criar nova com o nome da semana</SelectItem>
                  {!outroCanal && playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.titulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sem-inicio" className="text-xs">Primeira aula (preenche {linhas.length} dias seguidos no mesmo horário; dá para editar cada uma)</Label>
            <Input id="sem-inicio" type="datetime-local" value={inicio} onChange={(e) => preencherDias(e.target.value)} />
          </div>

          <ol className="space-y-2">
            {linhas.map((l, i) => (
              <li key={i} className="space-y-1.5 rounded-md border p-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  Aula {i + 1}
                  {linhas.length > 1 && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remover aula ${i + 1}`} onClick={() => setLinhas((x) => x.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
                <Input aria-label={`Título da aula ${i + 1}`} maxLength={100} placeholder="Título da aula" value={l.titulo} onChange={(e) => mudar(i, { titulo: e.target.value })} />
                <Select value={l.video_id || undefined} onValueChange={(v) => mudar(i, { video_id: v })}>
                  <SelectTrigger aria-label={`Vídeo da aula ${i + 1}`}><SelectValue placeholder="Vídeo da aula" /></SelectTrigger>
                  <SelectContent>{videos.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="datetime-local" aria-label={`Data da aula ${i + 1}`} value={l.quando} onChange={(e) => mudar(i, { quando: e.target.value })} />
                <MiniaturaYt valor={l.miniatura} onChange={(f) => mudar(i, { miniatura: f })} />
              </li>
            ))}
          </ol>
          {linhas.length < MAX_AULAS && (
            <Button size="sm" variant="outline" onClick={() => setLinhas((x) => [...x, linhaVazia()])}><Plus className="mr-1 h-4 w-4" /> Adicionar aula</Button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Cota do YouTube: cerca de {cota.toLocaleString("pt-BR")} de {COTA_DIARIA_YT.toLocaleString("pt-BR")} unidades por dia
            ({playlist === NOVA ? "playlist nova 50 + " : ""}cada live 3 + item na playlist 50{linhas.some((x) => x.miniatura) ? " + miniatura 50" : ""}).
            Todas as lives com Iniciar sozinho e vídeo da aula.
          </p>
          {erro && (nome || linhas.some((x) => x.titulo || x.quando)) && <p className="text-xs text-red-700 dark:text-red-300">{erro}</p>}
          <Button disabled={enviando || demo || !!erro || (!temCanal && !contas.length)} onClick={programar}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-1.5 h-4 w-4" />}
            {enviando && progresso ? `Programando ${progresso.feitas + 1} de ${progresso.total}…` : "Programar semana"}
          </Button>
          {progresso && progresso.faltaram.length > 0 && !enviando && (
            <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-medium">{progresso.feitas} programadas; faltaram:</p>
              <ul className="list-disc pl-5">{progresso.faltaram.map((f) => <li key={f.ordem}>Aula {f.ordem}: {f.motivo}</li>)}</ul>
              <Button size="sm" variant="outline" className="h-7" onClick={tentarDeNovo}>Tentar de novo as que faltaram</Button>
            </div>
          )}

          {semanas.map((s) => (
            <div key={s.id} className="space-y-1.5 rounded-md border p-2" aria-label={`Semana ${s.nome}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{s.nome}</span>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={demo} onClick={() => repetir(s)}>Repetir semana</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700 dark:text-red-300" disabled={!!ocupado || demo} onClick={() => cancelarSemana(s)}>
                    {ocupado === s.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Cancelar semana
                  </Button>
                </div>
              </div>
              {s.playlist_link && (
                <div className="flex items-center gap-1.5">
                  <Input readOnly value={s.playlist_link} className="h-7 text-xs" aria-label={`Link da playlist ${s.nome}`} />
                  <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" aria-label="Copiar link da playlist" onClick={() => copiar(s.playlist_link!)}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              )}
              <ol className="space-y-1">
                {s.aulas.map((a) => (
                  <li key={a.id} className={cn("text-xs", a.estado === "cancelada" && "opacity-60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.ordem}. {a.titulo}{a.agendada_em ? ` · ${formatarBrt(a.agendada_em)}` : ""}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{ROTULO_ESTADO_REPRISE[a.estado]}</span>
                    </div>
                    {a.link && (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Input readOnly value={a.link} className="h-6 text-[11px]" aria-label={`Link da aula ${a.ordem}`} />
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={`Copiar link da aula ${a.ordem}`} onClick={() => copiar(a.link!)}><Copy className="h-3 w-3" /></Button>
                      </div>
                    )}
                    {a.erro && <p className="text-[11px] text-red-700 dark:text-red-300">{a.erro}</p>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
