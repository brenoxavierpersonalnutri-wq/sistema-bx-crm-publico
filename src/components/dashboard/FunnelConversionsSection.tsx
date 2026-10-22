import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { DollarSign, Target, Users, UserCheck, TrendingUp, Megaphone, Filter, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMetaValue } from "@/lib/revenueUtils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inferFunnelKey } from "@/lib/funnelClassification";
import { usePrivacy } from "@/hooks/usePrivacy";
import { LeadsDrillSheet, DrillLead } from "@/components/shared/LeadsDrillSheet";

interface FunnelSource {
  key: string;
  label: string;
  fill: string;
  matchVia: (via: string | null) => boolean;
}

const FUNNEL_SOURCES: FunnelSource[] = [
  {
    key: "organico",
    label: "Orgânico / Link da Bio",
    fill: "hsl(var(--chart-funnel-organico))",
    matchVia: (via) => via === "organico",
  },
  {
    key: "social_selling",
    label: "Social Selling - Avaliação",
    fill: "hsl(var(--chart-funnel-social))",
    matchVia: (via) => via === "social-selling" || via === "social_selling",
  },
  {
    key: "social_selling_individual",
    label: "Social Selling - Consultoria",
    fill: "hsl(265, 75%, 60%)",
    matchVia: (via) => via === "social-selling" || via === "social_selling",
  },
  {
    key: "low_ticket",
    label: "LOW/PAGINA DE OBRIGADO",
    fill: "hsl(var(--chart-funnel-lowticket))",
    matchVia: (via) =>
      via === "low-ticket" || via === "low_ticket" || via === "api-oficial-low-ticket" || via === "low-14dias" || via === "desafio",
  },
  {
    key: "grupo_individual",
    label: "GRUPO DO LOW - CONSULTORIA",
    fill: "hsl(190, 80%, 50%)",
    matchVia: (via) => via === "grupo-individual",
  },
  {
    key: "grupo_avaliacao",
    label: "GRUPO DO LOW - AVALIAÇÃO",
    fill: "hsl(170, 75%, 45%)",
    matchVia: (via) =>
      via === "grupo-avaliacao" ||
      via === "grupo-low-ticket" ||
      via === "grupo-low" ||
      via === "low-grupo",
  },
  {
    key: "trafego_direto",
    label: "Tráfego Direto",
    fill: "hsl(var(--chart-funnel-direto))",
    matchVia: (via) => !via || via.trim() === "" || via === "trafego" || via === "site" || via === "desafio",
  },
  {
    key: "indicacao",
    label: "Indicação",
    fill: "hsl(var(--chart-funnel-indicacao))",
    matchVia: (via) => via === "indicacao",
  },
  {
    key: "comentou_eu_quero",
    label: "Comentou Eu Quero",
    fill: "hsl(280, 70%, 55%)",
    matchVia: (via) => via === "comentou-eu-quero",
  },
  {
    key: "acomp_individual",
    label: "Acomp. Individual",
    fill: "hsl(var(--chart-funnel-individual))",
    matchVia: (via) => via === "acompanhamento-individual",
  },
  {
    key: "ex_aluna",
    label: "Ex aluna",
    fill: "hsl(340, 70%, 55%)",
    matchVia: (via) => via === "ex-aluna" || via === "ex_aluna",
  },
  {
    key: "renovacao",
    label: "Renovação",
    fill: "hsl(160, 70%, 45%)",
    matchVia: (via) => via === "renovacao" || via === "renovação",
  },
  {
    key: "fluxo_incompleto",
    label: "Fluxo Incompleto",
    fill: "hsl(28, 85%, 55%)",
    matchVia: (via) => via === "fluxo_incompleto" || via === "fluxo-incompleto",
  },
  {
    key: "manychat_seguidor",
    label: "ManyChat · Novo Seguidor",
    fill: "hsl(200, 85%, 55%)",
    matchVia: (via) => via === "manychat" || via === "manychat_seguidor",
  },
  {
    key: "ia_whatsapp",
    label: "IA WhatsApp",
    fill: "hsl(142, 70%, 45%)",
    matchVia: (via) => via === "ia-whatsapp" || via === "ia_whatsapp",
  },
];

