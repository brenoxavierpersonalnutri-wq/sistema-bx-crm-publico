// IA do CRM no front: opções de modelo Claude (mesma lista que as functions usam) e a tradução do erro de
// supabase.functions.invoke na mensagem em português que a function devolveu (402/429/529/401 da Anthropic).
export {
  MODELO_CONVERSA,
  MODELO_RESUMO,
  MODELOS_CLAUDE,
  resolverModelo,
} from "../../../supabase/functions/_shared/anthropic.ts";

/**
 * A function responde 502 com { error: "IA (Claude): <motivo>" }; o invoke entrega isso como FunctionsHttpError
 * com a Response em error.context. Lê o corpo para mostrar o motivo de verdade, não "non-2xx status code".
 */
export async function mensagemErroIA(error: unknown, data?: unknown): Promise<string> {
  const d = data as { error?: string } | null | undefined;
  if (d?.error) return String(d.error);
  const e = error as { name?: string; message?: string; context?: Response } | null;
  if (e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError" || /Failed to send a request/i.test(String(e?.message))) {
    return "a função de IA não respondeu (não publicada ou sem rede)";
  }
  const ctx = e?.context;
  if (ctx && typeof ctx.json === "function") {
    const r = typeof ctx.clone === "function" ? ctx.clone() : ctx;
    const j = await r.json().catch(() => null);
    if (j?.error) return String(j.error);
  }
  return String(e?.message ?? "falhou");
}
