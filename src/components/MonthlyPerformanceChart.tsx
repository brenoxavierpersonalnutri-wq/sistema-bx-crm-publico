import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { Consultation } from "@/types/consultation";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfWeek,
  parseISO,
  isWithinInterval,
  getDay,
  startOfWeek,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface MonthlyPerformanceChartProps {
  consultations: Consultation[];
  allConsultations?: Consultation[];
  currentDate: Date;
}

const METAS = {
  diaria: { feitas: 8 },
  sabado: { feitas: 0 },
  domingo: { feitas: 0 },
  semanal: { agendadas: 50, feitas: 40, convertidas: 15 },
  mensal: { agendadas: 200, feitas: 160, convertidas: 60 },
  noShow: { taxa: 20 },
};

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

interface DayData {
  date: Date;
  dateStr: string;
  agendadas: number;
  feitas: number;
  noShow: number;
  isCurrentMonth: boolean;
}

export function MonthlyPerformanceChart({ consultations, allConsultations, currentDate }: MonthlyPerformanceChartProps) {
  const [period, setPeriod] = useState<"semanal" | "mensal">("semanal");

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  // Calendar data for daily view
  const calendarData = useMemo(() => {
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const allDays = eachDayOfInterval({ start: calStart, end: calEnd });

    return allDays.map((day): DayData => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayConsultations = consultations.filter((c) => c.date === dayStr);
      return {
        date: day,
        dateStr: dayStr,
        agendadas: dayConsultations.length,
        feitas: dayConsultations.filter((c) => c.attended === true).length,
        noShow: dayConsultations.filter((c) => c.attended === false).length,
        isCurrentMonth: day >= monthStart && day <= monthEnd,
      };
    });
  }, [consultations, monthStart, monthEnd]);

  // Weekly data
  const weeklyData = useMemo(() => {
    const weeks = eachWeekOfInterval(
      { start: monthStart, end: monthEnd },
      { weekStartsOn: 1 }
    );

    return weeks.map((ws) => {
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const weekConsultations = consultations.filter((c) => {
        const d = parseISO(c.date);
        return isWithinInterval(d, { start: ws, end: we });
      });
      return {
        name: `${format(ws, "dd/MM")}–${format(we, "dd/MM")}`,
        agendadas: weekConsultations.length,
        confirmadas: weekConsultations.filter((c) => c.callConfirmed === true).length,
        feitas: weekConsultations.filter((c) => c.attended === true).length,
        noShow: weekConsultations.filter((c) => c.attended === false).length,
        convertidas: weekConsultations.filter((c) => c.converted === true).length,
        metaAgendadas: METAS.semanal.agendadas,
        metaFeitas: METAS.semanal.feitas,
        metaConvertidas: METAS.semanal.convertidas,
      };
    });
  }, [consultations, monthStart, monthEnd]);

  // Monthly bar data across the current year
  const monthlyBarData = useMemo(() => {
    const source = allConsultations ?? consultations;
    const yearStart = startOfYear(currentDate);
    const yearEnd = endOfYear(currentDate);
    const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });
    return months.map((mStart) => {
      const mEnd = endOfMonth(mStart);
      const monthCons = source.filter((c) => {
        const d = parseISO(c.date);
        return isWithinInterval(d, { start: mStart, end: mEnd });
      });
      return {
        name: format(mStart, "MMM", { locale: ptBR }),
        agendadas: monthCons.length,
        confirmadas: monthCons.filter((c) => c.callConfirmed === true).length,
        feitas: monthCons.filter((c) => c.attended === true).length,
        noShow: monthCons.filter((c) => c.attended === false).length,
        convertidas: monthCons.filter((c) => c.converted === true).length,
      };
    });
  }, [allConsultations, consultations, currentDate]);


  const getMeta = () => {
    switch (period) {
      case "semanal": return METAS.semanal.feitas;
      case "mensal": return METAS.mensal.feitas;
    }
  };

  const weeks = useMemo(() => {
    const result: DayData[][] = [];
    for (let i = 0; i < calendarData.length; i += 7) {
      result.push(calendarData.slice(i, i + 7));
    }
    return result;
  }, [calendarData]);

  const renderCalendar = () => (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>
      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-1">
          {week.map((day) => {
            const hasData = day.agendadas > 0;
            const isSaturday = getDay(day.date) === 6;
            const isSunday = getDay(day.date) === 0;
            const isFuture = day.date > new Date();
            const metMeta = isSaturday
              ? day.feitas >= METAS.sabado.feitas
              : isSunday
              ? day.feitas >= METAS.domingo.feitas
              : day.feitas >= METAS.diaria.feitas;
            const showColor = day.isCurrentMonth && !isFuture && !isSunday;

            return (
              <div
                key={day.dateStr}
                className={cn(
                  "relative rounded-lg p-1.5 min-h-[60px] text-center transition-colors border",
                  !day.isCurrentMonth && "opacity-30 border-border/20 bg-card",
                  isSunday && day.isCurrentMonth && "border-border/20 bg-muted/30",
                  showColor && metMeta && "border-success/40 bg-success/15",
                  showColor && !metMeta && "border-destructive/40 bg-destructive/15",
                )}
              >
                <span className={cn(
                  "text-[11px] font-medium",
                  !day.isCurrentMonth && "text-muted-foreground",
                  day.isCurrentMonth && "text-foreground",
                )}>
                  {format(day.date, "d")}
                </span>
                {hasData && day.isCurrentMonth && (
                  <div className="mt-0.5 space-y-0">
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-[8px] text-muted-foreground">📅</span>
                      <span className="text-[10px] font-bold">{day.agendadas}</span>
                    </div>
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-[8px] text-muted-foreground">✓</span>
                      <span className={cn("text-[10px] font-bold", metMeta ? "text-success" : "text-destructive")}>{day.feitas}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>📅 Agendadas</span>
          <span>•</span>
          <span>✓ Feitas</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-success/20 border border-success/30" />
          <span>Meta batida</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-destructive/20 border border-destructive/30" />
          <span>Meta não batida</span>
        </div>
      </div>
    </div>
  );

  const renderBarChart = (data: any[], metas: { agendadas: number; feitas: number; convertidas: number }) => (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="name" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
          <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
            }}
          />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          <Bar dataKey="confirmadas" name="Confirmadas" fill="hsl(238 75% 65%)" radius={[4, 4, 0, 0]} barSize={12} />
          <Bar dataKey="feitas" name="Feitas" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} barSize={12} />
          <Bar dataKey="noShow" name="No-Show" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} barSize={12} />
          <Bar dataKey="convertidas" name="Convertidas" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} barSize={12} />

          <ReferenceLine
            y={metas.agendadas}
            stroke="hsl(238 75% 65%)"
            strokeDasharray="5 5"
            label={{ value: `Meta: ${metas.agendadas}`, fill: "hsl(238 75% 65%)", fontSize: 10, position: 'insideTopLeft' }}
          />
          <ReferenceLine
            y={metas.feitas}
            stroke="hsl(var(--warning))"
            strokeDasharray="5 5"
            label={{ value: `Meta: ${metas.feitas}`, fill: "hsl(var(--warning))", fontSize: 10, position: 'insideTopLeft' }}
          />
          <ReferenceLine
            y={metas.convertidas}
            stroke="hsl(var(--success))"
            strokeDasharray="5 5"
            label={{ value: `Meta: ${metas.convertidas}`, fill: "hsl(var(--success))", fontSize: 10, position: 'insideTopLeft' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Performance</CardTitle>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="semanal" className="text-xs px-2">Semanal</TabsTrigger>
              <TabsTrigger value="mensal" className="text-xs px-2">Mensal</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {period === "semanal" ? (
          <p className="text-xs text-muted-foreground">
            Metas Semanais: {METAS.semanal.agendadas} Confirmadas · {METAS.semanal.feitas} Feitas · {METAS.semanal.convertidas} Convertidas
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Metas Mensais: {METAS.mensal.agendadas} Confirmadas · {METAS.mensal.feitas} Feitas · {METAS.mensal.convertidas} Convertidas · {format(currentDate, "yyyy")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {period === "semanal" && renderBarChart(weeklyData, METAS.semanal)}
        {period === "mensal" && renderBarChart(monthlyBarData, METAS.mensal)}
      </CardContent>
    </Card>
  );
}
