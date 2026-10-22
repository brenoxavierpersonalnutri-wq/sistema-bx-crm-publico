// Cliente do proxy da VPS (só Deno). O OpenWA é o ÚNICO provedor de WhatsApp do CRM
// desde 17/10/2026: a UazAPI foi aposentada e o secret WA_PROVIDER não é mais lido.
//
// Toda chamada vai ao proxy em WA_PROXY_URL, assinada com WA_PROXY_SECRET
// (HMAC do corpo + timestamp + nonce; o proxy recusa > 60 s e nonce repetido).
// O segredo vem do secret da função se existir; senão do banco (segredosWa.ts).
import { assinarChamadaProxy } from "./openwa.ts";
import { segredoWa } from "./segredosWa.ts";

/** Resposta padrão das funções que só existiam para a UazAPI. */
export function respostaUazapiAposentada(cors: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      error: "UazAPI aposentada em 17/10/2026: o CRM usa só o OpenWA (VPS). Esta função não faz mais nada.",
      provider: "openwa",
    }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

export class ErroProxy extends Error {
  constructor(public status: number, public detalhe: unknown) {
    super(`proxy respondeu ${status}`);
  }
}

/**
 * POST assinado no proxy. `rota` é uma das rotas fechadas (send-text, status...).
 * Devolve o JSON, ou a Response crua quando `binario` (rota media).
 */
export async function chamarProxy(
  rota: string,
  corpo: Record<string, unknown>,
  opcoes: { binario?: boolean; timeoutMs?: number } = {},
  // JSON livre do OpenWA (ou Response na rota media); cada chamador valida o que lê
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const base = (Deno.env.get("WA_PROXY_URL") ?? "").replace(/\/+$/, "");
  const secret = await segredoWa("WA_PROXY_SECRET");
  if (!base || !secret) throw new ErroProxy(500, "WA_PROXY_URL/WA_PROXY_SECRET não configurados");

  const caminho = `/v1/${rota}`;
  const texto = JSON.stringify(corpo);
  const { ts, nonce, assinatura } = await assinarChamadaProxy(secret, "POST", caminho, texto);

  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WA-Timestamp": ts,
      "X-WA-Nonce": nonce,
      "X-WA-Signature": assinatura,
    },
    body: texto,
    signal: AbortSignal.timeout(opcoes.timeoutMs ?? 25_000),
  });

  if (opcoes.binario) {
    if (!res.ok) throw new ErroProxy(res.status, await res.text().catch(() => ""));
    return res;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroProxy(res.status, json);
  return json;
}
