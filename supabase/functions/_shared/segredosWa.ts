// Segredos da integração com a VPS (só Deno).
//
// Ordem: secret da função (Deno.env) SE existir com 32+ caracteres; senão o valor que a
// migration 20261022100000 gerou dentro do banco (integracao_config, só service role lê).
// Assim ninguém precisa colar valor no painel: o banco gera, a VPS busca uma vez pelo
// wa-proxy-pareamento, e as funções leem daqui. Cache em memória por 5 min (por instância).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type NomeSegredoWa = "WA_PROXY_SECRET" | "OPENWA_WEBHOOK_SECRET";

export const CHAVE_NO_BANCO: Record<NomeSegredoWa, string> = {
  WA_PROXY_SECRET: "wa_proxy_secret",
  OPENWA_WEBHOOK_SECRET: "openwa_webhook_secret",
};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<NomeSegredoWa, { valor: string; ate: number }>();

/** Valor efetivo do segredo ("" quando não há em lugar nenhum). Nunca loga o valor. */
export async function segredoWa(nome: NomeSegredoWa): Promise<string> {
  const doEnv = Deno.env.get(nome) ?? "";
  if (doEnv.length >= 32) return doEnv;

  const guardado = cache.get(nome);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;

  const url = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chave) return "";
  try {
    const db = createClient(url, chave, { auth: { persistSession: false } });
    const { data, error } = await db.from("integracao_config")
      .select("valor").eq("chave", CHAVE_NO_BANCO[nome]).maybeSingle();
    if (error) throw new Error(error.message);
    const valor = typeof data?.valor === "string" && data.valor.length >= 32 ? data.valor : "";
    if (valor) cache.set(nome, { valor, ate: Date.now() + TTL_MS });
    return valor;
  } catch (e) {
    console.error(`segredoWa: não consegui ler ${CHAVE_NO_BANCO[nome]}`, e instanceof Error ? e.message : e);
    return "";
  }
}
