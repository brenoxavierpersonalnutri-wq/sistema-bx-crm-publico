// Lista de fluxos (como o "Workflows list" do Full Funnel): abas Todos / Rascunhos / Excluídos, busca, pastas,
// colunas de inscritos e estatísticas. Os 5 espelhos do Full Funnel mostram o número de lá ao lado, só de referência.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Folder, FolderPlus, Loader2, MoreHorizontal, Plus, Search, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  FF_REFERENCIA,
  filtrarLista,
  fmtData,
  resumoGatilho,
  type AbaLista,
  type LinhaListaFluxo,
  type Pasta,
} from "@/lib/crm/fluxosConstrutor";
import { useFluxos } from "./contexto";
import { ModeloFollowupIA } from "./ModeloFollowupIA";

const ABAS: { id: AbaLista; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "rascunhos", rotulo: "Rascunhos" },
  { id: "excluidos", rotulo: "Excluídos" },
];

export function ListaFluxos() {
  const { fonte, base } = useFluxos();
  const navegar = useNavigate();
  const { toast } = useToast();
  const [lista, setLista] = useState<LinhaListaFluxo[] | null>(null);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [aba, setAba] = useState<AbaLista>("todos");
  const [busca, setBusca] = useState("");
  const [pasta, setPasta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"fluxo" | "pasta" | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [modeloIA, setModeloIA] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setErro(null);
      const [l, p] = await Promise.all([fonte.listar(), fonte.pastas()]);
      setLista(l);
      setPastas(p);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler os fluxos");
      setLista([]);
    }
  }, [fonte]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => filtrarLista(lista ?? [], aba, busca, pasta), [lista, aba, busca, pasta]);
  const contagem = useMemo(() => ({
    todos: (lista ?? []).filter((f) => !f.excluido_em).length,
    rascunhos: (lista ?? []).filter((f) => !f.excluido_em && !f.ativo).length,
    excluidos: (lista ?? []).filter((f) => f.excluido_em).length,
  }), [lista]);

  const agir = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok }); await carregar(); } catch (e) {
      toast({ title: "Não deu certo", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const confirmarNovo = async () => {
    setOcupado(true);
    try {
      if (dialogo === "pasta") {
        const p = await fonte.criarPasta(nomeNovo.trim() || "Nova pasta");
        setPastas((x) => [...x, p]);
        setPasta(p.id);
      } else {
        const id = await fonte.criar(nomeNovo.trim() || "Novo fluxo", pasta);
        navegar(`${base}/fluxos/${id}`);
      }
      setDialogo(null);
      setNomeNovo("");
    } catch (e) {
      toast({ title: "Não deu certo", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setOcupado(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Fluxos{lista && <span className="ml-2 text-base font-semibold text-muted-foreground tabular-nums">{lista.length}</span>}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Gatilho, passos e ramificações por contato. Tudo nasce como rascunho.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={() => { setNomeNovo(""); setDialogo("pasta"); }}>
            <FolderPlus className="h-4 w-4" /><span className="ml-1.5">Criar pasta</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setModeloIA(true)}>
            <Sparkles className="h-4 w-4" /><span className="ml-1.5">Modelo: Follow-up IA</span>
          </Button>
          <Button size="sm" className="h-8" onClick={() => { setNomeNovo(""); setDialogo("fluxo"); }}>
            <Plus className="h-4 w-4" /><span className="ml-1.5">Criar fluxo</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b">
        <div className="flex gap-1" role="tablist">
          {ABAS.map((a) => (
            <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {a.rotulo} <span className="text-xs text-muted-foreground">({contagem[a.id]})</span>
            </button>
          ))}
        </div>
        <div className="relative mb-1.5 w-full sm:w-64">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar fluxo" className="h-8 pl-8" aria-label="Buscar fluxo" />
        </div>
      </div>

      {pastas.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Pastas">
          <Button variant={pasta === null ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setPasta(null)}>Todas as pastas</Button>
          {pastas.map((p) => (
            <Button key={p.id} variant={pasta === p.id ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setPasta(pasta === p.id ? null : p.id)}>
              <Folder className="h-3.5 w-3.5" /><span className="ml-1">{p.nome}</span>
            </Button>
          ))}
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">Nome</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 text-right font-medium">Total inscritos</th>
              <th className="p-2 text-right font-medium">Inscritos ativos</th>
              <th className="p-2 font-medium">Estatísticas</th>
              <th className="p-2 font-medium">Última atualização</th>
              <th className="p-2 font-medium">Criado em</th>
              <th className="p-2" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {lista === null && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando...</td></tr>
            )}
            {lista !== null && !visiveis.length && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhum fluxo {aba === "excluidos" ? "excluído" : aba === "rascunhos" ? "em rascunho" : "aqui"}.</td></tr>
            )}
            {visiveis.map((f) => {
              const ff = f.origem_ff_workflow_id ? FF_REFERENCIA[f.origem_ff_workflow_id] : undefined;
              const nomePasta = pastas.find((p) => p.id === f.pasta_id)?.nome;
              return (
                <tr key={f.id} className="border-t hover:bg-muted/30">
                  <td className="p-2">
                    <button className="flex items-start gap-2 text-left" onClick={() => navegar(`${base}/fluxos/${f.id}`)}>
                      <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <span className="font-medium hover:underline">{f.nome}</span>
                        <span className="block text-xs text-muted-foreground">
                          {f.gatilhos.length ? f.gatilhos.map((g) => resumoGatilho(g)).join(" ou ") : "sem gatilho"}
                          {nomePasta ? ` · ${nomePasta}` : ""}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="p-2">
                    {f.excluido_em ? <Badge variant="outline">Excluído</Badge>
                      : f.ativo ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Publicado</Badge>
                      : <Badge variant="secondary">Rascunho</Badge>}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {f.resumo ? f.resumo.total_inscritos : "-"}
                    {ff && <span className="block text-[11px] text-muted-foreground" title="Número do Full Funnel, só como referência">no Full Funnel: {ff.inscritos} inscritos</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{f.resumo ? f.resumo.inscritos_ativos : "-"}</td>
                  <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                    {f.resumo ? (
                      <span><b className="text-foreground">{f.resumo.enviados}</b> enviados · <b className="text-foreground">{f.resumo.respondidos}</b> respondidos · <b className={f.resumo.falhas ? "text-destructive" : "text-foreground"}>{f.resumo.falhas}</b> falhas</span>
                    ) : "rode a migration 20261027150000"}
                  </td>
                  <td className="p-2 text-xs whitespace-nowrap">{fmtData(f.updated_at)}</td>
                  <td className="p-2 text-xs whitespace-nowrap">{fmtData(f.created_at)}</td>
                  <td className="p-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Ações de ${f.nome}`}><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navegar(`${base}/fluxos/${f.id}`)}>Abrir construtor</DropdownMenuItem>
                        {!f.excluido_em && (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Mover para pasta</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem onClick={() => agir(() => fonte.moverPasta(f.id, null), "Fluxo sem pasta")}>Sem pasta</DropdownMenuItem>
                              {pastas.map((p) => (
                                <DropdownMenuItem key={p.id} onClick={() => agir(() => fonte.moverPasta(f.id, p.id), `Movido para ${p.nome}`)}>{p.nome}</DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        {f.ativo && !f.excluido_em && (
                          <DropdownMenuItem onClick={() => agir(() => fonte.publicar(f.id, false), "Voltou para rascunho")}>Voltar para rascunho</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {f.excluido_em
                          ? <DropdownMenuItem onClick={() => agir(() => fonte.restaurar(f.id), "Fluxo restaurado (como rascunho)")}>Restaurar</DropdownMenuItem>
                          : <><DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Excluir desliga o fluxo</DropdownMenuLabel>
                            <DropdownMenuItem className="text-destructive" onClick={() => agir(() => fonte.excluir(f.id), "Fluxo excluído")}>Excluir</DropdownMenuItem></>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ModeloFollowupIA aberto={modeloIA} onFechar={() => setModeloIA(false)} pasta={pasta} />

      <Dialog open={dialogo !== null} onOpenChange={(v) => !v && setDialogo(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{dialogo === "pasta" ? "Nova pasta" : "Novo fluxo"}</DialogTitle></DialogHeader>
          <Input autoFocus value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} maxLength={dialogo === "pasta" ? 60 : 120}
            placeholder={dialogo === "pasta" ? "Nome da pasta" : "Nome do fluxo"} onKeyDown={(e) => e.key === "Enter" && confirmarNovo()} />
          {dialogo === "fluxo" && <p className="text-xs text-muted-foreground">Nasce como rascunho{pasta ? " dentro da pasta selecionada" : ""}. Nada é enviado até você publicar.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogo(null)}>Cancelar</Button>
            <Button onClick={confirmarNovo} disabled={ocupado}>{ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
