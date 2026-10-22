import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { parseISO, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { DateRange } from "react-day-picker";
import { Consultation } from "@/types/consultation";

interface WeekdayPeakChartProps {
  consultations: Consultation[];
  defaultRange?: DateRange;
}

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function WeekdayPeakChart({ consultations, defaultRange }: WeekdayPeakChartProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultRange ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) }
  );

  const data = useMemo(() => {
    const buckets = WEEKDAY_LABELS.map((label, idx) => ({
      day: WEEKDAY_SHORT[idx],
      fullDay: label,
      weekdayIndex: idx,
      agendadas: 0,
      confirmadas: 0,
      feitas: 0,
      noShow: 0,
      vendas: 0,
    }));

    const from = dateRange?.from;
    const to = dateRange?.to ?? from;
    if (!from) return buckets;

    consultations.forEach((c) => {
      try {
        const d = parseISO(c.date);
        if (!isWithinInterval(d, { start: from, end: to })) return;
        const wd = d.getDay();
        buckets[wd].agendadas += 1;
        if (c.callConfirmed === true) buckets[wd].confirmadas += 1;
        if (c.attended === true) buckets[wd].feitas += 1;
        if (c.attended === false) buckets[wd].noShow += 1;
        if (c.converted) buckets[wd].vendas += 1;
      } catch {
        // ignore
      }
    });

    // Reorder: Monday first, Sunday last (BR convention)
    return [...buckets.slice(1), buckets[0]];
  }, [consultations, dateRange]);

  const totals = useMemo(
    () => ({
      agendadas: data.reduce((s, d) => s + d.agendadas, 0),
      confirmadas: data.reduce((s, d) => s + d.confirmadas, 0),
      feitas: data.reduce((s, d) => s + d.feitas, 0),
      noShow: data.reduce((s, d) => s + d.noShow, 0),
      vendas: data.reduce((s, d) => s + d.vendas, 0),
    }),
    [data]
  );

  const conversaoPct = totals.feitas > 0 ? Math.round((totals.vendas / totals.feitas) * 100) : 0;
  const noShowPct = totals.confirmadas > 0 ? Math.round((totals.noShow / totals.confirmadas) * 100) : 0;

  const peakDay = useMemo(() => {
    return [...data].sort((a, b) => b.agendadas - a.agendadas)[0];
  }, [data]);


  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Picos por Dia da Semana</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Distribuição de agendamentos, feitas e vendas — Segunda a Domingo
            </p>
          </div>
          <DateRangePicker
            value={dateRange}
            onChange={(range) => setDateRange(range)}
            align="end"
            numberOfMonths={2}
            showClear
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Agendadas</p>
            <p className="text-xl font-bold text-primary">{totals.agendadas}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Confirmadas</p>
            <p className="text-xl font-bold text-indigo-500">{totals.confirmadas}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Feitas</p>
            <p className="text-xl font-bold text-orange-500">{totals.feitas}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Vendas / Conversão</p>
            <p className="text-xl font-bold text-emerald-500">{totals.vendas} <span className="text-xs font-medium text-muted-foreground">({conversaoPct}%)</span></p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">No-Show</p>
            <p className="text-xl font-bold text-destructive">{totals.noShow} <span className="text-xs font-medium text-muted-foreground">({noShowPct}% das confirm.)</span></p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Pico</p>
            <p className="text-xl font-bold">{peakDay?.fullDay ?? "-"}</p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.fullDay ?? label}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="agendadas" name="Agendadas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="confirmadas" name="Confirmadas" fill="hsl(238 75% 65%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="feitas" name="Feitas" fill="hsl(24 95% 53%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="noShow" name="No-Show" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="vendas" name="Vendas" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
