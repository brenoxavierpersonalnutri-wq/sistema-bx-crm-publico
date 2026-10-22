import { useMemo, useState } from "react";
import { Consultation } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Target, Users, UserX, TrendingUp, PhoneCall } from "lucide-react";
import {
  startOfDay,
  endOfDay,
  format,
  isWithinInterval,
  parseISO,
  isSameDay
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";

interface BookingGoalsChartProps {
  consultations: Consultation[];
  externalDateRange?: DateRange;
  hideDatePicker?: boolean;
  title?: string;
}

export function BookingGoalsChart({ consultations, externalDateRange, hideDatePicker, title }: BookingGoalsChartProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    externalDateRange || {
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }
  );
  

  // Sync with external range if provided
  useMemo(() => {
    if (externalDateRange) {
      setDateRange(externalDateRange);
    }
  }, [externalDateRange]);

  const { stats, rangeLabel } = useMemo(() => {
    if (!dateRange?.from) return { stats: null, rangeLabel: "Selecione um período" };

    const start = startOfDay(dateRange.from);
    const end = endOfDay(dateRange.to || dateRange.from);

    let label = "";
    if (dateRange.to && !isSameDay(dateRange.from, dateRange.to)) {
      label = `${format(start, "dd/MM")} - ${format(dateRange.to, "dd/MM/yy")}`;
    } else {
      label = format(start, "dd 'de' MMMM", { locale: ptBR });
    }

    const filtered = consultations.filter((c) => {
      const consultDate = parseISO(c.date);
      return isWithinInterval(consultDate, { start, end });
    });

    let expectedBookings = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) expectedBookings += 10;
      current.setDate(current.getDate() + 1);
    }

    const total = filtered.length;
    const attended = filtered.filter(c => c.attended === true).length;
    const confirmed = filtered.filter(c => c.callConfirmed === true).length;
    // No-Show = confirmou e não compareceu
    const noShow = filtered.filter(c => c.callConfirmed === true && c.attended === false).length;
    const converted = filtered.filter(c => c.converted === true).length;

    // Feitas % sobre confirmadas; Conversão % sobre feitas; No-Show % sobre confirmadas
    const attendanceRate = confirmed > 0 ? Math.round((attended / confirmed) * 100) : 0;
    const noShowRate = confirmed > 0 ? Math.round((noShow / confirmed) * 100) : 0;
    const conversionRate = attended > 0 ? Math.round((converted / attended) * 100) : 0;
    const confirmedRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;

    return {
      stats: {
        attendanceRate,
        noShowRate,
        conversionRate,
        confirmedRate,
        total,
        attended,
        noShow,
        converted,
        confirmed,
        expectedBookings,
        expectedAttended: Math.round(expectedBookings * 0.8),
        expectedConverted: Math.round(expectedBookings * 0.3)
      },
      rangeLabel: label
    };
  }, [consultations, dateRange]);


  const goals = [
    {
      label: "Confirmadas",
      value: stats?.confirmed || 0,
      target: stats?.expectedBookings || 50,
      icon: PhoneCall,
      color: "from-indigo-500/80 to-indigo-500",
      suffix: "",
      isInverse: false,
      isAbsolute: true,
      pct: stats?.confirmedRate ?? null,
      pctLabel: "do total",
    },
    {
      label: "Feitas",
      value: stats?.attended || 0,
      target: stats?.expectedAttended || 40,
      icon: Users,
      color: "from-warning/80 to-warning",
      suffix: "",
      isInverse: false,
      isAbsolute: true,
      pct: stats?.attendanceRate ?? null,
      pctLabel: "das confirmadas",
    },
    {
      label: "Conversão",
      value: stats?.converted || 0,
      target: stats?.expectedConverted || 15,
      icon: TrendingUp,
      color: "from-success/80 to-success",
      suffix: "",
      isInverse: false,
      isAbsolute: true,
      pct: stats?.conversionRate ?? null,
      pctLabel: "das feitas",
    },
    {
      label: "No-Show",
      value: stats?.noShow || 0,
      target: stats?.confirmed ? Math.round((stats.confirmed * 15) / 100) : 0,
      icon: UserX,
      color: "from-destructive/80 to-destructive",
      suffix: "",
      isInverse: true,
      isAbsolute: true,
      pct: stats?.noShowRate ?? null,
      pctLabel: "das confirmadas",
    }
  ];

  return (
    <Card className="border-none shadow-md overflow-hidden h-full bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-4 border-b border-border/40 bg-muted/30">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/15 rounded-xl border border-primary/20 shadow-sm">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="font-display text-lg font-bold tracking-tight">
                {title || "Metas de Agendamento"}
              </CardTitle>
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-black opacity-70">Qualidade e Conversão</p>
            </div>
          </div>

          {!hideDatePicker && (
            <DateRangePicker
              value={dateRange}
              onChange={(range) => setDateRange(range)}
              align="end"
              numberOfMonths={1}
              showClear
              size="default"
              triggerClassName="h-10 rounded-xl bg-background border-border/60 hover:bg-muted/50 hover:border-primary/30 shadow-sm font-bold"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6 px-6 pb-6">
        <div className="space-y-6">
          {goals.map((goal) => {
            const isAbsolute = (goal as any).isAbsolute;
            // No-Show usa escala percentual fixa 0-100
            const usePercentScale = goal.label === "No-Show";
            const isMet = goal.isInverse
              ? (goal.pct ?? goal.value) <= (usePercentScale ? 12 : goal.target)
              : goal.value >= goal.target;

            const maxScale = usePercentScale
              ? 100
              : isAbsolute
                ? Math.max(goal.target * 1.25, goal.value)
                : 100;

            const barValue = usePercentScale ? (goal.pct ?? 0) : goal.value;
            const targetValue = usePercentScale ? 12 : goal.target;

            const progress = barValue > 0 ? Math.min((barValue / maxScale) * 100, 100) : 0;
            const targetPos = targetValue > 0 ? Math.min((targetValue / maxScale) * 100, 100) : 0;

            return (
              <div key={goal.label} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                    <goal.icon className="h-3.5 w-3.5" /> {goal.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-bold">META: {goal.isInverse ? "<" : ">"}{usePercentScale ? "12%" : `${goal.target}${!isAbsolute ? "%" : ""}`}</span>
                    <span className={`text-sm font-black ${isMet ? "text-success" : "text-warning"}`}>
                      {goal.value}{goal.suffix}
                    </span>
                  </div>
                </div>
                <div className="relative w-full h-8 bg-muted/50 rounded-xl overflow-hidden border border-border group">
                  <div
                    className={`h-full bg-gradient-to-r transition-all duration-1000 ease-out relative ${goal.color}`}
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.1)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.1)_75%,transparent_75%,transparent)] bg-[length:20px_20px] opacity-10" />
                  </div>
                  
                  {/* Target line */}
                  <div 
                    className="absolute top-0 bottom-0 w-0.5 bg-foreground/20 z-10" 
                    style={{ left: `${targetPos}%` }}
                    title={`Meta: ${goal.target}%`}
                  >
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-foreground/30" />
                  </div>

                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[11px] font-black tracking-wide text-foreground/80 drop-shadow-sm">
                      {goal.pct !== null ? `${goal.pct}% ${goal.pctLabel}` : goal.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
