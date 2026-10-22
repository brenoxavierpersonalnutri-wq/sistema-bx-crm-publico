// Lista primeiro (18/10/2026): resposta da rota chats-recentes do proxy -> o que gravar no CRM. Lógica pura
// (sem Deno, sem rede): roda igual na edge function (whatsapp-import-history, modo "recentes") e no vitest.
//
// Regras:
//  - só entra conversa que tem pelo menos UMA mensagem com conteúdo e horário real (contato sem mensagem
//    fica fora da visão principal; aviso de sistema do pareamento não conta: _shared/openwa.ts semConteudo);
//  - @lid sem telefone resolvido fica de fora (não há como gravar sem número);
//  - o mesmo telefone em duas entradas (c.us e @lid) vira uma conversa só (a mais recente);
//  - ultimaEm = horário real da última mensagem: é o updated_at/created_at do contato NOVO (contato que já
//    existe não é tocado: upsert com ignoreDuplicates).
import { ehGrupo, telefoneValido } from "./openwa.ts";
import { linhasDoHistorico, type LinhaMensagem } from "./waBackfill.ts";

export type ConversaRecente = {
  phone: string;
  chatId: string;
  grupo: boolean;
  nome: string | null;
  linhas: LinhaMensagem[];
  ultimaEm: string;
};

export function conversasDosRecentes(resp: unknown, numeroId: string | null): ConversaRecente[] {
  const itens = resp && typeof resp === "object" && Array.isArray((resp as { itens?: unknown }).itens)
    ? (resp as { itens: unknown[] }).itens
    : [];
  const porTelefone = new Map<string, ConversaRecente>();
  for (const it of itens) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const chatId = typeof r.chatId === "string" ? r.chatId : "";
    const grupo = r.kind === "group" && ehGrupo(chatId);
    const phone = grupo ? chatId : typeof r.phone === "string" && telefoneValido(r.phone) ? r.phone : null;
    if (!phone) continue;
    const linhas = linhasDoHistorico(r.mensagens, phone);
    if (!linhas.length) continue;
    if (numeroId) for (const l of linhas) l.numero_id = numeroId;
    const ultimaEm = linhas.reduce((m, l) => (l.created_at > m ? l.created_at : m), linhas[0].created_at);
    const nome = typeof r.name === "string" && r.name.trim() && r.name !== chatId ? r.name.trim().slice(0, 120) : null;
    const atual = porTelefone.get(phone);
    if (atual) {
      // mesma pessoa em c.us e @lid: junta as mensagens (o banco deduplica pelo id)
      const ids = new Set(atual.linhas.map((l) => l.message_id));
      for (const l of linhas) if (!ids.has(l.message_id)) atual.linhas.push(l);
      if (ultimaEm > atual.ultimaEm) atual.ultimaEm = ultimaEm;
      atual.nome = atual.nome ?? nome;
      continue;
    }
    porTelefone.set(phone, { phone, chatId, grupo, nome, linhas, ultimaEm });
  }
  return [...porTelefone.values()].sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm));
}

/** Linha do contato NOVO (contato existente não muda: o upsert vai com ignoreDuplicates). */
export function contatoNovoDaConversa(c: ConversaRecente, numeroId: string | null): Record<string, unknown> {
  const base = { ...(numeroId ? { numero_id: numeroId } : {}), phone: c.phone, updated_at: c.ultimaEm, created_at: c.ultimaEm };
  return c.grupo
    ? { ...base, name: c.nome || "Grupo", is_group: true, source: "whatsapp-grupo" }
    : { ...base, name: c.nome || c.phone, source: "whatsapp-importacao" };
}
