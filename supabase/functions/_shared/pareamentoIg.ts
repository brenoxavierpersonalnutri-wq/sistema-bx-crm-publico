// Lógica pura do pareamento das credenciais do app do Instagram (VPS -> CRM), sem Deno e sem rede:
// roda no Deno (instagram-oauth, POST ?evento=parear) e no vitest (src/test/pareamentoIg.test.ts).
//
// Mesmo molde do live-pareamento: a VPS entrega UMA vez IG_APP_ID/IG_APP_SECRET, ninguém cola valor
// no painel. Travas na função, nesta ordem: IP da VPS (cf-connecting-ip) -> uso único -> HMAC com o
// wa_proxy_secret sobre `${ts}.${nonce}.${corpo}` (janela 5 min, cabeçalhos x-live-*) -> SQL atômica
// (nonce único + uso único). Grava em integracao_config chave 'instagram_app' (JSON).
// O IG_TOKEN_SEGREDO não viaja: a migration 20261026120000 gera no banco ('instagram_token_segredo').

export type ConfigAppIg = { app_id: string; app_secret: string };

/** Valida o corpo {app_id, app_secret} e devolve o texto exato que vai pro banco. */
export function validarCorpoIg(corpo: string): { ok: true; config: ConfigAppIg; valor: string } | { ok: false; motivo: string } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(corpo);
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, motivo: "corpo não é objeto" };
  const appId = String(d.app_id ?? "").trim();
  const appSecret = String(d.app_secret ?? "").trim();
  if (!/^\d{6,20}$/.test(appId)) return { ok: false, motivo: "app_id inválido (só dígitos)" };
  if (!/^[0-9a-f]{32}$/i.test(appSecret)) return { ok: false, motivo: "app_secret inválido (32 hex)" };
  const config = { app_id: appId, app_secret: appSecret.toLowerCase() };
  return { ok: true, config, valor: JSON.stringify(config) };
}

/** Lê o JSON guardado em integracao_config.instagram_app (aceita também os nomes do env). */
export function lerAppIgGuardado(valor: unknown): ConfigAppIg | null {
  if (typeof valor !== "string" || !valor) return null;
  try {
    const d = JSON.parse(valor);
    const app_id = String(d.app_id ?? d.IG_APP_ID ?? "");
    const app_secret = String(d.app_secret ?? d.IG_APP_SECRET ?? "");
    return app_id && app_secret ? { app_id, app_secret } : null;
  } catch {
    return null;
  }
}

/** O que falta pro "Conectar Instagram" funcionar, em linguagem de gente (vazio = pronto). */
export function faltasConfigIg(c: { appId: string; appSecret: string; segredoToken: string }): string[] {
  const f: string[] = [];
  if (!c.appId || !c.appSecret) f.push("as credenciais do app da Meta (IG_APP_ID e IG_APP_SECRET, pareamento da VPS)");
  if (c.segredoToken.length < 32) f.push("o segredo que cifra o token (IG_TOKEN_SEGREDO, gerado pela migration 20261026120000)");
  return f;
}

/** Resultado da SQL instagram_pareamento_gravar -> resposta HTTP. */
export function statusGravacaoIg(r: unknown): { status: 200 | 409 | 410 | 500; motivo: string } {
  if (r === "ok") return { status: 200, motivo: "ok" };
  if (r === "ja_pareado") return { status: 410, motivo: "já pareado" };
  if (r === "replay") return { status: 409, motivo: "nonce repetido" };
  return { status: 500, motivo: "resposta inesperada do banco" };
}
