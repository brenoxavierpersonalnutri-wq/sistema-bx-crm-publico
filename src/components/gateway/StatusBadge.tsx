import { Badge } from "@/components/ui/badge";
import { Check, Clock, X, Undo2 } from "lucide-react";
import { STATUS_LABEL } from "@/lib/gateway/formatters";

const map: Record<string, { cls: string; Icon: any }> = {
  pago: { cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", Icon: Check },
  pendente: { cls: "bg-amber-500/15 text-amber-600 border-amber-500/30", Icon: Clock },
  cancelado: { cls: "bg-red-500/15 text-red-600 border-red-500/30", Icon: X },
  reembolsado: { cls: "bg-muted text-muted-foreground border-border", Icon: Undo2 },
};

export function StatusBadge({ status }: { status: string }) {
  const item = map[status] ?? map.pendente;
  const { Icon } = item;
  return (
    <Badge variant="outline" className={`gap-1 ${item.cls}`}>
      <Icon className="h-3 w-3" />
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
