// /crm/banco[/:slug] — Banco de dados, com 3 abas (?aba=):
//   Pessoas (padrão): segmentos (listas prontas) com contagem, lista paginada (uma linha por pessoa), filtros,
//     exportar CSV, enviar para disparo, enviar para o kanban e os fluxos/automações ligados a cada segmento.
//   Registros: public.base_leads crua, uma linha por origem (era a tela Base de leads; /crm/base-leads redireciona).
//   Importar CSV: a porta manual da base (SellFlux/PagTrust) e o histórico por origem.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, KanbanSquare, Loader2, Plus, Send, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { celulaCsv, emLotes } from "@/lib/baseLeads";
import { formatarTelefone } from "@/lib/crm/central";
import { ROTULO_FONTE_ALUNA, regraAlunas, ligadosAoSegmento, type FiltroSegmento, type FiltrosTela, type RegistroGatilho, type Segmento } from "@/lib/crm/segmentos";
import { contarSegmento, lerAtualizadoEm, lerSegmento, lerTudo, useSegmentos, type PessoaBase } from "@/hooks/useSegmentos";
import { PROGRAM_LABELS } from "@/lib/alunaTypes";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { ABAS_BANCO, abaDaUrl, contatosParaKanban, type AbaBanco } from "@/lib/crm/bancoAbas";
import { RegistrosBase } from "@/components/crm/banco/RegistrosBase";
import { ImportarCSV } from "@/components/crm/banco/ImportarCSV";
import { baixarCsv, comVariantes, lerProdutos } from "@/components/crm/banco/dadosBanco";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const POR_PAGINA = 50;
const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
/** Data pura (AAAA-MM-DD, ex.: vencimento) sem o deslocamento de fuso do new Date("AAAA-MM-DD"). */
const diaBR = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("/") : dataBR(d));
const horaBR = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const nomePrograma = (p: string | null | undefined) => (p ? (PROGRAM_LABELS as Record<string, string>)[p] ?? p : "");

