import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthlyData } from "@/data/dashboardData";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrivacy } from "@/hooks/usePrivacy";

interface Props {
  data: MonthlyData[];
  onEditMonth: (index: number) => void;
}

export function MonthlyTable({ data, onEditMonth }: Props) {
  const { formatMoney } = usePrivacy();
  const fmt = (v: number) => formatMoney(v);

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="font-display text-lg">Dados Mensais</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Mês</th>
              <th className="text-right py-2 px-2 font-medium">Faturamento</th>
              <th className="text-right py-2 px-2 font-medium">Tráfego</th>
              <th className="text-right py-2 px-2 font-medium">13,83% Meta</th>
              <th className="text-right py-2 px-2 font-medium">Ferramentas</th>
              <th className="text-right py-2 px-2 font-medium">Colaboradores</th>
              <th className="text-right py-2 px-2 font-medium">Imposto</th>
              <th className="text-right py-2 px-2 font-medium">Total Gastos</th>
              <th className="text-right py-2 pl-2 font-medium">Lucro Líquido</th>
              <th className="py-2 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const imposto = d.faturamento * d.impostoPercent / 100;
              const totalGastos = d.trafego + d.campanhaMeta + d.ferramentas + d.colaboradores + imposto;
              const lucro = d.comissao - totalGastos;
              return (
                <tr key={d.month} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 pr-4 font-medium text-foreground">{d.month}</td>
                  <td className="py-2.5 px-2 text-right text-success font-medium">{fmt(d.faturamento)}</td>
                  <td className="py-2.5 px-2 text-right text-chart-traffic">{fmt(d.trafego)}</td>
                  <td className="py-2.5 px-2 text-right text-chart-campaign">{fmt(d.campanhaMeta)}</td>
                  <td className="py-2.5 px-2 text-right text-chart-tools">{fmt(d.ferramentas)}</td>
                  <td className="py-2.5 px-2 text-right text-chart-collaborators">{fmt(d.colaboradores)}</td>
                  <td className="py-2.5 px-2 text-right text-chart-tax">{fmt(imposto)}</td>
                  <td className="py-2.5 px-2 text-right text-destructive font-medium">{fmt(totalGastos)}</td>
                  <td className={`py-2.5 pl-2 text-right font-medium ${lucro >= 0 ? 'text-success' : 'text-destructive'}`}>{fmt(lucro)}</td>
                  <td className="py-2.5 pl-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditMonth(i)}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
