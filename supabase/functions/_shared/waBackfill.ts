// Lógica pura do backfill/importação de histórico do OpenWA (sem Deno, sem rede): roda igual no
// Deno (edge functions) e no Node (vitest, src/test/openwaBackfill.test.ts).
//
// - linhasDoHistorico: mensagens do /history do OpenWA -> linhas de whatsapp_messages;
// - midiasParaBaixar: quais mensagens com mídia ganham arquivo (as N mais recentes por chat);
// - autoresSemNome: WIDs de participantes de grupo que precisam de nome;
// - variantesTelefoneBR: o mesmo celular brasileiro com e sem o 9 (chave de contato);
// - chatIdDaMensagem: o chat de uma mensagem a partir do id serializado do WhatsApp;
// - OrcamentoLeituras: ritmo de leituras no proxy (o proxy corta em 60/min).
import { ehGrupo, interpretarEventoOpenwa, telefoneValido } from "./openwa.ts";

export type LinhaMensagem = {
  /** Número do WhatsApp da conversa (crm_numeros); vazio = o padrão (default do banco). */
  numero_id?: string | null;
  contact_phone: string;
  direction: "inbound" | "outbound";
  sender_type: "human" | "lead";
  body: string;
  media_type: string | null;
  mime_type: string | null;
  file_name: string | null;
  caption: string | null;
  message_id: string;
  created_at: string;
  author_name: string | null;
  author_phone: string | null;
  author_id: string | null;
  media_status: "pendente" | null;
};

/**
 * Converte o histórico de UM chat em linhas. `phone` é a chave do contato (telefone ou JID do
 * grupo). Em chat individual o chatId de cada mensagem vira <phone>@c.us antes de interpretar,
 * porque o chat pode ter vindo como @lid e a linha precisa do telefone já resolvido.
 * Mensagem de grupo dentro de chat individual, sem id ou apagada fica de fora.
 */
export function linhasDoHistorico(lista: unknown, phone: string, _agoraIso?: string): LinhaMensagem[] {
  if (!Array.isArray(lista)) return [];
  const grupo = ehGrupo(phone);
  const out: LinhaMensagem[] = [];
  const vistos = new Set<string>();
  for (const m of lista) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (!grupo && r.isGroup === true) continue;
    const ev = interpretarEventoOpenwa({
      event: r.fromMe ? "message.sent" : "message.received",
      data: { ...r, chatId: grupo ? phone : `${phone}@c.us` },
    });
    if (ev.tipo !== "mensagem" || !ev.messageId || ev.telefone !== phone || vistos.has(ev.messageId)) continue;
    // histórico sem horário real fica de fora: "agora" jogaria a conversa antiga pro topo da lista
    if (!ev.criadoEm) continue;
    vistos.add(ev.messageId);
    out.push({
      contact_phone: phone,
      direction: ev.fromMe ? "outbound" : "inbound",
      sender_type: ev.fromMe ? "human" : "lead",
      body: ev.corpo,
      media_type: ev.mediaType,
      mime_type: ev.mimetype,
      file_name: ev.fileName,
      caption: ev.caption,
      message_id: ev.messageId,
      created_at: ev.criadoEm,
      author_name: grupo ? ev.autorNome : null,
      author_phone: grupo ? ev.autorTelefone : null,
      author_id: grupo ? ev.autorId : null,
      media_status: null,
    });
  }
  return out;
}

/** As `n` mensagens com mídia mais recentes (figurinha entra: o Chefe quer ver as figurinhas do histórico). */
export function midiasParaBaixar(linhas: LinhaMensagem[], n: number): string[] {
  if (n <= 0) return [];
  return linhas
    .filter((l) => l.media_type)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n)
    .map((l) => l.message_id);
}

/** WIDs (…@lid / …@c.us) de autores sem nome, sem repetir. */
export function autoresSemNome(linhas: Pick<LinhaMensagem, "author_id" | "author_name">[]): string[] {
  const s = new Set<string>();
  for (const l of linhas) {
    if (!l.author_name && l.author_id && /^\d{5,25}@(c\.us|lid)$/.test(l.author_id)) s.add(l.author_id);
  }
  return [...s];
}

