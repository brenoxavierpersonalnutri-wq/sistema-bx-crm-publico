import { useState, useMemo, useEffect } from "react";
import { format, startOfMonth, endOfMonth, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { StatsCards } from "@/components/StatsCards";
import { FluxoProximoDiaUtil } from "@/components/FluxoProximoDiaUtil";
import { ConsultationTable } from "@/components/ConsultationTable";
import { AddConsultationForm } from "@/components/AddConsultationForm";
import { DateFilter } from "@/components/DateFilter";

import { PerformanceChart } from "@/components/PerformanceChart";
import { RevenueChart } from "@/components/RevenueChart";
import { BookingGoalsChart } from "@/components/BookingGoalsChart";
import { useConsultations, useAddConsultation, useSyncCalendly } from "@/hooks/useConsultations";
import { useSyncPeriodicoCalendly } from "@/hooks/useSyncPeriodicoCalendly";
import { useAuth } from "@/hooks/useAuth";
import { temComercial } from "@/lib/modules";
import { RefreshCw, LogOut, ArrowLeft, BarChart3, Calendar as CalendarIcon, LayoutDashboard, TrendingUp, Utensils, ShoppingCart, Lock, LineChart, Target, HandCoins, Users, Database, UserCheck } from "lucide-react";
import { BookingGoalCalculator } from "@/components/BookingGoalCalculator";
import { AnalysisTab } from "@/components/analise/AnalysisTab";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { Button } from "@/components/ui/button";
import { Consultation, ConsultationStatus } from "@/types/consultation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SdrPerformance } from "@/components/sdr/SdrPerformance";
import { Link, useNavigate } from "react-router-dom";
import { DateRange } from "react-day-picker";


import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { NoShowAnalysis } from "@/components/NoShowAnalysis";
import { MonthlyPerformanceChart } from "@/components/MonthlyPerformanceChart";
import { useCallback } from "react";
import { Aluna } from "@/lib/alunaTypes";
import { fetchAlunas, upsertAluna } from "@/lib/alunaStore";
import { SignalReminders } from "@/components/alunas/SignalReminders";
import { SignalReminderUnified } from "@/components/shared/SignalReminderUnified";
import { TodayTasksCheckin } from "@/components/TodayTasksCheckin";
import { ExpiringReminders } from "@/components/alunas/ExpiringReminders";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LeadsDrillSheet, DrillLead } from "@/components/shared/LeadsDrillSheet";
import { SinaisTab } from "@/components/sinais/SinaisTab";

type DashboardStatusFilter =
  | ConsultationStatus
  | "desqualificada"
  | "call_confirmada"
  | "call_nao_confirmada"
  | "feitas"
  | "reembolsadas"
  | "pagamento_ok"
  | "negociando_lista"
  | "reagendamento_futuro"
  | "renda_baixa"
  | "fluxo_incompleto_whatsapp"
  | "convertido_pitch01"
  | "parou_pitch01"
  | "qualificadas_sem_agendar"
  | null;

// Persistência do estado do dashboard de Vendas. Antes, quando o usuário
// filtrava uma data (ex: 21/05), trocava de aba e voltava, o componente
// remontava com state vazio — filtro caía pra "hoje" e parecia bug.
// Agora salva no localStorage e restaura ao montar.
const VENDAS_STATE_KEY = "vendas-dashboard-state-v1";

interface PersistedVendasState {
  dateRange?: { from?: string; to?: string };
  statusFilter?: DashboardStatusFilter;
  activeTab?: string;
}

