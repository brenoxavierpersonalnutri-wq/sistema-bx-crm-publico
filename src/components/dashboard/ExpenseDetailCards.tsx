import { Card, CardContent } from "@/components/ui/card";
import { Megaphone, Target, Wrench, Users, Receipt, MessageCircle } from "lucide-react";
import { usePrivacy } from "@/hooks/usePrivacy";

interface Props {
  trafego: number;
  campanha: number;
  ferramentas: number;
  colaboradores: number;
  imposto: number;
  whatsappCost: number;
  whatsappSent: number;
  whatsappReceived: number;
  onClickFerramentas?: () => void;
  onClickColaboradores?: () => void;
  onClickImposto?: () => void;
}

const items = [
  { key: "imposto" as const, label: "Imposto", icon: Receipt, color: "text-chart-tax", clickKey: "onClickImposto" },
  { key: "ferramentas" as const, label: "Ferramentas", icon: Wrench, color: "text-chart-tools", clickKey: "onClickFerramentas" },
  { key: "trafego" as const, label: "Tráfego", icon: Megaphone, color: "text-chart-traffic", clickKey: "" },
  { key: "campanha" as const, label: "13,83% Meta", icon: Target, color: "text-chart-campaign", clickKey: "" },
  { key: "colaboradores" as const, label: "Colaboradores", icon: Users, color: "text-chart-collaborators", clickKey: "onClickColaboradores" },
];

export function ExpenseDetailCards(props: Props) {
  const { formatMoney } = usePrivacy();
  const values: Record<string, number> = {
    trafego: props.trafego,
    campanha: props.campanha,
    ferramentas: props.ferramentas,
    colaboradores: props.colaboradores,
    imposto: props.imposto,
  };
  const clickHandlers: Record<string, (() => void) | undefined> = {
    onClickFerramentas: props.onClickFerramentas,
    onClickColaboradores: props.onClickColaboradores,
    onClickImposto: props.onClickImposto,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {items.map(({ key, label, icon: Icon, color, clickKey }) => {
          const handler = clickKey ? clickHandlers[clickKey] : undefined;
          const isClickable = !!handler;
          return (
            <Card
              key={key}
              className={`border-border/50 ${isClickable ? "cursor-pointer hover:border-primary/30 transition-colors" : ""}`}
              onClick={isClickable ? handler : undefined}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <Icon className={`h-5 w-5 ${color} mb-2`} />
                  {isClickable && <span className="text-[10px] text-muted-foreground">Editar</span>}
                </div>
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-lg font-display font-bold text-foreground">
                  {formatMoney(values[key])}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium text-foreground">WhatsApp Business</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Custo</p>
              <p className="text-lg font-display font-bold text-foreground">
                {formatMoney(props.whatsappCost)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Enviadas</p>
              <p className="text-lg font-display font-bold text-foreground">
                {props.whatsappSent.toLocaleString("pt-BR")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Recebidas</p>
              <p className="text-lg font-display font-bold text-foreground">
                {props.whatsappReceived.toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
