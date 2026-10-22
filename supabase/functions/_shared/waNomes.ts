// Nome e telefone de participantes de grupo (só Deno). O histórico do WhatsApp Web quase nunca traz
// o pushName (medido em 17/10/2026: 4 de 2000 mensagens de um grupo) e o autor vem como @lid, então
// sem isto a tela mostra "Participante". Fonte: rota contacts-info do proxy (até 50 por chamada);
// cache em whatsapp_wa_nomes (7 dias, inclusive "não tem nome", pra não perguntar de novo).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ErroProxy } from "./waProxy.ts";
import { chamarProxyNaSessao } from "./waNumero.ts";
import { nomesDaResposta } from "./waBackfill.ts";

const SETE_DIAS = 7 * 24 * 3600 * 1000;
export type NomeWa = { nome: string | null; telefone: string | null };

/** Lê o cache; devolve o mapa dos que têm entrada recente e a lista dos que faltam. */
export async function nomesDoCache(supabase: SupabaseClient, wids: string[]): Promise<{ achados: Map<string, NomeWa>; faltam: string[] }> {
  const achados = new Map<string, NomeWa>();
  if (!wids.length) return { achados, faltam: [] };
  const limite = new Date(Date.now() - SETE_DIAS).toISOString();
  for (let i = 0; i < wids.length; i += 150) {
    const { data } = await supabase.from("whatsapp_wa_nomes")
      .select("wid, nome, telefone, atualizado_em").in("wid", wids.slice(i, i + 150));
    for (const r of (data ?? []) as { wid: string; nome: string | null; telefone: string | null; atualizado_em: string }[]) {
      if (r.atualizado_em > limite || r.nome) achados.set(r.wid, { nome: r.nome, telefone: r.telefone });
    }
  }
  return { achados, faltam: wids.filter((w) => !achados.has(w)) };
}

/**
 * Resolve os WIDs (cache primeiro, proxy para o resto, de 50 em 50), grava no cache e preenche as
 * mensagens antigas desses autores (whatsapp_aplicar_nomes). `reservar()` false = sem orçamento:
 * devolve o que conseguiu.
 */
export async function resolverNomes(
  supabase: SupabaseClient,
  wids: string[],
  reservar: () => Promise<boolean> = async () => true,
  /** Sessão do número em que os autores apareceram (null = padrão). */
  sessao: string | null = null,
): Promise<Map<string, NomeWa>> {
  const { achados, faltam } = await nomesDoCache(supabase, [...new Set(wids)]);
  for (let i = 0; i < faltam.length; i += 50) {
    if (!(await reservar())) break;
    const lote = faltam.slice(i, i + 50);
    try {
      const resp = await chamarProxyNaSessao("contacts-info", { ids: lote }, sessao, { timeoutMs: 30_000 });
      const nomes = nomesDaResposta(resp);
      // quem não voltou (timeout do proxy) não entra no cache: tenta na próxima
      const voltaram = nomes.filter((n) => lote.includes(n.wid));
      if (voltaram.length) {
        const { error } = await supabase.rpc("whatsapp_aplicar_nomes", { p_nomes: voltaram });
        if (error) console.error("nomes: aplicar falhou", error.message);
      }
      for (const n of voltaram) achados.set(n.wid, { nome: n.nome, telefone: n.telefone });
    } catch (e) {
      if (e instanceof ErroProxy && e.status === 429) break;
      console.error("nomes: contacts-info falhou", e instanceof ErroProxy ? e.status : e instanceof Error ? e.message : e);
      break;
    }
  }
  return achados;
}
