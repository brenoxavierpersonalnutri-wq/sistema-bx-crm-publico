// Regras "quando X, faça Y". Criar/editar, ligar/desligar e simular (mostra quem seria atingido, sem enviar).
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Save, Search, Trash2, Pencil } from "lucide-react";
import {
  chamarAutomacoes,
  db,
  normalizarTag,
  resumoAutomacao,
  validarAutomacao,
  type Acao,
  type Automacao,
  type GatilhoTipo,
} from "@/lib/crmAutomacoes";
import { NOMES_ETAPAS, useCatalogo } from "./useCatalogo";
import { SeletorMensagem } from "./SeletorMensagem";
import { useEtapas } from "@/hooks/useEtapas";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";

interface Form {
  id?: string;
  nome: string;
  ativo: boolean;
  gatilho_tipo: GatilhoTipo;
  gatilho_valor: string;
  sem_resposta_horas: number;
  janela_max_horas: number;
  filtro_etapas: string[];
  comMensagem: boolean;
  roteiro_id: string | null;
  passo_id: string | null;
  moverEtapa: string;
  tag: string;
  template: string;
  variaveis: string; // uma por linha: chave=valor
}

const VAZIO: Form = {
  nome: "", ativo: false, gatilho_tipo: "etapa", gatilho_valor: "agendado", sem_resposta_horas: 24,
  janela_max_horas: 48, filtro_etapas: [], comMensagem: true, roteiro_id: null, passo_id: null,
  moverEtapa: "", tag: "", template: "", variaveis: "",
};

function paraAcoes(f: Form): Acao[] {
  const a: Acao[] = [];
  if (f.comMensagem && f.passo_id) a.push({ tipo: "passo", passo_id: f.passo_id });
  else if (f.comMensagem && f.roteiro_id) a.push({ tipo: "roteiro", roteiro_id: f.roteiro_id });
  else if (f.comMensagem) a.push({ tipo: "roteiro", roteiro_id: "" });
  if (f.moverEtapa) a.push({ tipo: "etapa", etapa: f.moverEtapa });
  if (f.tag.trim()) a.push({ tipo: "tag", tag: normalizarTag(f.tag) });
  if (f.template.trim()) {
    const variaveis = Object.fromEntries(
      f.variaveis.split("\n").map((l) => l.split("=")).filter((p) => p[0]?.trim()).map(([k, ...v]) => [k.trim(), v.join("=").trim()]),
    );
    a.push({ tipo: "template_oficial", template: f.template.trim(), variaveis });
  }
  return a;
}

function paraAutomacao(f: Form): Automacao {
  return {
    id: f.id ?? "",
    nome: f.nome.trim(),
    ativo: f.ativo,
    gatilho_tipo: f.gatilho_tipo,
    gatilho_valor: f.gatilho_tipo === "sem_resposta" ? null : f.gatilho_tipo === "tag" ? normalizarTag(f.gatilho_valor) : f.gatilho_valor,
    sem_resposta_horas: f.gatilho_tipo === "sem_resposta" ? Number(f.sem_resposta_horas) : null,
    janela_max_horas: Number(f.janela_max_horas) || 48,
    filtro_etapas: f.filtro_etapas,
    acoes: paraAcoes(f),
    ligado_em: null,
  };
}

