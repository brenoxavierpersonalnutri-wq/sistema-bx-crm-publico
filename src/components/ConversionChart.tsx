import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Line, ComposedChart, Cell } from "recharts";
import { Consultation } from "@/types/consultation";
import { format, endOfWeek, endOfMonth, eachDayOfInterval, eachWeekOfInterval, parseISO, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ConversionChartProps {
  consultations: Consultation[];
}

const METAS_VENDAS = {
  diaria: 3,
  semanal: 15,
  mensal: 16,
};

export function ConversionChart({ consultations }: ConversionChartProps) {
  const [period, setPeriod] = useState<"diario" | "semanal" | "mensal">("diario");

  const dailyData = useMemo(() => {
    const today = new Date();
    const last7Days = eachDayOfInterval({
      start: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000),
      end: today,
    });

    return last7Days.map((day) => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayConsultations = consultations.filter((c) => c.date === dayStr);
      const feitas = dayConsultations.filter((c) => c.attended === true).length;
      const vendas = dayConsultations.filter((c) => c.converted === true).length;
      const conversao = feitas > 0 ? Math.round((vendas / feitas) * 100) : 0;

      return {
        name: format(day, "EEE", { locale: ptBR }),
        vendas,
        conversao,
        meta: METAS_VENDAS.diaria,
      };
    });
  }, [consultations]);

  const weeklyData = useMemo(() => {
    const today = new Date();
    const last4Weeks = eachWeekOfInterval(
      {
        start: new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000),
        end: today,
      },
      { weekStartsOn: 1 }
    );

    return last4Weeks.map((weekStart, idx) => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekConsultations = consultations.filter((c) => {
        const d = parseISO(c.date);
        return isWithinInterval(d, { start: weekStart, end: weekEnd });
      });
      const feitas = weekConsultations.filter((c) => c.attended === true).length;
      const vendas = weekConsultations.filter((c) => c.converted === true).length;
      const conversao = feitas > 0 ? Math.round((vendas / feitas) * 100) : 0;

      return {
        name: `Sem ${idx + 1}`,
        vendas,
        conversao,
        meta: METAS_VENDAS.semanal,
      };
    });
  }, [consultations]);

  const monthlyData = useMemo(() => {
    const today = new Date();
    const last3Months = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (2 - i), 1);
      return d;
    });

    return last3Months.map((monthStart) => {
      const monthEnd = endOfMonth(monthStart);
      const monthConsultations = consultations.filter((c) => {
        const d = parseISO(c.date);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      });
      const feitas = monthConsultations.filter((c) => c.attended === true).length;
      const vendas = monthConsultations.filter((c) => c.converted === true).length;
      const conversao = feitas > 0 ? Math.round((vendas / feitas) * 100) : 0;

      return {
        name: format(monthStart, "MMM", { locale: ptBR }),
        vendas,
        conversao,
        meta: METAS_VENDAS.mensal,
      };
    });
  }, [consultations]);

  const getData = () => {
    switch (period) {
      case "diario":
        return dailyData;
      case "semanal":
        return weeklyData;
      case "mensal":
        return monthlyData;
    }
  };

  const getMeta = () => {
    switch (period) {
      case "diario":
        return METAS_VENDAS.diaria;
      case "semanal":
        return METAS_VENDAS.semanal;
      case "mensal":
        return METAS_VENDAS.mensal;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Conversão & Vendas</CardTitle>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="diario" className="text-xs px-2">Diário</TabsTrigger>
              <TabsTrigger value="semanal" className="text-xs px-2">Semanal</TabsTrigger>
              <TabsTrigger value="mensal" className="text-xs px-2">Mensal</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <p className="text-xs text-muted-foreground">
          Meta: {getMeta()} vendas ({period === "diario" ? "por dia" : period === "semanal" ? "por semana" : "por mês"})
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={getData()} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                yAxisId="left"
                axisLine={false}
                tickLine={false}
                className="text-[10px]"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                className="text-[10px]"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                unit="%"
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => {
                  if (name === "conversao") return [`${value}%`, "Conversão"];
                  return [value, "Vendas"];
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <ReferenceLine yAxisId="left" y={getMeta()} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ position: 'top', value: "Meta", fill: "hsl(var(--primary))", fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="vendas" name="Vendas" radius={[4, 4, 0, 0]} barSize={30}>
                {getData()?.map((entry, index) => (
                  <Cell key={index} fill={entry.vendas >= entry.meta ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                ))}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="conversao" name="Conversão %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
