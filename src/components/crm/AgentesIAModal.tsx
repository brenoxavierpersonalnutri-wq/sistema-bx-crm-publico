// Agentes de IA do CRM (crm_ai_agents): edição e modo de teste.
// O teste chama a função ai-agent-simular: mesma montagem de prompt e mesma
// leitura de ações do robô real, mas nada vai para o WhatsApp.
import { MODELOS_CLAUDE, mensagemErroIA, resolverModelo } from "@/lib/crm/iaClaude";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Send, RotateCcw, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEtapas } from "@/hooks/useEtapas";
import { db, type AgenteIA, type RespostaInterpretada } from "@/lib/crmRoteiros";

const MODELOS = MODELOS_CLAUDE;
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type Linha = { de: "lead" | "agente"; texto: string; tipo?: string };

export function AgentesIAModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const { toast } = useToast();
  const [agentes, setAgentes] = useState<AgenteIA[]>([]);
  const [selId, setSelId] = useState("");
  const [form, setForm] = useState<AgenteIA | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [antigoAtivo, setAntigoAtivo] = useState<{ id: string; active: boolean } | null>(null);

  // simulador
  const [conversa, setConversa] = useState<Linha[]>([]);
  const [entrada, setEntrada] = useState("");
  const [nomeTeste, setNomeTeste] = useState("Maria Teste");
  const [etapaTeste, setEtapaTeste] = useState("leads");
  const [notasTeste, setNotasTeste] = useState("");
  const [simulando, setSimulando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = async (manter?: string) => {
    const { data, error } = await db.from("crm_ai_agents").select("*").order("nome");
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    const lista = (data ?? []) as AgenteIA[];
    setAgentes(lista);
    const alvo = lista.find((a) => a.id === (manter ?? selId)) ?? lista[0];
    setSelId(alvo?.id ?? "");
    setForm(alvo ? { ...alvo } : null);
    const { data: ant } = await db.from("ai_agent_settings").select("id, active").limit(1).maybeSingle();
    setAntigoAtivo(ant ?? null);
  };

  useEffect(() => {
    if (isOpen) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const escolher = (id: string) => {
    setSelId(id);
    const a = agentes.find((x) => x.id === id);
    setForm(a ? { ...a } : null);
    setConversa([]);
    setAviso("");
  };

  const set = <K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    const { id, ...resto } = form;
    const payload = {
      ...resto,
      horario_inicio: form.horario_inicio || null,
      horario_fim: form.horario_fim || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    delete payload.created_at;
    const { error } = await db.from("crm_ai_agents").update(payload).eq("id", id);
    setSalvando(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: "Agente salvo", description: form.ativo ? "Ligado: responde leads novas no WhatsApp." : "Desligado." });
    carregar(id);
  };

  const desligarAntigo = async () => {
    if (!antigoAtivo) return;
    const { error } = await db.from("ai_agent_settings").update({ active: false }).eq("id", antigoAtivo.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setAntigoAtivo({ ...antigoAtivo, active: false });
  };

  const simular = async () => {
    if (!form || !entrada.trim() || simulando) return;
    const nova: Linha[] = [...conversa, { de: "lead", texto: entrada.trim() }];
    setConversa(nova);
    setEntrada("");
    setSimulando(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-agent-simular", {
        body: {
          agente: { prompt: form.prompt, base_conhecimento: form.base_conhecimento, modelo: form.modelo, temperatura: form.temperatura },
          historico: nova.map((l) => ({
            de: l.de,
            // mídia vira o mesmo rótulo que o robô real grava no histórico
            texto: l.tipo === "image" ? "[foto]" : l.tipo === "audio" ? "[áudio]" : l.tipo === "document" ? "[documento]" : l.texto,
          })),
          contato: { nome: nomeTeste, etapa: etapaTeste, notas: notasTeste },
        },
      });
      if (error || data?.error) throw new Error(await mensagemErroIA(error, data));
      const r = data.resposta as RespostaInterpretada;
      const linhas: Linha[] = r.mensagens.map((m) => ({ de: "agente", texto: m.conteudo, tipo: m.tipo }));
      setConversa((c) => [...c, ...linhas]);
      const avisos = [
        r.silencio ? "o agente ficou em silêncio" : "",
        r.etapa ? `moveria o contato para "${r.etapa}"` : "",
        r.transferir ? "transferiu para humano (a IA pararia nesta conversa)" : "",
      ].filter(Boolean);
      setAviso(avisos.join(" · "));
    } catch (e) {
      toast({ title: "Erro no teste", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSimulando(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Agentes de IA</DialogTitle>
          <DialogDescription>
            Cada agente responde só contatos atribuídos a ele (pelo gatilho da primeira mensagem, pela origem ou manualmente no painel do chat), nas etapas e no horário marcados. Humano que responde pausa a IA daquele contato. Desligado desde 17/10/2026: o CRM usa só o OpenWA e, nele, o número não responde sozinho.
          </DialogDescription>
        </DialogHeader>

        {antigoAtivo?.active && (
          <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm flex items-center justify-between gap-2">
            <span>O robô antigo (genérico, responde todo mundo) está ligado. Ele só roda enquanto nenhum agente daqui estiver ligado.</span>
            <Button size="sm" variant="outline" onClick={desligarAntigo}>Desligar robô antigo</Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {agentes.map((a) => (
            <Button key={a.id} size="sm" variant={a.id === selId ? "default" : "outline"} onClick={() => escolher(a.id)}>
              {a.nome} {a.ativo ? "· ligado" : "· desligado"}
            </Button>
          ))}
          {!agentes.length && <p className="text-sm text-muted-foreground">Nenhum agente. Rode a migration 20261017100000.</p>}
        </div>

        {form && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-3">
              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm font-medium">
                  <Switch checked={form.ativo} onCheckedChange={(v) => set("ativo", v)} /> Ligado
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Modelo (Claude, crédito da conta Anthropic)</Label>
                  <Select value={resolverModelo(form.modelo)} onValueChange={(v) => set("modelo", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{MODELOS.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Limite de respostas por conversa</Label>
                  <Input type="number" min={0} value={form.limite_interacoes ?? 15} onChange={(e) => set("limite_interacoes", Number(e.target.value) || 0)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">Etapas em que responde (nenhuma marcada = todas)</Label>
                <div className="flex flex-wrap gap-3 mt-1">
                  {KANBAN_COLUMNS.map((c) => (
                    <label key={c.id} className="flex items-center gap-1 text-sm">
                      <Checkbox
                        checked={(form.etapas ?? []).includes(c.id)}
                        onCheckedChange={(v) =>
                          set("etapas", v ? [...(form.etapas ?? []), c.id] : (form.etapas ?? []).filter((x) => x !== c.id))
                        }
                      />
                      {c.title}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Gatilhos (frase na mensagem da lead, uma por linha)</Label>
                  <Textarea className="min-h-[70px]" value={(form.gatilhos ?? []).join("\n")}
                    onChange={(e) => set("gatilhos", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
                </div>
                <div>
                  <Label className="text-xs">Origens (campo source do contato, separadas por vírgula)</Label>
                  <Input value={(form.origens ?? []).join(", ")}
                    onChange={(e) => set("origens", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div>
                      <Label className="text-xs">Início</Label>
                      <Input type="time" value={(form.horario_inicio ?? "").slice(0, 5)} onChange={(e) => set("horario_inicio", e.target.value || null)} />
                    </div>
                    <div>
                      <Label className="text-xs">Fim</Label>
                      <Input type="time" value={(form.horario_fim ?? "").slice(0, 5)} onChange={(e) => set("horario_fim", e.target.value || null)} />
                    </div>
                    <div>
                      <Label className="text-xs">Espera (s)</Label>
                      <Input type="number" min={0} max={30} value={form.atraso_segundos ?? 6} onChange={(e) => set("atraso_segundos", Number(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {DIAS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1 text-sm">
                    <Checkbox checked={(form.dias_semana ?? []).includes(i)}
                      onCheckedChange={(v) => set("dias_semana", v ? [...(form.dias_semana ?? []), i].sort() : (form.dias_semana ?? []).filter((x) => x !== i))} />
                    {d}
                  </label>
                ))}
                <span className="text-xs text-muted-foreground">Horário de Brasília. Sem início/fim = 24h.</span>
              </div>

              <div>
                <Label className="text-xs">Prompt</Label>
                <Textarea className="min-h-[300px] font-mono text-xs" value={form.prompt} onChange={(e) => set("prompt", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Base de conhecimento (fatos, links, políticas)</Label>
                <Textarea className="min-h-[120px] font-mono text-xs" value={form.base_conhecimento ?? ""} onChange={(e) => set("base_conhecimento", e.target.value)} />
              </div>
              <Button onClick={salvar} disabled={salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />} Salvar agente
              </Button>
            </div>

            <div className="rounded-lg border flex flex-col h-[75vh]">
              <div className="p-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Modo de teste (não envia WhatsApp)</span>
                  <Button size="sm" variant="ghost" onClick={() => { setConversa([]); setAviso(""); }}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Reiniciar
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input className="h-8" value={nomeTeste} onChange={(e) => setNomeTeste(e.target.value)} placeholder="Nome da lead" />
                  <Select value={etapaTeste} onValueChange={setEtapaTeste}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{KANBAN_COLUMNS.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Input className="h-8" value={notasTeste} onChange={(e) => setNotasTeste(e.target.value)} placeholder="Notas do CRM (ex.: avaliação 20/10 às 15h)" />
                <p className="text-[11px] text-muted-foreground">Testa o que está no formulário, mesmo sem salvar.</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/20">
                {conversa.map((l, i) => (
                  <div key={i} className={`flex ${l.de === "lead" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${l.de === "lead" ? "bg-background border" : "bg-green-100 dark:bg-green-900/40"}`}>
                      {l.tipo === "image" ? <img src={l.texto} alt="imagem enviada pelo agente" className="max-h-40 rounded" />
                        : l.tipo === "audio" ? <audio controls src={l.texto} className="w-56" />
                        : l.tipo === "document" ? <a href={l.texto} target="_blank" rel="noopener noreferrer" className="underline">documento</a>
                        : l.texto}
                    </div>
                  </div>
                ))}
                {simulando && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                {aviso && <p className="text-xs text-center text-amber-700 dark:text-amber-400">{aviso}</p>}
              </div>
              <div className="p-2 border-t flex gap-2">
                <Input value={entrada} onChange={(e) => setEntrada(e.target.value)} onKeyDown={(e) => e.key === "Enter" && simular()}
                  placeholder="Mensagem da lead" disabled={simulando} />
                <Button size="icon" onClick={simular} disabled={simulando || !entrada.trim()} aria-label="Enviar no teste">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
