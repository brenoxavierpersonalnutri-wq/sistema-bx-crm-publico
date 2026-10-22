// WA_PROXY_MULTISESSAO: a ponte da VPS aceita o campo `sessao` (números do time, /crm/conexoes).
// Não é segredo. Ordem: secret da função (Deno.env "1" liga, "0" desliga) tem prioridade; sem ele,
// integracao_config chave 'wa_proxy_multisessao' = '1' (só service role lê). Cache de 60 s por instância.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TTL_MS = 60 * 1000;
let cache: { valor: boolean; ate: number } | null = null;

export async function multisessaoLigada(): Promise<boolean> {
  const doEnv = (Deno.env.get("WA_PROXY_MULTISESSAO") ?? "").trim();
  if (doEnv === "1") return true;
  if (doEnv === "0") return false;
  if (cache && cache.ate > Date.now()) return cache.valor;
  const url = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chave) return false;
  try {
    const db = createClient(url, chave, { auth: { persistSession: false } });
    const { data, error } = await db.from("integracao_config")
      .select("valor").eq("chave", "wa_proxy_multisessao").maybeSingle();
    if (error) throw new Error(error.message);
    const valor = String(data?.valor ?? "").trim() === "1";
    cache = { valor, ate: Date.now() + TTL_MS };
    return valor;
  } catch (e) {
    console.error("multisessaoLigada: não li integracao_config", e instanceof Error ? e.message : e);
    return false;
  }
}
