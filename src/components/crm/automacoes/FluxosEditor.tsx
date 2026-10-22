// Fluxos de várias etapas (como os workflows do Full Funnel): gatilho + lista de passos.
// Lista, criar/editar, ligar/desligar e ver as execuções. Tudo nasce desligado.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
import {
  EVENTOS_SUGERIDOS,
  MAX_PASSOS,
  ROTULO_GATILHO_FLUXO,
  db,
  resumoPasso,
  templatesNaoAprovados,
  validarFluxo,
  type ExecucaoFluxo,
  type Fluxo,
  type FluxoGatilho,
  type PassoFluxo,
} from "@/lib/crmFluxos";
import { NOMES_ETAPAS, useCatalogo } from "./useCatalogo";
import { useTemplatesOficiais } from "./TemplatesOficiais";
import { NOVO_PASSO, PassoFluxoEditor, ROTULO_TIPO_PASSO, TIPOS_CLASSICOS, rotuloTipoPasso, type TipoPassoClassico } from "./PassoFluxoEditor";
import { useEtapas } from "@/hooks/useEtapas";
import { ItensEtapa } from "@/components/crm/etapas/ItensEtapa";

/** Fluxo montado no construtor visual (árvore, vários gatilhos, passos novos): este editor em lista não mexe nele. */
const doConstrutor = (f: Fluxo & { arvore?: unknown }) =>
  Array.isArray(f.arvore) || (f.gatilhos ?? []).length > 1 || !["tag", "etapa", "evento"].includes(f.gatilho_tipo)
  || (f.passos ?? []).some((p) => !TIPOS_CLASSICOS.includes(p.tipo as TipoPassoClassico));

const VAZIO: Fluxo = {
  id: "", nome: "", descricao: "", ativo: false, gatilho_tipo: "evento", gatilho_valor: "lead_qualificado",
  parar_se_responder: true, permitir_repetir: false, passos: [], ligado_em: null,
};

const STATUS_EXEC: Record<string, string> = { ativo: "em andamento", concluido: "concluído", parado: "parou (respondeu)", erro: "erro", cancelado: "cancelado" };

