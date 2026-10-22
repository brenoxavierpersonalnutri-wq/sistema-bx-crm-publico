// Aba "Registros" do Banco de dados: public.base_leads crua, uma linha por origem (antiga tela Base de leads).
// Paginação NO SERVIDOR (50 por página, contagem exata) em vez de baixar as 42 mil linhas no navegador. A política
// de RLS de base_leads já usa (SELECT ...) (migration 20261112100000). O Exportar lê todas as páginas do filtro
// em paralelo (lerTodasAsPaginas, 4 de cada vez).
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { celulaCsv, lerTodasAsPaginas } from "@/lib/baseLeads";
import { formatarTelefone } from "@/lib/crm/central";
import { ROTULO_ORIGEM, aplicarFiltrosRegistros, rotuloOrigem, type FiltrosRegistros } from "@/lib/crm/bancoAbas";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { baixarCsv, comVariantes, lerProdutos, lerResumoOrigens, type ResumoOrigem } from "./dadosBanco";

// base_leads e as RPCs novas ainda não estão nos tipos gerados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const POR_PAGINA = 50;
const TEMPO_MAXIMO_MS = 30_000;
const COLUNAS = "id,origem,origem_id,nome,telefone_e164,email,tags,produto,status,criado_origem";

interface Registro {
  id: string;
  origem: string;
  origem_id: string;
  nome: string | null;
  telefone_e164: string | null;
  email: string | null;
  tags: string[] | null;
  produto: string | null;
  status: string | null;
  criado_origem: string | null;
}

const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

