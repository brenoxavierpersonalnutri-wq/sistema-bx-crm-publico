import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface ExpenseItem {
  name: string;
  value: number;
  fill: string;
}

interface Props {
  data: ExpenseItem[];
}

export function ExpenseBreakdownChart({ data }: Props) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="font-display text-lg">Distribuição de Gastos</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
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
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
