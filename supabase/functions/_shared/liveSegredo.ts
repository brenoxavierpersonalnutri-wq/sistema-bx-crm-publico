// Segredo das lives (LIVE_CHAVES_SEGREDO): cifra as chaves RTMP (v1), o refresh_token do YouTube (y1)
// e assina o token de leitura do render. Ninguém cola segredo em painel.
//
// Ordem (env SEMPRE primeiro, pra não invalidar nada que já tenha sido cifrado com ele):
//  1) Deno.env LIVE_CHAVES_SEGREDO, se tiver 32+ caracteres;
//  2) integracao_config 'live_chaves_segredo' (64 hex gerados no banco pela migration
//     20261103110000; só service role lê). Achou: cache em memória da instância (o valor não muda;
//     trocar invalida o que já foi cifrado);
//  3) senão, erro com o motivo (nunca o valor).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escolherSegredoLive } from "./liveCrypto.ts";

export { escolherSegredoLive };

export const CHAVE_CONFIG_LIVE = "live_chaves_segredo";

let cacheBanco: string | null = null;

async function lerDoBanco(admin?: SupabaseClient): Promise<string | null> {
  if (cacheBanco) return cacheBanco;
  let db = admin;
  if (!db) {
    const url = Deno.env.get("SUPABASE_URL");
    const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !chave) return null;
    db = createClient(url, chave, { auth: { persistSession: false } });
  }
  try {
    const { data, error } = await db.from("integracao_config").select("valor").eq("chave", CHAVE_CONFIG_LIVE).maybeSingle();
    if (error) throw new Error(error.message);
    const v = escolherSegredoLive(null, (data?.valor as string | undefined) ?? null);
    if (v) cacheBanco = v; // sem valor não guarda: a migration pode rodar a qualquer momento
    return v;
  } catch (e) {
    console.error("liveSegredo: não li integracao_config", e instanceof Error ? e.message.slice(0, 120) : "erro");
    return null;
  }
}

/** Segredo das lives. Lança Error claro se não houver nem env nem banco. */
export async function segredoLive(admin?: SupabaseClient): Promise<string> {
  const doEnv = escolherSegredoLive(Deno.env.get("LIVE_CHAVES_SEGREDO"), null);
  if (doEnv) return doEnv;
  const v = await lerDoBanco(admin);
  if (v) return v;
  throw new Error(
    "LIVE_CHAVES_SEGREDO ausente: sem secret na função e sem 'live_chaves_segredo' em integracao_config (rode a migration 20261103110000)",
  );
}

/** Mesma coisa, mas devolve null em vez de lançar (pra quem tem caminho sem segredo). */
export async function segredoLiveOuNull(admin?: SupabaseClient): Promise<string | null> {
  try {
    return await segredoLive(admin);
  } catch {
    return null;
  }
}
