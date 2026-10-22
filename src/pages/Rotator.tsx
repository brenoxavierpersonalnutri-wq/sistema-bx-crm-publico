import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus, Copy, ArrowLeft, ExternalLink,
  MousePointerClick, ShoppingCart, DollarSign, TrendingUp, Code2, ChevronRight, LogOut,
  Trash2, BarChart3, Settings2, TestTube2,
} from "lucide-react";
import { rotatorApi, RotatorLink, RotatorDestination, RotatorStats, ConversionRule } from "@/lib/rotatorApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VelocidadeCell, ConnectRateCell } from "@/components/rotator/AnalysisCells";
import { OtimizacaoPainel } from "@/components/rotator/OtimizacaoPainel";
import type { MetricaDaVariacao } from "@/lib/pageMetrics";
import { melhorVariacao } from "@/lib/rotatorResultados";
import { buscarMetaDoProjeto, brl, lerMetaConfig, roasECpa, type RotatorMetaTotais } from "@/lib/rotatorMeta";
import { lerPedido, lerValorBR, type TotaisDoTeste, type VendaSemVersao } from "@/lib/rotatorSemVersao";

export default function Rotator() {
  const { toast } = useToast();
  const { signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const idParam = searchParams.get("id");
  const [rotators, setRotators] = useState<RotatorLink[]>([]);
  const [selected, setSelected] = useState<RotatorLink | null>(null);
  const [destinations, setDestinations] = useState<RotatorDestination[]>([]);
  const [stats, setStats] = useState<{ stats: RotatorStats[]; totals: TotaisDoTeste } | null>(null);
  // Conexão medida pelo beacon das páginas (só destinos que mandam beacon, ex.: /desafio/vN).
  const [conexao, setConexao] = useState<Record<string, MetricaDaVariacao>>({});
  const [loading, setLoading] = useState(true);
  const [showPixel, setShowPixel] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState("resultados");

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");

  const DEFAULT_SLOTS = 10;
  const [slots, setSlots] = useState<Array<{ label: string; url: string; weight: number }>>(
    Array.from({ length: DEFAULT_SLOTS }, (_, i) => ({
      label: `v${i + 1}`,
      url: "",
      weight: 10,
    }))
  );

  const [convType, setConvType] = useState<ConversionRule["type"]>("pixel");
  const [convValue, setConvValue] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  // Investimento do Meta (campanhas ligadas ao projeto em rotator_links.meta_config).
  const [meta, setMeta] = useState<RotatorMetaTotais | null>(null);
  const [metaErro, setMetaErro] = useState<string | null>(null);
  const [metaConta, setMetaConta] = useState("");
  const [metaIds, setMetaIds] = useState("");
  const [metaTrecho, setMetaTrecho] = useState("");
  const [metaDesde, setMetaDesde] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  // Vendas sem versão: entram só no total do teste (ver lib/rotatorSemVersao).
  const [semVersao, setSemVersao] = useState<VendaSemVersao[]>([]);
  const [semVersaoErro, setSemVersaoErro] = useState<string | null>(null);
  const [svPedido, setSvPedido] = useState("");
  const [svValor, setSvValor] = useState("");
  const [svQuando, setSvQuando] = useState("");
  const [svNota, setSvNota] = useState("");
  const [savingSv, setSavingSv] = useState(false);

  useEffect(() => { loadRotators(); }, []);
  useEffect(() => {
    if (selected) {
      loadDetails(selected.id);
      const rule = (selected.conversion_rule ?? { type: "pixel" }) as ConversionRule;
      setConvType(rule.type);
      setConvValue(rule.type === "pixel" ? "" : (rule.value ?? ""));
      const cfg = lerMetaConfig(selected.meta_config);
      setMetaConta(cfg?.ad_account_id ?? "");
      setMetaIds((cfg?.campaign_ids ?? []).join(", "));
      setMetaTrecho(cfg?.campaign_name_contains ?? "");
      setMetaDesde(cfg?.since ?? "");
      loadMeta(selected);
    }
  }, [selected]);

  const loadMeta = (r: RotatorLink) => {
    setMeta(null);
    setMetaErro(null);
    buscarMetaDoProjeto(r)
      .then((m) => setMeta(m))
      .catch((e) => setMetaErro(e?.message || "erro ao ler o Meta"));
  };

  const saveMetaConfig = async () => {
    if (!selected) return;
    const conta = metaConta.trim();
    const ids = metaIds.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const vazio = !conta && ids.length === 0 && !metaTrecho.trim();
    const cfg = vazio
      ? null
      : lerMetaConfig({
          ad_account_id: conta,
          campaign_ids: ids,
          campaign_name_contains: metaTrecho,
          since: metaDesde || undefined,
        });
    if (!vazio && !cfg) {
      toast({
        title: "Confira os campos do Meta",
        description: "Conta no formato act_123… e ao menos um ID de campanha ou trecho do nome.",
        variant: "destructive",
      });
      return;
    }
    setSavingMeta(true);
    try {
      await rotatorApi.updateMetaConfig(selected.id, cfg);
      const atualizado = { ...selected, meta_config: cfg };
      setSelected(atualizado);
      setRotators((prev) => prev.map((r) => (r.id === selected.id ? atualizado : r)));
      toast({ title: cfg ? "Campanhas do Meta ligadas!" : "Campanhas do Meta desligadas" });
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSavingMeta(false);
    }
  };

  const saveConversionRule = async () => {
    if (!selected) return;
    setSavingRule(true);
    try {
      const rule: ConversionRule =
        convType === "pixel"
          ? { type: "pixel" }
          : { type: convType, value: convValue.trim() };
      await rotatorApi.updateConversionRule(selected.id, rule);
      setSelected({ ...selected, conversion_rule: rule });
      setRotators((prev) => prev.map((r) => (r.id === selected.id ? { ...r, conversion_rule: rule } : r)));
      if (selected) await loadDetails(selected.id);
      toast({ title: "Regra de conversão salva!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSavingRule(false);
    }
  };

  const loadRotators = async () => {
    setLoading(true);
    try {
      const data = await rotatorApi.getAll();
      setRotators(data);
      if (idParam) {
        const found = data.find(r => r.id === idParam);
        if (found) setSelected(found);
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (id: string) => {
    try {
      const [dests, statsData] = await Promise.all([
        rotatorApi.getDestinations(id),
        rotatorApi.getTotalStats(id),
      ]);
      setDestinations(dests);
      setStats(statsData);
      loadSemVersao(id);
      // Sem bloquear a tela: se a view do beacon ainda não existir no banco, a coluna fica com "—".
      rotatorApi
        .getPageMetrics(id)
        .then((m) => setConexao(Object.fromEntries(m.map((x) => [x.destination_id, x]))))
        .catch(() => setConexao({}));
      const newSlots = Array.from({ length: DEFAULT_SLOTS }, (_, i) => {
        const d = dests[i];
        return d
          ? { label: d.label, url: d.url, weight: d.peso_manual ?? d.weight }
          : { label: `v${i + 1}`, url: "", weight: 10 };
      });
      setSlots(newSlots);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const loadSemVersao = (id: string) => {
    rotatorApi
      .getVendasSemVersao(id)
      .then((v) => { setSemVersao(v); setSemVersaoErro(null); })
      .catch((e) => { setSemVersao([]); setSemVersaoErro(e?.message || "erro ao ler as vendas sem versão"); });
  };

  const addVendaSemVersao = async () => {
    if (!selected) return;
    const pedido = lerPedido(svPedido);
    const valor = lerValorBR(svValor);
    const quando = svQuando ? new Date(svQuando) : null;
    if (!pedido || valor === null || !quando || Number.isNaN(quando.getTime())) {
      toast({
        title: "Confira a venda",
        description: "Informe o código do pedido, o valor pago (ex.: 29,00) e a data e hora da venda.",
        variant: "destructive",
      });
      return;
    }
    setSavingSv(true);
    try {
      await rotatorApi.addVendaSemVersao(selected.id, { order_id: pedido, value: valor, sold_at: quando.toISOString(), note: svNota });
      setSvPedido(""); setSvValor(""); setSvQuando(""); setSvNota("");
      await loadDetails(selected.id);
      toast({ title: "Venda sem versão adicionada" });
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSavingSv(false);
    }
  };

  const removeVendaSemVersao = async (v: VendaSemVersao) => {
    if (!selected) return;
    if (!window.confirm(`Remover a venda ${v.order_id} do total do teste?`)) return;
    try {
      await rotatorApi.removeVendaSemVersao(v.id);
      await loadDetails(selected.id);
      toast({ title: "Venda removida" });
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const createRotator = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    try {
      const rotator = await rotatorApi.create(
        newName.trim(),
        newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
      );
      setRotators([rotator, ...rotators]);
      setNewName("");
      setNewSlug("");
      setShowCreate(false);
      toast({ title: "Teste A/B criado!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const updateSlot = (index: number, field: "label" | "url" | "weight", value: string | number) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const saveDestinations = async () => {
    if (!selected) return;
    try {
      for (const d of destinations) {
        await rotatorApi.removeDestination(d.id);
      }
      const filledSlots = slots.filter((s) => s.url.trim());
      for (const s of filledSlots) {
        await rotatorApi.addDestination(selected.id, s.url.trim(), s.label.trim(), s.weight);
      }
      // Otimização ligada: as variações novas entram com peso manual; recalcula já.
      if (selected.otim_ativa) await rotatorApi.recalcularOtimizacao(selected.id).catch(() => undefined);
      await loadDetails(selected.id);
      toast({ title: "Variações salvas!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const deleteRotator = async (id: string) => {
    try {
      await rotatorApi.delete(id);
      setRotators(rotators.filter((r) => r.id !== id));
      if (selected?.id === id) {
        setSelected(null);
        setDestinations([]);
        setStats(null);
      }
      toast({ title: "Teste removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado!" });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const otimLigada = !!selected?.otim_ativa;
  const filledSlots = slots.filter((s) => s.url.trim());
  const totalWeight = filledSlots.reduce((s, d) => s + d.weight, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/teste">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <TestTube2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Testes A/B</h1>
              <p className="text-xs text-muted-foreground">Crie projetos para testar múltiplas páginas</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {!selected ? (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Header + Create */}
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Testes A/B</h2>
                <Button onClick={() => setShowCreate(!showCreate)} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar
                </Button>
              </div>

              {showCreate && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-primary/20 bg-card p-6">
                  <h3 className="text-sm font-semibold text-foreground mb-4">Novo Teste A/B</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nome do teste (ex: LP Captação)"
                      className="h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <input
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      placeholder="Apelido do link (ex: captacao-mar)"
                      className="h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <Button onClick={createRotator} disabled={!newName.trim() || !newSlug.trim()} className="h-10 gap-2">
                      <Plus className="h-4 w-4" /> Criar Teste
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Project Cards Grid */}
              {loading ? (
                <div className="text-center py-12 text-muted-foreground text-sm">Carregando...</div>
              ) : rotators.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <TestTube2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhum teste criado ainda.</p>
                  <p className="text-xs mt-1">Clique em "+ Criar" para começar seu primeiro teste A/B</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {rotators.map((r, idx) => (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group rounded-xl border border-border bg-card hover:border-primary/40 transition-all cursor-pointer overflow-hidden"
                      onClick={() => { setSelected(r); setActiveTab("resultados"); }}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                              <TestTube2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{r.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                <span className="text-primary/80">$</span> Vendas • {formatDate(r.created_at)}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRotator(r.id); }}
                            className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="border-t border-border/50 px-5 py-3">
                        <Button variant="ghost" className="w-full gap-2 text-muted-foreground hover:text-primary" size="sm">
                          <BarChart3 className="h-4 w-4" /> Ver Resultados
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Detail Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setSelected(null); setStats(null); setMeta(null); setMetaErro(null); setSemVersao([]); setSemVersaoErro(null); }} className="text-muted-foreground hover:text-foreground transition">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <TestTube2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-xl font-bold">{selected.name}</h1>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded">Vendas</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground truncate max-w-md">{rotatorApi.getRedirectUrl(selected.slug)}</p>
                      <button onClick={() => copyToClipboard(rotatorApi.getRedirectUrl(selected.slug))} className="text-primary hover:text-primary/80">
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* KPI Cards */}
              {stats && (() => {
                const sv = stats.totals.sem_versao;
                const nSv = sv.purchases;
                const kpis: Array<{ icon: typeof MousePointerClick; label: string; value: string; sub?: string; hint?: string; title?: string; color: string }> = [
                  { icon: MousePointerClick, label: "Visitas", value: stats.totals.clicks.toLocaleString("pt-BR"), color: "text-primary" },
                  { icon: ShoppingCart, label: "Checkouts", value: `${stats.totals.checkouts}`, sub: `${stats.totals.checkout_rate.toFixed(1)}%`, color: "text-amber-400" },
                  {
                    icon: DollarSign,
                    label: "Conversões",
                    value: `${stats.totals.purchases}`,
                    sub: `${stats.totals.conversion_rate.toFixed(1)}%`,
                    hint: nSv > 0 ? `inclui ${nSv} ${nSv === 1 ? "venda" : "vendas"} sem versão` : undefined,
                    title: nSv > 0 ? `${stats.totals.purchases_atribuidas} atribuída(s) às variações + ${nSv} sem versão` : undefined,
                    color: "text-emerald-400",
                  },
                  {
                    icon: TrendingUp,
                    label: "Receita",
                    value: brl(stats.totals.revenue),
                    hint: nSv > 0 ? `inclui ${brl(sv.revenue)} sem versão` : undefined,
                    title: nSv > 0 ? `${brl(stats.totals.revenue_atribuida)} das variações + ${brl(sv.revenue)} de ${nSv} venda(s) sem versão` : undefined,
                    color: "text-primary",
                  },
                ];
                return (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {kpis.map((kpi) => (
                      <div key={kpi.label} className="rounded-xl border border-border bg-card p-4" title={kpi.title}>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                          <span className="text-xs">{kpi.label}</span>
                        </div>
                        <p className="mt-2 text-xl font-bold text-foreground" data-kpi={kpi.label}>
                          {kpi.value}
                          {kpi.sub && <span className="text-sm font-normal text-muted-foreground ml-1">({kpi.sub})</span>}
                        </p>
                        {kpi.hint && <p className="mt-0.5 text-[11px] text-muted-foreground" data-kpi-hint={kpi.label}>{kpi.hint}</p>}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Investimento do Meta (teste inteiro: as variações dividem os mesmos anúncios) */}
              {lerMetaConfig(selected.meta_config) ? (
                <div className="rounded-xl border border-border bg-card p-4" data-bloco="meta">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Meta Ads · teste inteiro
                    </p>
                    {meta && (
                      <p className="text-[11px] text-muted-foreground" title={meta.campanhas.map((c) => `${c.name} (${c.status}): ${brl(c.spend)}`).join("\n")}>
                        {meta.dateFrom.split("-").reverse().join("/")} a {meta.dateTo.split("-").reverse().join("/")} · {meta.campanhas.length} campanha(s)
                      </p>
                    )}
                  </div>
                  {metaErro ? (
                    <p className="text-sm text-destructive">Não consegui ler o Meta: {metaErro}</p>
                  ) : !meta ? (
                    <p className="text-sm text-muted-foreground">Carregando o Meta…</p>
                  ) : (
                    (() => {
                      const receita = stats?.totals.revenue ?? 0;
                      const compras = stats?.totals.purchases ?? 0;
                      const { roas, cpa } = roasECpa(meta.spend, receita, compras);
                      const itens = [
                        { label: "Investimento", value: brl(meta.spend) },
                        { label: "Alcance", value: meta.reach.toLocaleString("pt-BR"), title: "Soma do alcance de cada campanha" },
                        { label: "CTR (link)", value: `${meta.ctr.toFixed(2).replace(".", ",")}%`, title: `${meta.link_clicks.toLocaleString("pt-BR")} cliques no link em ${meta.impressions.toLocaleString("pt-BR")} impressões` },
                        { label: "CPC (link)", value: meta.cpc > 0 ? brl(meta.cpc) : "—" },
                        { label: "ROAS", value: roas === null ? "—" : `${roas.toFixed(2).replace(".", ",")}x`, title: `Receita do teste (${brl(receita)}, inclui vendas sem versão) ÷ investimento` },
                        { label: "CPA", value: cpa === null ? "—" : brl(cpa), title: `Investimento ÷ compras do teste (${compras}, inclui vendas sem versão; o Meta contou ${meta.purchases_meta})` },
                      ];
                      return (
                        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                          {itens.map((k) => (
                            <div key={k.label} title={k.title}>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                              <p className="mt-1 text-lg font-bold text-foreground" data-metric={k.label}>{k.value}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              ) : null}

              {/* Tabs: Resultados | Configurar | Pixel */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="resultados" className="gap-2"><BarChart3 className="h-4 w-4" /> Resultados</TabsTrigger>
                  <TabsTrigger value="config" className="gap-2"><Settings2 className="h-4 w-4" /> Configurar Variações</TabsTrigger>
                  <TabsTrigger value="pixel" className="gap-2"><Code2 className="h-4 w-4" /> Pixel</TabsTrigger>
                </TabsList>

                {/* Results Table */}
                <TabsContent value="resultados" className="mt-6 space-y-4">
                  <OtimizacaoPainel
                    link={selected}
                    onAtualizado={(l) => {
                      setSelected(l);
                      setRotators((prev) => prev.map((r) => (r.id === l.id ? l : r)));
                      loadDetails(l.id);
                    }}
                    onErro={(m) => toast({ title: "Erro na otimização", description: m, variant: "destructive" })}
                  />
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-xs font-semibold uppercase tracking-wider">Variação</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">Visitas</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Visitas em que a página chegou a aparecer (beacon) ÷ visitas">Carregaram</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Visitas que clicaram no botão de compra">Checkouts</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">Compras</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Compras ÷ visitas">Conversão</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">Receita</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Visitante real (beacon), p75: LCP quando o navegador mede, senão o tempo até a página aparecer">Velocidade</TableHead>
                          {otimLigada && (
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-right" title="Peso atual no sorteio · probabilidade de ser a melhor · status da otimização">Otimização</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats?.stats && stats.stats.length > 0 ? (
                          (() => {
                            const melhor = melhorVariacao(stats.stats);
                            return stats.stats.map((s, i) => {
                              const isBest = s.destination_id === melhor;
                              return (
                                <TableRow
                                  key={s.destination_id}
                                  data-melhor={isBest ? "sim" : undefined}
                                  className={`border-border/30 ${isBest ? "bg-primary/10 hover:bg-primary/15" : ""}`}
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground">{s.label || `v${i + 1}`}</span>
                                      {isBest && (
                                        <span className="inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                          <TrendingUp className="h-3 w-3" /> Melhor
                                        </span>
                                      )}
                                    </div>
                                    <a
                                      href={s.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={s.url}
                                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline truncate max-w-xs mt-0.5"
                                    >
                                      <span className="truncate">{s.url.replace(/^https?:\/\//, "").split("?")[0]}</span>
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  </TableCell>
                                  <TableCell className="text-right font-medium">{s.clicks.toLocaleString("pt-BR")}</TableCell>
                                  <TableCell className="text-right">
                                    <ConnectRateCell metrica={conexao[s.destination_id]} />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="font-medium">{s.checkouts}</div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5">{s.checkout_rate.toFixed(1).replace(".", ",")}%</div>
                                  </TableCell>
                                  <TableCell className="text-right font-medium">{s.purchases}</TableCell>
                                  <TableCell className={`text-right font-bold ${isBest ? "text-primary" : s.conversion_rate > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                                    {s.conversion_rate.toFixed(2).replace(".", ",")}%
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {s.revenue > 0 ? `R$ ${s.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <VelocidadeCell metrica={conexao[s.destination_id]} />
                                  </TableCell>
                                  {otimLigada && (
                                    <TableCell className="text-right" data-testid="otim-celula">
                                      {(() => {
                                        const d = destinations.find((x) => x.id === s.destination_id);
                                        const pct = (v: unknown) => {
                                          const n = parseFloat(String(v ?? ""));
                                          return Number.isFinite(n) ? `${(n * 100).toFixed(1).replace(".", ",")}%` : "—";
                                        };
                                        return (
                                          <>
                                            <div className="font-medium">{pct(d?.otim_peso)}</div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5">melhor: {pct(d?.otim_prob_melhor)}</div>
                                            <div className={`text-[10px] mt-0.5 ${d?.otim_status?.startsWith("campeã") ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                                              {d?.otim_status ?? "aguardando cálculo"}
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </TableCell>
                                  )}
                                </TableRow>
                              );
                            });
                          })()
                        ) : (
                          <TableRow>
                            <TableCell colSpan={otimLigada ? 9 : 8} className="text-center py-12 text-muted-foreground text-sm">
                              Nenhuma variação configurada. Vá em "Configurar Variações" para adicionar páginas.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                {/* Config Tab */}
                <TabsContent value="config" className="mt-6 space-y-6">
                  {/* Campanhas do Meta */}
                  <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold">Campanhas do Meta</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ligue as campanhas que mandam tráfego para este link. Investimento, alcance, CTR, ROAS e CPA passam a aparecer no card e aqui em cima. Campanha entra se o ID estiver na lista ou se o nome contiver o trecho.
                        </p>
                      </div>
                      <Button onClick={saveMetaConfig} size="sm" disabled={savingMeta}>
                        {savingMeta ? "Salvando…" : "Salvar campanhas"}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={metaConta}
                        onChange={(e) => setMetaConta(e.target.value)}
                        placeholder="Conta de anúncios (act_123…)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        type="date"
                        value={metaDesde}
                        onChange={(e) => setMetaDesde(e.target.value)}
                        title="Início do período (vazio = dia em que o projeto foi criado)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        value={metaIds}
                        onChange={(e) => setMetaIds(e.target.value)}
                        placeholder="IDs das campanhas, separados por vírgula"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        value={metaTrecho}
                        onChange={(e) => setMetaTrecho(e.target.value)}
                        placeholder={`Nome contém… (ex.: /r/${selected.slug})`}
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>

                  {/* Vendas sem versão */}
                  <div className="rounded-xl border border-border bg-card p-6" data-bloco="sem-versao">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold">Vendas sem versão</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Vendas aprovadas do produto que chegaram sem a marcação da página (não dá para saber de qual variação vieram). Entram só no total do teste: Conversões, Receita, ROAS e CPA. A tabela por variação não muda. Se o mesmo pedido aparecer depois numa variação, ele deixa de somar aqui sozinho.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_120px_200px_1fr_auto]">
                      <input
                        value={svPedido}
                        onChange={(e) => setSvPedido(e.target.value)}
                        placeholder="Código do pedido (ex.: 13372733)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        value={svValor}
                        onChange={(e) => setSvValor(e.target.value)}
                        inputMode="decimal"
                        placeholder="Valor (29,00)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        type="datetime-local"
                        step={1}
                        value={svQuando}
                        onChange={(e) => setSvQuando(e.target.value)}
                        title="Data e hora da venda (horário deste computador)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <input
                        value={svNota}
                        onChange={(e) => setSvNota(e.target.value)}
                        placeholder="Observação (opcional)"
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <Button onClick={addVendaSemVersao} size="sm" className="h-9 gap-2" disabled={savingSv}>
                        <Plus className="h-4 w-4" /> {savingSv ? "Salvando…" : "Adicionar"}
                      </Button>
                    </div>
                    {semVersaoErro ? (
                      <p className="text-xs text-destructive mt-4">Não consegui ler as vendas sem versão: {semVersaoErro}</p>
                    ) : semVersao.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-4">Nenhuma venda sem versão neste teste.</p>
                    ) : (
                      <div className="mt-4 rounded-lg border border-border/60 overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border/50">
                              <TableHead className="text-xs">Pedido</TableHead>
                              <TableHead className="text-xs">Data</TableHead>
                              <TableHead className="text-xs text-right">Valor</TableHead>
                              <TableHead className="text-xs">Situação</TableHead>
                              <TableHead className="text-xs w-10" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {semVersao.map((v) => (
                              <TableRow key={v.id} className="border-border/30" data-venda-sem-versao={v.order_id}>
                                <TableCell className="text-sm font-medium" title={v.note || undefined}>
                                  {v.order_id}
                                  <span className="block text-[10px] text-muted-foreground">{v.source}</span>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {new Date(v.sold_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </TableCell>
                                <TableCell className="text-sm text-right">{brl(Number(v.value) || 0)}</TableCell>
                                <TableCell className="text-xs">
                                  {v.atribuida ? (
                                    <span className="text-amber-400" title="O mesmo pedido já é compra de uma variação; não soma de novo">já está numa variação (não soma)</span>
                                  ) : (
                                    <span className="text-emerald-400">soma no total</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <button
                                    onClick={() => removeVendaSemVersao(v)}
                                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                    title="Remover"
                                    aria-label={`Remover venda ${v.order_id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Regra de Conversão */}
                  <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold">Regra de Conversão</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Defina o que conta como conversão neste projeto. Ex.: para a "Avaliação", conta como convertida toda lead que chega numa página cuja URL contenha "agendar".
                        </p>
                      </div>
                      <Button onClick={saveConversionRule} size="sm" disabled={savingRule}>
                        {savingRule ? "Salvando…" : "Salvar regra"}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                      <select
                        value={convType}
                        onChange={(e) => setConvType(e.target.value as ConversionRule["type"])}
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <option value="pixel">Pixel manual (cmTrack purchase)</option>
                        <option value="url_contains">URL contém…</option>
                        <option value="url_equals">URL igual a…</option>
                      </select>
                      <input
                        value={convValue}
                        onChange={(e) => setConvValue(e.target.value)}
                        placeholder={convType === "pixel" ? "— não usado —" : convType === "url_contains" ? "ex.: agendar" : "ex.: https://site.com/obrigado"}
                        disabled={convType === "pixel"}
                        className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-3">
                      Requer o pixel instalado em todas as páginas do fluxo (inclusive na página de conversão). O pixel envia um pageview automático que é usado para casar com a regra.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold">Variações do Teste</h3>
                        <p className="text-xs text-muted-foreground mt-1">Configure até 10 páginas para testar. Defina o peso de tráfego para cada uma.</p>
                      </div>
                      <Button onClick={saveDestinations} size="sm">Salvar</Button>
                    </div>

                    {otimLigada && (
                      <div className="mb-4 text-xs font-medium text-primary bg-primary/10 px-3 py-2 rounded-lg">
                        Otimização automática ligada: o sorteio usa os pesos calculados (aba Resultados). Os pesos abaixo
                        voltam a valer quando a otimização for desligada.
                      </div>
                    )}
                    {totalWeight > 0 && totalWeight !== 100 && (
                      <div className="mb-4 text-xs font-medium text-amber-400 bg-amber-400/10 px-3 py-2 rounded-lg">
                        A soma dos pesos é {totalWeight}% — o ideal é 100%
                      </div>
                    )}

                    <div className="space-y-3">
                      {slots.map((slot, i) => {
                        const pctReal = slot.url.trim() && totalWeight > 0 ? ((slot.weight / totalWeight) * 100).toFixed(1) : "—";
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border p-4 transition ${slot.url.trim() ? "border-border bg-secondary/30" : "border-border/20 bg-secondary/5 opacity-50"}`}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                                {i + 1}
                              </span>
                              <span className="text-xs font-semibold text-foreground">{slot.label || `v${i + 1}`}</span>
                              {slot.url.trim() && (
                                <span className="ml-auto text-xs text-primary">{pctReal}% do tráfego</span>
                              )}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[120px_1fr_80px]">
                              <input
                                value={slot.label}
                                onChange={(e) => updateSlot(i, "label", e.target.value)}
                                placeholder="Nome"
                                className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                              <input
                                value={slot.url}
                                onChange={(e) => updateSlot(i, "url", e.target.value)}
                                placeholder="URL (https://...)"
                                className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                              <div className="relative">
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={slot.weight}
                                  onChange={(e) => updateSlot(i, "weight", parseInt(e.target.value) || 1)}
                                  className="h-9 w-full rounded-lg border border-border bg-secondary px-3 pr-7 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>

                {/* Pixel Tab */}
                <TabsContent value="pixel" className="mt-6">
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                      <Code2 className="h-4 w-4 text-primary" /> Pixel de Rastreamento
                    </h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      Cole este código nas suas páginas de destino para rastrear checkouts e compras.
                    </p>
                    <div className="relative">
                      <pre className="overflow-x-auto rounded-lg bg-secondary p-4 text-xs text-foreground">
                        {rotatorApi.getTrackingPixelSnippet(selected.slug)}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(rotatorApi.getTrackingPixelSnippet(selected.slug))}
                        className="absolute right-2 top-2 rounded-lg bg-card p-1.5 text-muted-foreground hover:text-foreground transition"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
