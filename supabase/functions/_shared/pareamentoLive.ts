// Lógica pura do pareamento dos segredos do LiveKit (VPS -> CRM), sem Deno e sem rede:
// roda no Deno (live-pareamento) e no vitest (src/test/pareamentoLive.test.ts).
//
// Sentido inverso do wa-proxy-pareamento: aqui a VPS ENTREGA ao CRM, UMA vez, o
// LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET que estão em /etc/headturbo-livekit/edge-secrets.env.
// Travas, todas obrigatórias (a função confere nesta ordem):
//   1. origem: cf-connecting-ip === IP da VPS (origemPermitida de pareamentoWa.ts, mesma regra);
//   2. uso único: só grava se ainda não houver valor (ou se o dono rearmou); depois, 410;
//   3. assinatura: HMAC-SHA256 com o wa_proxy_secret (já pareado com a VPS) sobre
//      `${ts}.${nonce}.${corpo}`; ts com janela de 5 min; nonce de uso único (a SQL recusa repetido).
// A resposta de sucesso traz só um hash curto do valor gravado, nunca o valor.
import { hmacSha256, iguaisTempoConstante, sha256Hex } from "./liveCrypto.ts";

export const JANELA_SEG = 300;
export const CABECALHO_TS = "x-live-ts";
export const CABECALHO_NONCE = "x-live-nonce";
export const CABECALHO_ASSINATURA = "x-live-assinatura";
export const CORPO_MAX = 4096;

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function mensagemAssinada(ts: string, nonce: string, corpo: string): string {
  return `${ts}.${nonce}.${corpo}`;
}

export async function assinarPareamento(segredo: string, ts: string, nonce: string, corpo: string): Promise<string> {
  return hex(await hmacSha256(segredo, mensagemAssinada(ts, nonce, corpo)));
}

/** Confere ts (janela), formato do nonce e HMAC. Não sabe de replay: isso é da SQL (nonce único). */
export async function conferirAssinatura(
  segredo: string,
  cab: { ts: string | null; nonce: string | null; assinatura: string | null },
  corpo: string,
  agoraMs: number,
): Promise<{ ok: boolean; motivo: string }> {
  if (!segredo || segredo.length < 32) return { ok: false, motivo: "segredo de assinatura ausente" };
  const { ts, nonce, assinatura } = cab;
  if (!ts || !/^\d{9,11}$/.test(ts)) return { ok: false, motivo: "timestamp ausente ou inválido" };
  if (Math.abs(agoraMs / 1000 - Number(ts)) > JANELA_SEG) return { ok: false, motivo: "timestamp fora da janela" };
  if (!nonce || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, motivo: "nonce ausente ou inválido" };
  if (!assinatura || !/^[0-9a-f]{64}$/.test(assinatura)) return { ok: false, motivo: "assinatura ausente ou inválida" };
  const esperada = await assinarPareamento(segredo, ts, nonce, corpo);
  if (!iguaisTempoConstante(esperada, assinatura)) return { ok: false, motivo: "assinatura não confere" };
  return { ok: true, motivo: "ok" };
}

export type ConfigLiveKit = { url: string; api_key: string; api_secret: string };

const URL_OK = /^(https:\/\/[a-z0-9.-]+(:\d+)?\/?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?)$/i;

/** Valida o corpo e devolve o valor normalizado (o texto exato que vai pro banco). */
export function validarCorpo(corpo: string): { ok: true; config: ConfigLiveKit; valor: string } | { ok: false; motivo: string } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(corpo);
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, motivo: "corpo não é objeto" };
  const url = String(d.url ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(d.api_key ?? "").trim();
  const apiSecret = String(d.api_secret ?? "").trim();
  if (!URL_OK.test(url)) return { ok: false, motivo: "url inválida" };
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(apiKey)) return { ok: false, motivo: "api_key inválida" };
  if (!/^[A-Za-z0-9_+/=-]{32,256}$/.test(apiSecret)) return { ok: false, motivo: "api_secret inválido (mínimo 32)" };
  const config = { url, api_key: apiKey, api_secret: apiSecret };
  return { ok: true, config, valor: JSON.stringify(config) };
}

/** Hash curto que a função devolve e o script da VPS recalcula pra conferir. */
export async function hashCurto(valor: string): Promise<string> {
  return (await sha256Hex(valor)).slice(0, 12);
}

/** Lê o JSON guardado em integracao_config.livekit (aceita as chaves no formato do env também). */
export function lerConfigGuardada(valor: unknown): ConfigLiveKit | null {
  if (typeof valor !== "string" || !valor) return null;
  try {
    const d = JSON.parse(valor);
    const url = String(d.url ?? d.LIVEKIT_URL ?? "");
    const api_key = String(d.api_key ?? d.LIVEKIT_API_KEY ?? "");
    const api_secret = String(d.api_secret ?? d.LIVEKIT_API_SECRET ?? "");
    return url && api_key && api_secret ? { url, api_key, api_secret } : null;
  } catch {
    return null;
  }
}

/** Resultado da SQL live_pareamento_gravar -> resposta HTTP. */
export function statusDaGravacao(r: unknown): { status: 200 | 409 | 410 | 500; motivo: string } {
  if (r === "ok") return { status: 200, motivo: "ok" };
  if (r === "ja_pareado") return { status: 410, motivo: "já pareado" };
  if (r === "replay") return { status: 409, motivo: "nonce repetido" };
  return { status: 500, motivo: "resposta inesperada do banco" };
}
