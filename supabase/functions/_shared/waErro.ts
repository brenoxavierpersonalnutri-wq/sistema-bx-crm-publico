// Erro do proxy do WhatsApp -> resposta legível para o CRM (20/10/2026). Lógica pura (sem Deno, sem rede): roda
// igual na edge function e no vitest. Antes, qualquer falha do chats-recentes virava 502 "Não consegui listar as
// conversas no OpenWA" e o CRM mostrava só "Edge Function returned a non-2xx status code".
//
// Recebe o que a chamada ao proxy lançou: ErroProxy (tem status e detalhe = corpo da resposta do proxy) ou o
// próprio timeout do fetch da edge function (DOMException TimeoutError).

const MSG_SINCRONIZANDO =
  "O WhatsApp demorou para responder (o número acabou de conectar e ainda está sincronizando, ou está ocupado). Tente de novo em 1 minuto.";

export type ErroCrm = { status: number; error: string; motivo?: string };

function textoDoDetalhe(detalhe: unknown): string | null {
  if (detalhe && typeof detalhe === "object") {
    const d = detalhe as Record<string, unknown>;
    if (typeof d.error === "string" && d.error.trim() && d.error !== "openwa") return d.error.trim().slice(0, 300);
    if (typeof d.message === "string" && d.message.trim()) return `OpenWA: ${d.message.trim().slice(0, 200)}`;
  }
  return null;
}

export function erroDoProxyParaCrm(e: unknown, acao = "listar as conversas"): ErroCrm {
  const nome = (e as { name?: unknown } | null)?.name;
  if (nome === "TimeoutError" || nome === "AbortError") return { status: 504, error: MSG_SINCRONIZANDO, motivo: "timeout" };
  const status = typeof (e as { status?: unknown } | null)?.status === "number" ? (e as { status: number }).status : 0;
  const detalhe = (e as { detalhe?: unknown } | null)?.detalhe;
  if (status === 429) return { status: 429, error: "Limite de leitura do proxy, tente em 1 minuto", motivo: "limite" };
  if (status === 504) return { status: 504, error: textoDoDetalhe(detalhe) ?? MSG_SINCRONIZANDO, motivo: "timeout" };
  if (status === 401) return { status: 502, error: "O proxy do WhatsApp recusou a assinatura da edge function (segredo diferente).", motivo: "assinatura" };
  const texto = textoDoDetalhe(detalhe);
  if (status) {
    return {
      status: status >= 500 ? 502 : status,
      error: texto ? `Não consegui ${acao} no WhatsApp: ${texto}` : `Não consegui ${acao} no WhatsApp (proxy respondeu ${status}).`,
    };
  }
  const msg = e instanceof Error && e.message ? e.message.slice(0, 200) : "erro desconhecido";
  return { status: 502, error: `Não consegui ${acao} no WhatsApp: ${msg}` };
}
