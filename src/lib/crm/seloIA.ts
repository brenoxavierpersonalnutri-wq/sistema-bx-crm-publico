// Selo de quem atende a conversa (lista e chat). Puro: sem banco.
import { quemAtende } from "../../../supabase/functions/_shared/roboAtendimento.ts";

export { quemAtende };

export type SeloIA = { tipo: "ia"; rotulo: string } | { tipo: "humano_pendente"; rotulo: string } | null;

export function seloIA(c: { ai_agent_slug?: string | null; ai_pausado?: boolean | null; ai_precisa_humano?: boolean | null }): SeloIA {
  if (c.ai_precisa_humano) return { tipo: "humano_pendente", rotulo: "Precisa de humano" };
  if (quemAtende(c) !== "humano") return { tipo: "ia", rotulo: "IA atendendo" };
  return null;
}
