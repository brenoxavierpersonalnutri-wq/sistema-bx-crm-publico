// Regra geral do CRM (21/10/2026): quando o atendimento humano entra na conversa, a IA para naquela conversa e
// só volta por um passo de FOLLOW-UP (agente de follow-up / fluxo de follow-up) ou pelo botão manual "Devolver
// para IA" (crm_ai_transferir_para_ia). Lógica pura (sem Deno, sem banco): o vitest importa direto.
//
// Humano entrou = mensagem MANUAL da equipe (CRM: whatsapp-send/-media; celular: message.sent que não veio da IA
// nem de automação) ou o botão "Assumir (humano)". Efeito: ai_pausado = true, ai_pausado_motivo = "humano", pendência
// da fila da IA cancelada e a linha "IA pausada: atendimento humano" no histórico. Vale também para conversa que a IA
// ainda não atendia: sem isso o gatilho/robô assumiria depois da janela de horas (a "volta depois de 12 h").
//
// Com motivo humano NENHUM gatilho, robô ou fluxo comum reativa a IA; só o follow-up (registrado como
// "retomado_followup") ou o humano pelo botão.

export const MOTIVO_HUMANO = "humano";
export const DETALHE_PAUSA_HUMANA = "IA pausada: atendimento humano";

/** Motivo de pausa que é atendimento humano ("humano", e os antigos "humano assumiu", "humano respondeu pelo ..."). */
export function motivoHumano(motivo: unknown): boolean {
  return /^humano\b/i.test(String(motivo ?? "").trim());
}

export interface EstadoIA {
  phone?: string | null;
  is_group?: boolean | null;
  ai_agent_slug?: string | null;
  ai_pausado?: boolean | null;
  ai_pausado_motivo?: string | null;
  ai_precisa_humano?: boolean | null;
}

/** A IA está pausada nesta conversa porque um humano entrou? */
export function pausadaPorHumano(c: EstadoIA | null | undefined): boolean {
  return Boolean(c?.ai_pausado) && motivoHumano(c?.ai_pausado_motivo);
}

const grupo = (c: EstadoIA | null | undefined, phone?: string | null) =>
  Boolean(c?.is_group) || String(phone ?? c?.phone ?? "").endsWith("@g.us");

/**
 * Quem pode tirar a IA da pausa. "followup" = passo de follow-up (agente de follow-up ou fluxo que tem passo de
 * follow-up); "manual" = humano no botão "Devolver para IA". Gatilho, robô (modo "todas") e fluxo comum: nunca com
 * motivo humano.
 */
export type OrigemReativacao = "gatilho" | "robo" | "fluxo" | "followup" | "manual";

export function podeReativar(c: EstadoIA | null | undefined, origem: OrigemReativacao): { ok: true } | { ok: false; motivo: string } {
  if (!pausadaPorHumano(c)) return { ok: true };
  if (origem === "followup" || origem === "manual") return { ok: true };
  return { ok: false, motivo: `${DETALHE_PAUSA_HUMANA}: só o follow-up (ou o botão "Devolver para IA") retoma` };
}

/** Plano ao detectar humano na conversa. mudou = a IA passou a ficar pausada agora (grava evento). */
export function planoPausaHumana(
  c: EstadoIA | null | undefined,
  origem: string,
  agora: Date,
): { mudou: boolean; patch: Record<string, unknown> | null; evento: { tipo: "pausado_humano"; detalhe: string } | null } {
  if (!c || grupo(c)) return { mudou: false, patch: null, evento: null };
  if (pausadaPorHumano(c)) {
    // já pausada por humano: só tira o selo "Precisa de humano" se ainda estiver (alguém atendeu)
    return { mudou: false, patch: c.ai_precisa_humano ? { ai_precisa_humano: false, updated_at: agora.toISOString() } : null, evento: null };
  }
  const o = String(origem ?? "").trim();
  return {
    mudou: true,
    patch: { ai_pausado: true, ai_pausado_motivo: MOTIVO_HUMANO, ai_precisa_humano: false, updated_at: agora.toISOString() },
    evento: { tipo: "pausado_humano", detalhe: `${DETALHE_PAUSA_HUMANA}${o ? ` (${o})` : ""}`.slice(0, 1000) },
  };
}

/** O fluxo é de follow-up? (tem um passo "Mensagem da IA" com agente de follow-up) */
export function fluxoDeFollowup(passos: { tipo?: string | null }[] | null | undefined): boolean {
  return (passos ?? []).some((p) => p?.tipo === "ia_followup");
}

/**
 * Follow-up mandou a mensagem de retomada: tira a pausa humana para a IA atender quando a lead responder.
 * Conversa sem pausa humana (ou grupo) = nada a fazer.
 */
export function planoRetomadaFollowup(
  c: EstadoIA | null | undefined,
  quem: string,
  agora: Date,
): { retomar: boolean; patch: Record<string, unknown> | null; evento: { tipo: "retomado_followup"; detalhe: string } | null } {
  if (!c || grupo(c) || !pausadaPorHumano(c)) return { retomar: false, patch: null, evento: null };
  return {
    retomar: true,
    patch: { ai_pausado: false, ai_pausado_motivo: null, ai_precisa_humano: false, updated_at: agora.toISOString() },
    evento: { tipo: "retomado_followup", detalhe: `IA retomada pelo follow-up (${String(quem ?? "").trim() || "follow-up"})`.slice(0, 1000) },
  };
}
