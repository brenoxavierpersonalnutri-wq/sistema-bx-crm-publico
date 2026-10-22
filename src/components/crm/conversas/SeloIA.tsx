// Selo "IA atendendo" / "Precisa de humano" (lista de conversas e cabeçalho do chat).
import { Bot, Hand } from "lucide-react";
import type { ContatoCRM } from "@/lib/crm/conversas";
import { seloIA } from "@/lib/crm/seloIA";

export function SeloIA({ contato, className = "" }: { contato: Pick<ContatoCRM, "ai_agent_slug" | "ai_pausado" | "ai_precisa_humano">; className?: string }) {
  const s = seloIA(contato);
  if (!s) return null;
  return (
    <span
      data-testid="selo-ia"
      className={`inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 font-medium whitespace-nowrap ${
        s.tipo === "ia" ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      } ${className}`}
      title={s.tipo === "ia" ? `Agente: ${contato.ai_agent_slug}` : "A IA passou esta conversa para o humano"}
    >
      {s.tipo === "ia" ? <Bot className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
      {s.rotulo}
    </span>
  );
}
