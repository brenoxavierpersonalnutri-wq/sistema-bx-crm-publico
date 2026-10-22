// Automações e campanhas do CRM: tipos, rótulos e chamada da edge function crm-automacoes.
// Tabelas da migration 20261018100000 (ainda fora do types.ts gerado): acesso via `db`.
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
export {
  CONFIG_PADRAO,
  validarAutomacao,
  normalizarTag,
  filtroVazio,
  type Acao,
  type Automacao,
  type ConfigEnvio,
  type FiltroPublico,
  type GatilhoTipo,
} from "../../supabase/functions/_shared/automacoes.ts";
import type { Acao, Automacao, FiltroPublico } from "../../supabase/functions/_shared/automacoes.ts";

export { db } from "@/lib/crmRoteiros";

export interface Campanha {
  id: string;
  nome: string;
  status: "rascunho" | "ativa" | "pausada" | "cancelada" | "concluida";
  filtro: FiltroPublico;
  roteiro_id: string | null;
  passo_id: string | null;
  lote_por_dia: number | null;
  total: number;
  confirmado_em: string | null;
  created_at: string;
}

export const ROTULO_GATILHO: Record<string, string> = {
  etapa: "Entrou na etapa",
  sem_resposta: "Sem resposta há",
  tag: "Recebeu a tag",
};

export const ROTULO_STATUS_CAMPANHA: Record<Campanha["status"], string> = {
  rascunho: "Rascunho",
  ativa: "Enviando",
  pausada: "Pausada",
  cancelada: "Cancelada",
  concluida: "Concluída",
};

/** "24 h", "3 dias" para o gatilho sem resposta. */
export function formatarHoras(h: number | null | undefined): string {
  const n = Number(h) || 0;
  if (n > 0 && n % 24 === 0) return `${n / 24} dia${n / 24 > 1 ? "s" : ""}`;
  return `${n} h`;
}

/** Frase curta da regra: "Entrou na etapa Agendado → envia roteiro, põe tag x". */
export function resumoAutomacao(
  a: Pick<Automacao, "gatilho_tipo" | "gatilho_valor" | "sem_resposta_horas" | "acoes">,
  nomes: { etapas?: Record<string, string>; roteiros?: Record<string, string> } = {},
): string {
  const et = (id: string | null | undefined) => (id ? nomes.etapas?.[id] ?? id : "?");
  const gat =
    a.gatilho_tipo === "etapa" ? `Entrou na etapa ${et(a.gatilho_valor)}` :
    a.gatilho_tipo === "tag" ? `Recebeu a tag ${a.gatilho_valor ?? "?"}` :
    `Sem resposta há ${formatarHoras(a.sem_resposta_horas)}`;
  const acoes = (a.acoes ?? []).map((x: Acao) =>
    x.tipo === "roteiro" ? `envia o roteiro ${nomes.roteiros?.[x.roteiro_id] ?? ""}`.trim() :
    x.tipo === "passo" ? "envia um passo" :
    x.tipo === "etapa" ? `move para ${et(x.etapa)}` :
    x.tipo === "tag" ? `põe a tag ${x.tag}` :
    x.tipo === "livre" ? "envia mensagem escrita no fluxo" :
    x.tipo === "ia_followup" ? "envia mensagem de follow-up escrita pela IA" :
    `template oficial ${x.template}`
  );
  return `${gat} → ${acoes.join(", ") || "nada"}`;
}

/** POST na edge function crm-automacoes com o JWT do usuário. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function chamarAutomacoes<T = any>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Faça login novamente.");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const r = await buscarComLimite(`https://${projectId}.supabase.co/functions/v1/crm-automacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) throw new Error("A função crm-automacoes ainda não foi publicada.");
    throw Object.assign(new Error(j?.error || `Falha (${r.status})`), { status: r.status, dados: j });
  }
  return j as T;
}
