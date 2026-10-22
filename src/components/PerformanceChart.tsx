import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { Consultation } from "@/types/consultation";
import { format, endOfWeek, eachDayOfInterval, eachWeekOfInterval, parseISO, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PerformanceChartProps {
  consultations: Consultation[];
  allConsultations: Consultation[];
}

const METAS = {
  diaria: { agendadas: 10, feitas: 8 },
  semanal: { agendadas: 50, feitas: 40 },
};

export function PerformanceChart({ consultations, allConsultations }: PerformanceChartProps) {
  const data = allConsultations;
  const [period, setPeriod] = useState<"diario" | "semanal">("diario");

  const dailyData = useMemo(() => {
    const today = new Date();
    const last7Days = eachDayOfInterval({
      start: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000),
      end: today,
    });

    return last7Days.map((day) => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayConsultations = data.filter((c) => c.date === dayStr);
      const agendadas = dayConsultations.length;
      const confirmadas = dayConsultations.filter((c) => c.callConfirmed === true).length;
      const feitas = dayConsultations.filter((c) => c.attended === true).length;
      const noShow = dayConsultations.filter((c) => c.attended === false).length;
      const isSaturday = day.getDay() === 6;
      const dailyMeta = isSaturday ? 4 : METAS.diaria.feitas;

      return {
        name: `${format(day, "EEE", { locale: ptBR })}\n${format(day, "dd/MM")}`,
        agendadas,
        confirmadas,
        feitas,
        convertidas: dayConsultations.filter((c) => c.converted === true).length,
        meta: dailyMeta,
      };
    });
  }, [data]);

  const weeklyData = useMemo(() => {
    const today = new Date();
    const last4Weeks = eachWeekOfInterval(
      {
        start: new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000),
        end: today,
      },
      { weekStartsOn: 1 }
    );

    return last4Weeks.map((weekStart) => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekConsultations = data.filter((c) => {
        const d = parseISO(c.date);
        return isWithinInterval(d, { start: weekStart, end: weekEnd });
      });
      const agendadas = weekConsultations.length;
      const confirmadas = weekConsultations.filter((c) => c.callConfirmed === true).length;
      const feitas = weekConsultations.filter((c) => c.attended === true).length;
      const convertidas = weekConsultations.filter((c) => c.converted === true).length;

      return {
        name: `${format(weekStart, "dd/MM")}–${format(weekEnd, "dd/MM")}`,
        agendadas,
        confirmadas,
        feitas,
        convertidas,
        meta: METAS.semanal.feitas,
      };
    });
  }, [data]);

  const getData = () => {
    return period === "diario" ? dailyData : weeklyData;
  };

  const getMeta = () => {
    return period === "diario" ? METAS.diaria.feitas : METAS.semanal.feitas;
  };

  return (
    <Card className="border-none shadow-sm overflow-hidden h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Performance</CardTitle>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="diario" className="text-xs px-2">Diário</TabsTrigger>
              <TabsTrigger value="semanal" className="text-xs px-2">Semanal</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <p className="text-xs text-muted-foreground">
          Meta: {getMeta()} consultas feitas ({period === "diario" ? "por dia" : "por semana"})
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={getData()} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={({ x, y, payload }) => {
                  const lines = (payload.value as string).split("\n");
                  return (
                    <g transform={`translate(${x},${y})`}>
                      {lines.map((line: string, i: number) => (
                        <text key={i} x={0} y={0} dy={12 + i * 14} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={11}>
                          {line}
                        </text>
                      ))}
                    </g>
                  );
                }}
                height={50}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <ReferenceLine y={getMeta()} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ position: 'top', value: "Meta", fill: "hsl(var(--primary))", fontSize: 10 }} />
              <Bar dataKey="agendadas" name="Agendadas" radius={[4, 4, 0, 0]} barSize={12}>
                {getData()?.map((entry, index) => (
                  <Cell key={index} fill={entry.agendadas >= entry.meta ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
              <Bar dataKey="confirmadas" name="Confirmadas" fill="hsl(238 75% 65%)" radius={[4, 4, 0, 0]} barSize={12} />
              <Bar dataKey="feitas" name="Feitas" radius={[4, 4, 0, 0]} barSize={12}>
                {getData()?.map((entry, index) => (
                  <Cell key={index} fill={entry.feitas >= entry.meta ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
              <Bar dataKey="convertidas" name="Convertidas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
