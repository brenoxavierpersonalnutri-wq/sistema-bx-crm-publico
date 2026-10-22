// Bloco "Reprisar em outra data" da aba Programação: várias datas de uma vez ou recorrência (todo dia, 7, 14, 21 ou
// 30 dias; até uma data, N vezes ou sem fim), pré-visualização das datas e da cota do YouTube antes de confirmar, e a
// lista "Reprises programadas" com link, estado, Cancelar e "Cancelar todas as futuras". Horário de Brasília fixo.
// Tudo herda o que está preenchido na aba (vídeo, iniciar sozinho, privacidade, título, descrição, playlist).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, Plus, Repeat, X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { liveAula, type LinkProgramado } from "@/lib/lives/aula";
import { cn } from "@/lib/utils";
import { SeletorCanalYt } from "@/components/lives/SeletorCanalYt";
import { useContasYt } from "@/lib/lives/useContasYt";
import {
  COTA_DIARIA_YT, deLocalBrt, estimarCota, formatarBrt, FREQUENCIAS, JANELA_CONTINUA, MAX_REPRISES, ROTULO_ESTADO_REPRISE,
  ROTULO_FREQUENCIA, type EstadoReprise, type Frequencia,
} from "../../../../supabase/functions/_shared/reprises.ts";
import { previaReprises, type FimRecorrencia as Fim, type ModoReprise as Modo } from "@/lib/lives/reprises";

export type RepriseListada = {
  id: string; titulo: string; agendada_em: string | null; status: string; serie_id: string | null;
  estado: EstadoReprise; erro: string | null; link: string | null; pode_cancelar: boolean;
};
type SerieAtiva = { id: string; frequencia_dias: number; proxima_em: string; janela: number; tentar_depois: string | null; ultimo_erro: string | null };
type Faltou = { agendada_em: string; motivo: string };