export default function BancoCRM() {
  const { slug } = useParams();
  const navegar = useNavigate();
  const [busca, setBusca] = useSearchParams();
  const aba = abaDaUrl(busca.get("aba"));
  const irPara = (a: AbaBanco) => setBusca((p) => { const n = new URLSearchParams(p); if (a === "pessoas") n.delete("aba"); else n.set("aba", a); return n; });
  const { segmentos, provisorio, recarregar } = useSegmentos(aba === "pessoas");
  const [contagens, setContagens] = useState<Map<string, number | null>>(new Map());
  const [ligados, setLigados] = useState<(RegistroGatilho & { tipoRegistro: "fluxo" | "automação" })[]>([]);
  const [novo, setNovo] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);

  const atual = segmentos?.find((s) => s.slug === slug) ?? segmentos?.[0] ?? null;

  useEffect(() => {
    if (!segmentos || aba !== "pessoas") return;
    let vivo = true;
    // cada contagem aparece assim que chega (uma lenta não segura as outras)
    segmentos.forEach(async (s) => {
      const n = await contarSegmento(s);
      if (vivo) setContagens((m) => new Map(m).set(s.id, n));
    });
    lerAtualizadoEm().then((t) => vivo && setAtualizadoEm(t));
    return () => { vivo = false; };
  }, [segmentos, aba]);

  useEffect(() => {
    if (aba !== "pessoas") return;
    (async () => {
      const ler = async (tabela: string) => {
        try {
          const { data } = await db.from(tabela).select("id,nome,ativo,gatilho_tipo,gatilho_valor");
          return (data ?? []) as RegistroGatilho[];
        } catch {
          return [];
        }
      };
      const [f, a] = await Promise.all([ler("crm_fluxos"), ler("crm_automacoes")]);
      setLigados([...f.map((x) => ({ ...x, tipoRegistro: "fluxo" as const })), ...a.map((x) => ({ ...x, tipoRegistro: "automação" as const }))]);
    })();
  }, [aba]);

  return (
    <div className="px-4 py-5 md:px-8 md:py-7 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Banco de dados{segmentos && <span className="ml-2 text-base font-semibold text-muted-foreground tabular-nums">{segmentos.length}</span>}</h2>
          <p className="text-sm text-muted-foreground">
            Todos os leads que chegam ao sistema (formulário, agendamento, compra, aluna, WhatsApp, webhook e CSV).
            {atualizadoEm && <span className="text-xs" data-testid="base-atualizada"> Base atualizada em {horaBR(atualizadoEm)} (a cada 10 min).</span>}
          </p>
        </div>
        {aba === "pessoas" && (
          <Button size="sm" className="h-8" onClick={() => setNovo(true)} disabled={provisorio} title={provisorio ? "A tabela de segmentos ainda não foi criada no banco" : undefined}>
            <Plus className="h-4 w-4 mr-1.5" /> Novo segmento
          </Button>
        )}
      </div>

      <div role="tablist" aria-label="Abas do Banco de dados" className="flex gap-1 border-b">
        {ABAS_BANCO.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} data-testid={`aba-${a.id}`} onClick={() => irPara(a.id)}
            className={`-mb-px border-b-2 px-3 h-9 text-sm ${aba === a.id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "registros" && <RegistrosBase />}
      {aba === "importar" && <ImportarCSV />}

      {aba === "pessoas" && provisorio && segmentos && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Segmentos padrão (a tabela crm_segmentos ainda não está no banco): dá para ver e exportar, ainda não dá para criar novos.</p>
      )}

      {aba !== "pessoas" ? null : !segmentos ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Segmentos" className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1">
            {segmentos.map((s) => {
              const ativo = atual?.id === s.id;
              const n = contagens.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid="segmento"
                  onClick={() => navegar(`/crm/banco/${s.slug}`)}
                  className={`shrink-0 flex items-center justify-between gap-3 rounded-lg px-3 h-10 text-sm text-left ${s.filtro.programa ? "lg:ml-4" : ""} ${ativo ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                >
                  <span className="truncate">{s.nome}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">{contagens.has(s.id) ? (n === null ? "—" : n?.toLocaleString("pt-BR")) : "…"}</span>
                </button>
              );
            })}
          </nav>
          {atual && <DetalheSegmento key={atual.id} segmento={atual} ligados={ligadosAoSegmento(atual, ligados)} />}
        </div>
      )}

      <NovoSegmento aberto={novo} onFechar={() => setNovo(false)} onCriado={async (s) => { setNovo(false); await recarregar(true); navegar(`/crm/banco/${s}`); }} />
    </div>
  );
}

