// /crm/agente-ia — "Agente IA" (item próprio no menu do CRM; /crm/ia redireciona para cá).
// À esquerda "Treinar IA": por agente, liga/desliga, número, até onde vai, horário, políticas, prompt com histórico
// e base de conhecimento. À direita (abaixo no celular) o simulador em destaque (ai-agent-simular, cenário offline:
// nenhuma mensagem sai para o WhatsApp), com aprovar/corrigir resposta.
// Ligar só com número + link + horário (a mesma regra está no banco: crm_ai_agents_pronto_para_ligar).
// "Novo agente" (18/10/2026) escolhe o tipo: atendimento ou follow-up. O de follow-up não liga aqui: entra no
// fluxo pelo passo "Mensagem da IA" e o simulador dele mostra a mensagem para uma conversa real, sem enviar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleAlert, FlaskConical, Loader2, Plus, Repeat, Save, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { NUMEROS_PADRAO, type NumeroCRM } from "@/lib/crm/central";
import {
  TIPOS_AGENTE,
  MODOS_ATIVACAO,
  criarAgente,
  db,
  ehFollowup,
  modoAtivacao,
  payloadAgente,
  prontoParaLigar,
  rotuloTipo,
  type AgenteIA,
  type ItemConhecimentoDB,
  type TipoAgente,
} from "@/lib/crm/treinarIA";
import { SimuladorFollowup } from "@/components/crm/ia/SimuladorFollowup";
import { ConfigAgente } from "@/components/crm/ia/ConfigAgente";
import { PromptAgente } from "@/components/crm/ia/PromptAgente";
import { ConhecimentoAgente } from "@/components/crm/ia/ConhecimentoAgente";
import { SimuladorAgente } from "@/components/crm/ia/SimuladorAgente";
import { EstadoRoboIA } from "@/components/crm/ia/EstadoRoboIA";
import { CartaoAgente, corStatusAgente, rotuloStatusAgente } from "@/components/crm/ia/CartaoAgente";
import { AvatarCRM, TituloPaginaCRM, TituloSecaoCRM } from "@/components/crm/ui/SecaoCRM";
import { metricasPorAgente, type MetricasAgente } from "@/lib/crm/metricasAgentes";

const SEM_METRICAS: MetricasAgente = { comIA: 0, atendidasHoje: 0, respostasHoje: 0, transferidasHoje: 0 };

const ABAS = [
  { id: "config", rotulo: "Configuração" },
  { id: "prompt", rotulo: "Prompt" },
  { id: "conhecimento", rotulo: "Base de conhecimento" },
] as const;

