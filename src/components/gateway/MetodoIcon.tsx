import { CreditCard, FileText, Zap } from "lucide-react";
import { METODO_LABEL } from "@/lib/gateway/formatters";

export function MetodoIcon({ metodo, withLabel = false }: { metodo: string; withLabel?: boolean }) {
  const Icon = metodo === "pix" ? Zap : metodo === "boleto" ? FileText : CreditCard;
  const color =
    metodo === "pix" ? "text-emerald-600" : metodo === "boleto" ? "text-blue-600" : "text-purple-600";
  return (
    <span className={`inline-flex items-center gap-1.5 ${color}`}>
      <Icon className="h-4 w-4" />
      {withLabel && <span className="text-sm font-medium">{METODO_LABEL[metodo] ?? metodo}</span>}
    </span>
  );
}
