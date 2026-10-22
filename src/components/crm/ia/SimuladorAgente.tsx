// Aba "Simulador" da tela Treinar IA: conversa de teste (ai-agent-simular, nada vai pro WhatsApp) e
// "aprovar / corrigir resposta", que guarda o exemplo em crm_ai_exemplos (entra no prompt como few-shot).
import { mensagemErroIA } from "@/lib/crm/iaClaude";
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEtapas } from "@/hooks/useEtapas";
import { db, type AgenteIA, type ExemploDB, type ItemConhecimentoDB } from "@/lib/crm/treinarIA";

type Linha = { de: "lead" | "agente"; texto: string; tipo?: string; turno?: number };
type Turno = { id: number; leadIdx: number; status: "pendente" | "aprovada" | "corrigida" };

const rotuloMidia = (l: Linha) =>
  l.tipo === "image" ? "[foto]" : l.tipo === "audio" ? "[áudio]" : l.tipo === "document" ? "[documento]" : l.texto;

interface Props {
  form: AgenteIA;
  conhecimento: ItemConhecimentoDB[];
  /** coluna estreita (tela Agente IA, ao lado da configuração): exemplos do treino vão para baixo da conversa */
  compacto?: boolean;
}

export function SimuladorAgente({ form, conhecimento, compacto = false }: Props) {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const { toast } = useToast();
  const [conversa, setConversa] = useState<Linha[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [entrada, setEntrada] = useState("");
  const [nomeTeste, setNomeTeste] = useState("Maria Teste");
  const [etapaTeste, setEtapaTeste] = useState("leads");
  const [notasTeste, setNotasTeste] = useState("");
  const [respeitarHorario, setRespeitarHorario] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [corrigindo, setCorrigindo] = useState<{ turno: number; texto: string } | null>(null);
  const [exemplos, setExemplos] = useState<ExemploDB[]>([]);

  const carregarExemplos = useCallback(async () => {
    const { data } = await db.from("crm_ai_exemplos").select("*").eq("agent_id", form.id).order("created_at", { ascending: false }).limit(50);
    setExemplos((data ?? []) as ExemploDB[]);
  }, [form.id]);

  useEffect(() => {
    carregarExemplos();
    setConversa([]);
    setTurnos([]);
    setAviso("");
  }, [carregarExemplos]);

  const simular = async () => {
    if (!entrada.trim() || simulando) return;
    const nova: Linha[] = [...conversa, { de: "lead", texto: entrada.trim() }];
    const leadIdx = nova.length - 1;
    setConversa(nova);
    setEntrada("");
    setSimulando(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-simular", {
        body: {
          agente: {
            slug: form.slug, nome: form.nome, prompt: form.prompt, base_conhecimento: form.base_conhecimento,
            modelo: form.modelo, temperatura: form.temperatura, politicas: form.politicas,
            frase_transferencia: form.frase_transferencia, palavras_transferencia: form.palavras_transferencia,
            limite_interacoes: form.limite_interacoes, link_agendamento: form.link_agendamento,
            horario_inicio: form.horario_inicio, horario_fim: form.horario_fim, dias_semana: form.dias_semana,
            mensagem_fora_horario: form.mensagem_fora_horario,
            prompt_transferencia: form.prompt_transferencia, transferir_sem_mensagem: form.transferir_sem_mensagem,
            transferir_para: form.transferir_para, transferir_tag: form.transferir_tag, transferir_etapa: form.transferir_etapa,
            transferir_fluxo_id: form.transferir_fluxo_id,
          },
          conhecimento,
          exemplos: exemplos.filter((e) => e.ativo !== false).map((e) => ({ mensagem_lead: e.mensagem_lead, resposta: e.resposta })),
          historico: nova.map((l) => ({ de: l.de, texto: rotuloMidia(l) })),
          contato: { nome: nomeTeste, etapa: etapaTeste, notas: notasTeste },
          respeitarHorario,
        },
      });
      if (error || data?.error) throw new Error(await mensagemErroIA(error, data));
      const r = data.resposta as { mensagens: { tipo: string; conteudo: string }[]; transferir: boolean; silencio: boolean; etapa: string | null; retidas?: string[] };
      const id = Date.now();
      setConversa((c) => [...c, ...r.mensagens.map((m) => ({ de: "agente" as const, texto: m.conteudo, tipo: m.tipo, turno: id }))]);
      if (r.mensagens.length) setTurnos((t) => [...t, { id, leadIdx, status: "pendente" }]);
      const d = data.decisao as { acao: string; motivo?: string } | undefined;
      const tr = data.transferencia as { motivo: string; para: string; tag: string | null; etapa: string | null; fluxo_id: string | null; despedida: string | null } | null | undefined;
      setAviso([
        d && d.acao === "fora_horario" ? "fora do horário" : "",
        tr ? `TRANSFERIRIA PARA HUMANO: ${tr.motivo} → ${tr.para}${tr.tag ? `, tag ${tr.tag}` : ""}${tr.etapa ? `, etapa ${tr.etapa}` : ""}${tr.fluxo_id ? ", iniciaria o fluxo" : ""}${tr.despedida || r.mensagens.length ? "" : ", sem despedida"}` : "",
        !tr && data.classificacao && !data.classificacao.transferir ? "decisão de transferência: continua com a IA" : "",
        r.silencio && !tr ? "o agente ficou em silêncio" : "",
        r.etapa ? `moveria o contato para "${r.etapa}"` : "",
        r.retidas?.length ? `mensagem retida: faltou ${r.retidas.join(", ")}` : "",
      ].filter(Boolean).join(" · "));
    } catch (e) {
      toast({ title: "Erro no teste", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSimulando(false);
    }
  };

  const respostaDoTurno = (id: number) => conversa.filter((l) => l.turno === id).map(rotuloMidia).join("\n\n");

  const guardar = async (turno: Turno, tipo: "aprovada" | "corrigida", texto: string) => {
    const original = respostaDoTurno(turno.id);
    const lead = conversa[turno.leadIdx]?.texto ?? "";
    const contexto = conversa.slice(Math.max(0, turno.leadIdx - 8), turno.leadIdx).map((l) => ({ de: l.de, texto: rotuloMidia(l) }));
    const { error } = await db.from("crm_ai_exemplos").insert({
      agent_id: form.id, tipo, mensagem_lead: lead, resposta: texto, resposta_original: tipo === "corrigida" ? original : null, contexto,
    });
    if (error) return toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    setTurnos((t) => t.map((x) => (x.id === turno.id ? { ...x, status: tipo } : x)));
    setCorrigindo(null);
    carregarExemplos();
    toast({ title: tipo === "aprovada" ? "Resposta aprovada" : "Correção salva", description: "Entra no treino do agente a partir da próxima resposta." });
  };

  const alternarExemplo = async (e: ExemploDB, ativo: boolean) => {
    await db.from("crm_ai_exemplos").update({ ativo }).eq("id", e.id);
    carregarExemplos();
  };
  const apagarExemplo = async (e: ExemploDB) => {
    if (!window.confirm("Apagar este exemplo do treino?")) return;
    await db.from("crm_ai_exemplos").delete().eq("id", e.id);
    carregarExemplos();
  };

  return (
    <div className={`grid gap-4 ${compacto ? "" : "lg:grid-cols-[1fr_340px]"}`}>
      <div className="crm-chat rounded-xl border overflow-hidden flex flex-col h-[70vh] bg-card">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">Simulador (não envia WhatsApp, usa o que está na tela mesmo sem salvar)</span>
            <Button size="sm" variant="ghost" onClick={() => { setConversa([]); setTurnos([]); setAviso(""); }}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reiniciar
            </Button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <Input className="h-8" value={nomeTeste} onChange={(e) => setNomeTeste(e.target.value)} placeholder="Nome da lead" aria-label="Nome da lead de teste" />
            <Select value={etapaTeste} onValueChange={setEtapaTeste}>
              <SelectTrigger className="h-8" aria-label="Etapa de teste"><SelectValue /></SelectTrigger>
              <SelectContent>{KANBAN_COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={respeitarHorario} onCheckedChange={setRespeitarHorario} /> respeitar horário agora
            </label>
          </div>
          <Input className="h-8" value={notasTeste} onChange={(e) => setNotasTeste(e.target.value)} placeholder="Notas do CRM (ex.: avaliação 20/10 às 15h)" aria-label="Notas de teste" />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--chat-fundo,#0d0f13)]">
          {conversa.map((l, i) => {
            const fimDoTurno = l.turno !== undefined && conversa[i + 1]?.turno !== l.turno;
            const turno = fimDoTurno ? turnos.find((t) => t.id === l.turno) : undefined;
            return (
              <div key={i}>
                <div className={`flex ${l.de === "lead" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${l.de === "lead" ? "bg-[var(--chat-bolha-in,#1e2128)] text-[var(--chat-texto,#e8eaed)] rounded-tl-sm" : "bg-[var(--chat-bolha-out,#005c4b)] text-[var(--chat-texto,#e8eaed)] rounded-tr-sm"}`}>
                    {l.tipo === "image" ? <img src={l.texto} alt="imagem enviada pelo agente" className="max-h-40 rounded" />
                      : l.tipo === "audio" ? <audio controls src={l.texto} className="w-56" />
                      : l.tipo === "document" ? <a href={l.texto} target="_blank" rel="noopener noreferrer" className="underline">documento</a>
                      : l.texto}
                  </div>
                </div>
                {turno && (
                  <div className="flex justify-end gap-1.5 mt-1">
                    {turno.status === "pendente" ? (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => guardar(turno, "aprovada", respostaDoTurno(turno.id))}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Aprovar resposta
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCorrigindo({ turno: turno.id, texto: respostaDoTurno(turno.id) })}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Corrigir resposta
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-green-700 dark:text-green-400">{turno.status === "aprovada" ? "aprovada" : "corrigida"} · no treino</span>
                    )}
                  </div>
                )}
                {turno && corrigindo?.turno === turno.id && (
                  <div className="mt-2 ml-auto max-w-[85%] space-y-1.5">
                    <Textarea className="min-h-[90px] text-sm" value={corrigindo.texto} onChange={(e) => setCorrigindo({ ...corrigindo, texto: e.target.value })}
                      aria-label="Resposta corrigida" />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCorrigindo(null)}>Cancelar</Button>
                      <Button size="sm" className="h-7 text-xs" disabled={!corrigindo.texto.trim()} onClick={() => guardar(turno, "corrigida", corrigindo.texto.trim())}>
                        Salvar correção
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {simulando && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
          {aviso && <p className="text-xs text-center text-amber-700 dark:text-amber-400">{aviso}</p>}
        </div>

        <div className="p-2 border-t flex gap-2 bg-[var(--chat-barra,#14161b)]">
          <Input value={entrada} onChange={(e) => setEntrada(e.target.value)} onKeyDown={(e) => e.key === "Enter" && simular()}
            placeholder="Mensagem da lead" disabled={simulando} aria-label="Mensagem da lead" />
          <Button size="icon" onClick={simular} disabled={simulando || !entrada.trim()} aria-label="Enviar no teste">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <aside className="rounded-xl border bg-card p-4 space-y-2 h-fit" aria-label="Exemplos do treino">
        <h4 className="text-base font-bold tracking-tight">Exemplos do treino ({exemplos.filter((e) => e.ativo !== false).length} em uso)</h4>
        <p className="text-xs text-muted-foreground">Os 20 mais recentes em uso entram no prompt como modelo de resposta.</p>
        {!exemplos.length && <p className="text-xs text-muted-foreground">Aprove ou corrija respostas no simulador para criar exemplos.</p>}
        <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {exemplos.map((e) => (
            <li key={e.id} className={`rounded-lg border bg-secondary p-2.5 text-xs space-y-1 ${e.ativo === false ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={e.tipo === "corrigida" ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}>{e.tipo}</span>
                <div className="flex items-center gap-1">
                  <Switch checked={e.ativo !== false} onCheckedChange={(v) => alternarExemplo(e, v)} aria-label="Usar exemplo" />
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => apagarExemplo(e)} aria-label="Apagar exemplo"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <p><span className="text-muted-foreground">Lead:</span> {e.mensagem_lead}</p>
              <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Resposta:</span> {e.resposta}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
