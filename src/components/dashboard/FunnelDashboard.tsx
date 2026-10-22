import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { linkDeWhatsapp } from "@/lib/telefoneDaLead";
import { metaApi } from "@/lib/metaApi";
import { getMetaValue } from "@/lib/revenueUtils";
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from "recharts";
import { Users, UserCheck, UserX, Filter, TrendingUp, Megaphone, ShoppingBag, Globe, MousePointerClick, DollarSign, Calendar as CalendarIcon, LogOut, ChevronDown, Target, PhoneCall, CheckCircle2, Download, MessageCircle, Bot } from "lucide-react";

function exportConsultationsCSV(consults: any[], filenameBase: string) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const funnelLabels: Record<string, string> = {
    organico: "Orgânico / Link da Bio",
    social_selling: "Social Selling - Avaliação",
    social_selling_individual: "Social Selling - Consultoria",
    low_ticket: "LOW/PAGINA DE OBRIGADO",
    grupo_individual: "GRUPO DO LOW - CONSULTORIA",
    grupo_avaliacao: "GRUPO DO LOW - AVALIAÇÃO",
    trafego_direto: "Tráfego Direto",
    indicacao: "Indicação",
    comentou_eu_quero: "Comentou Eu Quero",
    acomp_individual: "Acomp. Individual",
    ex_aluna: "Ex aluna",
    renovacao: "Renovação",
    fluxo_incompleto: "Fluxo Incompleto",
    manychat_seguidor: "ManyChat · Novo Seguidor",
    ia_whatsapp: "IA WhatsApp",
  };
  const header = ["Nome do Cliente", "Funil", "Confirmada", "Convertida", "Programa"];
  const rows = consults.map(c => {
    const funnelKey = inferFunnelKey({
      via: c.via, utmSource: c.utmSource, utmCampaign: c.utmCampaign,
      utmMedium: c.utmMedium, utmContent: c.utmContent, utmTerm: c.utmTerm,
    });
    return [
      c.clientName ?? "",
      funnelLabels[funnelKey] ?? funnelKey,
      c.callConfirmed === true ? "Sim" : c.callConfirmed === false ? "Não" : "—",
      c.converted === true ? "Sim" : c.converted === false ? "Não" : "—",
      c.converted === true ? (c.eventTypeName ?? "—") : "—",
    ];
  });
  const csv = "\uFEFF" + [header, ...rows].map(r => r.map(escape).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase.replace(/[^a-z0-9-_]+/gi, "_")}_${format(new Date(), "yyyy-MM-dd")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
import { DateRange } from "react-day-picker";
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter";
import { FunnelConversionsSection, MetaCampaign, MetaAdWithSpend } from "@/components/dashboard/FunnelConversionsSection";
import { ConsultationTable } from "@/components/ConsultationTable";
import { inferFunnelKey } from "@/lib/funnelClassification";
import { LeadsDrillSheet, DrillLead } from "@/components/shared/LeadsDrillSheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FunnelSource {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  fill: string;
  matchVia: (via: string | null) => boolean;
}

const FUNNEL_SOURCES: FunnelSource[] = [
  {
    key: "organico",
    label: "Orgânico / Link da Bio",
    icon: <Globe className="h-4 w-4" />,
    color: "text-success",
    fill: "hsl(var(--chart-funnel-organico))",
    matchVia: (via) => via === "organico",
  },
  {
    key: "social_selling",
    label: "Social Selling - Avaliação",
    icon: <Megaphone className="h-4 w-4" />,
    color: "text-primary",
    fill: "hsl(var(--chart-funnel-social))",
    matchVia: (via) => via === "social-selling" || via === "social_selling",
  },
  {
    key: "social_selling_individual",
    label: "Social Selling - Consultoria",
    icon: <Megaphone className="h-4 w-4" />,
    color: "text-primary",
    fill: "hsl(265, 75%, 60%)",
    matchVia: (via) => via === "social-selling" || via === "social_selling",
  },
  {
    key: "low_ticket",
    label: "LOW/PAGINA DE OBRIGADO",
    icon: <ShoppingBag className="h-4 w-4" />,
    color: "text-warning",
    fill: "hsl(var(--chart-funnel-lowticket))",
    matchVia: (via) =>
      via === "low-ticket" ||
      via === "low_ticket" ||
      via === "api-oficial-low-ticket" ||
      via === "low-14dias" ||
      via === "desafio",
  },
  {
    key: "grupo_individual",
    label: "GRUPO DO LOW - CONSULTORIA",
    icon: <Users className="h-4 w-4" />,
    color: "text-cyan-500",
    fill: "hsl(190, 80%, 50%)",
    matchVia: (via) => via === "grupo-individual",
  },
  {
    key: "grupo_avaliacao",
    label: "GRUPO DO LOW - AVALIAÇÃO",
    icon: <Users className="h-4 w-4" />,
    color: "text-teal-500",
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
    icon: <TrendingUp className="h-4 w-4" />,
    color: "text-purple-500",
    fill: "hsl(var(--chart-funnel-direto))",
    matchVia: (via) =>
      !via ||
      via.trim() === "" ||
      via === "trafego" ||
      via === "site" ||
      via === "desafio",
  },
  {
    key: "indicacao",
    label: "Indicação",
    icon: <UserCheck className="h-4 w-4" />,
    color: "text-accent",
    fill: "hsl(var(--chart-funnel-indicacao))",
    matchVia: (via) => via === "indicacao",
  },
  {
    key: "comentou_eu_quero",
    label: "Comentou Eu Quero",
    icon: <Megaphone className="h-4 w-4" />,
    color: "text-purple-500",
    fill: "hsl(280, 70%, 55%)",
    matchVia: (via) => via === "comentou-eu-quero",
  },
  {
    key: "acomp_individual",
    label: "Acomp. Individual",
    icon: <Users className="h-4 w-4" />,
    color: "text-muted-foreground",
    fill: "hsl(var(--chart-funnel-individual))",
    matchVia: (via) => via === "acompanhamento-individual",
  },
  {
    key: "ex_aluna",
    label: "Ex aluna",
    icon: <UserX className="h-4 w-4" />,
    color: "text-rose-400",
    fill: "hsl(340, 70%, 55%)",
    matchVia: (via) => via === "ex-aluna" || via === "ex_aluna",
  },
  {
    key: "renovacao",
    label: "Renovação",
    icon: <UserCheck className="h-4 w-4" />,
    color: "text-emerald-400",
    fill: "hsl(160, 70%, 45%)",
    matchVia: (via) => via === "renovacao" || via === "renovação",
  },
  {
    key: "fluxo_incompleto",
    label: "Fluxo Incompleto",
    icon: <UserCheck className="h-4 w-4" />,
    color: "text-orange-400",
    fill: "hsl(28, 85%, 55%)",
    matchVia: (via) => via === "fluxo_incompleto" || via === "fluxo-incompleto",
  },
  {
    key: "manychat_seguidor",
    label: "ManyChat · Novo Seguidor",
    icon: <UserCheck className="h-4 w-4" />,
    color: "text-sky-400",
    fill: "hsl(200, 85%, 55%)",
    matchVia: (via) => via === "manychat" || via === "manychat_seguidor",
  },
  {
    key: "ia_whatsapp",
    label: "IA WhatsApp",
    icon: <Bot className="h-4 w-4" />,
    color: "text-green-500",
    fill: "hsl(142, 70%, 45%)",
    matchVia: (via) => via === "ia-whatsapp" || via === "ia_whatsapp",
  },
];

