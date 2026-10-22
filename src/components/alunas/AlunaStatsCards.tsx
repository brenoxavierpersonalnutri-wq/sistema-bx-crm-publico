import { Users, AlertTriangle, CheckCircle, Monitor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Aluna } from "@/lib/alunaTypes";
import { filtrarAlunas } from "@/lib/alunaFiltros";

interface StatsProps {
  alunas: Aluna[];
  onFilterSelect?: (filter: string) => void;
}

export function AlunaStatsCards({ alunas, onFilterSelect }: StatsProps) {
  const totalIndividuais = filtrarAlunas(alunas, "individuais").length;
  const totalPlataforma = filtrarAlunas(alunas, "plataforma").length;
  const pagas = filtrarAlunas(alunas, "dia").length;
  const pendentes = filtrarAlunas(alunas, "pendentes").length;

  const stats = [
    { label: "Alunas Individuais", value: totalIndividuais, icon: Users, color: "bg-primary/10 text-primary", key: "individuais" },
    { label: "Plataforma", value: totalPlataforma, icon: Monitor, color: "bg-accent/10 text-accent-foreground", key: "plataforma" },
    { label: "Pagamentos em Dia", value: pagas, icon: CheckCircle, color: "bg-success/10 text-success", key: "dia" },
    { label: "Pendentes", value: pendentes, icon: AlertTriangle, color: "bg-destructive/10 text-destructive", key: "pendentes" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="border-none shadow-sm hover:shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          onClick={() => onFilterSelect?.(stat.key)}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.color}`}>
              <stat.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