function loadPersistedVendasState(): PersistedVendasState {
  try {
    const raw = localStorage.getItem(VENDAS_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistedDateRangeToObj(p?: PersistedVendasState["dateRange"]): DateRange | undefined {
  if (!p || (!p.from && !p.to)) return undefined;
  return {
    from: p.from ? new Date(p.from) : undefined,
    to: p.to ? new Date(p.to) : undefined,
  };
}

function SignalRemindersConsultas({ consultations }: { consultations: Consultation[] }) {
  const today = new Date();
  const upcoming = consultations.filter((c) => {
    if (!c.signalFollowUpDate || c.converted === true || c.signalResiduePaid === true) return false;
    try {
      const followUp = parseISO(c.signalFollowUpDate);
      const diff = differenceInDays(followUp, today);
      return diff <= 3; // show 3 days before and after
    } catch {
      return false;
    }
  });

  if (upcoming.length === 0) return null;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="h-5 w-5 text-warning" />
          <h3 className="font-semibold text-sm">Lembretes de Sinal — Cobrança Pendente</h3>
        </div>
        <div className="space-y-2">
          {upcoming.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm bg-background rounded-lg px-3 py-2 border border-border/40">
              <span className="font-medium">{c.clientName}</span>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>Sinal: R$ {c.signalValue?.toFixed(2).replace(".", ",")}</span>
                <span>Cobrar: {c.signalFollowUpDate ? format(parseISO(c.signalFollowUpDate), "dd/MM", { locale: ptBR }) : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const Index = () => {
  const { data: consultations = [], isLoading, isError, refetch } = useConsultations();
  const addMutation = useAddConsultation();
  const { mutate: syncCalendly, isPending: isSyncing } = useSyncCalendly();
  const { signOut, user, isAdmin, allowedModules, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const logout = () => signOut();
  // Lazy initializers — lê localStorage uma vez na montagem.
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
    persistedDateRangeToObj(loadPersistedVendasState().dateRange)
  );
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>(
    () => loadPersistedVendasState().statusFilter ?? null
  );
  const [activeTab, setActiveTab] = useState(
    () => loadPersistedVendasState().activeTab ?? "geral"
  );
  const [currentDate, setCurrentDate] = useState(new Date());
  const [drill, setDrill] = useState<{ title: string; leads: DrillLead[] } | null>(null);

  // Persiste state a cada mudança. Sobrevive a navegar entre /vendas, /balanco-mensal,
  // /anual e /vendas/funil (que desmontam o Index) sem perder o filtro do usuário.
  useEffect(() => {
    try {
      localStorage.setItem(
        VENDAS_STATE_KEY,
        JSON.stringify({
          dateRange: dateRange
            ? {
                from: dateRange.from?.toISOString(),
                to: dateRange.to?.toISOString(),
              }
            : undefined,
          statusFilter,
          activeTab,
        })
      );
    } catch {}
  }, [dateRange, statusFilter, activeTab]);

  const consultationToDrill = (c: Consultation): DrillLead => ({
    id: c.id,
    name: c.clientName,
    phone: c.clientPhone,
    via: c.via ?? null,
    status: c.disqualified ? "Desqualificada" : c.converted ? "Convertida" : c.attended === true ? "Feita" : c.attended === false ? "No-show" : "Agendada",
    score: c.leadScore ?? null,
    date: c.date,
  });

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const [alunas, setAlunas] = useState<Aluna[]>([]);

  const loadAlunas = useCallback(async () => {
    try {
      const data = await fetchAlunas();
      setAlunas(data);
    } catch (err) {
      console.error("Failed to load alunas", err);
    }
  }, []);

  useEffect(() => {
    loadAlunas();
  }, [loadAlunas]);

  // Sincronizacao do Calendly: a cada 5 minutos, so com a aba a vista, e
  // dividida entre as telas abertas no mesmo navegador. Antes era a cada 60s
  // em cada aba, o que mantinha o banco sob carga o dia inteiro.
  useSyncPeriodicoCalendly(syncCalendly);

  const filteredConsultations = useMemo(() => {
    const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : todayStr;
    const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : fromStr;

    return consultations.filter((c) => c.date >= fromStr && c.date <= toStr);
  }, [consultations, dateRange, todayStr]);

  const monthConsultations = useMemo(() => {
    const start = format(startOfMonth(currentDate), "yyyy-MM-dd");
    const end = format(endOfMonth(currentDate), "yyyy-MM-dd");
    return consultations.filter((c) => c.date >= start && c.date <= end);
  }, [consultations, currentDate]);

  const tableConsultations = useMemo(() => {
    const notExcluded = (c: Consultation) => c.is_future_reschedule !== true && c.is_incomplete_flow !== true && c.lowIncome !== true;
    const notRefunded = (c: Consultation) => c.refunded !== true;
    if (!statusFilter) {
      return filteredConsultations.filter((c) => c.disqualified !== true && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "reembolsadas") {
      return filteredConsultations.filter((c) => c.refunded === true && notExcluded(c));
    }
    if (statusFilter === "pagamento_ok") {
      return filteredConsultations.filter((c) => c.status === "convertido" && c.refunded !== true && notExcluded(c));
    }
    if (statusFilter === "negociando_lista") {
      return filteredConsultations.filter((c) => (c.status === "negociando" || c.negotiating === true) && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "desqualificada") {
      return filteredConsultations.filter((c) => c.disqualified === true && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "call_confirmada") {
      return filteredConsultations.filter((c) => c.callConfirmed === true && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "call_nao_confirmada") {
      return filteredConsultations.filter((c) => c.callConfirmed === false && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "feitas") {
      return filteredConsultations.filter((c) => c.attended === true && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "reagendamento_futuro") {
      // Exceção: aqui SIM mostra is_future_reschedule (a tabela default exclui).
      return filteredConsultations.filter((c) => c.is_future_reschedule === true && notRefunded(c));
    }
    if (statusFilter === "renda_baixa") {
      return filteredConsultations.filter((c) => c.lowIncome === true && notRefunded(c));
    }
    if (statusFilter === "fluxo_incompleto_whatsapp") {
      const WHATSAPP_TRACKING_START = "2026-07-14T00:00:00Z";
      return filteredConsultations.filter((c) =>
        c.refunded !== true &&
        c.disqualified !== true &&
        (
          c.is_incomplete_flow === true ||
          (
            !c.whatsappClickedAt &&
            c.via != null &&
            !!c.createdAt &&
            c.createdAt >= WHATSAPP_TRACKING_START
          )
        )
      );
    }
    if (statusFilter === "convertido_pitch01") {
      return filteredConsultations.filter((c) => c.status === "convertido" && c.passedPitch01 === true && notExcluded(c) && notRefunded(c));
    }
    if (statusFilter === "parou_pitch01") {
      return filteredConsultations.filter((c) => c.attended === true && c.converted === false && c.passedPitch01 === false && notExcluded(c) && notRefunded(c));
    }
    return filteredConsultations.filter((c) => c.status === statusFilter && notExcluded(c) && notRefunded(c));
  }, [filteredConsultations, statusFilter]);

  const handleAdd = (consultation: Consultation) => {
    addMutation.mutate(consultation);
  };

  if (!authLoading && !temComercial(isAdmin, allowedModules)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="bg-card p-8 rounded-2xl border border-border/60 shadow-lg max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <Lock className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Módulo Bloqueado</h2>
            <p className="text-muted-foreground">
              Você não tem a liberação "Comercial" (Monitoramento das Consultas).
              Solicite a liberação ao administrador do sistema.
            </p>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o Início
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <UserProfileHeader />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/alunas">
              <Button variant="outline" size="sm" className="gap-2">
                <Utensils className="h-4 w-4" />
                Gestão de Alunas
              </Button>
            </Link>
            <Link to="/respostas">
              <Button variant="outline" size="sm" className="gap-2">
                <Database className="h-4 w-4" />
                Banco de Dados
              </Button>
            </Link>
            <Link to="/disponibilidade">
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                Minha Agenda
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="gap-2" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              if (v === "anual") {
                navigate("/anual");
              } else if (v === "mensal") {
                navigate("/balanco-mensal");
              } else if (v === "funil") {
                navigate("/vendas/funil");
              } else {
                setActiveTab(v);
              }
            }}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-8 sm:w-[1080px]">
              <TabsTrigger value="geral" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Geral
              </TabsTrigger>
              <TabsTrigger value="sinais" className="gap-2">
                <HandCoins className="h-4 w-4" />
                Sinais
              </TabsTrigger>
              <TabsTrigger value="analise" className="gap-2">
                <LineChart className="h-4 w-4" />
                Análise
              </TabsTrigger>
              <TabsTrigger value="funil" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Funil
              </TabsTrigger>
              <TabsTrigger value="sdr" className="gap-2">
                <UserCheck className="h-4 w-4" />
                SDR
              </TabsTrigger>
              <TabsTrigger value="meta" className="gap-2">
                <Target className="h-4 w-4" />
                Meta
              </TabsTrigger>
              <TabsTrigger value="mensal" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                Mensal
              </TabsTrigger>
              <TabsTrigger value="anual" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Anual
              </TabsTrigger>
            </TabsList>
          </Tabs>


        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          // Antes a falha era invisível: a tabela aparecia vazia, como se não
          // houvesse consulta nenhuma. Agora que a chamada tem limite de tempo
          // e pode falhar de verdade, a tela precisa dizer isso e dar a saída.
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <p className="font-semibold">Não consegui carregar as consultas</p>
            <p className="text-sm text-muted-foreground">O servidor não respondeu a tempo. Tente de novo.</p>
            <Button variant="outline" onClick={() => void refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <Tabs value={activeTab} className="w-full">
              <TabsContent value="geral" className="space-y-6 mt-0">
                <DateFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
                
                {/* Signal reminders: source=consultations, sync to alunas */}
                <SignalReminderUnified />

                {/* Fluxo do próximo dia útil: um dia só, ignora o filtro de datas */}
                <FluxoProximoDiaUtil consultations={consultations} />

                {/* Check-in tasks do dia */}
                <TodayTasksCheckin />

                <StatsCards
                  consultations={filteredConsultations}
                  hasDateFilter={!!dateRange?.from}
                  dateRange={dateRange}
                  activeFilter={statusFilter}
                  onFilterChange={setStatusFilter}
                  onCardDrill={(filter, label) => {
                    const base = filteredConsultations.filter(c => c.is_future_reschedule !== true && c.is_incomplete_flow !== true);
                    const notRefunded = (c: Consultation) => c.refunded !== true;
                    let list: Consultation[] = [];
                    switch (filter) {
                      case "feitas": list = base.filter(c => c.attended === true && notRefunded(c)); break;
                      case "convertido": list = base.filter(c => c.status === "convertido" && notRefunded(c)); break;
                      case "no-show": list = base.filter(c => c.callConfirmed === true && c.attended === false && notRefunded(c)); break;
                      case "não convertido": list = base.filter(c => c.status === "não convertido" && notRefunded(c)); break;
                      case "desqualificada": list = base.filter(c => c.disqualified === true && notRefunded(c)); break;
                      case "call_confirmada": list = base.filter(c => c.callConfirmed === true && notRefunded(c)); break;
                      case "call_nao_confirmada": list = base.filter(c => c.callConfirmed === false && notRefunded(c)); break;
                      case "reembolsadas": list = base.filter(c => c.refunded === true); break;
                      case "pagamento_ok": list = base.filter(c => c.status === "convertido" && c.refunded !== true); break;
                      case "negociando_lista": list = base.filter(c => (c.status === "negociando" || c.negotiating === true) && notRefunded(c)); break;
                      // base já exclui is_future_reschedule — pra este caso a gente
                      // precisa olhar a lista ORIGINAL (filteredConsultations) e pegar
                      // só os marcados pra reagendar depois.
                      case "reagendamento_futuro": list = filteredConsultations.filter(c => c.is_future_reschedule === true && notRefunded(c)); break;
                      case "renda_baixa": list = filteredConsultations.filter(c => c.lowIncome === true && notRefunded(c)); break;
                      case "fluxo_incompleto_whatsapp": {
                        const WHATSAPP_TRACKING_START = "2026-07-14T00:00:00Z";
                        list = filteredConsultations.filter(c =>
                          c.refunded !== true &&
                          c.disqualified !== true &&
                          (
                            c.is_incomplete_flow === true ||
                            (
                              !c.whatsappClickedAt &&
                              c.via != null &&
                              !!c.createdAt &&
                              c.createdAt >= WHATSAPP_TRACKING_START
                            )
                          )
                        );
                        break;
                      }
                      case "convertido_pitch01": list = base.filter(c => c.status === "convertido" && c.passedPitch01 === true && notRefunded(c)); break;
                      case "parou_pitch01": list = base.filter(c => c.attended === true && c.converted === false && c.passedPitch01 === false && notRefunded(c)); break;
                      default: list = base.filter(c => c.status === filter && notRefunded(c));
                    }
                    setDrill({ title: label, leads: list.map(consultationToDrill) });
                  }}
                  onAgendamentosDrill={async (fromIso, toIso, label) => {
                    // Filtra pela DATA DE AGENDAMENTO (created_at) — quem agendou no período,
                    // independente da data da consulta (inclusive consultas marcadas pra dias futuros).
                    const fromMs = new Date(fromIso).getTime();
                    const toMs = new Date(toIso).getTime();
                    const list = consultations.filter((c) => {
                      if (!c.createdAt) return false;
                      const t = new Date(c.createdAt).getTime();
                      return t >= fromMs && t <= toMs;
                    });
                    const leads: DrillLead[] = list
                      .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()))
                      .map((c) => {
                        const bookedDate = c.date ? format(parseISO(c.date), "dd/MM/yyyy", { locale: ptBR }) : "—";
                        const hora = c.startTime ? format(new Date(c.startTime), "HH:mm") : "";
                        const agendouEm = c.createdAt ? format(new Date(c.createdAt), "dd/MM HH:mm", { locale: ptBR }) : "";
                        const status = c.disqualified
                          ? "Desqualificada"
                          : c.converted
                            ? "Convertida"
                            : c.attended === true
                              ? "Feita"
                              : c.attended === false
                                ? "No-show"
                                : c.callConfirmed === true
                                  ? "Confirmada"
                                  : "Agendada";
                        return {
                          id: c.id,
                          name: c.clientName,
                          phone: c.clientPhone,
                          via: c.via,
                          status,
                          score: c.leadScore,
                          date: `Agendou ${agendouEm} → Consulta ${bookedDate}${hora ? " " + hora : ""}`,
                        };
                      });
                    setDrill({ title: label, leads });
                  }}
                  onFormLeadsDrill={(formLeads, label) => {
                    const leads: DrillLead[] = formLeads.map((f) => ({
                      id: f.id,
                      name: f.name,
                      phone: f.phone,
                      via: f.utmSource ?? null,
                      status: f.status ?? "Qualificada · sem agendamento",
                      score: f.score,
                      level: f.nivel,
                      date: format(new Date(f.createdAt), "dd/MM HH:mm", { locale: ptBR }),
                    }));
                    setDrill({ title: label, leads });
                  }}
                />




                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <RevenueChart consultations={consultations} externalDateRange={dateRange} />
                  <BookingGoalsChart consultations={consultations} externalDateRange={dateRange} />
                </div>

                


                {statusFilter && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Filtrando por: <strong className="text-foreground capitalize">{statusFilter}</strong>
                    </span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setStatusFilter(null)}>
                      Limpar filtro
                    </Button>
                  </div>
                )}

                <div className="space-y-6">
                  <ConsultationTable consultations={tableConsultations} hideAddButton={!!statusFilter} />
                </div>
              </TabsContent>

              <TabsContent value="sinais" className="mt-0">
                <SinaisTab />
              </TabsContent>

              <TabsContent value="analise" className="mt-0">
                <AnalysisTab />
              </TabsContent>

              <TabsContent value="sdr" className="mt-0">
                <SdrPerformance />
              </TabsContent>

              <TabsContent value="meta" className="mt-0">
                <BookingGoalCalculator consultations={consultations} />
              </TabsContent>

              <TabsContent value="mensal" className="mt-0" />
              <TabsContent value="anual" className="mt-0" />
            </Tabs>
          </div>
        )}
      </main>

      <LeadsDrillSheet
        open={!!drill}
        onOpenChange={(o) => !o && setDrill(null)}
        title={drill?.title ?? ""}
        leads={drill?.leads ?? []}
      />
    </div>
  );
};

export default Index;
