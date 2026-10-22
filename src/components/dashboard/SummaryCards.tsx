import { TrendingUp, TrendingDown, DollarSign, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePrivacy } from "@/hooks/usePrivacy";

interface SummaryCardProps {
  title: string;
  value: number;
  type: "revenue" | "expense" | "profit" | "commission";
  onClick?: () => void;
}

function SummaryCard({ title, value, type, onClick }: SummaryCardProps) {
  const { formatMoney } = usePrivacy();
  const formatted = formatMoney(value);
  const iconMap = {
    revenue: <TrendingUp className="h-5 w-5 text-success" />,
    commission: <Wallet className="h-5 w-5 text-primary" />,
    expense: <TrendingDown className="h-5 w-5 text-destructive" />,
    profit: <DollarSign className="h-5 w-5 text-warning" />,
  };
  const colorMap = {
    revenue: "text-success",
    commission: "text-primary",
    expense: "text-destructive",
    profit: value >= 0 ? "text-success" : "text-destructive",
  };

  const clickable = !!onClick;

  return (
    <Card
      className={`border-border/50 transition-all ${clickable ? "cursor-pointer hover:border-primary/40 hover:shadow-md" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") onClick?.(); } : undefined}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          {iconMap[type]}
        </div>
        <p className={`text-2xl font-display font-bold ${colorMap[type]}`}>{formatted}</p>
        {clickable && (
          <p className="text-[10px] text-muted-foreground/70 mt-1">Clique para detalhar</p>
        )}
      </CardContent>
    </Card>
  );
}

interface SummaryCardsProps {
  faturamento: number;
  comissao: number;
  gastos: number;
  lucro: number;
  onClickFaturamento?: () => void;
  onClickGastos?: () => void;
}

export function SummaryCards({ faturamento, comissao, gastos, lucro, onClickFaturamento, onClickGastos }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <SummaryCard title="Faturamento Total" value={faturamento} type="revenue" onClick={onClickFaturamento} />
      <SummaryCard title="Comissão Total" value={comissao} type="commission" />
      <SummaryCard title="Gastos Totais" value={gastos} type="expense" onClick={onClickGastos} />
      <SummaryCard title="Lucro" value={lucro} type="profit" />
    </div>
  );
}
