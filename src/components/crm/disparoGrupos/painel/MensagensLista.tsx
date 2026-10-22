// "Ações" (estilo SendFlow): toda mensagem de grupo, com filtro por status (Na fila, Agendado, Processando,
// Sucesso, Falhas), cartão com prévia, campanha, datas, duração e progresso, e Cancelar o que ainda não saiu.
// Cancelar usa a RPC que já existe (grupos_cancelar_mensagem); nada é enviado daqui.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarClock, CheckCircle2, Flag, Loader2, Play, RefreshCw, Send, Timer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { db, ROTULO_STATUS, rotuloRelativo, type CampanhaGrupos, type MensagemAgendada } from "@/lib/grupos";
import { duracao, FILTROS_MENSAGEM, noFiltro, nomeCampanha, ROTULO_FILTRO, type FiltroMensagem } from "@/lib/painelGrupos";
import { clsPrimario, seletor } from "./ui";

const ROTULO_TIPO: Record<string, string> = {
  texto: "Texto", imagem: "Imagem", video: "Vídeo", audio: "Áudio", documento: "Arquivo", enquete: "Enquete", travar: "Fechar grupos", destravar: "Abrir grupos",
};
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export function MensagensLista({ campanhas, campanhaId, onEnviar }: {
  campanhas: CampanhaGrupos[];
  /** só desta campanha (aba Mensagens do detalhe); vazio = todas (página Ações) */
  campanhaId?: string;
  onEnviar?: () => void;
}) {
  const { toast } = useToast();
  const [lista, setLista] = useState<MensagemAgendada[]>([]);
  const [filtro, setFiltro] = useState<FiltroMensagem>("todas");
  const [doCampanha, setDoCampanha] = useState(campanhaId ?? "");
  const [carregando, setCarregando] = useState(true);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    let q = db.from("grupos_mensagens").select("*").order("agendado_para", { ascending: false }).limit(300);
    if (doCampanha) q = q.eq("campanha_id", doCampanha);
    const { data } = await q;
    setLista((data ?? []) as MensagemAgendada[]);
    setCarregando(false);
  }, [doCampanha]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!lista.some((m) => m.status === "enviando")) return;
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [lista, carregar]);

  const contagem = useMemo(() => {
    const agora = Date.now();
    return Object.fromEntries(FILTROS_MENSAGEM.map((f) => [f, lista.filter((m) => noFiltro(m, f, agora)).length])) as Record<FiltroMensagem, number>;
  }, [lista]);
  const visiveis = lista.filter((m) => noFiltro(m, filtro));
  const nomeDe = (id: string) => { const c = campanhas.find((x) => x.id === id); return c ? nomeCampanha(c) : "campanha"; };

  async function cancelar(m: MensagemAgendada) {
    if (!confirm("Cancelar esta mensagem? O que já saiu não volta; o resto não é enviado.")) return;
    setCancelando(m.id);
    const { error } = await db.rpc("grupos_cancelar_mensagem", { p_id: m.id });
    setCancelando(null);
    toast({ title: error ? "Erro ao cancelar" : "Mensagem cancelada", description: error?.message, variant: error ? "destructive" : undefined });
    carregar();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!campanhaId && (
          <select className={seletor} value={doCampanha} onChange={(e) => setDoCampanha(e.target.value)} aria-label="Filtrar por campanha">
            <option value="">Todas as campanhas</option>
            {campanhas.map((c) => <option key={c.id} value={c.id}>{nomeCampanha(c)}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <Button size="icon" variant="ghost" onClick={carregar} title="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
        {onEnviar && <Button className={clsPrimario} onClick={onEnviar}><Send className="h-4 w-4 mr-1" /> Enviar mensagem</Button>}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Status">
        {FILTROS_MENSAGEM.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
            className={cn("px-3 py-2 text-sm -mb-px border-b-2", filtro === f ? "border-amber-400 font-medium" : "border-transparent text-muted-foreground")}>
            {ROTULO_FILTRO[f]} <span className="text-xs text-muted-foreground">{contagem[f]}</span>
          </button>
        ))}
      </div>

      {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
      {!carregando && !visiveis.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem aqui.</p>}
      <div className="space-y-2">
        {visiveis.map((m) => {
          const podeCancelar = m.status === "agendada" || m.status === "enviando";
          const pctFeito = m.total_grupos ? Math.round(((m.enviados + m.falhas) / m.total_grupos) * 100) : 0;
          return (
            <div key={m.id} className="rounded-xl border border-border bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{ROTULO_TIPO[m.tipo] ?? m.tipo}</span>
                <span className="text-muted-foreground">· {nomeDe(m.campanha_id)}</span>
                {m.relativo_evento && typeof m.offset_min === "number" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{rotuloRelativo(m.offset_min)}</span>
                )}
                {m.mencionar_todos && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">@todos</span>}
                <span className="flex-1" />
                <span className={cn("rounded px-2 py-0.5 text-xs",
                  m.status === "concluida" ? "bg-green-500/15 text-green-400" : m.status === "erro" ? "bg-red-500/15 text-red-400"
                    : m.status === "enviando" ? "bg-sky-500/15 text-sky-400" : m.status === "cancelada" ? "bg-muted text-muted-foreground" : "bg-amber-400/15 text-amber-400")}>
                  {ROTULO_STATUS[m.status]}
                </span>
              </div>
              <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto]">
                <p className="whitespace-pre-wrap rounded-lg bg-emerald-900/30 border border-emerald-800/40 p-2 text-sm line-clamp-4">
                  {m.texto || (m.nome_arquivo ? `📎 ${m.nome_arquivo}` : ROTULO_TIPO[m.tipo])}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground md:min-w-[260px]">
                  <span className="inline-flex items-center gap-1" title="Agendada"><CalendarClock className="h-3.5 w-3.5" />{dataHora(m.agendado_para)}</span>
                  <span className="inline-flex items-center gap-1" title="Iniciou"><Play className="h-3.5 w-3.5" />{dataHora(m.iniciado_em)}</span>
                  <span className="inline-flex items-center gap-1" title="Terminou"><Flag className="h-3.5 w-3.5" />{dataHora(m.concluido_em)}</span>
                  <span className="inline-flex items-center gap-1" title="Duração"><Timer className="h-3.5 w-3.5" />{duracao(m.iniciado_em, m.concluido_em) ?? "—"}</span>
                  <span className="inline-flex items-center gap-1 text-green-500" title="Enviadas"><CheckCircle2 className="h-3.5 w-3.5" />{m.enviados}/{m.total_grupos || "?"} grupos</span>
                  <span className="inline-flex items-center gap-1 text-red-400" title="Falhas"><XCircle className="h-3.5 w-3.5" />{m.falhas} falha(s)</span>
                </div>
              </div>
              {m.status === "enviando" && (
                <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${pctFeito}%` }} /></div>
              )}
              {m.motivo && <p className="mt-1 text-xs text-red-400">{m.motivo}</p>}
              {podeCancelar && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" disabled={cancelando === m.id} onClick={() => cancelar(m)}>
                    <Ban className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
