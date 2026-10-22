// Resolve a sessão do OpenWA de um item da fila pelo número dele (crm_numeros), só Deno.
// numero_id vem do próprio item (herdado da automação/campanha/fluxo por trigger, migration 20261024100000).
// Tabela/coluna ainda não criadas = sessão padrão (comportamento de antes), nunca derruba o envio.
import { sessaoParaEnvio, type NumeroEnvio } from "./numerosWa.ts";

// cliente do supabase-js; tipado solto para não puxar os tipos gerados no Deno
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const cache = new Map<number, { sessao: string | null } | { recusa: string }>();

export async function sessaoDoItemFila(db: Db, filaId: number): Promise<{ sessao: string | null } | { recusa: string }> {
  const emCache = cache.get(filaId);
  if (emCache) return emCache;
  let r: { sessao: string | null } | { recusa: string } = { sessao: null };
  try {
    const { data, error } = await db
      .from("crm_automacao_fila")
      .select("numero_id, crm_numeros(tipo, sessao_openwa, ativo)")
      .eq("id", filaId)
      .maybeSingle();
    if (!error && data?.numero_id) r = sessaoParaEnvio((data.crm_numeros ?? null) as NumeroEnvio | null);
  } catch (e) {
    console.error("sessaoDoItemFila:", e instanceof Error ? e.message : e);
  }
  cache.set(filaId, r);
  return r;
}
