// Campanhas (disparo em massa no número não oficial) com ritmo controlado.
// Fluxo: rascunho -> contar público -> confirmar "vou enviar para N contatos" -> fila.
// Pausar, retomar e cancelar passam pela edge function; relatório com enviados, falhas e respostas.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Loader2, Pause, Pencil, Play, Plus, Save, Send, Trash2, XCircle } from "lucide-react";
import { useEtapas } from "@/hooks/useEtapas";
import {
  CONFIG_PADRAO, ROTULO_STATUS_CAMPANHA, chamarAutomacoes, db, filtroVazio,
  type Campanha, type ConfigEnvio, type FiltroPublico,
} from "@/lib/crmAutomacoes";
import { useCatalogo } from "./useCatalogo";
import { SeletorMensagem } from "./SeletorMensagem";

interface Form {
  id?: string;
  nome: string;
  etapas: string[];
  tags: string;
  origens: string;
  sem_resposta_dias: string;
  roteiro_id: string | null;
  passo_id: string | null;
  lote_por_dia: string;
}
const VAZIO: Form = { nome: "", etapas: [], tags: "", origens: "", sem_resposta_dias: "", roteiro_id: null, passo_id: null, lote_por_dia: "" };

const lista = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const paraFiltro = (f: Form): FiltroPublico => ({
  etapas: f.etapas,
  tags: lista(f.tags),
  origens: lista(f.origens),
  sem_resposta_dias: Number(f.sem_resposta_dias) || null,
});

type Contagem = { campanha: Campanha; total: number; amostra: { phone: string; name: string | null; stage: string | null }[] };
type Relatorio = { total: number; porStatus: Record<string, number>; enviados: number; respostas: number };

