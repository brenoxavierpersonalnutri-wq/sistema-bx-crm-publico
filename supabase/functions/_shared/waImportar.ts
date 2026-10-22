// Importa o histórico de UM chat do OpenWA para o CRM (só Deno). Usado pelo whatsapp-import-history
// (botão "Sincronizar"/histórico de um contato) e pelo whatsapp-backfill (todos os chats).
//
// 1 leitura de histórico (deep acima de 100 mensagens: o WhatsApp Web carrega as antigas sob demanda,
// até 2000) + até 1 leitura de nomes por 50 autores sem nome. Grava em lote pela RPC
// whatsapp_inserir_mensagens (ON CONFLICT DO NOTHING: reimportar não duplica). As N mídias mais
// recentes ficam com media_status 'pendente' e o tick do backfill baixa (rota media / histórico).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chamarProxyNaSessao, sessaoLeitura } from "./waNumero.ts";
import { ehGrupo } from "./openwa.ts";
import { aplicarNomes, autoresSemNome, linhasDoHistorico, midiasParaBaixar, type LinhaMensagem } from "./waBackfill.ts";
import { resolverNomes } from "./waNomes.ts";

/** numeroId: o número (crm_numeros) cuja sessão lê o chat e a quem as mensagens pertencem (null = padrão). */
export type AlvoChat = { phone: string; chatId: string | null; numeroId?: string | null };

const LOTE = 500;

/** Insere sem duplicar; devolve quantas eram novas. Sem a RPC (migration pendente), linha a linha. */
export async function inserirMensagens(supabase: SupabaseClient, linhas: LinhaMensagem[]): Promise<number> {
  let novas = 0;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const { data, error } = await supabase.rpc("whatsapp_inserir_mensagens", { p_linhas: lote });
    if (!error) {
      novas += Number(data) || 0;
      continue;
    }
    if (error.code !== "PGRST202" && error.code !== "42883") throw new Error(error.message);
    // fallback: confere os que já existem e insere o resto um a um (23505 = corrida, conta como existente)
    const { data: ja } = await supabase.from("whatsapp_messages").select("message_id")
      .in("message_id", lote.map((l) => l.message_id).slice(0, 150));
    const existentes = new Set((ja ?? []).map((r: { message_id: string }) => r.message_id));
    for (const l of lote) {
      if (existentes.has(l.message_id)) continue;
      const { media_status: _ms, ...semColunaNova } = l;
      const { error: e2 } = await supabase.from("whatsapp_messages").insert(semColunaNova);
      if (!e2) novas++;
      else if (e2.code !== "23505") throw new Error(e2.message);
    }
  }
  return novas;
}

export async function importarChat(
  supabase: SupabaseClient,
  alvo: AlvoChat,
  opcoes: { limite: number; midias: number; reservar: () => Promise<boolean> },
): Promise<{ lidas: number; novas: number; midiasPendentes: number }> {
  const grupo = ehGrupo(alvo.phone);
  const limite = Math.min(Math.max(Math.trunc(opcoes.limite) || 100, 1), 2000);
  const corpo: Record<string, unknown> = grupo
    ? { chatId: alvo.phone, limit: limite }
    : alvo.chatId ? { chatId: alvo.chatId, limit: limite } : { phone: alvo.phone, limit: limite };
  if (limite > 100) corpo.deep = true;
  if (!(await opcoes.reservar())) throw new Error("sem orçamento de leitura");
  const sessao = await sessaoLeitura(supabase, alvo.numeroId ?? null);
  const lista = await chamarProxyNaSessao("history", corpo, sessao, { timeoutMs: limite > 100 ? 60_000 : 25_000 });
  const linhas = linhasDoHistorico(lista, alvo.phone, new Date().toISOString());
  if (!linhas.length) return { lidas: 0, novas: 0, midiasPendentes: 0 };
  if (alvo.numeroId) for (const l of linhas) l.numero_id = alvo.numeroId;

  if (grupo) {
    const faltam = autoresSemNome(linhas);
    if (faltam.length) aplicarNomes(linhas, await resolverNomes(supabase, faltam, opcoes.reservar, sessao));
  }
  const comArquivo = new Set(midiasParaBaixar(linhas, opcoes.midias));
  for (const l of linhas) if (comArquivo.has(l.message_id)) l.media_status = "pendente";

  const novas = await inserirMensagens(supabase, linhas);
  // mensagem que já existia sem arquivo (importação antiga gravava só "[foto]"): entra na fila também
  for (const l of linhas) {
    if (!comArquivo.has(l.message_id)) continue;
    await supabase.from("whatsapp_messages")
      .update({ media_status: "pendente", media_type: l.media_type, ...(l.mime_type ? { mime_type: l.mime_type } : {}) })
      .eq("message_id", l.message_id).is("media_status", null).is("media_path", null);
  }
  return { lidas: linhas.length, novas, midiasPendentes: comArquivo.size };
}