export function PainelReprises({ salaId, corpoBase, temMiniatura, temPlaylist, destinosYt, contaYtDaLive, demo }: {
  salaId: string;
  /** campos herdados da aba (vídeo, iniciar sozinho, título, descrição, privacidade, playlist, miniatura) */
  corpoBase: () => Promise<Record<string, unknown>>;
  temMiniatura: boolean;
  temPlaylist: boolean;
  destinosYt: number;
  /** canal do destino YouTube ligado nesta live (padrão do seletor) */
  contaYtDaLive?: string | null;
  demo?: boolean;
}) {
  const { contas, padrao } = useContasYt(!demo);
  const [canal, setCanal] = useState("");
  useEffect(() => setCanal(contaYtDaLive ?? padrao?.id ?? ""), [contaYtDaLive, padrao?.id]);
  const [modo, setModo] = useState<Modo>("datas");
  const [datas, setDatas] = useState<string[]>([""]);
  const [freq, setFreq] = useState<Frequencia>(7);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState<Fim>("vezes");
  const [ate, setAte] = useState("");
  const [vezes, setVezes] = useState("8");
  const [sufixo, setSufixo] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [faltaram, setFaltaram] = useState<Faltou[]>([]);
  const [lista, setLista] = useState<RepriseListada[]>([]);
  const [series, setSeries] = useState<SerieAtiva[]>([]);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (demo) return;
    try {
      const r = await liveAula<{ reprises: RepriseListada[]; series: SerieAtiva[] }>("reprises", { room_id: salaId });
      setLista(r.reprises ?? []);
      setSeries(r.series ?? []);
    } catch {
      setLista([]);
      setSeries([]);
    }
  }, [salaId, demo]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const previa = useMemo(() => previaReprises({ modo, datas, freq, inicio, fim, ate, vezes, agora: new Date() }), [modo, datas, freq, inicio, fim, ate, vezes]);
  const cota = estimarCota(previa.datas.length, { miniatura: temMiniatura, playlist: temPlaylist, destinos: Math.max(1, destinosYt) });

  const programar = async () => {
    if (!previa.datas.length) return toast.error("Escolha pelo menos uma data");
    if (previa.erro) return toast.error(previa.erro);
    const resumo = previa.continua
      ? `Criar agora as próximas ${previa.datas.length} reprises (${ROTULO_FREQUENCIA[freq]}, sem fim)? Depois o sistema cria a seguinte sozinho a cada uma que acontecer.`
      : `Criar ${previa.datas.length} reprise${previa.datas.length > 1 ? "s" : ""}, cada uma com um link novo no YouTube?`;
    if (!confirm(resumo)) return;
    setEnviando(true);
    setFaltaram([]);
    try {
      const alvo = modo === "datas"
        ? { datas: previa.datas.map((d) => d.toISOString()) }
        : {
            recorrencia: {
              frequencia_dias: freq, inicio: deLocalBrt(inicio)?.toISOString(),
              ...(fim === "ate" ? { ate } : fim === "vezes" ? { quantidade: Number(vezes) } : { continua: true, janela: JANELA_CONTINUA }),
            },
          };
      const r = await liveAula<{ criadas: { room_id: string; agendada_em: string; links: LinkProgramado[] }[]; faltaram: Faltou[]; avisos: string[]; cota_esgotou: boolean }>(
        "reprisar", { room_id: salaId, ...(await corpoBase()), ...alvo, sufixo_data: sufixo, ...(contas.length > 1 && canal ? { yt_conta_id: canal } : {}) },
      );
      const n = r.criadas?.length ?? 0;
      toast.success(`${n} reprise${n === 1 ? "" : "s"} programada${n === 1 ? "" : "s"}`);
      (r.avisos ?? []).slice(0, 5).forEach((a) => toast.warning(a, { duration: 10_000 }));
      if (r.faltaram?.length) {
        setFaltaram(r.faltaram);
        toast.warning(r.cota_esgotou ? `A cota do YouTube acabou: ${r.faltaram.length} ficaram de fora (lista abaixo)` : `${r.faltaram.length} não foram criadas (lista abaixo)`, { duration: 12_000 });
      }
      setDatas([""]);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async (r: RepriseListada) => {
    if (!confirm(`Cancelar a reprise de ${r.agendada_em ? formatarBrt(r.agendada_em) : ""}? A live programada some do YouTube (o link deixa de valer).`)) return;
    setCancelando(r.id);
    try {
      const x = await liveAula<{ avisos: string[] }>("reprise-cancelar", { room_id: r.id });
      (x.avisos ?? []).forEach((a) => toast.warning(a, { duration: 10_000 }));
      toast.success("Reprise cancelada");
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelando(null);
    }
  };

  const cancelarTodas = async () => {
    const n = lista.filter((r) => r.pode_cancelar).length;
    if (!confirm(`Cancelar ${n ? `as ${n} reprises futuras` : "a recorrência"}${series.length ? " e parar a recorrência contínua" : ""}? Os links do YouTube deixam de valer.`)) return;
    setCancelando("todas");
    try {
      const x = await liveAula<{ canceladas: string[]; avisos: string[] }>("reprises-cancelar-futuras", { room_id: salaId });
      (x.avisos ?? []).slice(0, 5).forEach((a) => toast.warning(a, { duration: 10_000 }));
      toast.success(`${x.canceladas?.length ?? 0} reprise(s) cancelada(s)`);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelando(null);
    }
  };

  const copiar = (l: string) => navigator.clipboard.writeText(l).then(() => toast.success("Link copiado"));
  const futuras = lista.filter((r) => r.pode_cancelar).length;

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <Label>Reprisar em outra data</Label>
        <p className="text-xs text-muted-foreground">
          Cada data vira uma live nova com a mesma cena, banners, canal do YouTube e vídeo, com link próprio. Horário de Brasília.
        </p>
      </div>

      <div className="inline-flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="Como escolher as datas">
        {([["datas", "Datas avulsas"], ["recorrencia", "Repetir"]] as const).map(([k, rot]) => (
          <button key={k} type="button" role="tab" aria-selected={modo === k} onClick={() => setModo(k)}
            className={cn("rounded px-2.5 py-1", modo === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{rot}</button>
        ))}
      </div>

      {modo === "datas" ? (
        <div className="space-y-1.5">
          {datas.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input type="datetime-local" aria-label={`Data da reprise ${i + 1}`} value={v} onChange={(e) => setDatas((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remover data ${i + 1}`} disabled={datas.length === 1 && !v}
                onClick={() => setDatas((l) => (l.length === 1 ? [""] : l.filter((_, j) => j !== i)))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={datas.length >= MAX_REPRISES} onClick={() => setDatas((l) => [...l, ""])}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar data
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Repetir</Label>
            <Select value={String(freq)} onValueChange={(v) => setFreq(Number(v) as Frequencia)}>
              <SelectTrigger aria-label="Frequência"><SelectValue /></SelectTrigger>
              <SelectContent>{FREQUENCIAS.map((f) => <SelectItem key={f} value={String(f)}>{ROTULO_FREQUENCIA[f]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-inicio" className="text-xs">A partir de</Label>
            <Input id="rep-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Termina</Label>
            <Select value={fim} onValueChange={(v) => setFim(v as Fim)}>
              <SelectTrigger aria-label="Quando termina"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vezes">Depois de N vezes</SelectItem>
                <SelectItem value="ate">Em uma data</SelectItem>
                <SelectItem value="sempre">Sem fim (vai repondo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fim === "vezes" && (
            <div className="space-y-1">
              <Label htmlFor="rep-vezes" className="text-xs">Quantidade de vezes (até {MAX_REPRISES})</Label>
              <Input id="rep-vezes" type="number" min={1} max={MAX_REPRISES} value={vezes} onChange={(e) => setVezes(e.target.value)} />
            </div>
          )}
          {fim === "ate" && (
            <div className="space-y-1">
              <Label htmlFor="rep-ate" className="text-xs">Até (inclusive)</Label>
              <Input id="rep-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
          )}
          {fim === "sempre" && (
            <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
              Cria agora as próximas {JANELA_CONTINUA}. Cada vez que uma acontece (ou é cancelada), o sistema cria a seguinte sozinho, mantendo {JANELA_CONTINUA} à frente.
              A miniatura personalizada vale só para as criadas agora.
            </p>
          )}
        </div>
      )}

      <SeletorCanalYt id="rep-canal-yt" contas={contas} valor={canal} onChange={setCanal} />

      <div className="flex items-start gap-2">
        <Switch id="rep-sufixo" checked={sufixo} onCheckedChange={setSufixo} />
        <Label htmlFor="rep-sufixo" className="text-sm font-normal leading-snug">Pôr a data no fim do título (ex.: "Aula (10/11 19h)")</Label>
      </div>

      {(previa.datas.length > 0 || previa.erro) && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs" aria-label="Pré-visualização das reprises">
          {previa.erro && <p className="text-red-700 dark:text-red-300">{previa.erro}</p>}
          {previa.datas.length > 0 && (
            <>
              <p className="font-medium">{previa.datas.length} reprise{previa.datas.length > 1 ? "s" : ""}{previa.continua ? " agora (depois vai repondo)" : ""}:</p>
              <ol className="max-h-40 list-decimal space-y-0.5 overflow-y-auto pl-5">
                {previa.datas.map((d) => <li key={d.toISOString()}>{formatarBrt(d)}</li>)}
              </ol>
              <p className={cn("text-muted-foreground", cota.alto && "text-amber-700 dark:text-amber-300")}>
                Cota do YouTube: cerca de {cota.unidades.toLocaleString("pt-BR")} de {COTA_DIARIA_YT.toLocaleString("pt-BR")} unidades por dia
                {temMiniatura || temPlaylist ? " (miniatura e playlist custam 50 cada por reprise)" : ""}. Se acabar, crio o que der e mostro o que faltou.
              </p>
            </>
          )}
        </div>
      )}

      <Button variant="outline" disabled={enviando || demo || !previa.datas.length || !!previa.erro} onClick={programar}>
        {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Repeat className="mr-1.5 h-4 w-4" />}
        Programar reprises{previa.datas.length ? ` (${previa.datas.length})` : ""}
      </Button>

      {faltaram.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-medium">Não criadas:</p>
          <ul className="list-disc pl-5">{faltaram.map((f) => <li key={f.agendada_em}>{formatarBrt(f.agendada_em)}: {f.motivo}</li>)}</ul>
        </div>
      )}

      {(lista.length > 0 || series.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Reprises programadas</Label>
            {(futuras > 0 || series.length > 0) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700 dark:text-red-300" disabled={!!cancelando || demo} onClick={cancelarTodas}>
                {cancelando === "todas" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Cancelar todas as futuras
              </Button>
            )}
          </div>
          {series.map((s) => (
            <p key={s.id} className="text-[11px] text-muted-foreground">
              Repetindo {ROTULO_FREQUENCIA[s.frequencia_dias as Frequencia] ?? `a cada ${s.frequencia_dias} dias`}, sempre {s.janela} à frente. Próxima a criar: {formatarBrt(s.proxima_em)}.
              {s.ultimo_erro && <span className="block text-amber-700 dark:text-amber-300">Última tentativa falhou: {s.ultimo_erro}</span>}
            </p>
          ))}
          <ul className="space-y-1.5">
            {lista.map((r) => (
              <li key={r.id} className={cn("space-y-1 rounded-md border p-2", r.estado === "cancelada" && "opacity-60")}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Link to={`/lives/estudio/${r.id}`} className="font-medium hover:underline">{r.agendada_em ? formatarBrt(r.agendada_em) : r.titulo}</Link>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px]",
                    r.estado === "programada" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
                    r.estado === "erro" && "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
                    !["programada", "erro"].includes(r.estado) && "bg-muted text-muted-foreground")}>
                    {ROTULO_ESTADO_REPRISE[r.estado]}
                  </span>
                </div>
                {r.link && (
                  <div className="flex items-center gap-1.5">
                    <Input readOnly value={r.link} className="h-7 text-xs" aria-label={`Link da reprise ${r.agendada_em ? formatarBrt(r.agendada_em) : ""}`} />
                    <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" aria-label="Copiar link" onClick={() => copiar(r.link!)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Abrir no YouTube" asChild><a href={r.link} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></Button>
                  </div>
                )}
                {!r.link && r.estado === "programada" && <p className="text-[11px] text-muted-foreground">Sem link do YouTube (sem canal conectado nesta reprise).</p>}
                {r.erro && <p className="text-[11px] text-red-700 dark:text-red-300">{r.erro}</p>}
                {r.pode_cancelar && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!!cancelando || demo} onClick={() => cancelar(r)}>
                    {cancelando === r.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Cancelar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