export function FluxosEditor() {
  const { toast } = useToast();
  const { roteiros, passos: passosRoteiro, nomesRoteiros } = useCatalogo();
  useEtapas(); // re-renderiza com os nomes de crm_etapas (NOMES_ETAPAS)
  const { templates } = useTemplatesOficiais();
  const [lista, setLista] = useState<Fluxo[]>([]);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [form, setForm] = useState<Fluxo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [execs, setExecs] = useState<{ fluxo: Fluxo; linhas: ExecucaoFluxo[] } | null>(null);
  const [novoTipo, setNovoTipo] = useState<TipoPassoClassico>("esperar");
  const [numeros, setNumeros] = useState<{ id: string; apelido: string | null; telefone: string | null; tipo: string | null }[]>([]);
  useEffect(() => {
    // crm_numeros vem da Central (/crm/central); sem a tabela, o seletor mostra só "número padrão"
    db.from("crm_numeros").select("id, apelido, telefone, tipo").then(({ data }: { data: typeof numeros | null }) => setNumeros(data ?? []));
  }, []);
  const nomeNumero = (id: string | null | undefined) => {
    const n = numeros.find((x) => x.id === id);
    return n ? `${n.apelido || n.telefone}${n.tipo === "oficial" ? " (oficial)" : ""}` : null;
  };

  const carregar = useCallback(async () => {
    const { data, error } = await db.from("crm_fluxos").select("*").order("created_at");
    if (error) toast({ title: "Tabela de fluxos não encontrada", description: "Rode a migration 20261023120000.", variant: "destructive" });
    setLista((data ?? []) as Fluxo[]);
    const { data: ativos } = await db.from("crm_fluxo_execucoes").select("fluxo_id").eq("status", "ativo").limit(5000);
    const c: Record<string, number> = {};
    for (const r of (ativos ?? []) as { fluxo_id: string }[]) c[r.fluxo_id] = (c[r.fluxo_id] ?? 0) + 1;
    setContagem(c);
  }, [toast]);
  useEffect(() => { carregar(); }, [carregar]);

  const nomes = { etapas: NOMES_ETAPAS, roteiros: nomesRoteiros };
  const set = (p: Partial<Fluxo>) => setForm((f) => (f ? { ...f, ...p } : f));
  const setPasso = (i: number, p: PassoFluxo) => setForm((f) => (f ? { ...f, passos: f.passos.map((x, j) => (j === i ? p : x)) } : f));
  const moverPasso = (i: number, d: -1 | 1) => setForm((f) => {
    if (!f) return f;
    const ps = [...f.passos];
    const j = i + d;
    if (j < 0 || j >= ps.length) return f;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return { ...f, passos: ps };
  });

  const salvar = async () => {
    if (!form) return;
    const erros = validarFluxo({ ...form, gatilhos: null }); // este editor edita o gatilho único
    if (erros.length) return toast({ title: "Falta ajustar", description: erros.join(" "), variant: "destructive" });
    const fora = templatesNaoAprovados(form, templates);
    if (fora.length && !window.confirm(`Template fora do catálogo aprovado: ${fora.join(", ")}. Salvar mesmo assim?`)) return;
    setSalvando(true);
    const linha = {
      nome: form.nome.trim(), descricao: form.descricao || null, gatilho_tipo: form.gatilho_tipo, gatilho_valor: form.gatilho_valor,
      parar_se_responder: form.parar_se_responder, permitir_repetir: form.permitir_repetir, passos: form.passos,
      // mantém o construtor visual coerente: gatilho único vira a lista; a árvore é refeita a partir dos passos
      // (só com a migration 20261027150000 aplicada: as colunas existem e a linha lida já traz `gatilhos`)
      ...(lista.some((x) => "gatilhos" in x) ? { gatilhos: [{ tipo: form.gatilho_tipo, valor: form.gatilho_valor ?? "" }], arvore: null } : {}),
      ...(numeros.length ? { numero_id: form.numero_id || null } : {}),
    };
    const { error } = form.id
      ? await db.from("crm_fluxos").update(linha).eq("id", form.id)
      : await db.from("crm_fluxos").insert({ ...linha, ativo: false });
    setSalvando(false);
    if (error) return toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    toast({ title: form.id ? "Fluxo atualizado" : "Fluxo criado (desligado)" });
    setForm(null);
    carregar();
  };

  const alternar = async (f: Fluxo, ativo: boolean) => {
    if (ativo) {
      const erros = validarFluxo(f);
      if (erros.length) return toast({ title: "Fluxo incompleto", description: erros.join(" "), variant: "destructive" });
      if (!window.confirm(
        `Ligar "${f.nome}"? Vale só para gatilhos a partir de agora. Template oficial sai pelo Full Funnel; ` +
        "mensagem não oficial só sai com o envio ligado na aba Limites." +
        (f.origem_ff_workflow_id ? " ATENÇÃO: este é espelho de um workflow do Full Funnel; se o de lá continuar ligado, a lead recebe 2x." : ""),
      )) return;
    }
    const { error } = await db.from("crm_fluxos").update({ ativo }).eq("id", f.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    carregar();
  };

  const excluir = async (f: Fluxo) => {
    if (!window.confirm(`Excluir "${f.nome}"? As execuções e a fila dele somem junto.`)) return;
    await db.from("crm_fluxos").delete().eq("id", f.id);
    carregar();
  };

  const verExecucoes = async (f: Fluxo) => {
    const { data } = await db.from("crm_fluxo_execucoes").select("*").eq("fluxo_id", f.id).order("iniciado_em", { ascending: false }).limit(200);
    setExecs({ fluxo: f, linhas: (data ?? []) as ExecucaoFluxo[] });
  };

  const cancelarExec = async (e: ExecucaoFluxo) => {
    const { error } = await db.from("crm_fluxo_execucoes").update({ status: "cancelado", motivo: "cancelado na tela" }).eq("id", e.id).eq("status", "ativo");
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    if (execs) verExecucoes(execs.fluxo);
  };

  return (
    <div className="space-y-4 pt-2">
      {!form && (
        <Button size="sm" onClick={() => { setForm({ ...VAZIO, passos: [] }); setExecs(null); }}>
          <Plus className="mr-1 h-4 w-4" /> Novo fluxo
        </Button>
      )}

      {form && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Nome</Label><Input value={form.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Lead qualificado → avaliação" /></div>
            <div className="space-y-1"><Label>Descrição</Label><Textarea rows={1} value={form.descricao ?? ""} onChange={(e) => set({ descricao: e.target.value })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Começa quando</Label>
              <Select value={form.gatilho_tipo} onValueChange={(v) => set({ gatilho_tipo: v as FluxoGatilho, gatilho_valor: v === "etapa" ? "agendado" : v === "evento" ? "lead_qualificado" : "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ROTULO_GATILHO_FLUXO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{form.gatilho_tipo === "etapa" ? "Etapa" : form.gatilho_tipo === "tag" ? "Tag" : "Evento"}</Label>
              {form.gatilho_tipo === "etapa" ? (
                <Select value={form.gatilho_valor ?? ""} onValueChange={(v) => set({ gatilho_valor: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><ItensEtapa incluir={form.gatilho_valor} /></SelectContent>
                </Select>
              ) : (
                <>
                  <Input list={form.gatilho_tipo === "evento" ? "eventos-fluxo" : undefined} value={form.gatilho_valor ?? ""} onChange={(e) => set({ gatilho_valor: e.target.value })} />
                  <datalist id="eventos-fluxo">{EVENTOS_SUGERIDOS.map((e) => <option key={e} value={e} />)}</datalist>
                </>
              )}
            </div>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.parar_se_responder} onCheckedChange={(v) => set({ parar_se_responder: v })} /> Parar se a lead responder</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.permitir_repetir} onCheckedChange={(v) => set({ permitir_repetir: v })} /> Pode entrar de novo</label>
            </div>
          </div>
          <div className="space-y-1 sm:w-1/2">
            <Label>Número de WhatsApp</Label>
            <Select value={form.numero_id || "__padrao__"} onValueChange={(v) => set({ numero_id: v === "__padrao__" ? null : v })} disabled={!numeros.length}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__padrao__">{numeros.length ? "Número padrão" : "Número padrão (Central de números ainda não instalada)"}</SelectItem>
                {numeros.map((n) => <SelectItem key={n.id} value={n.id}>{n.apelido || n.telefone} · {n.tipo === "oficial" ? "oficial" : "não oficial"}{n.telefone && n.apelido ? ` · ${n.telefone}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {form.gatilho_tipo === "evento" && (
            <p className="text-xs text-muted-foreground">Evento externo = alguém chama <code>crm_registrar_evento(telefone, evento, nome, dados)</code> (PagTrust, formulário). Sem produtor ligado, o fluxo não dispara.</p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Passos</p>
            {form.passos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum passo ainda.</p>}
            {form.passos.map((p, i) => (
              <div key={i} className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{i + 1}</Badge>
                  <span className="text-sm font-medium flex-1">{rotuloTipoPasso(p.tipo)}</span>
                  <Button size="icon" variant="ghost" title="Subir" onClick={() => moverPasso(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Descer" onClick={() => moverPasso(i, 1)} disabled={i === form.passos.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Remover" onClick={() => set({ passos: form.passos.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <PassoFluxoEditor passo={p} idx={i} total={form.passos.length} templates={templates} roteiros={roteiros} passos={passosRoteiro} onChange={(np) => setPasso(i, np)} />
              </div>
            ))}
            {form.passos.length < MAX_PASSOS && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as TipoPassoClassico)}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ROTULO_TIPO_PASSO).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => set({ passos: [...form.passos, structuredClone(NOVO_PASSO[novoTipo])] })}>
                  <Plus className="mr-1 h-4 w-4" /> Adicionar passo
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={salvar} disabled={salvando}>{salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <div className="divide-y rounded-lg border">
        {lista.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum fluxo ainda.</p>}
        {lista.map((f) => (
          <div key={f.id} className="flex items-start gap-3 p-3">
            <Switch checked={f.ativo} onCheckedChange={(v) => alternar(f, v)} className="mt-1" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="font-medium text-sm">
                {f.nome}{" "}
                {f.ativo ? <Badge className="ml-1">ligado</Badge> : <Badge variant="outline" className="ml-1">rascunho</Badge>}
                {f.origem_ff_workflow_id && <Badge variant="secondary" className="ml-1">espelho Full Funnel</Badge>}
                {contagem[f.id] ? <Badge variant="outline" className="ml-1">{contagem[f.id]} em andamento</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROTULO_GATILHO_FLUXO[f.gatilho_tipo]} {f.gatilho_tipo === "etapa" ? NOMES_ETAPAS[f.gatilho_valor ?? ""] ?? f.gatilho_valor : f.gatilho_valor}
                {nomeNumero(f.numero_id) ? ` · ${nomeNumero(f.numero_id)}` : ""}
                {f.parar_se_responder ? " · para se responder" : ""}{f.permitir_repetir ? " · pode repetir" : ""}
              </p>
              <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                {(f.passos ?? []).map((p, i) => <li key={i}>{resumoPasso(p, nomes)}</li>)}
              </ol>
            </div>
            <Button size="icon" variant="ghost" title="Execuções" onClick={() => verExecucoes(f)}><Users className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title={doConstrutor(f) ? "Montado no construtor visual: edite em Automação > Fluxos" : "Editar"} disabled={doConstrutor(f)} onClick={() => { setForm({ ...f, passos: structuredClone(f.passos ?? []) }); setExecs(null); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title="Excluir" onClick={() => excluir(f)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      {execs && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Execuções de “{execs.fluxo.nome}” ({execs.linhas.length})</p>
            <Button size="sm" variant="ghost" onClick={() => setExecs(null)}>Fechar</Button>
          </div>
          {execs.linhas.length === 0 && <p className="text-xs text-muted-foreground">Ninguém entrou neste fluxo ainda.</p>}
          <div className="max-h-64 overflow-y-auto text-xs">
            {execs.linhas.map((e) => (
              <div key={e.id} className="flex items-center gap-2 border-b py-1">
                <span className="font-mono">{e.contact_phone}</span>
                <span>passo {Math.min(e.passo_idx + 1, execs.fluxo.passos.length)}/{execs.fluxo.passos.length}</span>
                <Badge variant="outline">{STATUS_EXEC[e.status] ?? e.status}</Badge>
                <span className="text-muted-foreground flex-1 truncate">{e.status === "ativo" ? `próximo: ${new Date(e.proximo_em).toLocaleString("pt-BR")}` : (e as ExecucaoFluxo & { motivo?: string }).motivo ?? ""}</span>
                {e.status === "ativo" && <Button size="sm" variant="ghost" onClick={() => cancelarExec(e)}>Cancelar</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