/** Preenche autor das linhas a partir do mapa WID -> {nome, telefone}. Muta e devolve as linhas. */
export function aplicarNomes<T extends Pick<LinhaMensagem, "author_id" | "author_name" | "author_phone">>(
  linhas: T[],
  nomes: Map<string, { nome: string | null; telefone: string | null }>,
): T[] {
  for (const l of linhas) {
    if (!l.author_id) continue;
    const n = nomes.get(l.author_id);
    if (!n) continue;
    if (!l.author_name && n.nome) l.author_name = n.nome;
    if (!l.author_phone && n.telefone) l.author_phone = n.telefone;
  }
  return linhas;
}

/** Resposta do contacts-info do proxy -> entradas válidas pro cache (whatsapp_aplicar_nomes). */
export function nomesDaResposta(resp: unknown): { wid: string; nome: string | null; telefone: string | null }[] {
  if (!Array.isArray(resp)) return [];
  const out: { wid: string; nome: string | null; telefone: string | null }[] = [];
  for (const c of resp) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const wid = typeof r.id === "string" && /^\d{5,25}@(c\.us|lid)$/.test(r.id) ? r.id : null;
    if (!wid) continue;
    const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
    const tel = typeof r.phone === "string" && telefoneValido(r.phone) ? r.phone : null;
    // nome salvo na agenda do Breno vale mais que o pushName
    out.push({ wid, nome: txt(r.name) ?? txt(r.pushName), telefone: tel });
  }
  return out;
}

/**
 * O mesmo celular brasileiro com e sem o nono dígito. O WhatsApp guarda muita conta antiga com
 * 55+DDD+8 dígitos, e formulário/planilha grava 55+DDD+9+8: sem isso o mesmo lead vira dois contatos.
 * Devolve [original, variante] (ou só [original] quando não é celular BR).
 */
export function variantesTelefoneBR(d: string): string[] {
  if (!telefoneValido(d)) return [d];
  const com9 = /^55([1-9]\d)9([6-9]\d{7})$/.exec(d);
  if (com9) return [d, `55${com9[1]}${com9[2]}`];
  const sem9 = /^55([1-9]\d)([6-9]\d{7})$/.exec(d);
  if (sem9) return [d, `55${sem9[1]}9${sem9[2]}`];
  return [d];
}

/**
 * Chat de uma mensagem pelo id serializado do whatsapp-web.js: `<fromMe>_<chat>_<id>[_<autor>]`.
 * Serve pra pedir a mídia de mensagem antiga sem ter guardado o chatId (pode ser @lid).
 */
export function chatIdDaMensagem(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  const m = /^(?:true|false)_([^_]+@(?:c\.us|lid|g\.us))_/.exec(messageId);
  if (!m) return null;
  const chat = m[1];
  return /^(\d{10,15}@c\.us|\d{5,25}@lid|\d{5,25}(-\d{5,15})?@g\.us)$/.test(chat) ? chat : null;
}

/**
 * Leituras por minuto (janela deslizante). O proxy corta em 60/min contando TODAS as leituras
 * (webhook, foto, importação); o backfill fica com folga.
 */
export class OrcamentoLeituras {
  private marcas: number[] = [];
  constructor(private teto: number, private agora: () => number = Date.now) {}
  /** ms até a próxima vaga (0 = pode ler agora; a vaga já fica reservada). */
  reservar(): number {
    const t = this.agora();
    this.marcas = this.marcas.filter((m) => m > t - 60_000);
    if (this.marcas.length < this.teto) {
      this.marcas.push(t);
      return 0;
    }
    return this.marcas[0] + 60_000 - t + 5;
  }
}

/** Texto curto do progresso do backfill (a tela e o resumo da função usam o mesmo). */
export function textoProgresso(j: { status: string; total_chats: number; chats_feitos: number }): string {
  if (j.status === "listando") return "listando conversas do WhatsApp…";
  if (j.status === "importando") return `importando ${j.chats_feitos}/${j.total_chats} conversas`;
  if (j.status === "concluido") return `concluído: ${j.chats_feitos}/${j.total_chats} conversas`;
  if (j.status === "cancelado") return `cancelado em ${j.chats_feitos}/${j.total_chats}`;
  if (j.status === "pausado") return `pausado em ${j.chats_feitos}/${j.total_chats}`;
  return "erro no backfill";
}

