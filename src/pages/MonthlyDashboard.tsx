import { useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, setMonth, setYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { StatsCards } from "@/components/StatsCards";
import { MonthlyPerformanceChart } from "@/components/MonthlyPerformanceChart";
import { RevenueChart } from "@/components/RevenueChart";
import { BookingGoalsChart } from "@/components/BookingGoalsChart";
import { DailyBreakdown } from "@/components/DailyBreakdown";
import { useConsultations, useSyncCalendly } from "@/hooks/useConsultations";
import { useSyncPeriodicoCalendly } from "@/hooks/useSyncPeriodicoCalendly";
import { useAuth } from "@/hooks/useAuth";
import { RefreshCw, LogOut, ArrowLeft, ChevronLeft, ChevronRight, Users, BarChart3, TrendingUp } from "lucide-react";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { Button } from "@/components/ui/button";
import { ConsultationStatus } from "@/types/consultation";
import { Link } from "react-router-dom";

import { MonthlyCalendar } from "@/components/MonthlyCalendar";
import { NoShowAnalysis } from "@/components/NoShowAnalysis";
import { WeekdayPeakChart } from "@/components/WeekdayPeakChart";

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

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const MonthlyDashboard = () => {
  const { data: consultations = [], isLoading } = useConsultations();
  const { signOut, isAdmin } = useAuth();
  const { mutate: syncCalendly } = useSyncCalendly();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>(null);

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  // Sincronizacao do Calendly: a cada 5 minutos, so com a aba a vista, e
  // dividida entre as telas abertas no mesmo navegador. Antes era a cada 60s
  // em cada aba, o que mantinha o banco sob carga o dia inteiro.
  useSyncPeriodicoCalendly(syncCalendly);

  const monthConsultations = useMemo(() => {
    const start = format(startOfMonth(currentDate), "yyyy-MM-dd");
    const end = format(endOfMonth(currentDate), "yyyy-MM-dd");
    return consultations.filter((c) => c.date >= start && c.date <= end);
  }, [consultations, currentDate]);

  const prevMonth = () => {
    setCurrentDate((d) => {
      const m = d.getMonth();
      if (m === 0) return setMonth(setYear(d, d.getFullYear() - 1), 11);
      return setMonth(d, m - 1);
    });
  };

  const nextMonth = () => {
    setCurrentDate((d) => {
      const m = d.getMonth();
      if (m === 11) return setMonth(setYear(d, d.getFullYear() + 1), 0);
      return setMonth(d, m + 1);
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/vendas">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            </Link>
            <UserProfileHeader />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation + Month Selector */}
      <div className="container max-w-6xl mx-auto px-4 pt-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link to="/vendas">
                <BarChart3 className="h-4 w-4" />
                Geral
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link to="/anual">
                <TrendingUp className="h-4 w-4" />
                Anual
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center min-w-[200px]">
              <h2 className="text-2xl font-bold font-display">
                {MONTH_NAMES[currentMonth]}
              </h2>
              <p className="text-sm text-muted-foreground">{currentYear}</p>
            </div>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <StatsCards
              consultations={monthConsultations}
              hasDateFilter={true}
              dateRange={{ from: startOfMonth(currentDate), to: endOfMonth(currentDate) }}
              activeFilter={statusFilter}
              onFilterChange={setStatusFilter}
            />

            <div className="grid lg:grid-cols-2 gap-6">
              <BookingGoalsChart 
                consultations={consultations}
                externalDateRange={{ from: startOfMonth(currentDate), to: endOfMonth(currentDate) }}
              />
              <MonthlyPerformanceChart consultations={monthConsultations} allConsultations={consultations} currentDate={currentDate} />
            </div>

            <WeekdayPeakChart
              consultations={consultations}
              defaultRange={{ from: startOfMonth(currentDate), to: endOfMonth(currentDate) }}
            />

            <div className="grid lg:grid-cols-2 gap-6">
              <RevenueChart 
                consultations={monthConsultations}
                externalDateRange={{ from: startOfMonth(currentDate), to: endOfMonth(currentDate) }}
                hideDatePicker
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default MonthlyDashboard;
