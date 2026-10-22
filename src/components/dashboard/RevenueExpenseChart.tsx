import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MonthlyData } from "@/data/dashboardData";

interface Props {
  data: MonthlyData[];
}

export function RevenueExpenseChart({ data }: Props) {
  const chartData = data.map((d) => ({
    month: d.month,
    Faturamento: d.faturamento,
    Gastos: d.trafego + d.campanhaMeta + d.ferramentas + d.colaboradores,
  }));

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="font-display text-lg">Faturamento vs Gastos</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 13, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 13,
              }}
              formatter={(value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            />
            <Legend />
            <Bar dataKey="Faturamento" fill="hsl(var(--chart-revenue))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Gastos" fill="hsl(var(--chart-expense))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