// ---------- janela do backfill (integracao_config 'backfill_dias', padrão 90) ----------

export const BACKFILL_DIAS_PADRAO = 90;

/** Dias da janela: número inteiro >= 1; vazio/inválido = padrão; "0" = sem limite (tudo). */
export function diasDaJanela(valor: string | null | undefined): number {
  const t = String(valor ?? "").trim();
  if (!t) return BACKFILL_DIAS_PADRAO;
  const n = Math.trunc(Number(t));
  if (!Number.isFinite(n) || n < 0) return BACKFILL_DIAS_PADRAO;
  return n;
}

/**
 * Timestamp de chat do WhatsApp em ms. O OpenWA manda em segundos; se vier em ms (>= 1e11), aceita.
 * null/0/inválido = null.
 */
export function tsChatParaMs(ts: number | string | null | undefined): number | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1e11 ? n : n * 1000;
}

/** Corte da janela em ms (null = sem limite). */
export function corteDaJanela(dias: number, agoraMs: number = Date.now()): number | null {
  return dias > 0 ? agoraMs - dias * 86_400_000 : null;
}

/** Chat entra no backfill? Sem timestamp conhecido entra (vai pro fim da fila). */
export function chatNaJanela(ts: number | string | null | undefined, corteMs: number | null): boolean {
  if (corteMs === null) return true;
  const ms = tsChatParaMs(ts);
  return ms === null || ms >= corteMs;
}

/**
 * Filtro PostgREST (.or) dos itens da fila FORA da janela, cobrindo ts em segundos e em ms.
 * ts em ms nunca é < corte em segundos, então os dois ramos não se misturam.
 */
export function filtroForaDaJanela(corteMs: number): string {
  const seg = Math.floor(corteMs / 1000);
  return `ts.lt.${seg},and(ts.gte.100000000000,ts.lt.${Math.floor(corteMs)})`;
}

// ---------- histórico completo por número (18/10/2026) ----------

/** Teto de mensagens por conversa no histórico completo (proxy: TETO_HISTORICO_FUNDO, deep). */
export const POR_CHAT_HISTORICO_COMPLETO = 2000;
export const STATUS_ATIVOS = ["listando", "importando"] as const;

type JobResumo = { status: string; completo?: boolean | null } | null | undefined;

/**
 * O que fazer quando pedem para iniciar, dado o último job do número:
 *  - "reusar": já existe um job ativo do mesmo tipo (só acorda o tick);
 *  - "retomar": há um job pausado do tipo pedido (ou o pedido é o normal e há qualquer pausado);
 *  - "cancelar-e-criar": há um job ativo/pausado de OUTRO tipo (normal -> completo): cancela e cria;
 *  - "criar": nada em aberto.
 * Um job em aberto por número (índice único whatsapp_backfill_um_ativo_por_numero).
 */
export function decidirInicio(ultimo: JobResumo, completo: boolean): "reusar" | "retomar" | "cancelar-e-criar" | "criar" {
  if (!ultimo) return "criar";
  const doTipo = Boolean(ultimo.completo) === completo;
  if ((STATUS_ATIVOS as readonly string[]).includes(ultimo.status)) return doTipo || !completo ? "reusar" : "cancelar-e-criar";
  if (ultimo.status === "pausado") return doTipo || !completo ? "retomar" : "cancelar-e-criar";
  return "criar";
}

/** Contato NOVO criado pelo backfill (contato existente não muda: upsert com ignoreDuplicates). */
export function contatoNovoDoBackfill(
  item: { kind: string; nome: string | null },
  phone: string,
  ultimaEm: string,
  completo: boolean,
  numeroId: string | null,
): Record<string, unknown> {
  const base = { ...(numeroId ? { numero_id: numeroId } : {}), phone, updated_at: ultimaEm, created_at: ultimaEm };
  return item.kind === "group"
    ? { ...base, name: item.nome || "Grupo", is_group: true, source: "whatsapp-grupo" }
    // 'whatsapp-historico': conversa antiga trazida pelo histórico completo não entra em fluxo de "contato novo"
    : { ...base, name: item.nome || phone, source: completo ? "whatsapp-historico" : "whatsapp-backfill" };
}