function consulta(f: FiltrosRegistros, cabecalhoContagem: boolean) {
  const q = db.from("base_leads").select(COLUNAS, cabecalhoContagem ? { count: "exact" } : undefined);
  return aplicarFiltrosRegistros(q, f).order("criado_origem", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
}

export function RegistrosBase() {
  const { toast } = useToast();
  const [filtros, setFiltros] = useState<FiltrosRegistros>({});
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<{ linhas: Registro[]; total: number | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoOrigem[] | null>(null);
  const [produtos, setProdutos] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    // resumo e produtos em paralelo com a primeira página
    lerResumoOrigens().then((r) => vivo && setResumo(r));
    lerProdutos().then((p) => vivo && setProdutos(p)); // sem a RPC: filtro de produto fica escondido
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { setFiltros((x) => ({ ...x, busca: buscaDigitada || undefined })); setPagina(0); }, 400);
    return () => window.clearTimeout(t);
  }, [buscaDigitada]);

  const carregar = useCallback(async () => {
    setErro(null);
    setDados(null);
    try {
      const de = pagina * POR_PAGINA;
      const { data, count, error } = await consulta(filtros, true).range(de, de + POR_PAGINA - 1).abortSignal(AbortSignal.timeout(TEMPO_MAXIMO_MS));
      if (error) throw new Error(error.message);
      setDados({ linhas: (data ?? []) as Registro[], total: count ?? null });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDados({ linhas: [], total: 0 });
    }
  }, [filtros, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const mudar = (patch: Partial<FiltrosRegistros>) => { setFiltros((x) => ({ ...x, ...patch })); setPagina(0); };
  const totalPaginas = dados?.total ? Math.ceil(dados.total / POR_PAGINA) : 1;
  const origens = resumo?.map((r) => r.origem) ?? Object.keys(ROTULO_ORIGEM);

  async function exportar() {
    setOcupado("Exportando...");
    try {
      const todos = await lerTodasAsPaginas<Registro>(async (de, ate) => {
        const { data, error } = await consulta(filtros, false).range(de, ate).abortSignal(AbortSignal.timeout(TEMPO_MAXIMO_MS));
        if (error) throw new Error(error.message);
        return (data ?? []) as Registro[];
      }, { tamanho: 1000, paralelo: 4, aoAvancar: (p) => setOcupado(`Exportando... ${p.length} lidos`) });
      const cab = ["origem", "nome", "telefone_e164", "email", "tags", "produto", "status", "criado_origem"] as const;
      baixarCsv(`registros-${new Date().toISOString().slice(0, 10)}.csv`,
        [cab.join(",")].concat(todos.map((l) => cab.map((c) => celulaCsv(l[c])).join(","))));
      toast({ title: "CSV exportado", description: `${todos.length} registro(s).` });
    } catch (e) {
      toast({ title: "Falha ao exportar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="space-y-3" aria-label="Registros">
      <p className="text-sm text-muted-foreground">
        Uma linha por registro de origem (formulário, agendamento, compra, aluna, WhatsApp, CSV). A mesma pessoa aparece uma vez por origem; na aba Pessoas ela vira uma linha só.
      </p>
      {resumo && (
        <div className="flex flex-wrap gap-1.5" data-testid="resumo-origens">
          {resumo.map((r) => (
            <button key={r.origem} type="button" onClick={() => mudar({ origem: filtros.origem === r.origem ? undefined : r.origem })}
              className={`rounded-full border px-2.5 py-1 text-xs ${filtros.origem === r.origem ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
              title={r.ultimo_importado ? `Última entrada na base: ${dataBR(r.ultimo_importado)}` : undefined}>
              {rotuloOrigem(r.origem)} <span className="tabular-nums opacity-70">{r.linhas.toLocaleString("pt-BR")}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Buscar nome, e-mail ou telefone" value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} className="h-9 w-64" />
        <label className="text-xs text-muted-foreground">Origem
          <select aria-label="Origem" className="block h-9 rounded-md border bg-background px-2 text-sm" value={filtros.origem ?? ""} onChange={(e) => mudar({ origem: e.target.value || undefined })}>
            <option value="">Todas</option>
            {origens.map((o) => <option key={o} value={o}>{rotuloOrigem(o)}</option>)}
          </select>
        </label>
        <SeletorTags className="w-56" rotulo="Filtrar por tag" placeholder="Todas as tags" valor={filtros.tag ? [filtros.tag] : []}
          onMudar={async (t) => mudar({ tag: t[0] || undefined, tagVariantes: t[0] ? await comVariantes([t[0]]) : undefined })} />
        {produtos.length > 0 && (
          <label className="text-xs text-muted-foreground">Produto
            <select aria-label="Produto" className="block h-9 max-w-[14rem] rounded-md border bg-background px-2 text-sm" value={filtros.produto ?? ""} onChange={(e) => mudar({ produto: e.target.value || undefined })}>
              <option value="">Todos</option>
              {produtos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-muted-foreground">Criado de
          <Input type="date" value={filtros.de ?? ""} onChange={(e) => mudar({ de: e.target.value || undefined })} className="h-9" />
        </label>
        <label className="text-xs text-muted-foreground">até
          <Input type="date" value={filtros.ate ?? ""} onChange={(e) => mudar({ ate: e.target.value || undefined })} className="h-9" />
        </label>
        <label className="flex items-center gap-2 text-sm h-9">
          <input type="checkbox" checked={!!filtros.comTelefone} onChange={(e) => mudar({ comTelefone: e.target.checked || undefined })} /> Só com telefone
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground tabular-nums" data-testid="total-registros">{dados?.total != null ? `${dados.total.toLocaleString("pt-BR")} registro(s)` : "…"}</span>
          <Button variant="outline" size="sm" className="h-9" onClick={exportar} disabled={!!ocupado || !dados?.total}><Download className="h-4 w-4 mr-1.5" />Exportar CSV</Button>
        </div>
      </div>
      {ocupado && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{ocupado}</p>}
      {erro && <p className="text-sm text-destructive">Não consegui ler os registros: {erro}</p>}

      <div className="rounded-xl border bg-card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Origem</th><th className="p-2">Nome</th><th className="p-2">Telefone</th><th className="p-2">E-mail</th>
              <th className="p-2">Tags</th><th className="p-2">Produto</th><th className="p-2">Criado</th>
            </tr>
          </thead>
          <tbody>
            {!dados ? (
              <tr><td colSpan={7} className="p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</td></tr>
            ) : dados.linhas.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-muted-foreground">Nenhum registro neste filtro.</td></tr>
            ) : dados.linhas.map((l) => (
              <tr key={l.id} className="border-t" data-testid="linha-registro">
                <td className="p-2 text-xs whitespace-nowrap">{rotuloOrigem(l.origem)}</td>
                <td className="p-2">{l.nome ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">{l.telefone_e164 ? formatarTelefone(l.telefone_e164) : ""}</td>
                <td className="p-2">{l.email ?? ""}</td>
                <td className="p-2 max-w-[18rem] truncate text-xs" title={(l.tags ?? []).join(", ")}>{(l.tags ?? []).join(", ")}</td>
                <td className="p-2 text-xs">{l.produto ?? ""}</td>
                <td className="p-2 whitespace-nowrap">{dataBR(l.criado_origem)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">Página {pagina + 1} de {totalPaginas}</span>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setPagina((p) => p + 1)} disabled={pagina + 1 >= totalPaginas} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </section>
  );
}