interface ConsultationRow {
  id: string;
  via: string | null;
  date: string;
  attended: boolean | null;
  converted: boolean | null;
  [key: string]: any;
}

import { mapToConsultation, DbConsultation, useConsultations } from "@/hooks/useConsultations";

interface FunnelStats {
  key: string;
  label: string;
  total: number;
  attended: number;
  attendedPercent: number;
  noShows: number;
  noShowsPercent: number;
  pending: number;
  pendingPercent: number;
  converted: number;
  convertedPercent: number;
  qualified: number; // for charts
  disqualified: number; // for charts
  qualifiedPercent: number;
  disqualifiedPercent: number;
  fill: string;
}

interface FunnelDashboardProps {
  dateRange?: DateRange;
}

const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.05) return null; // don't show label for very small slices
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
  const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);

  return (
    <text x={x} y={y} fill="currentColor" className="text-foreground" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export function FunnelDashboard({ dateRange: externalDateRange }: FunnelDashboardProps) {
  const { data: allConsultations, isLoading: loading } = useConsultations();
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(() => {
    const saved = sessionStorage.getItem("funnelDashboardDateRange");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.from) {
          return {
            from: new Date(parsed.from),
            to: parsed.to ? new Date(parsed.to) : undefined,
          };
        }
      } catch (e) {
        console.error("Error parsing saved date range", e);
      }
    }
    return undefined; // "TIRE ESSA ORIENTACAO, DEIXE ELE LIMPO"
  });

  useEffect(() => {
    if (localDateRange) {
      sessionStorage.setItem("funnelDashboardDateRange", JSON.stringify(localDateRange));
    } else {
      sessionStorage.removeItem("funnelDashboardDateRange");
    }
  }, [localDateRange]);
  const [selectedFunnelCard, setSelectedFunnelCard] = useState<string | null>(null);
  const [selectedSpecialCard, setSelectedSpecialCard] = useState<"reschedule" | "incomplete" | "sem_wpp" | null>(null);
  const [drillKpi, setDrillKpi] = useState<null | "leads" | "calls_confirmadas" | "feitas" | "convertidos" | "pagamento_ok" | "noshow" | "perdidos" | "spend" | "revenue">(null);
  const [allCampaigns, setAllCampaigns] = useState<MetaCampaign[]>([]);
  const [allAds, setAllAds] = useState<MetaAdWithSpend[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);

  const activeDateRange = externalDateRange || localDateRange;
  const tableRef = useRef<HTMLDivElement>(null);

  const dateFilter = useMemo(() => {
    if (activeDateRange?.from) {
      return {
        from: format(activeDateRange.from, "yyyy-MM-dd"),
        to: activeDateRange.to ? format(activeDateRange.to, "yyyy-MM-dd") : format(activeDateRange.from, "yyyy-MM-dd"),
      };
    }
    return undefined;
  }, [activeDateRange]);

  const consultations = useMemo(() => {
    if (!allConsultations) return [];
    if (!dateFilter) return allConsultations;
    return allConsultations.filter(c => c.date >= dateFilter.from && c.date <= dateFilter.to);
  }, [allConsultations, dateFilter]);

  const matchesFunnel = useCallback((consultation: ConsultationRow, funnelKey: string) => {
    return inferFunnelKey({
      via: consultation.via,
      utmSource: consultation.utmSource,
      utmCampaign: consultation.utmCampaign,
      utmMedium: consultation.utmMedium,
      utmContent: consultation.utmContent,
      utmTerm: consultation.utmTerm,
    }) === funnelKey;
  }, []);

  // Fetch Meta campaigns for global spend
  useEffect(() => {
    const fetchMetaSpend = async () => {
      setLoadingMeta(true);
      try {
        // Use cached metaApi (sequential to avoid Meta rate limits)
        // format as "YYYY-MM-DD" — raw Date objects serialize to ISO with timezone
        // and Meta API silently falls back to last_30d when it can't parse the format
        const dFrom = dateFilter?.from ? format(dateFilter.from, "yyyy-MM-dd") : undefined;
        const dTo = dateFilter?.to ? format(dateFilter.to, "yyyy-MM-dd") : undefined;
        const campaignsRes = await metaApi.getCampaigns("", dFrom, dTo);
        
        if (campaignsRes.success && campaignsRes.data) {
          const fetchedCampaigns = campaignsRes.data
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              spend: c.insights?.data?.[0]?.spend ? parseFloat(c.insights.data[0].spend) : 0,
            }))
            .filter((c: MetaCampaign) => c.spend > 0);
          setAllCampaigns(fetchedCampaigns);
          
          if (fetchedCampaigns.length > 0 && selectedCampaignIds.length === 0) {
            // Seleciona todas as campanhas por padrão para que o Gasto Total seja exato
            setSelectedCampaignIds(fetchedCampaigns.map((c: MetaCampaign) => c.id));
          }
        }

        const adsRes = await metaApi.getAds("", dFrom, dTo);
        
        if (adsRes.success && adsRes.data) {
          const fetchedAds: MetaAdWithSpend[] = adsRes.data
            .map((a: any) => ({
              id: a.id,
              name: a.name,
              status: a.status,
              campaignId: a.campaign_id,
              spend: a.insights?.data?.[0]?.spend ? parseFloat(a.insights.data[0].spend) : 0,
              impressions: a.insights?.data?.[0]?.impressions ? parseInt(a.insights.data[0].impressions) : 0,
              clicks: a.insights?.data?.[0]?.clicks ? parseInt(a.insights.data[0].clicks) : 0,
              ctr: a.insights?.data?.[0]?.ctr ? parseFloat(a.insights.data[0].ctr) : 0,
              thumbnailUrl: a.creative?.thumbnail_url || null,
            }))
            .filter((a: MetaAdWithSpend) => a.spend > 0);
          setAllAds(fetchedAds);
        }
      } catch (err) {
        console.error("Failed to fetch meta data", err);
      } finally {
        setLoadingMeta(false);
      }
    };
    fetchMetaSpend();
  }, [dateFilter]);

  const funnelStats = useMemo((): (FunnelStats & { confirmed: number; confirmedPercent: number })[] => {
    return FUNNEL_SOURCES.map((funnel) => {
      const matched = consultations.filter((c) => matchesFunnel(c, funnel.key));
      const total = matched.length;
      
      const confirmed = matched.filter((c) => c.callConfirmed === true).length;
      const attended = matched.filter((c) => c.attended === true).length;
      // No-show = confirmou a reunião mas não compareceu
      const noShows = matched.filter((c) => c.callConfirmed === true && c.attended === false).length;
      const pending = total - (attended + matched.filter((c) => c.attended === false).length);
      const converted = matched.filter((c) => c.converted === true).length;
      
      // Feitas calculadas sobre as confirmadas
      const attendedPercent = confirmed > 0 ? Math.round((attended / confirmed) * 100) : 0;
      // No-show calculado sobre as confirmadas
      const noShowsPercent = confirmed > 0 ? Math.round((noShows / confirmed) * 100) : 0;
      const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;
      const confirmedPercent = total > 0 ? Math.round((confirmed / total) * 100) : 0;
      // Conversão calculada sobre as feitas
      const convertedPercent = attended > 0 ? Math.round((converted / attended) * 100) : 0;

      // Update qualified math to match the new definitions from Custo/Lead
      const explicitlyDisqualified = matched.filter((c) => c.disqualified === true).length;
      const qualified = Math.max(0, total - explicitlyDisqualified);
      const disqualified = explicitlyDisqualified;
      const qualifiedPercent = total > 0 ? Math.round((qualified / total) * 100) : 0;
      const disqualifiedPercent = total > 0 ? Math.round((disqualified / total) * 100) : 0;

      return {
        key: funnel.key,
        label: funnel.label,
        total,
        attended,
        attendedPercent,
        noShows,
        noShowsPercent,
        pending,
        pendingPercent,
        converted,
        convertedPercent,
        qualified,
        disqualified,
        qualifiedPercent,
        disqualifiedPercent,
        confirmed,
        confirmedPercent,
        fill: funnel.fill,
      };
    });
  }, [consultations, matchesFunnel]);

  const totalLeads = funnelStats.reduce((s, f) => s + f.total, 0);
  const totalQualified = funnelStats.reduce((s, f) => s + f.qualified, 0);
  const totalDisqualified = funnelStats.reduce((s, f) => s + f.disqualified, 0);
  const totalConverted = funnelStats.reduce((s, f) => s + f.converted, 0);
  const totalAttended = funnelStats.reduce((s, f) => s + f.attended, 0);
  const totalNoShows = funnelStats.reduce((s, f) => s + f.noShows, 0);
  const totalCallsConfirmadas = consultations.filter(c => c.callConfirmed === true).length;
  const totalFutureReschedule = consultations.filter(c => c.is_future_reschedule === true).length;
  const totalIncompleteFlow = consultations.filter(c => c.is_incomplete_flow === true).length;
  const semWppList = consultations.filter(c =>
    c.callConfirmed !== true &&
    c.attended !== false &&
    c.is_future_reschedule !== true &&
    c.is_incomplete_flow !== true &&
    c.disqualified !== true &&
    c.refunded !== true
  );
  const totalSemWpp = semWppList.length;
  const overallQualifiedPercent = totalLeads > 0 ? Math.round((totalQualified / totalLeads) * 100) : 0;
  const overallDisqualifiedPercent = totalLeads > 0 ? Math.round((totalDisqualified / totalLeads) * 100) : 0;
  const overallConvertedPercent = totalAttended > 0 ? Math.round((totalConverted / totalAttended) * 100) : 0;
  const overallCallsConfirmadasPercent = totalLeads > 0 ? Math.round((totalCallsConfirmadas / totalLeads) * 100) : 0;
  const overallAttendedPercent = totalCallsConfirmadas > 0 ? Math.round((totalAttended / totalCallsConfirmadas) * 100) : 0;
  const overallNoShowPercent = totalCallsConfirmadas > 0 ? Math.round((totalNoShows / totalCallsConfirmadas) * 100) : 0;

  // Faturamento = MESMO cálculo do Geral (getMetaValue)
  const totalRevenue = consultations
    .filter((c) => c.converted === true)
    .reduce((sum, c) => sum + getMetaValue(c), 0);

  // Gasto Tráfego = apenas campanhas que começam com "AV" (captação de leads)
  const isAVCampaign = (name: string) => /^\s*av[\s\-_|]/i.test(name) || /^av\b/i.test(name.trim());
  const totalMktSpend = allCampaigns
    .filter((c) => isAVCampaign(c.name))
    .reduce((sum, c) => sum + c.spend, 0);
  // ROAS = Faturamento / (Gasto + 13,8% imposto Meta)
  const totalInvestido = totalMktSpend * 1.138;
  const roas = totalInvestido > 0 ? totalRevenue / totalInvestido : null;

  const pieData = funnelStats
    .filter((f) => f.total > 0)
    .map((f) => ({
      name: f.label,
      value: f.total,
      fill: f.fill,
    }));

  const pieDataConsultas = funnelStats
    .filter((f) => f.attended > 0)
    .map((f) => ({
      name: f.label,
      value: f.attended,
      fill: f.fill,
    }));

  const pieDataVendas = funnelStats
    .filter((f) => f.converted > 0)
    .map((f) => ({
      name: f.label,
      value: f.converted,
      fill: f.fill,
    }));

  const pieDataNoShow = funnelStats
    .filter((f) => f.noShows > 0)
    .map((f) => ({
      name: f.label,
      value: f.noShows,
      fill: f.fill,
    }));

  const pieDataDesqualificados = funnelStats
    .filter((f) => f.disqualified > 0)
    .map((f) => ({
      name: f.label,
      value: f.disqualified,
      fill: f.fill,
    }));

  const handleCardClick = (funnelKey: string) => {
    setSelectedFunnelCard(prev => prev === funnelKey ? null : funnelKey);
    setSelectedSpecialCard(null);
    setTimeout(() => {
      if (tableRef.current && funnelKey !== selectedFunnelCard) {
        tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const filteredTableConsultations = useMemo(() => {
    if (!selectedFunnelCard) return [];
    return consultations.filter((c) => matchesFunnel(c, selectedFunnelCard));
  }, [consultations, selectedFunnelCard, matchesFunnel]);

  const selectedCardLabel = FUNNEL_SOURCES.find(f => f.key === selectedFunnelCard)?.label;

  const toDrillLead = useCallback((c: any): DrillLead => ({
    id: c.id,
    name: c.clientName || c.client_name || "—",
    phone: c.clientPhone || c.client_phone || null,
    via: c.via || null,
    status: c.converted === true ? "Convertido" : c.disqualified === true ? "Desqualificado" : c.attended === true ? "Compareceu" : c.attended === false ? "No-show" : "Pendente",
    score: c.leadScore ?? c.lead_score ?? null,
    date: c.date,
  }), []);

  const drillData = useMemo(() => {
    if (!drillKpi) return { title: "", consults: [] as any[] };
    if (drillKpi === "leads") {
      return { title: `Consultas Agendadas (${totalLeads})`, consults: consultations };
    }
    if (drillKpi === "calls_confirmadas") {
      const list = consultations.filter(c => c.callConfirmed === true);
      return { title: `Calls Confirmadas (${list.length})`, consults: list };
    }
    if (drillKpi === "feitas") {
      const list = consultations.filter(c => c.attended === true);
      return { title: `Consultas Feitas (${list.length})`, consults: list };
    }
    if (drillKpi === "convertidos") {
      return { title: `Vendas Convertidas (${totalConverted})`, consults: consultations.filter(c => c.converted === true) };
    }
    if (drillKpi === "pagamento_ok") {
      const list = consultations.filter(c => c.converted === true && c.refunded !== true);
      return { title: `Convertidas / Pagamento OK (${list.length})`, consults: list };
    }
    if (drillKpi === "noshow") {
      const list = consultations.filter(c => c.callConfirmed === true && c.attended === false);
      return { title: `No-Show (${list.length})`, consults: list };
    }
    if (drillKpi === "perdidos") {
      return { title: `Perdidos / Desqualificados (${totalDisqualified})`, consults: consultations.filter(c => c.disqualified === true) };
    }
    if (drillKpi === "spend") {
      const avLeads = consultations.filter(c => inferFunnelKey({ via: c.via, utmSource: c.utmSource, utmCampaign: c.utmCampaign, utmMedium: c.utmMedium, utmContent: c.utmContent, utmTerm: c.utmTerm }) === "trafego_direto");
      return { title: `Leads de Tráfego (campanhas AV) (${avLeads.length})`, consults: avLeads };
    }
    if (drillKpi === "revenue") {
      return { title: `Faturamento — Vendas (${totalConverted})`, consults: consultations.filter(c => c.converted === true) };
    }
    return { title: "", consults: [] as any[] };
  }, [drillKpi, consultations, totalLeads, totalConverted, totalDisqualified]);

  // Selected funnels for "Análise por Funil" — vazio por padrão (sem gráficos abertos)
  const [efficiencyFunnels, setEfficiencyFunnels] = useState<string[]>([]);
  const [isEfficiencyOpen, setIsEfficiencyOpen] = useState(false);
  type AnalysisMetric = "efficiency" | "noshow" | "confirmed" | "scheduled" | "feitas";
  const [analysisMetric, setAnalysisMetric] = useState<AnalysisMetric>("efficiency");

  const METRIC_LABELS: Record<AnalysisMetric, string> = {
    efficiency: "Eficiência de Conversão",
    noshow: "Taxa de No-Show",
    confirmed: "Taxa de Confirmadas",
    scheduled: "Taxa de Agendadas",
    feitas: "Consultas Feitas",
  };

  // contagens por funil necessárias
  const callConfirmedByFunnel = useMemo(() => {
    const map: Record<string, number> = {};
    FUNNEL_SOURCES.forEach(f => {
      map[f.key] = consultations.filter(c => matchesFunnel(c, f.key) && c.callConfirmed === true).length;
    });
    return map;
  }, [consultations, matchesFunnel]);

  // No-Show = confirmou a reunião (callConfirmed === true) mas não compareceu (attended === false)
  const noShowConfirmedByFunnel = useMemo(() => {
    const map: Record<string, number> = {};
    FUNNEL_SOURCES.forEach(f => {
      map[f.key] = consultations.filter(c => matchesFunnel(c, f.key) && c.callConfirmed === true && c.attended === false).length;
    });
    return map;
  }, [consultations, matchesFunnel]);

  const efficiencyData = useMemo(() => {
    const totalAgendadasAll = funnelStats.reduce((s, f) => s + f.total, 0);

    return FUNNEL_SOURCES.filter(f => efficiencyFunnels.includes(f.key)).map(f => {
      const stat = funnelStats.find(s => s.key === f.key);
      const total = stat?.total ?? 0;          // agendadas do funil
      const attended = stat?.attended ?? 0;
      const converted = stat?.converted ?? 0;
      const confirmed = callConfirmedByFunnel[f.key] ?? 0;
      const noShowsConfirmed = noShowConfirmedByFunnel[f.key] ?? 0;

      let numerator = 0;
      let denominator = 0;
      let primaryLabel = "";
      let secondaryLabel = "";

      switch (analysisMetric) {
        case "efficiency":
          numerator = converted;
          denominator = attended;
          primaryLabel = "vendas";
          secondaryLabel = "consultas";
          break;
        case "noshow":
          numerator = noShowsConfirmed;
          denominator = confirmed;
          primaryLabel = "no-shows";
          secondaryLabel = "confirmadas";
          break;
        case "confirmed":
          numerator = confirmed;
          denominator = total;
          primaryLabel = "confirmadas";
          secondaryLabel = "agendadas";
          break;
        case "scheduled":
          numerator = total;
          denominator = totalAgendadasAll;
          primaryLabel = "agendadas deste funil";
          secondaryLabel = "no total";
          break;
        case "feitas":
          numerator = attended;
          denominator = confirmed;
          primaryLabel = "feitas";
          secondaryLabel = "confirmadas";
          break;
      }

      const pct = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
      const hasData = denominator > 0;
      const remainder = Math.max(0, denominator - numerator);

      return {
        key: f.key,
        label: f.label,
        fill: f.fill,
        numerator,
        denominator,
        remainder,
        pct,
        hasData,
        primaryLabel,
        secondaryLabel,
      };
    });
  }, [efficiencyFunnels, funnelStats, analysisMetric, callConfirmedByFunnel, noShowConfirmedByFunnel]);

  // Scroll to drill section when drillKpi opens
  useEffect(() => {
    if (drillKpi && tableRef.current) {
      setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [drillKpi]);

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-8 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Carregando dados do funil...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-display font-bold tracking-tight">Dash / Funil</h2>
        </div>
        {!externalDateRange && (
          <DateRangeFilter
            dateRange={localDateRange}
            onRangeChange={setLocalDateRange}
            onClear={() => setLocalDateRange(undefined)}
          />
        )}
      </div>

      {/* Primary Funnel KPIs (clickable → drill below) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-primary/50 ${drillKpi === "leads" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "leads" ? null : "leads")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Consultas Agendadas</span>
              <CalendarIcon className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-display font-bold">{totalLeads}</p>
            <p className="text-xs text-muted-foreground mt-1">Todos os funis</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-indigo-500/50 ${drillKpi === "calls_confirmadas" ? "ring-2 ring-indigo-500" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "calls_confirmadas" ? null : "calls_confirmadas")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Calls Confirmadas</span>
              <PhoneCall className="h-5 w-5 text-indigo-500" />
            </div>
            <p className="text-3xl font-display font-bold text-indigo-500">{totalCallsConfirmadas}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallCallsConfirmadasPercent}% do total</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-warning/50 ${drillKpi === "feitas" ? "ring-2 ring-warning" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "feitas" ? null : "feitas")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Consultas Feitas</span>
              <CheckCircle2 className="h-5 w-5 text-warning" />
            </div>
            <p className="text-3xl font-display font-bold text-warning">{totalAttended}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallAttendedPercent}% das confirmadas</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-success/50 ${drillKpi === "convertidos" ? "ring-2 ring-success" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "convertidos" ? null : "convertidos")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Vendas Convertidas</span>
              <UserCheck className="h-5 w-5 text-success" />
            </div>
            <p className="text-3xl font-display font-bold text-success">{totalConverted}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallConvertedPercent}% das feitas (reembolso está aqui)</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-emerald-500/50 ${drillKpi === "pagamento_ok" ? "ring-2 ring-emerald-500" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "pagamento_ok" ? null : "pagamento_ok")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Convertidas / Pagamento OK</span>
              <UserCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="text-3xl font-display font-bold text-emerald-600">{consultations.filter(c => c.converted === true && c.refunded !== true).length}</p>
            <p className="text-xs text-muted-foreground mt-1">Convertidas menos reembolsadas</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-destructive/50 ${drillKpi === "noshow" ? "ring-2 ring-destructive" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "noshow" ? null : "noshow")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">No-Show</span>
              <UserX className="h-5 w-5 text-destructive" />
            </div>
            <p className="text-3xl font-display font-bold text-destructive">{totalNoShows}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallNoShowPercent}% das confirmadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Qualificados</span>
              <UserCheck className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-display font-bold text-primary">{totalQualified}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallQualifiedPercent}% do total</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-destructive/50 ${drillKpi === "perdidos" ? "ring-2 ring-destructive" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "perdidos" ? null : "perdidos")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Perdidos (Desqualif.)</span>
              <UserX className="h-5 w-5 text-destructive" />
            </div>
            <p className="text-3xl font-display font-bold text-destructive">{totalDisqualified}</p>
            <p className="text-xs text-muted-foreground mt-1">{overallDisqualifiedPercent}% do total</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-purple-500/50 ${drillKpi === "spend" ? "ring-2 ring-purple-500" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "spend" ? null : "spend")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground truncate mr-2">Gasto Tráfego</span>
              <DollarSign className="h-5 w-5 text-purple-500 shrink-0" />
            </div>
             <p className="text-3xl font-display font-bold">
               {loadingMeta ? "..." : (document.body.classList.contains("privacy-on") ? "R$ ••••••" : `R$ ${totalMktSpend.toFixed(2).replace('.', ',')}`)}
             </p>
             <p className="text-xs text-muted-foreground mt-1">Apenas campanhas AV</p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 border-success/30 bg-success/5 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-success/50 ${drillKpi === "revenue" ? "ring-2 ring-success" : ""}`}
          onClick={() => setDrillKpi(prev => prev === "revenue" ? null : "revenue")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-success truncate mr-2">Faturamento Geral</span>
              <DollarSign className="h-5 w-5 text-success shrink-0" />
            </div>
            <p className="text-3xl font-display font-bold text-success">
              {document.body.classList.contains("privacy-on") ? "R$ ••••••" : `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Soma de todas vendas</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 border-indigo-200/50 bg-indigo-50/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-indigo-700 truncate mr-2">ROAS</span>
              <TrendingUp className="h-5 w-5 text-indigo-500 shrink-0" />
            </div>
            <p className="text-3xl font-display font-bold text-indigo-600">
              {loadingMeta ? "..." : roas === null ? "—" : roas.toFixed(2).replace('.', ',')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {loadingMeta ? "" : roas === null ? "Sem gasto registrado" : `Invest. c/ imposto: R$ ${totalInvestido.toFixed(2).replace('.', ',')}`}
            </p>
          </CardContent>
        </Card>
        <Card
          className={`border-border/50 bg-amber-50/30 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-amber-500/50 ${selectedSpecialCard === 'reschedule' ? 'ring-2 ring-amber-500' : 'border-amber-200/50'}`}
          onClick={() => {
            setSelectedSpecialCard(prev => prev === 'reschedule' ? null : 'reschedule');
            setSelectedFunnelCard(null);
          }}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-700 truncate mr-2">Reagend. Futuro</span>
              <CalendarIcon className="h-5 w-5 text-amber-500 shrink-0" />
            </div>
            <p className="text-3xl font-display font-bold text-amber-600">{totalFutureReschedule}</p>
            <p className="text-xs text-muted-foreground mt-1 text-amber-700/80">Para reagendar</p>
          </CardContent>
        </Card>

        <Card
          className={`border-border/50 bg-rose-50/30 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-rose-500/50 ${selectedSpecialCard === 'incomplete' ? 'ring-2 ring-rose-500' : 'border-rose-200/50'}`}
          onClick={() => {
            setSelectedSpecialCard(prev => prev === 'incomplete' ? null : 'incomplete');
            setSelectedFunnelCard(null);
          }}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-rose-700 truncate mr-2">Fluxo Incompleto</span>
              <LogOut className="h-5 w-5 text-rose-500 shrink-0" />
            </div>
            <p className="text-3xl font-display font-bold text-rose-600">{totalIncompleteFlow}</p>
            <p className="text-xs text-muted-foreground mt-1 text-rose-700/80">Sem WhatsApp</p>
          </CardContent>
        </Card>

        <Card
          className={`border-border/50 bg-emerald-50/30 cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-emerald-500/50 ${selectedSpecialCard === 'sem_wpp' ? 'ring-2 ring-emerald-500' : 'border-emerald-200/50'}`}
          onClick={() => {
            setSelectedSpecialCard(prev => prev === 'sem_wpp' ? null : 'sem_wpp');
            setSelectedFunnelCard(null);
          }}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-emerald-700 truncate mr-2">Agendou · Sem WPP</span>
              <MessageCircle className="h-5 w-5 text-emerald-500 shrink-0" />
            </div>
            <p className="text-3xl font-display font-bold text-emerald-600">{totalSemWpp}</p>
            <p className="text-xs text-muted-foreground mt-1 text-emerald-700/80">Aguardando contato</p>
          </CardContent>
        </Card>
      </div>

      <div className="text-sm text-muted-foreground mt-6 mb-2 flex items-center gap-1.5">
        <MousePointerClick className="w-4 h-4" />
        <p>Clique em um funil abaixo para visualizar a lista de leads dele.</p>
      </div>
      
      {/* Per-funnel Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FUNNEL_SOURCES.map((funnel, i) => {
          const stats = funnelStats[i];
          const isSelected = selectedFunnelCard === funnel.key;
          
          return (
            <Card 
              key={funnel.key} 
              className={`border-border/50 cursor-pointer overflow-hidden transition-all duration-200 hover:ring-2 hover:ring-primary/50 hover:shadow-md ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
              onClick={() => handleCardClick(funnel.key)}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: funnel.fill }} />
                    <span className={`font-medium text-sm ${funnel.color}`}>{funnel.icon}</span>
                    <span className="font-display font-semibold text-sm">{funnel.label}</span>
                  </div>
                </div>
                
                <p className="text-2xl font-bold mb-3">{stats.total} <span className="text-xs font-normal text-muted-foreground ml-1">leads</span></p>
                
                <div className="flex flex-col gap-1.5 mt-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Agendadas:</span>
                    <span className="font-medium text-foreground">{stats.total} (100%)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Confirmadas:</span>
                    <span className="font-medium text-indigo-500">{stats.confirmed} ({stats.confirmedPercent}%)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Feitas:</span>
                    <span className="font-medium text-primary">{stats.attended} ({stats.attendedPercent}% das confirmadas)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>No-show:</span>
                    <span className="font-medium text-destructive">{stats.noShows} ({stats.noShowsPercent}% das confirmadas)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pendentes:</span>
                    <span className="font-medium text-warning">{stats.pending} ({stats.pendingPercent}%)</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30">
                    <span>Vendas:</span>
                    <span className="font-medium text-success">{stats.converted} ({stats.convertedPercent}% das feitas)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Expanded Table when Funnel is Clicked */}
      {selectedFunnelCard && (
        <div ref={tableRef} className="pt-4 pb-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <Card className="border-primary/20 shadow-md">
            <CardHeader className="bg-primary/5 pb-4 border-b border-border/50 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-base text-primary flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Leads: {selectedCardLabel}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Exibindo os {filteredTableConsultations.length} leads do funil selecionado no período.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => exportConsultationsCSV(filteredTableConsultations, `leads_${selectedCardLabel || 'funil'}`)}>
                  <Download className="h-4 w-4" />
                  Exportar CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedFunnelCard(null)}>
                  Fechar Filtro
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-4">
              {(selectedFunnelCard === "grupo_individual" || selectedFunnelCard === "grupo_avaliacao") && (() => {
                const byCopy = new Map<string, { total: number; converted: number }>();
                filteredTableConsultations.forEach((c: any) => {
                  const key = (c.utmContent && String(c.utmContent).trim()) || "(sem utm_content)";
                  const acc = byCopy.get(key) ?? { total: 0, converted: 0 };
                  acc.total += 1;
                  if (c.converted === true) acc.converted += 1;
                  byCopy.set(key, acc);
                });
                const rows = Array.from(byCopy.entries()).sort((a, b) => b[1].total - a[1].total);
                if (rows.length === 0) return null;
                return (
                  <div className="px-4 pt-4 sm:px-0 sm:pt-0 sm:pb-4">
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Quebra por copy (utm_content)</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {rows.map(([copy, v]) => (
                          <div key={copy} className="flex items-center justify-between rounded-md bg-card border border-border/50 px-3 py-2 text-xs">
                            <span className="font-mono truncate mr-2" title={copy}>{copy}</span>
                            <span className="shrink-0">
                              <span className="font-semibold text-foreground">{v.total}</span>
                              <span className="text-muted-foreground"> leads · </span>
                              <span className="font-semibold text-success">{v.converted}</span>
                              <span className="text-muted-foreground"> vendas</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <ConsultationTable consultations={filteredTableConsultations as any} hideAddButton />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Expanded Table for Special Cards (reschedule / incomplete) */}
      {selectedSpecialCard && selectedSpecialCard !== 'sem_wpp' && (
        <div ref={tableRef} className="pt-4 pb-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <Card className={selectedSpecialCard === 'reschedule' ? 'border-amber-500/20 shadow-md' : 'border-rose-500/20 shadow-md'}>
            <CardHeader className={`${selectedSpecialCard === 'reschedule' ? 'bg-amber-50/50' : 'bg-rose-50/50'} pb-4 border-b border-border/50 flex flex-row items-center justify-between`}>
              <div>
                <CardTitle className={`font-display text-base flex items-center gap-2 ${selectedSpecialCard === 'reschedule' ? 'text-amber-700' : 'text-rose-700'}`}>
                  {selectedSpecialCard === 'reschedule' ? <CalendarIcon className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  {selectedSpecialCard === 'reschedule' ? 'Reagendamento Futuro' : 'Fluxo Incompleto'}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedSpecialCard === 'reschedule'
                    ? 'Leads sinalizados para reagendar posteriormente.'
                    : 'Leads que não concluíram o fluxo do WhatsApp.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                  const data = consultations.filter(c => selectedSpecialCard === 'reschedule' ? c.is_future_reschedule === true : c.is_incomplete_flow === true);
                  exportConsultationsCSV(data, selectedSpecialCard === 'reschedule' ? 'reagendamento_futuro' : 'fluxo_incompleto');
                }}>
                  <Download className="h-4 w-4" />
                  Exportar CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedSpecialCard(null)}>
                  Fechar Filtro
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-4">
              <ConsultationTable
                consultations={consultations.filter(c => selectedSpecialCard === 'reschedule' ? c.is_future_reschedule === true : c.is_incomplete_flow === true) as any}
                hideAddButton
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Expanded List: Agendou mas não foi pro WPP */}
      {selectedSpecialCard === 'sem_wpp' && (
        <div ref={tableRef} className="pt-4 pb-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <Card className="border-emerald-500/20 shadow-md">
            <CardHeader className="bg-emerald-50/50 pb-4 border-b border-border/50 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-display text-base text-emerald-700 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Agendadas · Sem Contato WPP ({semWppList.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Consultas agendadas que ainda não receberam confirmação via WhatsApp. Clique no número para chamar.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedSpecialCard(null)}>
                Fechar
              </Button>
            </CardHeader>
            <CardContent className="p-4">
              {semWppList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhuma consulta pendente de contato WPP.</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {semWppList
                    .slice()
                    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
                    .map((c) => {
                      const phone = (c.clientPhone ?? '').replace(/\D/g, '');
                      const waLink = linkDeWhatsapp(c.clientPhone);
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{c.clientName ?? '—'}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Consulta: {c.date ?? '—'}{c.startTime ? ` às ${format(new Date(c.startTime), 'HH:mm')}` : ''}
                            </p>
                          </div>
                          {waLink ? (
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline shrink-0"
                            >
                              <MessageCircle className="w-4 h-4" />
                              {c.clientPhone}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground shrink-0">Sem telefone</span>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Drill-down inline (substitui o Sheet lateral) */}
      {drillKpi && (
        <div ref={tableRef} className="pt-4 pb-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <Card className="border-primary/20 shadow-md">
            <CardHeader className="bg-primary/5 pb-4 border-b border-border/50 flex flex-row flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="font-display text-base text-primary flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {drillData.title}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Lista de leads correspondente ao KPI selecionado.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => exportConsultationsCSV(drillData.consults, `kpi_${drillData.title}`)}>
                  <Download className="h-4 w-4" />
                  Exportar CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDrillKpi(null)}>
                  Fechar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-4">
              <ConsultationTable consultations={drillData.consults as any} hideAddButton />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts + Conversions — escondidos quando há drill ativo */}
      {!drillKpi && (
        <>
          <div className="space-y-6 mt-6">

            {/* Row 1: 3 Pie Charts — Leads, Consultas, Vendas */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: "Distribuição de Leads", data: pieData },
                { title: "Consultas Feitas por Funil", data: pieDataConsultas },
                { title: "Vendas por Funil", data: pieDataVendas },
              ].map(({ title, data }) => (
                <Card key={title} className="border-border/50">
                  <CardHeader>
                    <CardTitle className="font-display text-base text-center">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
                        <Pie
                          data={data.length > 0 ? data : [{ name: "Sem dados", value: 1, fill: "hsl(var(--muted))" }]}
                          cx="50%"
                          cy="45%"
                          innerRadius={35}
                          outerRadius={60}
                          dataKey="value"
                          label={({ percent }) => data.length > 0 && percent > 0 ? `${(percent * 100).toFixed(0)}%` : ""}
                          labelLine={data.length > 0}
                        >
                          {(data.length > 0 ? data : [{ name: "Sem dados", value: 1, fill: "hsl(var(--muted))" }]).map((entry, index) => (
                            <Cell key={index} fill={entry.fill} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        />
                        <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ))}
            </div>



            {/* Análise por Funil — múltiplas métricas, sem gráficos abertos por padrão */}
            <Card className="border-border/50">
              <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="font-display text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    Análise por Funil
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Selecione a métrica e os funis para visualizar</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Métrica (single-select) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2 border-border/60 text-xs">
                        <TrendingUp className="h-3.5 w-3.5" />
                        Métrica: {METRIC_LABELS[analysisMetric]}
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[240px]">
                      <DropdownMenuLabel className="text-xs">Selecionar métrica</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {(Object.keys(METRIC_LABELS) as AnalysisMetric[]).map(key => (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={analysisMetric === key}
                          onCheckedChange={() => setAnalysisMetric(key)}
                          onSelect={(e) => e.preventDefault()}
                          className="text-xs"
                        >
                          {METRIC_LABELS[key]}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Funis (multi-select) */}
                  <DropdownMenu open={isEfficiencyOpen} onOpenChange={setIsEfficiencyOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2 border-border/60 text-xs">
                        <Filter className="h-3.5 w-3.5" />
                        Funis ({efficiencyFunnels.length === 0 ? "Nenhum" : efficiencyFunnels.length})
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[240px]">
                      <DropdownMenuLabel className="text-xs flex items-center justify-between">
                        <span>Selecionar funis</span>
                        <span
                          className="text-primary cursor-pointer hover:underline font-normal"
                          onClick={(e) => {
                            e.preventDefault();
                            if (efficiencyFunnels.length === FUNNEL_SOURCES.length) setEfficiencyFunnels([]);
                            else setEfficiencyFunnels(FUNNEL_SOURCES.map(f => f.key));
                          }}
                        >
                          {efficiencyFunnels.length === FUNNEL_SOURCES.length ? "Limpar" : "Todos"}
                        </span>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {FUNNEL_SOURCES.map(f => (
                        <DropdownMenuCheckboxItem
                          key={f.key}
                          checked={efficiencyFunnels.includes(f.key)}
                          onCheckedChange={(checked) => {
                            setEfficiencyFunnels(prev => checked ? [...prev, f.key] : prev.filter(k => k !== f.key));
                          }}
                          onSelect={(e) => e.preventDefault()}
                          className="text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.fill }} />
                            {f.label}
                          </div>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                {efficiencyData.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Selecione um ou mais funis no filtro acima para visualizar.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {efficiencyData.map((item) => (
                      <div key={item.key} className="border border-border/50 rounded-lg p-4 bg-card">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }} />
                          <span className="font-medium text-sm">{item.label}</span>
                        </div>
                        {item.hasData ? (
                          <div className="relative">
                            <ResponsiveContainer width="100%" height={160}>
                              <PieChart>
                                <Pie
                                  data={[
                                    { name: METRIC_LABELS[analysisMetric], value: item.numerator, fill: item.fill },
                                    { name: "Restante", value: item.remainder, fill: "hsl(var(--muted))" },
                                  ]}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={45}
                                  outerRadius={65}
                                  dataKey="value"
                                  startAngle={90}
                                  endAngle={-270}
                                >
                                  <Cell fill={item.fill} />
                                  <Cell fill="hsl(var(--muted))" />
                                </Pie>
                                <RechartsTooltip
                                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="text-xl font-bold text-foreground">{item.pct}%</span>
                            </div>
                          </div>
                        ) : (
                          <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
                            Sem dados no período
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          <span className="font-semibold text-foreground">{item.numerator}</span> {item.primaryLabel} de <span className="font-semibold text-foreground">{item.denominator}</span> {item.secondaryLabel}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Conversões & Custos Section */}
          <FunnelConversionsSection
            consultations={consultations as any}
            dateFrom={dateFilter?.from || ''}
            dateTo={dateFilter?.to || ''}
            activeFunnel={selectedFunnelCard}
            onFunnelClick={handleCardClick}
            allCampaigns={allCampaigns}
            allAds={allAds}
            loadingMeta={loadingMeta}
            selectedCampaignIds={selectedCampaignIds}
            setSelectedCampaignIds={setSelectedCampaignIds}
          />
        </>
      )}
    </div>
  );
}