export default function TreinarIA() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [agentes, setAgentes] = useState<AgenteIA[]>([]);
  const [numeros, setNumeros] = useState<NumeroCRM[]>([]);
  const [form, setForm] = useState<AgenteIA | null>(null);
  const [salvo, setSalvo] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [conhecimento, setConhecimento] = useState<ItemConhecimentoDB[]>([]);
  const [novo, setNovo] = useState<{ tipo: TipoAgente; nome: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [metricas, setMetricas] = useState<Map<string, MetricasAgente> | null>(null);

  const selId = params.get("agente");
  const aba = ABAS.some((a) => a.id === params.get("aba")) ? (params.get("aba") as string) : "config";
  const mudarParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  const carregar = useCallback(async (manterId?: string | null) => {
    setCarregando(true);
    const [{ data, error }, nums] = await Promise.all([
      db.from("crm_ai_agents").select("*").order("nome"),
      db.from("crm_numeros").select("*").order("ordem"),
    ]);
    if (error) toast({ title: "Agentes", description: error.message, variant: "destructive" });
    const lista = (data ?? []) as AgenteIA[];
    setAgentes(lista);
    setNumeros(nums.error || !nums.data?.length ? NUMEROS_PADRAO : (nums.data as NumeroCRM[]));
    const alvo = lista.find((a) => a.id === manterId) ?? lista[0] ?? null;
    setForm(alvo ? { ...alvo } : null);
    setSalvo(alvo ? JSON.stringify(payloadSemData(alvo)) : "");
    setCarregando(false);
  }, [toast]);

  // números dos cartões (só leitura); relê depois de salvar
  useEffect(() => {
    let vivo = true;
    metricasPorAgente().then((m) => { if (vivo) setMetricas(m); });
    return () => { vivo = false; };
  }, [versao]);

  useEffect(() => {
    carregar(selId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = (id: string) => {
    if (form && sujo && !window.confirm("Há alterações não salvas neste agente. Trocar mesmo assim?")) return;
    const a = agentes.find((x) => x.id === id);
    setForm(a ? { ...a } : null);
    setSalvo(a ? JSON.stringify(payloadSemData(a)) : "");
    setConhecimento([]);
    mudarParam("agente", id);
  };

  const set = useCallback(<K extends keyof AgenteIA>(k: K, v: AgenteIA[K]) => setForm((f) => (f ? { ...f, [k]: v } : f)), []);
  const onItens = useCallback((itens: ItemConhecimentoDB[]) => setConhecimento(itens), []);

  const status = form ? prontoParaLigar(form) : { pronto: false, faltando: [] };
  const modo = form ? modoAtivacao(form) : "transferidas";
  const followup = ehFollowup(form);

  const criar = async (tipo: TipoAgente, nome: string) => {
    if (form && sujo && !window.confirm("Há alterações não salvas neste agente. Criar outro mesmo assim?")) return;
    setCriando(true);
    try {
      const id = await criarAgente(tipo, nome.trim());
      setNovo(null);
      mudarParam("agente", id);
      await carregar(id);
      toast({ title: "Agente criado", description: tipo === "followup" ? "Já vem com o prompt de follow-up. Use no fluxo pelo passo Mensagem da IA." : "Nasce desligado." });
    } catch (e) {
      toast({ title: "Não criou", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setCriando(false);
    }
  };
  const sujo = useMemo(() => (form ? JSON.stringify(payloadSemData(form)) !== salvo : false), [form, salvo]);

  const salvar = async () => {
    if (!form) return;
    if (modoAtivacao(form) !== "transferidas" && !status.pronto) {
      return toast({ title: "Não dá para ligar ainda", description: `Falta: ${status.faltando.join(", ")}.`, variant: "destructive" });
    }
    setSalvando(true);
    const { error } = await db.from("crm_ai_agents").update(payloadAgente(form)).eq("id", form.id);
    setSalvando(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: "Agente salvo", description: `Modo: ${rotuloModo(modoAtivacao(form))}.` });
    setVersao((v) => v + 1);
    carregar(form.id);
  };

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-6">
      <TituloPaginaCRM
        titulo="Agente IA"
        contador={agentes.length > 0 ? agentes.length : undefined}
        descricao="Cada agente atende um número de WhatsApp. Escolha o agente, ajuste e teste no simulador antes de ligar."
        acoes={
          <>
            <Button size="sm" variant="outline" onClick={() => criar("followup", "Follow-up")} disabled={criando}>
              {criando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Repeat className="h-4 w-4 mr-1" />} Criar agente de follow-up
            </Button>
            <Button size="sm" onClick={() => setNovo({ tipo: "atendimento", nome: "" })}>
              <Plus className="h-4 w-4 mr-1" /> Novo agente
            </Button>
          </>
        }
      />

      <EstadoRoboIA versao={versao} />

      {carregando && !form ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : !agentes.length ? (
        <p className="text-sm text-muted-foreground">Nenhum agente no banco (migrations 20261017100000 e 20261027140000).</p>
      ) : (
        <div className="space-y-6">
          <section aria-label="Lista de agentes" className="space-y-3">
            <TituloSecaoCRM titulo="Agentes" contador={agentes.length} onAdicionar={() => setNovo({ tipo: "atendimento", nome: "" })} rotuloAdicionar="Novo agente" />
            <nav aria-label="Agentes" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {agentes.map((a) => (
                <CartaoAgente
                  key={a.id}
                  agente={a}
                  numero={numeros.find((n) => n.id === a.numero_id) ?? null}
                  metricas={metricas ? metricas.get(a.slug) ?? SEM_METRICAS : null}
                  ativo={form?.id === a.id}
                  onEscolher={() => escolher(a.id)}
                />
              ))}
            </nav>
          </section>

          {form && (
            <section aria-label={`Agente ${form.nome}`} className="space-y-4 min-w-0">
              {/* cabeçalho do agente: nome, situação, modo e salvar (fica preso no topo ao rolar) */}
              <div className="sticky top-0 z-20 -mx-4 md:-mx-8 border-b bg-background/95 px-4 md:px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <AvatarCRM nome={form.nome} corStatus={corStatusAgente(form)} rotuloStatus={rotuloStatusAgente(form)} tamanho="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold tracking-tight truncate">{form.nome}</h2>
                    {followup ? (
                      <p className="text-sm text-muted-foreground" data-testid="status-agente">
                        Agente de follow-up. Não responde conversa e não liga aqui: entra num fluxo pelo passo <b className="text-foreground">Mensagem da IA (follow-up)</b>, e o fluxo decide número, horário e cadência (modelo pronto "Follow-up IA" na lista de fluxos).
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="inline-flex items-center gap-1.5" data-testid="status-agente">
                          {status.pronto ? (
                            <><CheckCircle2 className="h-4 w-4 text-success" /> <span className="font-medium">Pronto para ligar</span></>
                          ) : (
                            <><CircleAlert className="h-4 w-4 text-amber-400" /> <span className="text-muted-foreground">Falta para ligar: <b className="text-foreground">{status.faltando.join(", ")}</b></span></>
                          )}
                        </span>
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium hover:border-primary/60" data-testid="modo-agente"
                          onClick={() => mudarParam("aba", "config")} title="Mude em Configuração > Quando a IA começa a atender">
                          Modo: {rotuloModo(modo)}
                        </button>
                      </div>
                    )}
                  </div>
                  <Button onClick={salvar} disabled={salvando || !sujo} className="shrink-0">
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    {sujo ? "Salvar agente" : "Salvo"}
                  </Button>
                </div>
              </div>

              <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] gap-5 items-start">
                <section aria-labelledby="titulo-treinar" className="space-y-4 min-w-0">
                  <Tabs value={aba} onValueChange={(v) => mudarParam("aba", v)}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 id="titulo-treinar" className="text-lg font-bold tracking-tight">Treinar IA</h3>
                      <TabsList className="flex-wrap h-auto">
                        {ABAS.map((a) => <TabsTrigger key={a.id} value={a.id} className="px-4">{a.rotulo}</TabsTrigger>)}
                      </TabsList>
                    </div>
                    <TabsContent value="config" className="mt-4"><ConfigAgente form={form} numeros={numeros} set={set} followup={followup} /></TabsContent>
                    <TabsContent value="prompt" className="mt-4"><PromptAgente form={form} set={set} versao={versao} /></TabsContent>
                    {/* forceMount: a base carrega mesmo sem abrir a aba (o simulador usa) */}
                    <TabsContent value="conhecimento" className="mt-4 data-[state=inactive]:hidden" forceMount>
                      <ConhecimentoAgente key={form.id} form={form} set={set} onItens={onItens} />
                    </TabsContent>
                  </Tabs>
                </section>

                <section
                  id="simulador"
                  aria-labelledby="titulo-simulador"
                  data-testid="simulador-agente-ia"
                  className="rounded-xl border bg-card p-4 space-y-3 min-w-0 xl:sticky xl:top-24"
                >
                  <div className="space-y-2">
                    <h3 id="titulo-simulador" className="text-lg font-bold tracking-tight flex items-center gap-2">
                      <FlaskConical className="h-5 w-5 text-primary" /> {followup ? "Testar o follow-up (simulação, nada é enviado)" : "Testar a IA (simulação, nada é enviado)"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {followup
                        ? <>Agente <b className="text-foreground">{form.nome}</b> ({rotuloTipo(form)}). Escolha uma conversa: mostra a mensagem que sairia agora, com o que está na tela, mesmo sem salvar.</>
                        : <>Digite como se fosse a lead. Usa o que está na tela, mesmo sem salvar.</>}
                    </p>
                    <Badge variant="outline" className="gap-1 border-success/40 text-success whitespace-nowrap">
                      <ShieldCheck className="h-3.5 w-3.5" /> Cenário offline, não envia mensagem
                    </Badge>
                  </div>
                  {followup ? <SimuladorFollowup key={form.id} form={form} /> : <SimuladorAgente form={form} conhecimento={conhecimento} compacto />}
                </section>
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={novo !== null} onOpenChange={(v) => !v && setNovo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo agente</DialogTitle>
            <DialogDescription>Nasce desligado. O de follow-up já vem com o prompt pronto.</DialogDescription>
          </DialogHeader>
          {novo && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="nome-agente">Nome</Label>
                <Input id="nome-agente" autoFocus value={novo.nome} maxLength={120} placeholder={novo.tipo === "followup" ? "Follow-up" : "Atendimento"}
                  onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Tipo</legend>
                {TIPOS_AGENTE.map((t) => (
                  <label key={t.id} className={`flex cursor-pointer gap-2 rounded-md border p-2.5 text-sm ${novo.tipo === t.id ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="tipo-agente" value={t.id} checked={novo.tipo === t.id} onChange={() => setNovo({ ...novo, tipo: t.id })} className="mt-0.5" />
                    <span><span className="font-medium">{t.rotulo}</span><span className="block text-xs text-muted-foreground">{t.ajuda}</span></span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(null)}>Cancelar</Button>
            <Button onClick={() => novo && criar(novo.tipo, novo.nome)} disabled={criando}>
              {criando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Criar agente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Campos editáveis sem o carimbo de data, para saber se há alteração não salva. */
function payloadSemData(a: AgenteIA) {
  const p = payloadAgente(a);
  delete p.updated_at;
  return p;
}

const rotuloModo = (m: string): string => MODOS_ATIVACAO.find((x) => x.id === m)?.rotulo ?? m;