function deAutomacao(a: Automacao): Form {
  const msg = a.acoes.find((x) => x.tipo === "roteiro" || x.tipo === "passo");
  const et = a.acoes.find((x) => x.tipo === "etapa") as Extract<Acao, { tipo: "etapa" }> | undefined;
  const tg = a.acoes.find((x) => x.tipo === "tag") as Extract<Acao, { tipo: "tag" }> | undefined;
  const tp = a.acoes.find((x) => x.tipo === "template_oficial") as Extract<Acao, { tipo: "template_oficial" }> | undefined;
  return {
    id: a.id, nome: a.nome, ativo: a.ativo, gatilho_tipo: a.gatilho_tipo, gatilho_valor: a.gatilho_valor ?? "",
    sem_resposta_horas: a.sem_resposta_horas ?? 24, janela_max_horas: a.janela_max_horas ?? 48,
    filtro_etapas: a.filtro_etapas ?? [], comMensagem: Boolean(msg),
    roteiro_id: msg?.tipo === "roteiro" ? msg.roteiro_id : null,
    passo_id: msg?.tipo === "passo" ? msg.passo_id : null,
    moverEtapa: et?.etapa ?? "", tag: tg?.tag ?? "", template: tp?.template ?? "",
    variaveis: Object.entries(tp?.variaveis ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
  };
}

type Simulacao = { total: number; contatos: { phone: string; name: string | null; stage: string | null }[]; envio: string; observacao: string };

export function RegrasAutomacao() {
  const { toast } = useToast();
  const { roteiros, passos, nomesRoteiros } = useCatalogo();
  const { colunas } = useEtapas();
  const [lista, setLista] = useState<Automacao[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [sim, setSim] = useState<Simulacao | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await db.from("crm_automacoes").select("*").order("created_at");
    if (error) toast({ title: "Tabela de automações não encontrada", description: "Rode a migration 20261018100000.", variant: "destructive" });
    setLista((data ?? []) as Automacao[]);
  }, [toast]);
  useEffect(() => { carregar(); }, [carregar]);

  // O passo escolhido define o roteiro no seletor
  const roteiroDoPasso = (pid: string | null) => passos.find((p) => p.id === pid)?.roteiro_id ?? null;

  const salvar = async () => {
    if (!form) return;
    const a = paraAutomacao(form);
    const erros = validarAutomacao(a);
    if (erros.length) return toast({ title: "Falta ajustar", description: erros.join(" "), variant: "destructive" });
    setSalvando(true);
    const linha = {
      nome: a.nome, gatilho_tipo: a.gatilho_tipo, gatilho_valor: a.gatilho_valor, sem_resposta_horas: a.sem_resposta_horas,
      janela_max_horas: a.janela_max_horas, filtro_etapas: a.filtro_etapas, acoes: a.acoes,
    };
    const { error } = form.id
      ? await db.from("crm_automacoes").update(linha).eq("id", form.id)
      : await db.from("crm_automacoes").insert({ ...linha, ativo: false });
    setSalvando(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: form.id ? "Regra atualizada" : "Regra criada (desligada)" });
    setForm(null);
    carregar();
  };

  const alternar = async (a: Automacao, ativo: boolean) => {
    if (ativo && !window.confirm(
      `Ligar "${a.nome}"? A regra passa a valer para eventos a partir de agora (nunca para a base antiga). ` +
      "Mensagem não oficial só sai se o envio estiver ligado na aba Limites.",
    )) return;
    const { error } = await db.from("crm_automacoes").update({ ativo }).eq("id", a.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    carregar();
  };

  const excluir = async (a: Automacao) => {
    if (!window.confirm(`Excluir "${a.nome}"? O histórico de envios dela some junto.`)) return;
    await db.from("crm_automacoes").delete().eq("id", a.id);
    carregar();
  };

  const simular = async (a: Automacao) => {
    setSimulando(true); setSim(null);
    try { setSim(await chamarAutomacoes<Simulacao>({ modo: "simular", automacao: a })); }
    catch (e) { toast({ title: "Não deu para simular", description: (e as Error).message, variant: "destructive" }); }
    finally { setSimulando(false); }
  };

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <div className="space-y-4 pt-2">
      {!form && (
        <Button size="sm" onClick={() => { setForm({ ...VAZIO }); setSim(null); }}>
          <Plus className="mr-1 h-4 w-4" /> Nova regra
        </Button>
      )}

      {form && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={form.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Agendou → lembrete" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Quando</Label>
              <Select value={form.gatilho_tipo} onValueChange={(v) => set({ gatilho_tipo: v as GatilhoTipo, gatilho_valor: v === "etapa" ? "agendado" : "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="etapa">Contato entra na etapa</SelectItem>
                  <SelectItem value="sem_resposta">Sem resposta há</SelectItem>
                  <SelectItem value="tag">Contato recebe a tag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.gatilho_tipo === "etapa" && (
              <div className="space-y-1">
                <Label>Etapa</Label>
                <Select value={form.gatilho_valor} onValueChange={(v) => set({ gatilho_valor: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><ItensEtapa incluir={form.gatilho_valor} /></SelectContent>
                </Select>
              </div>
            )}
            {form.gatilho_tipo === "tag" && (
              <div className="space-y-1">
                <Label>Tag</Label>
                <Input value={form.gatilho_valor} onChange={(e) => set({ gatilho_valor: e.target.value })} placeholder="quente" />
              </div>
            )}
            {form.gatilho_tipo === "sem_resposta" && (
              <>
                <div className="space-y-1">
                  <Label>Horas sem resposta</Label>
                  <Input type="number" min={1} value={form.sem_resposta_horas} onChange={(e) => set({ sem_resposta_horas: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label title="Quem está calado há mais que horas + janela fica de fora (não varre a base antiga)">Janela (h)</Label>
                  <Input type="number" min={1} value={form.janela_max_horas} onChange={(e) => set({ janela_max_horas: Number(e.target.value) })} />
                </div>
              </>
            )}
          </div>
          {form.gatilho_tipo === "sem_resposta" && (
            <p className="text-xs text-muted-foreground">
              Pega quem recebeu nossa última mensagem há entre {form.sem_resposta_horas} h e {form.sem_resposta_horas + form.janela_max_horas} h. Se a lead responder antes do envio, ele não sai.
            </p>
          )}

          <div className="space-y-1">
            <Label>Só para contatos nas etapas (vazio = qualquer)</Label>
            <div className="flex flex-wrap gap-3">
              {colunas.map((c) => (
                <label key={c.id} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    checked={form.filtro_etapas.includes(c.id)}
                    onCheckedChange={(v) => set({ filtro_etapas: v ? [...form.filtro_etapas, c.id] : form.filtro_etapas.filter((x) => x !== c.id) })}
                  />
                  {c.title}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-md bg-muted/40 p-3 space-y-3">
            <p className="text-sm font-medium">Faça</p>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.comMensagem} onCheckedChange={(v) => set({ comMensagem: v })} />
              Enviar mensagem pelo WhatsApp não oficial (respeita os limites)
            </label>
            {form.comMensagem && (
              <SeletorMensagem
                roteiros={roteiros}
                passos={passos}
                roteiroId={form.roteiro_id ?? roteiroDoPasso(form.passo_id)}
                passoId={form.passo_id}
                onChange={(v) => set(v)}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Mover para a etapa</Label>
                <Select value={form.moverEtapa || "__nao__"} onValueChange={(v) => set({ moverEtapa: v === "__nao__" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nao__">Não mover</SelectItem>
                    <ItensEtapa incluir={form.moverEtapa || null} />
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Pôr a tag</Label>
                <Input value={form.tag} onChange={(e) => set({ tag: e.target.value })} placeholder="opcional" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Disparar template oficial (Full Funnel)</Label>
                <Input value={form.template} onChange={(e) => set({ template: e.target.value })} placeholder="nome do template, opcional" />
              </div>
              {form.template.trim() && (
                <div className="space-y-1">
                  <Label>Variáveis (uma por linha, chave=valor)</Label>
                  <Textarea rows={3} value={form.variaveis} onChange={(e) => set({ variaveis: e.target.value })} placeholder={"nome={primeiro_nome}\ndia=sexta"} />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar
            </Button>
            <Button variant="outline" onClick={() => simular(paraAutomacao(form))} disabled={simulando}>
              <Search className="mr-1 h-4 w-4" /> Simular
            </Button>
            <Button variant="ghost" onClick={() => { setForm(null); setSim(null); }}>Cancelar</Button>
          </div>
        </div>
      )}

      {(simulando || sim) && (
        <div className="rounded-lg border p-3 text-sm space-y-2">
          {simulando ? <Loader2 className="h-4 w-4 animate-spin" /> : sim && (
            <>
              <p><b>{sim.total}</b> contato(s) seriam atingidos agora. Nada foi enviado.</p>
              <p className="text-xs text-muted-foreground">{sim.observacao} Envio não oficial: {sim.envio}.</p>
              <ul className="max-h-40 overflow-y-auto text-xs">
                {sim.contatos.map((c) => <li key={c.phone}>{c.name || "(sem nome)"} · {c.phone} · {NOMES_ETAPAS[c.stage ?? ""] ?? c.stage}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {lista.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma regra ainda.</p>}
        {lista.map((a) => (
          <div key={a.id} className="flex items-center gap-3 p-3">
            <Switch checked={a.ativo} onCheckedChange={(v) => alternar(a, v)} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{a.nome} {a.ativo ? <Badge className="ml-1">ligada</Badge> : <Badge variant="outline" className="ml-1">desligada</Badge>}</p>
              <p className="text-xs text-muted-foreground truncate">{resumoAutomacao(a, { etapas: NOMES_ETAPAS, roteiros: nomesRoteiros })}</p>
            </div>
            <Button size="icon" variant="ghost" title="Simular" onClick={() => simular(a)}><Search className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title="Editar" onClick={() => { setForm(deAutomacao(a)); setSim(null); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title="Excluir" onClick={() => excluir(a)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