export interface MetaAdWithSpend {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  thumbnailUrl: string | null;
  campaignId?: string;
}

interface FunnelConversionsSectionProps {
  consultations: any[];
  dateFrom: string;
  dateTo: string;
  activeFunnel?: string | null;
  onFunnelClick?: (key: string) => void;
  allCampaigns: MetaCampaign[];
  allAds: MetaAdWithSpend[];
  loadingMeta: boolean;
  selectedCampaignIds: string[];
  setSelectedCampaignIds: (ids: string[] | ((prev: string[]) => string[])) => void;
}

export interface MetaCampaign {
  id: string;
  name: string;
  spend: number;
}

// Helper: is this campaign a lead-gen campaign? (starts with "AV")
const isLeadCampaign = (name: string): boolean => {
  return name.trim().toUpperCase().startsWith("AV");
};

export function FunnelConversionsSection({
  consultations,
  dateFrom,
  dateTo,
  activeFunnel,
  onFunnelClick,
  allCampaigns,
  allAds,
  loadingMeta,
  selectedCampaignIds,
  setSelectedCampaignIds,
}: FunnelConversionsSectionProps) {
  // Travado em "trafego_direto" — só faz sentido medir custo de captação aqui
  const selectedCostFunnel = "trafego_direto";
  const [isCampaignDropdownOpen, setIsCampaignDropdownOpen] = useState(false);
  const [drill, setDrill] = useState<{ title: string; leads: DrillLead[] } | null>(null);

  // Apenas campanhas AV (captação de leads) podem aparecer no dropdown global
  const avCampaigns = useMemo(
    () => allCampaigns.filter((c) => isLeadCampaign(c.name)),
    [allCampaigns]
  );

  // Garante que apenas IDs de campanhas AV permaneçam selecionados; auto-marca todas as AV ao carregar
  useEffect(() => {
    if (avCampaigns.length === 0) return;
    const avIds = avCampaigns.map((c) => c.id);
    const filtered = selectedCampaignIds.filter((id) => avIds.includes(id));
    // Se nenhuma AV está marcada, marca todas automaticamente
    if (filtered.length === 0) {
      setSelectedCampaignIds(avIds);
    } else if (filtered.length !== selectedCampaignIds.length) {
      // Remove IDs de campanhas não-AV (ex.: DMD) que estavam marcadas
      setSelectedCampaignIds(filtered);
    }
  }, [avCampaigns]);

  const toDrillLead = (c: any): DrillLead => ({
    id: c.id,
    name: c.clientName ?? c.client_name ?? "Sem nome",
    phone: c.clientPhone ?? c.client_phone ?? null,
    via: c.via ?? null,
    status: c.disqualified ? "Desqualificada" : c.converted ? "Convertida" : c.attended === true ? "Feita" : c.attended === false ? "No-show" : "Agendada",
    score: c.leadScore ?? c.lead_score ?? null,
    date: c.date,
  });

  // Table-specific filters
  const [tableCampaignIds, setTableCampaignIds] = useState<string[]>([]);
  const [tableAdIds, setTableAdIds] = useState<string[]>([]);
  const [isTableCampDropdownOpen, setIsTableCampDropdownOpen] = useState(false);
  const [isTableAdDropdownOpen, setIsTableAdDropdownOpen] = useState(false);

  // Derive available campaigns for the table — use allCampaigns name when available, fallback to ID
  const tableCampaigns = useMemo(() => {
    const map = new Map<string, string>();
    allAds.forEach(ad => {
      if (ad.campaignId) {
        const c = allCampaigns.find(camp => camp.id === ad.campaignId);
        map.set(ad.campaignId, c ? c.name : `Campanha ${ad.campaignId.slice(-6)}`);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .filter(c => c.name.trim().toUpperCase().startsWith("AV"));
  }, [allAds, allCampaigns]);

  // Derive available ads based on selected campaign filter
  const availableAdsForFilter = useMemo(() => {
    if (tableCampaignIds.length === 0) return allAds;
    return allAds.filter(a => tableCampaignIds.includes(a.campaignId || ""));
  }, [allAds, tableCampaignIds]);

  const filteredAds = useMemo(() => {
    let ads = availableAdsForFilter;
    if (tableAdIds.length > 0) {
      ads = ads.filter(a => tableAdIds.includes(a.id));
    }
    return ads.sort((a, b) => b.spend - a.spend);
  }, [availableAdsForFilter, tableAdIds]);

  const matchesFunnel = (consultation: FunnelConversionsSectionProps["consultations"][number], funnelKey: string) => {
    return inferFunnelKey({
      via: consultation.via,
      utmSource: consultation.utmSource,
      utmCampaign: consultation.utmCampaign,
      utmMedium: consultation.utmMedium,
      utmContent: consultation.utmContent,
      utmTerm: consultation.utmTerm,
    }) === funnelKey;
  };

  const funnelMetrics = useMemo(() => {
    return FUNNEL_SOURCES.map((funnel) => {
      const matched = consultations.filter((c) => matchesFunnel(c, funnel.key));
      const agendamentos = matched.length;
      const consultasFeitas = matched.filter((c) => c.attended === true).length;
      const noShows = matched.filter((c) => c.attended === false).length;
      const vendas = matched.filter((c) => c.converted === true).length;
      const disqualified = matched.filter((c) => c.disqualified === true).length;
      const valorTotal = matched
        .filter((c) => c.converted === true)
        .reduce((sum, c) => sum + getMetaValue(c), 0);

      const pctAgendamento = agendamentos; 
      const pctConsulta = agendamentos > 0 ? Math.round((consultasFeitas / agendamentos) * 100) : 0;
      const pctNoShow = agendamentos > 0 ? Math.round((noShows / agendamentos) * 100) : 0;
      const pctVenda = consultasFeitas > 0 ? Math.round((vendas / consultasFeitas) * 100) : 0;
      
      const qualifiedLeads = Math.max(0, agendamentos - disqualified); // Ensure it doesn't go below 0

      return {
        key: funnel.key,
        label: funnel.label,
        fill: funnel.fill,
        agendamentos,
        consultasFeitas,
        noShows,
        vendas,
        qualifiedLeads,
        valorTotal,
        pctConsulta,
        pctNoShow,
        pctVenda,
      };
    });
  }, [consultations]);

  const totals = useMemo(() => {
    const agendamentos = funnelMetrics.reduce((s, f) => s + f.agendamentos, 0);
    const consultasFeitas = funnelMetrics.reduce((s, f) => s + f.consultasFeitas, 0);
    const noShows = funnelMetrics.reduce((s, f) => s + f.noShows, 0);
    const vendas = funnelMetrics.reduce((s, f) => s + f.vendas, 0);
    const qualifiedLeads = funnelMetrics.reduce((s, f) => s + f.qualifiedLeads, 0);
    const valorTotal = funnelMetrics.reduce((s, f) => s + f.valorTotal, 0);
    return { agendamentos, consultasFeitas, noShows, vendas, qualifiedLeads, valorTotal };
  }, [funnelMetrics]);

  // Gasto total = TODAS as campanhas selecionadas no filtro global
  const totalSelectedSpend = useMemo(() => {
    return allCampaigns
      .filter(c => selectedCampaignIds.includes(c.id))
      .reduce((sum, c) => sum + c.spend, 0);
  }, [allCampaigns, selectedCampaignIds]);

  const costKPIs = useMemo(() => {
    const activeFunnelSource = FUNNEL_SOURCES.find(f => f.key === selectedCostFunnel) ?? null;
    
    // Only AV campaigns generate leads — sum their spend
    const avCampaignSpend = allCampaigns
      .filter(c => selectedCampaignIds.includes(c.id) && isLeadCampaign(c.name))
      .reduce((sum, c) => sum + c.spend, 0);

    // "Comentou Eu Quero" também vem de tráfego pago — inclui junto ao Tráfego Direto
    const matchesTrafegoOrComentou = (c: typeof consultations[number]) =>
      matchesFunnel(c, "trafego_direto") || matchesFunnel(c, "comentou_eu_quero");

    let relevantConsultations = consultations.filter(matchesTrafegoOrComentou);

    const qualifiedLeads = Math.max(0, relevantConsultations.length - relevantConsultations.filter((c) => c.disqualified === true).length);
    const consultasFeitas = relevantConsultations.filter((c) => c.attended === true).length;
    const vendas = relevantConsultations.filter((c) => c.converted === true).length;

    return {
      custoLeadQualificado: qualifiedLeads > 0 ? avCampaignSpend / qualifiedLeads : 0,
      custoConsultaFeita: consultasFeitas > 0 ? avCampaignSpend / consultasFeitas : 0,
      custoVenda: vendas > 0 ? avCampaignSpend / vendas : 0,
      spend: avCampaignSpend,
      qualifiedCount: qualifiedLeads,
      consultasCount: consultasFeitas,
      vendasCount: vendas,
    };
  }, [allCampaigns, consultations, selectedCampaignIds, selectedCostFunnel]);

  const chartData = funnelMetrics.map((f) => ({
    name: f.label,
    "% Consulta Feita": f.pctConsulta,
    "% Venda": f.pctVenda,
  }));

  // Meta campaign performance - pie data by spend
  const CAMPAIGN_COLORS = [
    "hsl(210, 80%, 55%)", "hsl(150, 60%, 45%)", "hsl(35, 90%, 55%)",
    "hsl(280, 60%, 55%)", "hsl(0, 70%, 55%)", "hsl(180, 50%, 45%)",
    "hsl(60, 70%, 45%)", "hsl(320, 60%, 50%)",
  ];

  const selectedCampaignsPieData = useMemo(() => {
    return allCampaigns
      .filter((c) => selectedCampaignIds.includes(c.id))
      .map((c, i) => ({
        name: c.name.length > 25 ? c.name.substring(0, 22) + "..." : c.name,
        fullName: c.name,
        value: c.spend,
        fill: CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length],
      }));
  }, [allCampaigns, selectedCampaignIds]);

  const { hidden: privacyHidden } = usePrivacy();
  const formatCurrency = (v: number) => (privacyHidden ? "R$ ••••••" : `R$ ${v.toFixed(2).replace(".", ",")}`);

  const toggleCampaign = (id: string) => {
    setSelectedCampaignIds((prev) =>
      prev.includes(id) ? prev.filter((cId) => cId !== id) : [...prev, id]
    );
  };

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-display font-bold tracking-tight">Conversões & Custos</h2>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Funil travado em Tráfego Direto (única origem com captação paga via AV) */}
          <div className="flex items-center gap-2 h-9 px-3 rounded-md bg-card border border-border/60 text-xs">
            <Filter className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium">Funil: Tráfego Direto + Comentou Eu Quero</span>
          </div>

          {/* Facebook Campaigns Selector (GLOBAL) — apenas campanhas AV */}
          <DropdownMenu open={isCampaignDropdownOpen} onOpenChange={setIsCampaignDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 border-border/60">
                <Megaphone className="h-3.5 w-3.5 text-[#1877F2]" />
                Campanhas AV ({selectedCampaignIds.length})
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[280px] max-h-[400px] overflow-y-auto">
              <DropdownMenuLabel className="text-xs flex items-center justify-between">
                <span>Campanhas de Captação (AV)</span>
                {avCampaigns.length > 0 && (
                  <span 
                    className="text-primary cursor-pointer hover:underline font-normal"
                    onClick={(e) => {
                      e.preventDefault();
                      if (selectedCampaignIds.length === avCampaigns.length) {
                        setSelectedCampaignIds([]);
                      } else {
                        setSelectedCampaignIds(avCampaigns.map(c => c.id));
                      }
                    }}
                  >
                    {selectedCampaignIds.length === avCampaigns.length ? "Desmarcar todas" : "Selecionar todas"}
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {loadingMeta ? (
                <div className="p-2 text-xs text-muted-foreground text-center">Carregando campanhas...</div>
              ) : avCampaigns.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground text-center">Nenhuma campanha AV com gasto encontrada.</div>
              ) : (
                avCampaigns.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={selectedCampaignIds.includes(c.id)}
                    onCheckedChange={() => {
                      setSelectedCampaignIds((prev) =>
                        prev.includes(c.id) ? prev.filter((cId) => cId !== c.id) : [...prev, c.id]
                      );
                    }}
                    onSelect={(e) => e.preventDefault()}
                    className="text-xs py-2 cursor-pointer"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium truncate max-w-[200px]">{c.name}</span>
                      <span className="text-muted-foreground">{formatCurrency(c.spend)} de gasto</span>
                    </div>
                  </DropdownMenuCheckboxItem>
                ))
              )}
              
              {avCampaigns.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="p-2">
                    <Button 
                      className="w-full text-xs h-8" 
                      onClick={() => setIsCampaignDropdownOpen(false)}
                    >
                      OK, Filtrar
                    </Button>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </div>

      {/* BLOCO 3 — Meta Cost Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(() => {
          // Build the same relevant set used by costKPIs so drill matches
          const activeFunnelSource = FUNNEL_SOURCES.find(f => f.key === selectedCostFunnel) ?? null;
          const relevant = consultations.filter(
            (c) => matchesFunnel(c, "trafego_direto") || matchesFunnel(c, "comentou_eu_quero")
          );
          const qualifLeads = relevant.filter((c) => c.disqualified !== true);
          const consultasFeitasLeads = relevant.filter((c) => c.attended === true);
          const vendasLeads = relevant.filter((c) => c.converted === true);

          const kpis = [
            { label: "Gasto na Campanha", value: costKPIs.spend, icon: DollarSign, subtitle: "Total investido na seleção", drillLeads: null as any[] | null, drillTitle: "" },
            { label: "Custo / Lead Qualif. Agendado", value: costKPIs.custoLeadQualificado, icon: Target, subtitle: `${costKPIs.qualifiedCount} leads qualific.`, drillLeads: qualifLeads, drillTitle: `Leads qualificados — ${activeFunnelSource?.label ?? "Tráfego Direto"}` },
            { label: "Custo / Consulta Feita", value: costKPIs.custoConsultaFeita, icon: UserCheck, subtitle: `${costKPIs.consultasCount} consultas feitas`, drillLeads: consultasFeitasLeads, drillTitle: `Consultas feitas — ${activeFunnelSource?.label ?? "Tráfego Direto"}` },
            { label: "Vendas Feitas (Custo / Venda)", value: costKPIs.custoVenda, icon: DollarSign, subtitle: `${costKPIs.vendasCount} vendas convertidas`, drillLeads: vendasLeads, drillTitle: `Vendas convertidas — ${activeFunnelSource?.label ?? "Tráfego Direto"}` },
          ];

          return kpis.map((kpi) => {
            const clickable = !!kpi.drillLeads;
            return (
              <Card
                key={kpi.label}
                className={`border-border/50 ${clickable ? "cursor-pointer hover:border-primary/60 transition-colors" : ""}`}
                onClick={() => {
                  if (clickable && kpi.drillLeads) {
                    setDrill({ title: kpi.drillTitle, leads: kpi.drillLeads.map(toDrillLead) });
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
                    <kpi.icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-xl font-display font-bold">
                    {loadingMeta && allCampaigns.length === 0 ? "..." : kpi.value > 0 ? formatCurrency(kpi.value) : "—"}
                  </p>
                  {kpi.subtitle && (
                    <p className="text-[10px] text-muted-foreground mt-1">{kpi.subtitle}</p>
                  )}
                </CardContent>
              </Card>
            );
          });
        })()}
      </div>

      {/* BLOCO 1 — Tabela de Conversão por Funil */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-display text-base">Métricas de Conversão por Funil</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm outline-none">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Funil</th>
                <th className="py-2 px-3 font-medium text-center">Agendamentos</th>
                <th className="py-2 px-3 font-medium text-center">Consultas Feitas</th>
                <th className="py-2 px-3 font-medium text-center">% Feitas</th>
                <th className="py-2 px-3 font-medium text-center">No-show</th>
                <th className="py-2 px-3 font-medium text-center">% No-show</th>
                <th className="py-2 px-3 font-medium text-center">Vendas</th>
                <th className="py-2 px-3 font-medium text-center">% Venda</th>
                <th className="py-2 pl-3 font-medium text-right">Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              {funnelMetrics.map((f) => (
                <tr 
                  key={f.key} 
                  onClick={() => onFunnelClick?.(f.key)}
                  className={`border-b border-border/40 hover:bg-muted/30 cursor-pointer transition-colors ${activeFunnel === f.key ? 'bg-primary/5' : ''}`}
                >
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.fill }} />
                      <span className="font-medium">{f.label}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono">{f.agendamentos}</td>
                  <td className="py-2.5 px-3 text-center font-mono">{f.consultasFeitas}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-primary">{f.pctConsulta}%</td>
                  <td className="py-2.5 px-3 text-center font-mono">{f.noShows}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-destructive">{f.pctNoShow}%</td>
                  <td className="py-2.5 px-3 text-center font-mono font-semibold text-[hsl(var(--success))]">{f.vendas}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-[hsl(var(--success))]">{f.pctVenda}%</td>
                  <td className="py-2.5 pl-3 text-right font-mono font-semibold">
                    {f.valorTotal > 0 ? formatCurrency(f.valorTotal) : "—"}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-muted/40 font-semibold border-t border-border">
                <td className="py-2.5 pr-3">Total</td>
                <td className="py-2.5 px-3 text-center font-mono">{totals.agendamentos}</td>
                <td className="py-2.5 px-3 text-center font-mono">{totals.consultasFeitas}</td>
                <td className="py-2.5 px-3 text-center font-mono text-primary">
                  {totals.agendamentos > 0 ? Math.round((totals.consultasFeitas / totals.agendamentos) * 100) : 0}%
                </td>
                <td className="py-2.5 px-3 text-center font-mono">{totals.noShows}</td>
                <td className="py-2.5 px-3 text-center font-mono text-destructive">
                  {totals.agendamentos > 0 ? Math.round((totals.noShows / totals.agendamentos) * 100) : 0}%
                </td>
                <td className="py-2.5 px-3 text-center font-mono text-[hsl(var(--success))]">{totals.vendas}</td>
                <td className="py-2.5 px-3 text-center font-mono text-[hsl(var(--success))]">
                  {totals.consultasFeitas > 0 ? Math.round((totals.vendas / totals.consultasFeitas) * 100) : 0}%
                </td>
                <td className="py-2.5 pl-3 text-right font-mono">{formatCurrency(totals.valorTotal)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* BLOCO 2 — Gráfico de % Conversão por Funil */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-display text-base">% Conversão por Funil</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value}%`, undefined]}
              />
              <Legend />
              <Bar dataKey="% Consulta Feita" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="% Venda" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Meta Campaign Spend Distribution Pie */}
      {selectedCampaignsPieData.length > 1 && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="font-display text-base text-center">Distribuição de Gasto por Campanha Meta</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart margin={{ top: 20, right: 50, left: 50, bottom: 20 }}>
                <Pie
                  data={selectedCampaignsPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={60}
                  dataKey="value"
                  label={({ name, percent, value }) =>
                    privacyHidden
                      ? `${name} •••• (${(percent * 100).toFixed(0)}%)`
                      : `${name} R$${value.toFixed(0)} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine
                >
                  {selectedCampaignsPieData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name: string, props: any) => [
                    privacyHidden ? "R$ ••••••" : `R$ ${value.toFixed(2).replace(".", ",")}`,
                    props.payload?.fullName || props.payload?.name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-Ad Spend Breakdown Table with REAL UTM Attribution */}
      {allAds.length > 0 && (
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-[hsl(210,80%,55%)]" />
                  Custo por Anúncio (Meta Ads)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Atribuição real via UTM — cada lead é vinculado ao anúncio que o trouxe (utm_content).</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Campanha Dropdown */}
                <DropdownMenu open={isTableCampDropdownOpen} onOpenChange={setIsTableCampDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2 border-border/60 text-xs">
                      Campanha ({tableCampaignIds.length || "Todas"})
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[280px] max-h-[300px] overflow-y-auto">
                    <DropdownMenuLabel className="text-xs">
                      Filtrar por Campanha
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={tableCampaignIds.length === 0}
                      onCheckedChange={() => setTableCampaignIds([])}
                      className="text-xs"
                    >
                      Todas as Campanhas
                    </DropdownMenuCheckboxItem>
                    
                    {tableCampaigns.length === 0 ? (
                      <div className="p-3 text-xs text-muted-foreground text-center bg-muted/30">
                        Nenhuma campanha encontrada no período selecionado.
                      </div>
                    ) : (
                      tableCampaigns.map(c => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={tableCampaignIds.includes(c.id)}
                          onCheckedChange={(checked) => {
                            if (checked) setTableCampaignIds(prev => [...prev, c.id]);
                            else setTableCampaignIds(prev => prev.filter(id => id !== c.id));
                          }}
                          onSelect={e => e.preventDefault()}
                          className="text-xs"
                        >
                          <span className="truncate max-w-[220px]" title={c.name}>{c.name}</span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Ads Dropdown */}
                <DropdownMenu open={isTableAdDropdownOpen} onOpenChange={setIsTableAdDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2 border-border/60 text-xs">
                      Anúncio ({tableAdIds.length || "Todos"})
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[280px] max-h-[300px] overflow-y-auto">
                    <DropdownMenuLabel className="text-xs flex justify-between items-center">
                      <span>Filtrar Anúncio</span>
                      {tableAdIds.length > 0 && (
                        <span 
                          className="text-primary cursor-pointer hover:underline font-normal"
                          onClick={(e) => { e.preventDefault(); setTableAdIds([]); }}
                        >
                          Limpar
                        </span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {availableAdsForFilter.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground text-center">Nenhum anúncio carregado.</div>
                    ) : (
                      availableAdsForFilter.map(a => (
                        <DropdownMenuCheckboxItem
                          key={a.id}
                          checked={tableAdIds.includes(a.id)}
                          onCheckedChange={(checked) => {
                            if (checked) setTableAdIds(prev => [...prev, a.id]);
                            else setTableAdIds(prev => prev.filter(id => id !== a.id));
                          }}
                          onSelect={e => e.preventDefault()}
                          className="text-xs py-1.5"
                        >
                          <span className="truncate max-w-[220px]" title={a.name}>{a.name}</span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                   <th className="py-2 pr-3 font-medium">Anúncio</th>
                   <th className="py-2 px-3 font-medium text-center">Status</th>
                   <th className="py-2 px-3 font-medium text-right">Gasto</th>
                   <th className="py-2 px-3 font-medium text-center">Impressões</th>
                   <th className="py-2 px-3 font-medium text-center">Cliques</th>
                   <th className="py-2 px-3 font-medium text-center">CTR</th>
                   <th className="py-2 px-3 font-medium text-center">Agend.</th>
                   <th className="py-2 px-3 font-medium text-right">Custo/Lead Qual.</th>
                   <th className="py-2 px-3 font-medium text-right">Custo/Consulta</th>
                   <th className="py-2 pl-3 font-medium text-right">Custo/Venda</th>
                 </tr>
              </thead>
              <tbody>
                {(() => {
                  // Para ads AV: atribui leads de tráfego (direto + comentou eu quero) proporcionalmente
                  const trafegoLeads = consultations.filter(
                    (c) => matchesFunnel(c, "trafego_direto") || matchesFunnel(c, "comentou_eu_quero")
                  );
                  const totalTrafegoQualified = Math.max(1, trafegoLeads.length - trafegoLeads.filter((c) => c.disqualified === true).length);
                  const totalTrafegoConsultas = trafegoLeads.filter((c) => c.attended === true).length;
                  const totalTrafegoVendas = trafegoLeads.filter((c) => c.converted === true).length;
                  
                  // Total spend of all visible AV ads for proportional distribution
                  const totalAvAdSpend = filteredAds
                    .filter(ad => {
                      const camp = allCampaigns.find(c => c.id === ad.campaignId);
                      return camp ? isLeadCampaign(camp.name) : false;
                    })
                    .reduce((sum, ad) => sum + ad.spend, 0);

                  const adRows = filteredAds.map((ad) => {
                    const camp = allCampaigns.find(c => c.id === ad.campaignId);
                    const isAv = camp ? isLeadCampaign(camp.name) : false;
                    
                    // For AV ads: proportionally attribute leads by spend share
                    let adQualified = 0, adConsultas = 0, adVendas = 0, adAgendamentos = 0;
                    if (isAv && totalAvAdSpend > 0) {
                      const spendShare = ad.spend / totalAvAdSpend;
                      adAgendamentos = Math.round(trafegoLeads.length * spendShare);
                      adQualified = Math.round(totalTrafegoQualified * spendShare);
                      adConsultas = Math.round(totalTrafegoConsultas * spendShare);
                      adVendas = Math.round(totalTrafegoVendas * spendShare);
                    }
                    
                    const custoLead = adQualified > 0 ? ad.spend / adQualified : 0;
                    const custoConsulta = adConsultas > 0 ? ad.spend / adConsultas : 0;
                    const custoVenda = adVendas > 0 ? ad.spend / adVendas : 0;

                    return { ad, adAgendamentos, adQualified, adConsultas, adVendas, custoLead, custoConsulta, custoVenda, isAv };
                  });

                  const totalSpend = adRows.reduce((sum, row) => sum + row.ad.spend, 0);
                  const totalImpressions = adRows.reduce((sum, row) => sum + row.ad.impressions, 0);
                  const totalClicks = adRows.reduce((sum, row) => sum + row.ad.clicks, 0);
                  const totalAgendamentos = adRows.reduce((sum, row) => sum + row.adAgendamentos, 0);
                  const totalQualified = adRows.reduce((sum, row) => sum + row.adQualified, 0);
                  const totalConsultas = adRows.reduce((sum, row) => sum + row.adConsultas, 0);
                  const totalVendas = adRows.reduce((sum, row) => sum + row.adVendas, 0);

                  const overallCustoLead = totalQualified > 0 ? totalSpend / totalQualified : 0;
                  const overallCustoConsulta = totalConsultas > 0 ? totalSpend / totalConsultas : 0;
                  const overallCustoVenda = totalVendas > 0 ? totalSpend / totalVendas : 0;

                  return (
                    <>
                      {adRows.map((row) => (
                        <tr key={row.ad.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-2">
                              {row.ad.thumbnailUrl && (
                                <img src={row.ad.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                              )}
                              <span className="font-medium truncate max-w-[200px]" title={row.ad.name}>{row.ad.name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              row.ad.status === "ACTIVE" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"
                            }`}>
                              {row.ad.status === "ACTIVE" ? "Ativo" : row.ad.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-primary">{formatCurrency(row.ad.spend)}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{row.ad.impressions > 1000 ? `${(row.ad.impressions / 1000).toFixed(1)}k` : row.ad.impressions}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{row.ad.clicks}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{row.ad.ctr.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 text-center font-mono font-semibold">{row.adAgendamentos}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.custoLead > 0 ? formatCurrency(row.custoLead) : "—"}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.custoConsulta > 0 ? formatCurrency(row.custoConsulta) : "—"}</td>
                          <td className="py-2.5 pl-3 text-right font-mono font-semibold">{row.custoVenda > 0 ? formatCurrency(row.custoVenda) : "—"}</td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      {adRows.length > 0 && (
                        <tr className="bg-muted/40 font-semibold border-t border-border">
                          <td className="py-2.5 pr-3">Total ({adRows.length} anúncios)</td>
                          <td className="py-2.5 px-3 text-center">—</td>
                          <td className="py-2.5 px-3 text-right font-mono text-primary">{formatCurrency(totalSpend)}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{(totalImpressions / 1000).toFixed(1)}k</td>
                          <td className="py-2.5 px-3 text-center font-mono">{totalClicks}</td>
                          <td className="py-2.5 px-3 text-center">—</td>
                          <td className="py-2.5 px-3 text-center font-mono">{totalAgendamentos}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{overallCustoLead > 0 ? formatCurrency(overallCustoLead) : "—"}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{overallCustoConsulta > 0 ? formatCurrency(overallCustoConsulta) : "—"}</td>
                          <td className="py-2.5 pl-3 text-right font-mono font-semibold">{overallCustoVenda > 0 ? formatCurrency(overallCustoVenda) : "—"}</td>
                        </tr>
                      )}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
    <LeadsDrillSheet
      open={!!drill}
      onOpenChange={(o) => !o && setDrill(null)}
      title={drill?.title ?? ""}
      leads={drill?.leads ?? []}
    />
    </>
  );
}
