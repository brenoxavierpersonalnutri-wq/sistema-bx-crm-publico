import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import type { StatusEntrega } from "@/lib/crm/conversas";

const ROTULO: Record<StatusEntrega, string> = {
  pendente: "Enviando",
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
  falhou: "Falhou ao enviar",
};

export function StatusEntregaIcone({ status, className = "h-4 w-4" }: { status: StatusEntrega | null; className?: string }) {
  if (!status) return null;
  const comum = { "aria-label": ROTULO[status], role: "img", "data-status": status } as const;
  if (status === "pendente") return <Clock {...comum} className={`${className} crm-chat-meta`} />;
  if (status === "falhou") return <AlertCircle {...comum} className={`${className} text-destructive`} />;
  if (status === "enviada") return <Check {...comum} className={`${className} crm-chat-meta`} />;
  return <CheckCheck {...comum} className={`${className} ${status === "lida" ? "crm-chat-lido" : "crm-chat-meta"}`} />;
}