function DetalheSegmento({ segmento, ligados }: { segmento: Segmento; ligados: (RegistroGatilho & { tipoRegistro: string })[] }) {
  const { toast } = useToast();
  const [tela, setTela] = useState<FiltrosTela>({ comTelefone: false });
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<{ pessoas: PessoaBase[]; total: number | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const recorteAlunas = segmento.filtro.alunas ?? null;
  const ehAlunas = !!recorteAlunas;
  const [produtos, setProdutos] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    if (!ehAlunas) lerProdutos().then((p) => vivo && setProdutos(p));
    return () => { vivo = false; };
  }, [ehAlunas]);

  // busca com folga de 400 ms
  useEffect(() => {
    const t = window.setTimeout(() => { setTela((x) => ({ ...x, busca: buscaDigitada })); setPagina(0); }, 400);
    return () => window.clearTimeout(t);
  }, [buscaDigitada]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await lerSegmento(segmento, tela, pagina * POR_PAGINA, POR_PAGINA));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler");
      setDados({ pessoas: [], total: 0 });
    }
  }, [segmento, tela, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const totalPaginas = dados?.total ? Math.ceil(dados.total / POR_PAGINA) : 1;
  const mudar = (patch: Partial<FiltrosTela>) => { setTela((x) => ({ ...x, ...patch })); setPagina(0); };

  async function exportar() {
    setOcupado("Exportando...");
    try {
      const todos = await lerTudo(segmento, tela);
      const cab = (ehAlunas
        ? ["nome", "telefone_e164", "programa", "vencimento", "origens", "primeira_entrada", "ultima_entrada"]
        : ["nome", "telefone_e164", "email", "nivel", "origens", "tags", "produto", "primeira_entrada", "ultima_entrada"]) as (keyof PessoaBase)[];
      const linhas = [cab.join(",")].concat(todos.map((p) => cab.map((c) => celulaCsv(Array.isArray(p[c]) ? (p[c] as string[]).join("|") : p[c])).join(",")));
      baixarCsv(`${segmento.slug}-${new Date().toISOString().slice(0, 10)}.csv`, linhas);
      toast({ title: "CSV exportado", description: `${todos.length} pessoa(s).` });
    } catch (e) {
      toast({ title: "Falha ao exportar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setOcupado(null);
    }
  }

  async function salvarParaDisparo() {
    setOcupado("Montando a lista...");
    try {
      const fones = [...new Set((await lerTudo(segmento, tela)).map((p) => p.telefone_e164).filter(Boolean) as string[])];
      if (!fones.length) { toast({ title: "Nenhuma pessoa com telefone neste filtro" }); return; }
      const nome = window.prompt(`Salvar ${fones.length} telefone(s) como lista para disparo. Nada é enviado agora.`, `${segmento.nome} ${new Date().toLocaleDateString("pt-BR")}`);
      if (!nome) return;
      const { error } = await db.from("base_leads_segmentos").insert({
        nome, filtro: { segmento: segmento.slug, ...segmento.filtro, tela }, telefones: fones, total: fones.length,
      });
      if (error) throw new Error(error.message);
      toast({ title: "Lista salva para disparo", description: `${fones.length} telefone(s). Escolha a mensagem e ligue o envio em Automação.` });
    } catch (e) {
      toast({ title: "Falha ao salvar a lista", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setOcupado(null);
    }
  }

  async function enviarParaKanban() {
    setOcupado("Montando a lista...");
    try {
      const contatos = contatosParaKanban(await lerTudo(segmento, tela));
      if (!contatos.length) { toast({ title: "Nenhuma pessoa com telefone neste filtro" }); return; }
      if (!window.confirm(`Criar até ${contatos.length} contato(s) no kanban (etapa Leads)? Os que já existem não são alterados. Nenhuma mensagem é enviada.`)) return;
      const lotes = emLotes(contatos, 500);
      for (let i = 0; i < lotes.length; i++) {
        setOcupado(`Enviando para o kanban (lote ${i + 1} de ${lotes.length})...`);
        const { error } = await supabase.from("whatsapp_contacts").upsert(lotes[i], { onConflict: "numero_id,phone", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      toast({ title: "Kanban atualizado", description: `${contatos.length} telefone(s) processados; os já existentes não foram alterados.` });
    } catch (e) {
      toast({ title: "Falha ao enviar para o kanban", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="min-w-0 space-y-3" aria-label={segmento.nome}>
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">{segmento.nome}</h3>
            {recorteAlunas ? (
              <p className="text-[11px] leading-snug text-muted-foreground max-w-2xl" data-testid="regra-segmento">{regraAlunas(segmento.filtro)}</p>
            ) : (
              segmento.descricao && <p className="text-xs text-muted-foreground">{segmento.descricao}</p>
            )}
          </div>
          <div className="text-2xl font-bold tabular-nums" data-testid="total-segmento">{dados?.total?.toLocaleString("pt-BR") ?? "…"}</div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1"><Workflow className="h-3.5 w-3.5" /> Fluxos e automações deste segmento</div>
          {ligados.length ? (
            <ul className="flex flex-wrap gap-2">
              {ligados.map((l) => (
                <li key={l.id}>
                  <Link to="/crm/automacao" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted">
                    <span className={`h-2 w-2 rounded-full ${l.ativo ? "bg-emerald-500" : "bg-zinc-400"}`} aria-hidden />
                    {l.nome} <span className="text-muted-foreground">· {l.tipoRegistro} {l.ativo ? "ligado" : "desligado"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum fluxo ou automação com gatilho deste segmento.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder={ehAlunas ? "Buscar nome ou telefone" : "Buscar nome, e-mail ou telefone"} value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} className="h-9 w-64" />
        {ehAlunas && (
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" checked={!!tela.comTelefone} onChange={(e) => mudar({ comTelefone: e.target.checked })} /> Só com telefone
          </label>
        )}
        {!ehAlunas && (
          <>
            <SeletorTags className="w-56" rotulo="Filtrar por tag" placeholder="Todas as tags" valor={tela.tag ? [tela.tag] : []}
              onMudar={async (t) => mudar({ tag: t[0] || undefined, tagVariantes: t[0] ? await comVariantes([t[0]]) : undefined })} />
            {produtos.length > 0 && (
              <label className="text-xs text-muted-foreground">Produto
                <select aria-label="Produto" className="block h-9 max-w-[14rem] rounded-md border bg-background px-2 text-sm" value={tela.produto ?? ""} onChange={(e) => mudar({ produto: e.target.value || undefined })}>
                  <option value="">Todos</option>
                  {produtos.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}
            <label className="text-xs text-muted-foreground">Última entrada de
              <Input type="date" value={tela.de ?? ""} onChange={(e) => mudar({ de: e.target.value || undefined })} className="h-9" />
            </label>
            <label className="text-xs text-muted-foreground">até
              <Input type="date" value={tela.ate ?? ""} onChange={(e) => mudar({ ate: e.target.value || undefined })} className="h-9" />
            </label>
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" checked={!!tela.comTelefone} onChange={(e) => mudar({ comTelefone: e.target.checked })} /> Só com telefone
            </label>
          </>
        )}
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" className="h-9" onClick={exportar} disabled={!!ocupado || !dados?.total}><Download className="h-4 w-4 mr-1.5" />Exportar CSV</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={enviarParaKanban} disabled={!!ocupado || !dados?.total}><KanbanSquare className="h-4 w-4 mr-1.5" />Enviar para o kanban</Button>
          <Button size="sm" className="h-9" onClick={salvarParaDisparo} disabled={!!ocupado || !dados?.total}><Send className="h-4 w-4 mr-1.5" />Enviar para disparo</Button>
        </div>
      </div>
      {ocupado && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{ocupado}</p>}
      {erro && <p className="text-sm text-destructive">Não consegui ler este segmento: {erro}</p>}

      <div className="rounded-xl border bg-card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Nome</th><th className="p-2">Telefone</th>
              {ehAlunas ? (
                <><th className="p-2">Programa</th><th className="p-2">{recorteAlunas === "ativas" ? "Vence" : "Venceu / fechou"}</th><th className="p-2">De onde</th></>
              ) : (
                <><th className="p-2">E-mail</th><th className="p-2">Nível</th><th className="p-2">Origens</th><th className="p-2">Tags</th><th className="p-2">Produto</th><th className="p-2">Última entrada</th></>
              )}
            </tr>
          </thead>
          <tbody>
            {!dados ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</td></tr>
            ) : dados.pessoas.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-muted-foreground">Ninguém neste filtro.</td></tr>
            ) : dados.pessoas.map((p) => (
              <tr key={p.chave} className="border-t" data-testid="linha-pessoa">
                <td className="p-2">{p.nome ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">{p.telefone_e164 ? formatarTelefone(p.telefone_e164) : ""}</td>
                {ehAlunas ? (
                  <>
                    <td className="p-2">{nomePrograma(p.programa)}</td>
                    <td className="p-2 whitespace-nowrap">{p.vencimento ? diaBR(p.vencimento) : dataBR(p.ultima_entrada)}</td>
                    <td className="p-2 text-xs">{p.origens.map((o) => ROTULO_FONTE_ALUNA[o] ?? o).join(", ")}</td>
                  </>
                ) : (
                  <>
                    <td className="p-2">{p.email ?? ""}</td>
                    <td className="p-2">{p.nivel ? <Badge variant="outline">{p.nivel}</Badge> : ""}</td>
                    <td className="p-2 text-xs">{p.origens.join(", ")}</td>
                    <td className="p-2 max-w-[14rem] truncate text-xs" title={p.tags.join(", ")} data-testid="tags-pessoa">{p.tags.join(", ")}</td>
                    <td className="p-2 text-xs">{p.produto ?? ""}</td>
                    <td className="p-2 whitespace-nowrap">{dataBR(p.ultima_entrada)}</td>
                  </>
                )}
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

const ORIGENS = ["avaliacao", "individual", "agendamento", "compra", "aluna", "pagtrust", "sellflux", "crm_whatsapp"];
const NIVEIS = ["A", "B", "C", "D", "DQ"];
const slugDe = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function NovoSegmento({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (slug: string) => void }) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [origens, setOrigens] = useState<string[]>([]);
  const [niveis, setNiveis] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [comprador, setComprador] = useState<"" | "sim" | "nao">("");
  const [salvando, setSalvando] = useState(false);
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  const salvar = async () => {
    const slug = slugDe(nome);
    if (slug.length < 2) return toast({ title: "Dê um nome ao segmento", variant: "destructive" });
    const filtro: FiltroSegmento = {};
    if (origens.length) filtro.origens = origens;
    if (niveis.length) filtro.niveis = niveis;
    // grafias gravadas de fato ("Comprou" e "comprou"): o filtro do segmento é exato
    const t = await comVariantes(tags);
    if (t.length) filtro.tags = t;
    if (comprador) filtro.comprador = comprador === "sim";
    setSalvando(true);
    const { error } = await db.from("crm_segmentos").insert({ slug, nome: nome.trim(), filtro, gatilhos: tags.map((v) => ({ tipo: "tag", valor: v })) });
    setSalvando(false);
    if (error) return toast({ title: "Não salvou", description: error.message, variant: "destructive" });
    setNome(""); setOrigens([]); setNiveis([]); setTags([]); setComprador("");
    onCriado(slug);
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Novo segmento</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <label className="block space-y-1"><span className="text-muted-foreground">Nome</span><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Avaliação nível A" /></label>
          <div className="space-y-1">
            <span className="text-muted-foreground">Origem (qualquer uma)</span>
            <div className="flex flex-wrap gap-1.5">
              {ORIGENS.map((o) => <button key={o} type="button" onClick={() => setOrigens((l) => alternar(l, o))} className={`rounded-full border px-2.5 py-1 text-xs ${origens.includes(o) ? "bg-primary text-primary-foreground border-primary" : ""}`}>{o}</button>)}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground">Nível da avaliação</span>
            <div className="flex flex-wrap gap-1.5">
              {NIVEIS.map((n) => <button key={n} type="button" onClick={() => setNiveis((l) => alternar(l, n))} className={`rounded-full border px-2.5 py-1 text-xs ${niveis.includes(n) ? "bg-primary text-primary-foreground border-primary" : ""}`}>{n}</button>)}
            </div>
          </div>
          <div className="space-y-1"><span className="text-muted-foreground">Tags (qualquer uma)</span><SeletorTags multiplo valor={tags} onMudar={setTags} placeholder="Escolher tags" rotulo="Tags do segmento" /></div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Compra</span>
            <select value={comprador} onChange={(e) => setComprador(e.target.value as "" | "sim" | "nao")} className="h-9 w-full rounded-md border bg-background px-2">
              <option value="">Tanto faz</option><option value="sim">Só quem comprou</option><option value="nao">Só quem nunca comprou</option>
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Criar segmento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