export function CampanhasEnvio() {
  const { colunas: KANBAN_COLUMNS } = useEtapas(); // etapas de crm_etapas (ativas)
  const { toast } = useToast();
  const { roteiros, passos, nomesRoteiros } = useCatalogo();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [cfg, setCfg] = useState<ConfigEnvio>(CONFIG_PADRAO);
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [contagem, setContagem] = useState<Contagem | null>(null);
  const [relatorio, setRelatorio] = useState<{ id: string; r: Relatorio } | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await db.from("crm_campanhas").select("*").order("created_at", { ascending: false });
    setCampanhas((data ?? []) as Campanha[]);
    const { data: c } = await db.from("crm_envio_config").select("*").eq("numero", "principal").maybeSingle();
    if (c) setCfg(c as ConfigEnvio);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const salvar = async () => {
    if (!form) return;
    const filtro = paraFiltro(form);
    if (!form.nome.trim()) return toast({ title: "Dê um nome à campanha", variant: "destructive" });
    if (filtroVazio(filtro)) return toast({ title: "Escolha pelo menos um filtro de público", variant: "destructive" });
    if (!form.roteiro_id && !form.passo_id) return toast({ title: "Escolha a mensagem", variant: "destructive" });
    const linha = {
      nome: form.nome.trim(), filtro, roteiro_id: form.roteiro_id, passo_id: form.passo_id,
      lote_por_dia: Number(form.lote_por_dia) > 0 ? Number(form.lote_por_dia) : null,
    };
    const { error } = form.id
      ? await db.from("crm_campanhas").update(linha).eq("id", form.id)
      : await db.from("crm_campanhas").insert(linha);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: "Rascunho salvo. Nada foi enviado." });
    setForm(null);
    carregar();
  };

  const contar = async (c: Campanha) => {
    setOcupado(c.id);
    try {
      const r = await chamarAutomacoes<{ total: number; amostra: Contagem["amostra"] }>({ modo: "contar_publico", filtro: c.filtro });
      if (!r.total) toast({ title: "Nenhum contato nesse público" });
      else setContagem({ campanha: c, total: r.total, amostra: r.amostra });
    } catch (e) {
      toast({ title: "Não deu para contar", description: (e as Error).message, variant: "destructive" });
    } finally { setOcupado(null); }
  };

  const confirmar = async () => {
    if (!contagem) return;
    setOcupado(contagem.campanha.id);
    try {
      const r = await chamarAutomacoes<{ total: number; envio_ligado: boolean }>({
        modo: "confirmar_campanha", campanha_id: contagem.campanha.id, total_confirmado: contagem.total,
      });
      toast({
        title: `Campanha na fila: ${r.total} contatos`,
        description: r.envio_ligado ? "Sai no ritmo configurado." : "O envio não oficial está DESLIGADO ou pausado: ligue na aba Limites para começar.",
      });
    } catch (e) {
      toast({ title: "Não confirmou", description: (e as Error).message, variant: "destructive" });
    } finally { setOcupado(null); setContagem(null); carregar(); }
  };

  const acao = async (c: Campanha, a: "pausar" | "retomar" | "cancelar") => {
    if (a === "cancelar" && !window.confirm(`Cancelar "${c.nome}"? O que ainda não saiu não sai mais.`)) return;
    setOcupado(c.id);
    try { await chamarAutomacoes({ modo: "campanha_acao", campanha_id: c.id, acao: a }); }
    catch (e) { toast({ title: "Erro", description: (e as Error).message, variant: "destructive" }); }
    finally { setOcupado(null); carregar(); }
  };

  const verRelatorio = async (c: Campanha) => {
    setOcupado(c.id);
    try { setRelatorio({ id: c.id, r: await chamarAutomacoes<Relatorio>({ modo: "relatorio_campanha", campanha_id: c.id }) }); }
    catch (e) { toast({ title: "Erro", description: (e as Error).message, variant: "destructive" }); }
    finally { setOcupado(null); }
  };

  const excluir = async (c: Campanha) => {
    if (!window.confirm(`Excluir "${c.nome}"?`)) return;
    await db.from("crm_campanhas").delete().eq("id", c.id);
    carregar();
  };

  const editar = (c: Campanha) => setForm({
    id: c.id, nome: c.nome, etapas: c.filtro.etapas ?? [], tags: (c.filtro.tags ?? []).join(", "),
    origens: (c.filtro.origens ?? []).join(", "), sem_resposta_dias: c.filtro.sem_resposta_dias ? String(c.filtro.sem_resposta_dias) : "",
    roteiro_id: c.roteiro_id, passo_id: c.passo_id, lote_por_dia: c.lote_por_dia ? String(c.lote_por_dia) : "",
  });

  const dias = (n: number, lote: number | null) => Math.max(1, Math.ceil(n / Math.min(lote || cfg.max_dia, cfg.max_dia)));

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs text-muted-foreground">
        Ritmo do número: até {cfg.max_hora}/hora e {cfg.max_dia}/dia, das {cfg.hora_inicio}h às {cfg.hora_fim}h, {cfg.intervalo_min} a {cfg.intervalo_max} s entre envios,
        pausa sozinho com 3 falhas seguidas ou sinal de restrição. Roteiro com vários passos conta cada mensagem.
        {!cfg.ligado && <b className="text-amber-600"> Envio não oficial DESLIGADO.</b>}
        {cfg.pausado && <b className="text-red-600"> PAUSADO: {cfg.pausado_motivo}</b>}
      </p>

      {!form && <Button size="sm" onClick={() => setForm({ ...VAZIO })}><Plus className="mr-1 h-4 w-4" /> Nova campanha</Button>}

      {form && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="space-y-1"><Label>Nome</Label><Input value={form.nome} onChange={(e) => set({ nome: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Etapas</Label>
            <div className="flex flex-wrap gap-3">
              {KANBAN_COLUMNS.map((c) => (
                <label key={c.id} className="flex items-center gap-1 text-sm">
                  <Checkbox checked={form.etapas.includes(c.id)} onCheckedChange={(v) => set({ etapas: v ? [...form.etapas, c.id] : form.etapas.filter((x) => x !== c.id) })} />
                  {c.title}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Tags (vírgula; qualquer uma)</Label><Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} /></div>
            <div className="space-y-1"><Label>Origens (vírgula)</Label><Input value={form.origens} onChange={(e) => set({ origens: e.target.value })} placeholder="avaliacao, individual" /></div>
            <div className="space-y-1"><Label>Sem resposta há (dias)</Label><Input type="number" min={0} value={form.sem_resposta_dias} onChange={(e) => set({ sem_resposta_dias: e.target.value })} /></div>
          </div>
          <div className="space-y-1">
            <Label>Mensagem</Label>
            <SeletorMensagem roteiros={roteiros} passos={passos} roteiroId={form.roteiro_id} passoId={form.passo_id} onChange={(v) => set(v)} />
            <p className="text-xs text-muted-foreground">Variáveis aceitas no envio automático: {"{primeiro_nome}"}, {"{nome}"}, {"{telefone}"}. Outras ({"{data}"}...) bloqueiam a confirmação.</p>
          </div>
          <div className="space-y-1 max-w-xs">
            <Label>Dividir em lotes de (contatos/dia, opcional)</Label>
            <Input type="number" min={1} value={form.lote_por_dia} onChange={(e) => set({ lote_por_dia: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button onClick={salvar}><Save className="mr-1 h-4 w-4" /> Salvar rascunho</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {campanhas.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma campanha.</p>}
        {campanhas.map((c) => (
          <div key={c.id} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{c.nome} <Badge variant={c.status === "ativa" ? "default" : "outline"} className="ml-1">{ROTULO_STATUS_CAMPANHA[c.status]}</Badge></p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.total ? `${c.total} contatos · ` : ""}{c.roteiro_id ? nomesRoteiros[c.roteiro_id] ?? "roteiro" : "passo"}
                  {c.lote_por_dia ? ` · lotes de ${c.lote_por_dia}/dia` : ""}
                </p>
              </div>
              {ocupado === c.id && <Loader2 className="h-4 w-4 animate-spin" />}
              {c.status === "rascunho" && (
                <>
                  <Button size="sm" onClick={() => contar(c)} disabled={!!ocupado}><Send className="mr-1 h-4 w-4" /> Contar e enviar</Button>
                  <Button size="icon" variant="ghost" onClick={() => editar(c)}><Pencil className="h-4 w-4" /></Button>
                </>
              )}
              {c.status === "ativa" && <Button size="sm" variant="outline" onClick={() => acao(c, "pausar")}><Pause className="mr-1 h-4 w-4" /> Pausar</Button>}
              {c.status === "pausada" && <Button size="sm" variant="outline" onClick={() => acao(c, "retomar")}><Play className="mr-1 h-4 w-4" /> Retomar</Button>}
              {(c.status === "ativa" || c.status === "pausada") && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => acao(c, "cancelar")}><XCircle className="mr-1 h-4 w-4" /> Cancelar</Button>
              )}
              {c.status !== "rascunho" && <Button size="icon" variant="ghost" title="Relatório" onClick={() => verRelatorio(c)}><BarChart3 className="h-4 w-4" /></Button>}
              {["rascunho", "cancelada", "concluida"].includes(c.status) && (
                <Button size="icon" variant="ghost" onClick={() => excluir(c)}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
            {relatorio?.id === c.id && (
              <div className="rounded bg-muted/40 p-2 text-xs flex flex-wrap gap-4">
                <span>Total: <b>{relatorio.r.total}</b></span>
                <span>Enviados: <b>{relatorio.r.enviados}</b></span>
                <span>Responderam: <b>{relatorio.r.respostas}</b></span>
                <span>Falhas: <b>{relatorio.r.porStatus.erro ?? 0}</b></span>
                <span>Pendentes: <b>{relatorio.r.porStatus.pendente ?? 0}</b></span>
                <span>Ignorados: <b>{relatorio.r.porStatus.ignorado ?? 0}</b></span>
                <span>Cancelados: <b>{relatorio.r.porStatus.cancelado ?? 0}</b></span>
              </div>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={!!contagem} onOpenChange={(v) => !v && setContagem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vou enviar para {contagem?.total} contatos</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Campanha "{contagem?.campanha.nome}" pelo WhatsApp não oficial. No ritmo atual leva cerca de{" "}
                  {contagem ? dias(contagem.total, contagem.campanha.lote_por_dia) : 0} dia(s), só das {cfg.hora_inicio}h às {cfg.hora_fim}h.
                  Dá para pausar ou cancelar a qualquer momento.
                </p>
                <p className="text-xs">Primeiros: {contagem?.amostra.slice(0, 8).map((a) => a.name || a.phone).join(", ")}</p>
                {!cfg.ligado && <p className="text-amber-600 text-xs">O envio não oficial está desligado: a fila só anda depois de ligar.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Confirmar envio para {contagem?.total}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
