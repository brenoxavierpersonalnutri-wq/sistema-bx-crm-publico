// Visão "Conversas" do CRM (layout de WhatsApp Web): regras puras, sem React nem Supabase.
// Ordenação da lista, horário relativo, separadores de data, agrupamento de bolhas,
// status de entrega e não lidas calculadas no front (sem coluna no banco: a última
// leitura de cada conversa fica no localStorage, por usuário).

import { lerVCards } from "./vcard";
import { casaAtendente, conversaNoDepartamento, type Departamento, type FiltroAtendente } from "@/lib/crm/departamentos";

export type StatusBanco = "pending" | "sent" | "delivered" | "read" | "failed" | string | null;
export type StatusEntrega = "pendente" | "enviada" | "entregue" | "lida" | "falhou";
export type TipoMidia = "image" | "sticker" | "audio" | "video" | "document" | "link" | null;

export interface MensagemCRM {
  id: string;
  contact_phone: string;
  /** Número do WhatsApp (crm_numeros) da conversa (17/10/2026); sem a coluna, o padrão. */
  numero_id?: string | null;
  body: string;
  caption?: string | null;
  created_at: string;
  direction: string; // "inbound" | "outbound"
  sender_type: string; // "lead" | "human" | "user" | "bot"
  status?: StatusBanco;
  media_url?: string | null;
  /** Caminho no bucket privado whatsapp-media (OpenWA, 17/10/2026): a fonte assina na leitura e preenche media_url. */
  media_path?: string | null;
  /** pendente (baixando / nova tentativa) · ok · falhou (o WhatsApp não entregou o arquivo). */
  media_status?: "pendente" | "ok" | "falhou" | null;
  media_type?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
  message_id?: string | null;
  /** Em grupo: quem mandou (nome no WhatsApp) e o telefone dele, quando o OpenWA resolve. */
  author_name?: string | null;
  author_phone?: string | null;
  /** WID do autor (…@lid quase sempre): chave estável pra cor e agrupamento. */
  author_id?: string | null;
  /** Veio da importação do histórico (whatsapp_inserir_mensagens): nunca conta como não lida. */
  importada?: boolean | null;
}

export interface ContatoCRM {
  id: string;
  phone: string;
  /** Número do WhatsApp (crm_numeros) desta conversa: o mesmo telefone em 2 números = 2 conversas. */
  numero_id?: string | null;
  name: string;
  stage: string;
  avatar_url?: string | null;
  avatar_atualizado_em?: string | null;
  /** Grupo do WhatsApp (phone = JID …@g.us). Só leitura no CRM. */
  is_group?: boolean | null;
  tags?: string[] | null;
  notes?: string | null;
  ai_agent_slug?: string | null;
  ai_pausado?: boolean | null;
  ai_pausado_motivo?: string | null;
  /** a IA passou a conversa para o humano e ninguém atendeu ainda (migration 20261103100000) */
  ai_precisa_humano?: boolean | null;
  /** atendente da conversa (usuário; migration 20261123100000). null = sem atendente */
  atendente_id?: string | null;
  /** departamento (aba de Conversas / coluna do Kanban). null = sem departamento */
  departamento_id?: string | null;
  updated_at: string;
  created_at?: string;
  /** Canal da conversa (17/10/2026): sem a coluna, é WhatsApp. No Direct o phone é "ig:" + IGSID. */
  canal?: CanalConversa;
  /** @ do Instagram (só no Direct). */
  username?: string | null;
  /** Última mensagem DA PESSOA no Direct: a janela de 24 h conta daqui. */
  ultima_entrada_em?: string | null;
}

export type CanalConversa = "whatsapp" | "instagram";

/** Número do WhatsApp do Breno (crm_numeros), como a tela de Conversas usa. */
export interface NumeroConversa {
  id: string;
  chave: string;
  apelido: string;
  telefone?: string | null;
  tipo?: "openwa" | "oficial";
  ativo?: boolean;
  /** Sessão do OpenWA ("grupos-N" = número dedicado a criar grupo). */
  sessao_openwa?: string | null;
  /** true = não aparece em /crm/conversas (migration 20261121100000). Ausente = banco sem a coluna. */
  ocultar_em_conversas?: boolean | null;
}

/**
 * Número que fica fora de /crm/conversas (seletor, listas e contadores). Vale a coluna
 * `ocultar_em_conversas`; só quando o banco ainda não tem a coluna (undefined) cai para a finalidade
 * de grupos, a mesma que o Disparo em grupo usa para achar o número que cria grupo (sessão "grupos-N").
 */
export function numeroOcultoEmConversas(n: Pick<NumeroConversa, "ocultar_em_conversas" | "sessao_openwa">): boolean {
  if (n.ocultar_em_conversas === true) return true;
  if (n.ocultar_em_conversas === false) return false;
  return /^grupos-\d{1,3}$/.test(n.sessao_openwa ?? "");
}

/**
 * Chave da conversa: "<numero_id>|<phone>"; sem número (Instagram, banco antes da migration), o phone.
 * É o que a tela seleciona, o que a leitura guarda e o que casa mensagem com contato.
 */
export function chaveConversa(c: { phone: string; numero_id?: string | null }): string {
  return c.numero_id ? `${c.numero_id}|${c.phone}` : c.phone;
}

/** Contato da seleção: pela chave da conversa; sem casar, o primeiro com esse telefone (link antigo ?abrir=). */
export function contatoDaSelecao<T extends { phone: string; numero_id?: string | null }>(contatos: T[], selecionado: string | null): T | null {
  if (!selecionado) return null;
  return contatos.find((c) => chaveConversa(c) === selecionado) ?? contatos.find((c) => c.phone === selecionado) ?? null;
}

/** Chave da conversa de uma mensagem. */
export const chaveDaMensagem = (m: Pick<MensagemCRM, "contact_phone" | "numero_id">): string =>
  chaveConversa({ phone: m.contact_phone, numero_id: m.numero_id });

/** Rótulo do número: o apelido; sem cadastro, "Número". */
export function rotuloNumero(numeros: NumeroConversa[] | null | undefined, numeroId: string | null | undefined): string | null {
  if (!numeroId || !numeros?.length) return null;
  return numeros.find((n) => n.id === numeroId)?.apelido ?? null;
}

/** Canal do contato: a coluna, ou o prefixo "ig:" do phone. */
export function canalDoContato(c: Pick<ContatoCRM, "phone"> & { canal?: CanalConversa }): CanalConversa {
  if (c.canal) return c.canal;
  return typeof c.phone === "string" && c.phone.startsWith("ig:") ? "instagram" : "whatsapp";
}

/** Linha de baixo do nome no cabeçalho: telefone no WhatsApp, "@user · Instagram" no Direct. */
export function subtituloContato(c: Pick<ContatoCRM, "phone" | "name" | "username"> & { canal?: CanalConversa }): string | null {
  if (canalDoContato(c) === "instagram") return c.username ? `@${c.username} · Instagram` : "Instagram Direct";
  return c.name && c.name !== c.phone ? formatarTelefone(c.phone) : null;
}

export interface Conversa {
  contato: ContatoCRM;
  ultima: MensagemCRM | null;
  naoLidas: number;
  /** Marcada à mão como não lida (menu de contexto): bolinha sem número, até a conversa ser aberta de novo. */
  marcadaNaoLida?: boolean;
  /**
   * ISO usado na ordenação e no horário: SEMPRE a última mensagem real (timestamp do WhatsApp).
   * Sem mensagem = "" (vai pro fim). Nunca updated_at/created_at do contato: o backfill mexe neles
   * e a conversa antiga subia pro topo como se fosse de agora (17/10/2026).
   */
  ordem: string;
  /** true = o banco confirmou que o contato não tem mensagem nenhuma (sai do "Tudo", entra em "Sem conversa"). */
  semConversa: boolean;
}

/** Resumo por contato que vem do banco (RPC crm_conversas_ultimas): última mensagem e não lidas. */
export interface ResumoConversa {
  contact_phone: string;
  numero_id?: string | null;
  ultima: MensagemCRM;
  nao_lidas: number;
}

/**
 * Resumos indexados + quem eles cobrem: contato coberto e sem resumo = confirmado sem mensagem.
 * null = RPC indisponível (migration não rodou): a lista cai na janela de mensagens recentes.
 */
export interface IndiceResumos {
  /** Por chave da conversa (chaveConversa). */
  porTelefone: Map<string, ResumoConversa>;
  cobre: (c: ContatoCRM) => boolean;
}

export function indexarResumos(resumos: ResumoConversa[], cobre: (c: ContatoCRM) => boolean): IndiceResumos {
  const porTelefone = new Map<string, ResumoConversa>();
  for (const r of resumos) {
    if (r?.contact_phone && r.ultima?.created_at) porTelefone.set(chaveConversa({ phone: r.contact_phone, numero_id: r.numero_id }), r);
  }
  return { porTelefone, cobre };
}

export const ehEnviada = (m: Pick<MensagemCRM, "direction">) => m.direction === "outbound";

/** Grupo do WhatsApp: jid @g.us ou id longo com hífen (desde 17/10/2026 o webhook grava grupo como …@g.us). */
export function ehGrupo(phone: string): boolean {
  if (!phone) return false;
  if (phone.startsWith("ig:")) return false; // Direct do Instagram: IGSID longo não é grupo
  if (/@g\.us$/i.test(phone)) return true;
  return /^\d+-\d+$/.test(phone) || phone.replace(/\D/g, "").length >= 18;
}

/** Contato é grupo: pela coluna is_group ou, sem ela, pelo formato do phone. */
export function contatoEhGrupo(c: Pick<ContatoCRM, "phone" | "is_group">): boolean {
  return c.is_group === true || ehGrupo(c.phone);
}

/** Nome exibido: o salvo; sem nome, "Grupo" para grupo e o telefone formatado para contato. */
export function nomeExibido(c: Pick<ContatoCRM, "phone" | "name" | "is_group"> & { username?: string | null; canal?: CanalConversa }): string {
  const n = (c.name ?? "").trim();
  if (n && n !== c.phone) return n;
  if (canalDoContato(c) === "instagram") return c.username ? `@${c.username}` : "Instagram";
  return contatoEhGrupo(c) ? "Grupo" : formatarTelefone(c.phone);
}

// Paleta dos nomes de autor em grupo (como no WhatsApp: cada pessoa uma cor fixa).
const CORES_AUTOR = [
  "#e5486c", "#06a77d", "#c2410c", "#7c3aed", "#0284c7", "#b45309",
  "#be185d", "#15803d", "#4f46e5", "#0f766e", "#a21caf", "#dc2626",
];

/** Cor estável por autor (mesmo telefone/nome = mesma cor). */
export function corDoAutor(chave: string | null | undefined): string {
  const s = (chave ?? "").trim();
  if (!s) return CORES_AUTOR[0];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CORES_AUTOR[h % CORES_AUTOR.length];
}

/** Rótulo do autor na bolha de grupo: o nome; sem nome, o telefone; sem os dois, "Participante". */
export function rotuloAutor(m: Pick<MensagemCRM, "author_name" | "author_phone" | "author_id">): string | null {
  const n = (m.author_name ?? "").trim();
  if (n) return n;
  if (m.author_phone) return formatarTelefone(m.author_phone);
  return m.author_id ? "Participante" : null;
}

/** Chave do autor (cor e agrupamento): WID, senão telefone, senão nome. */
export const chaveAutor = (m: Pick<MensagemCRM, "author_name" | "author_phone" | "author_id">): string =>
  m.author_id || m.author_phone || m.author_name || "";

export function iniciais(nome: string | null | undefined, fallback = "?"): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return fallback;
  if (/^[+\d\s()-]+$/.test(limpo)) return limpo.replace(/\D/g, "").slice(-2) || fallback;
  const partes = limpo
    .split(/\s+/)
    .map((p) => graf(p).filter((g) => /[\p{L}\p{N}]/u.test(g)))
    .filter((g) => g.length > 0);
  if (partes.length === 0) {
    const emoji = graf(limpo).find((g) => /\p{Extended_Pictographic}/u.test(g));
    return emoji ?? "#";
  }
  const a = partes[0][0];
  const b = partes.length > 1 ? partes[partes.length - 1][0] : partes[0][1] ?? "";
  return (a + b).toUpperCase();
}

/** Separa por grafema (não corta emoji/ZWJ/acentos combinados). */
function graf(texto: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(texto), (x) => x.segment);
  return Array.from(texto);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dois = (n: number) => String(n).padStart(2, "0");

function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Diferença em dias de calendário (local): 0 = hoje, 1 = ontem. */
export function diasAtras(iso: string, agora: Date = new Date()): number {
  return Math.round((inicioDoDia(agora) - inicioDoDia(new Date(iso))) / 86_400_000);
}

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** Horário da lista: hoje "14:32", ontem "Ontem", antes "12/10/2026". */
export function horarioDaLista(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "";
  const dias = diasAtras(iso, agora);
  if (dias <= 0) return horaCurta(iso);
  if (dias === 1) return "Ontem";
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Separador de data no chat: "Hoje", "Ontem", "12 de outubro" (ou "... de 2025" em outro ano). */
export function rotuloSeparador(iso: string, agora: Date = new Date()): string {
  const dias = diasAtras(iso, agora);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const d = new Date(iso);
  const base = `${d.getDate()} de ${MESES[d.getMonth()]}`;
  return d.getFullYear() === agora.getFullYear() ? base : `${base} de ${d.getFullYear()}`;
}

export function statusEntrega(m: Pick<MensagemCRM, "direction" | "status">): StatusEntrega | null {
  if (!ehEnviada(m)) return null;
  switch (m.status) {
    case "read":
    case "played":
      return "lida";
    case "delivered":
      return "entregue";
    case "pending":
      return "pendente";
    case "failed":
    case "error":
      return "falhou";
    default:
      return "enviada";
  }
}

export function tipoMidia(m: Pick<MensagemCRM, "media_url" | "media_type" | "mime_type">): TipoMidia {
  const u = m.media_url;
  if (!u) return null;
  const mt = (m.media_type || "").toLowerCase();
  if (mt === "image" || mt === "sticker" || mt === "audio" || mt === "video" || mt === "document") return mt;
  if (mt === "ptt" || mt === "voice") return "audio";
  const mime = (m.mime_type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "document";
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)) return "image";
  if (/\.(ogg|mp3|m4a|opus|wav)(\?|$)/i.test(u)) return "audio";
  if (/\.(mp4|mov|webm)(\?|$)/i.test(u)) return "video";
  if (/\.(pdf|docx?|xlsx?|csv|zip|pptx?|txt)(\?|$)/i.test(u)) return "document";
  return "link";
}

const ROTULO_SO_MIDIA = /^\[(foto|imagem|áudio|audio|vídeo|video|figurinha|documento|mídia|midia)\]$/i;

/**
 * Mídia que ficou só com metadado (importação do histórico, 18/10/2026): tem tipo, não tem arquivo nem fila.
 * A bolha oferece "Baixar mídia" (busca pelo media-id na hora), em vez de baixar tudo em massa.
 */
/** Áudio/nota de voz que ainda precisa ser baixado (candidato ao carregamento automático). */
export function audioSobDemanda(m: Pick<MensagemCRM, "media_type" | "media_url" | "media_path" | "media_status" | "message_id">): boolean {
  return midiaSobDemanda(m) && ["audio", "ptt", "voice"].includes((m.media_type || "").toLowerCase());
}

export function midiaSobDemanda(m: Pick<MensagemCRM, "media_type" | "media_url" | "media_path" | "media_status" | "message_id">): boolean {
  const t = (m.media_type || "").toLowerCase();
  return !!t && t !== "chat" && t !== "text" && !m.media_url && !m.media_path && !m.media_status && !!m.message_id;
}

/** Texto exibível da mensagem (legenda ou corpo), escondendo rótulos tipo "[foto]" quando a mídia veio. */
export function textoDaMensagem(m: MensagemCRM): string {
  const texto = (m.caption || m.body || "").trim();
  if (!texto) return "";
  if (m.media_url && ROTULO_SO_MIDIA.test(texto)) return "";
  return texto;
}

const NOME_TIPO: Record<string, string> = {
  image: "Foto", sticker: "Figurinha", audio: "Áudio", video: "Vídeo", document: "Documento", link: "Mídia",
};

/** Prévia da lista: tipo de mídia (se houver) + texto. */
export function previaDaMensagem(m: MensagemCRM | null): { tipo: TipoMidia; texto: string } {
  if (!m) return { tipo: null, texto: "" };
  const tipo = tipoMidia(m);
  const texto = textoDaMensagem(m);
  const cartoes = lerVCards(texto);
  if (cartoes.length) return { tipo: null, texto: `Contato: ${cartoes.map((c) => c.nome).join(", ")}` };
  if (tipo) return { tipo, texto: texto || (tipo === "document" && m.file_name) || NOME_TIPO[tipo] };
  // rótulo "[áudio]" sem a mídia baixada
  const rot = (m.body || "").trim().match(ROTULO_SO_MIDIA);
  if (rot) return { tipo: null, texto: rot[1][0].toUpperCase() + rot[1].slice(1) };
  return { tipo: null, texto };
}

// ---------- itens do chat (separadores + agrupamento) ----------

export type ItemChat =
  | { tipo: "data"; chave: string; rotulo: string }
  | { tipo: "msg"; chave: string; msg: MensagemCRM; primeiraDoGrupo: boolean; ultimaDoGrupo: boolean };

const JANELA_GRUPO_MS = 5 * 60_000;

/** Recebe mensagens em qualquer ordem; devolve itens em ordem cronológica. */
export function montarItensChat(mensagens: MensagemCRM[], agora: Date = new Date()): ItemChat[] {
  const ord = [...mensagens].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const itens: ItemChat[] = [];
  let diaAnterior = "";
  ord.forEach((msg, i) => {
    const d = new Date(msg.created_at);
    const dia = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dia !== diaAnterior) {
      itens.push({ tipo: "data", chave: `d-${dia}`, rotulo: rotuloSeparador(msg.created_at, agora) });
      diaAnterior = dia;
    }
    const ant = ord[i - 1];
    const prox = ord[i + 1];
    const mesmoGrupo = (x?: MensagemCRM, y?: MensagemCRM) => {
      if (!x || !y) return false;
      const dx = new Date(x.created_at), dy = new Date(y.created_at);
      // em grupo, autor diferente quebra o bloco (cada pessoa ganha o nome no topo)
      return ehEnviada(x) === ehEnviada(y)
        && (ehEnviada(x) || chaveAutor(x) === chaveAutor(y))
        && inicioDoDia(dx) === inicioDoDia(dy)
        && Math.abs(dy.getTime() - dx.getTime()) <= JANELA_GRUPO_MS;
    };
    itens.push({
      tipo: "msg",
      chave: msg.id,
      msg,
      primeiraDoGrupo: !mesmoGrupo(ant, msg),
      ultimaDoGrupo: !mesmoGrupo(msg, prox),
    });
  });
  return itens;
}

/** Junta páginas/eventos sem duplicar (por id e por message_id), ordem cronológica. */
export function mesclarMensagens(atuais: MensagemCRM[], novas: MensagemCRM[]): MensagemCRM[] {
  // índice por message_id (21/10/2026): a busca linear por duplicata era O(n²) — 2000 recentes a cada
  // recarga da lista travavam o celular por centenas de ms
  const porId = new Map<string, MensagemCRM>();
  const porMsgId = new Map<string, string>();
  for (const m of atuais) {
    porId.set(m.id, m);
    if (m.message_id) porMsgId.set(m.message_id, m.id);
  }
  for (const m of novas) {
    if (m.message_id) {
      const outro = porMsgId.get(m.message_id);
      if (outro && outro !== m.id) porId.delete(outro);
      porMsgId.set(m.message_id, m.id);
    }
    const antes = porId.get(m.id);
    const junto = { ...antes, ...m };
    // a mesma mídia relida sem o link assinado (ele chega depois) não some da tela
    if (antes?.media_url && !m.media_url && m.media_path && antes.media_path === m.media_path) junto.media_url = antes.media_url;
    porId.set(m.id, junto);
  }
  return [...porId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

// ---------- lista de conversas ----------

export type Leituras = Record<string, string>; // chave da conversa (antes: phone) -> ISO da última leitura

/** Última leitura da conversa: a chave nova; sem ela, a antiga só pelo telefone. */
export const leituraDe = (leituras: Leituras, c: { phone: string; numero_id?: string | null }): string | undefined =>
  leituras[chaveConversa(c)] ?? leituras[c.phone];

/** Recebida e chegou pelo webhook: a importação do histórico não infla as não lidas. */
export const contaComoNaoLida = (m: MensagemCRM): boolean => !ehEnviada(m) && !m.importada;

export function contarNaoLidas(mensagensDoContato: MensagemCRM[], lidaEm: string | null | undefined): number {
  if (!lidaEm) return 0;
  return mensagensDoContato.filter((m) => contaComoNaoLida(m) && m.created_at > lidaEm).length;
}

/**
 * Monta e ordena a lista (mais recente primeiro).
 * `recentes`: janela das últimas mensagens de todos os contatos (qualquer ordem).
 * `leituras`: última leitura por telefone; `base`: a partir de quando contar não lidas
 * para quem nunca foi aberto (o primeiro uso não acusa o histórico inteiro como não lido).
 */
export function montarConversas(
  contatos: ContatoCRM[],
  recentes: MensagemCRM[],
  leituras: Leituras,
  base: string | null,
  resumos: IndiceResumos | null = null,
  marcadas: ReadonlySet<string> | null = null,
): Conversa[] {
  const porChave = new Map<string, MensagemCRM[]>();
  for (const m of recentes) {
    const k = chaveDaMensagem(m);
    const l = porChave.get(k);
    if (l) l.push(m); else porChave.set(k, [m]);
  }
  const lista = contatos.map((contato): Conversa => {
    const chave = chaveConversa(contato);
    const msgs = porChave.get(chave) ?? [];
    const r = resumos?.porTelefone.get(chave) ?? null;
    let ultima: MensagemCRM | null = r?.ultima ?? null;
    for (const m of msgs) if (!ultima || m.created_at > ultima.created_at) ultima = m;
    const lida = leituraDe(leituras, contato);
    const corte = lida && base ? (lida > base ? lida : base) : lida || base;
    let naoLidas: number;
    if (r && corte && corte < r.ultima.created_at) {
      // o banco contou até a última dele; soma só o que chegou depois (Realtime)
      naoLidas = r.nao_lidas + msgs.filter((m) => contaComoNaoLida(m) && m.created_at > r.ultima.created_at && m.created_at > corte).length;
    } else {
      naoLidas = contarNaoLidas(msgs, corte);
    }
    return {
      contato,
      ultima,
      naoLidas,
      marcadaNaoLida: !!marcadas?.has(chave),
      ordem: ultima?.created_at ?? "",
      semConversa: !ultima && !!resumos && resumos.cobre(contato),
    };
  });
  return ordenarConversas(lista);
}

/** Tem não lida de verdade ou foi marcada à mão (conta em "Não lidas" e no contador). */
export const temNaoLida = (c: Pick<Conversa, "naoLidas" | "marcadaNaoLida">): boolean => c.naoLidas > 0 || !!c.marcadaNaoLida;

/** Mais recente primeiro; sem mensagem ("") no fim, por nome. */
export function ordenarConversas(lista: Conversa[]): Conversa[] {
  return [...lista].sort((a, b) => {
    if (!a.ordem !== !b.ordem) return a.ordem ? -1 : 1;
    if (!a.ordem) return nomeExibido(a.contato).localeCompare(nomeExibido(b.contato), "pt-BR") || chaveConversa(a.contato).localeCompare(chaveConversa(b.contato));
    return b.ordem.localeCompare(a.ordem) || chaveConversa(a.contato).localeCompare(chaveConversa(b.contato));
  });
}

export type FiltroConversa =
  | "tudo" | "nao-lidas" | "grupos" | "sem-conversa" | `canal:${CanalConversa}` | `etapa:${string}` | `tag:${string}`
  /** aba de departamento (crm_departamentos.id) */
  | `dep:${string}`;

export interface OpcoesFiltro {
  /** departamentos, para as abas `dep:` (a da IA é regra) */
  departamentos?: Pick<Departamento, "id" | "regra">[];
  /** filtro "Atendente" (abaixo do seletor de número) */
  atendente?: FiltroAtendente;
  /**
   * A busca já foi feita no servidor (lista paginada): estas conversas casaram lá e passam no texto mesmo se a
   * regra local discordar (acento, prévia que o servidor leu e a lista ainda não tem). Os outros filtros valem.
   */
  casouNaBusca?: (c: Conversa) => boolean;
}

const soDigitos = (s: string) => s.replace(/\D/g, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * `numeroId`: só as conversas daquele número do WhatsApp (seletor do topo); null = todos.
 * Instagram não tem número: sai quando um número é escolhido.
 */
export function filtrarConversas(
  lista: Conversa[], busca: string, filtro: FiltroConversa, numeroId: string | null = null, opcoes: OpcoesFiltro = {},
): Conversa[] {
  const q = semAcento(busca.trim());
  const qDig = soDigitos(busca);
  const dep = filtro.startsWith("dep:") ? (opcoes.departamentos ?? []).find((d) => d.id === filtro.slice(4)) ?? null : null;
  const atendente = opcoes.atendente ?? "todos";
  return lista.filter((c) => {
    if (numeroId && c.contato.numero_id !== numeroId) return false;
    if (atendente !== "todos" && !casaAtendente(c.contato, atendente)) return false;
    if (filtro.startsWith("dep:") && (!dep || contatoEhGrupo(c.contato) || !conversaNoDepartamento(c.contato, dep))) return false;
    // contato confirmado sem mensagem não aparece nas visões de conversa, só em "Sem conversa"
    if (filtro === "sem-conversa") { if (c.ultima) return false; }
    else if (c.semConversa && !q) return false; // na busca, aparece (no fim)
    if (filtro === "nao-lidas" && !temNaoLida(c)) return false;
    if (filtro === "grupos" && !contatoEhGrupo(c.contato)) return false;
    if (filtro.startsWith("canal:") && canalDoContato(c.contato) !== filtro.slice(6)) return false;
    if (filtro.startsWith("etapa:") && c.contato.stage !== filtro.slice(6)) return false;
    if (filtro.startsWith("tag:") && !(c.contato.tags ?? []).includes(filtro.slice(4))) return false;
    if (!q) return true;
    if (opcoes.casouNaBusca?.(c)) return true;
    if (semAcento(c.contato.name || "").includes(q)) return true;
    if (c.contato.username && semAcento(c.contato.username).includes(q.replace(/^@/, ""))) return true;
    if (qDig.length >= 3 && soDigitos(c.contato.phone).includes(qDig)) return true;
    return semAcento(previaDaMensagem(c.ultima).texto).includes(q);
  });
}

export function tagsDisponiveis(contatos: ContatoCRM[]): string[] {
  const s = new Set<string>();
  for (const c of contatos) for (const t of c.tags ?? []) if (t) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function formatarTelefone(phone: string): string {
  const d = soDigitos(phone);
  if (d.length === 13 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : phone;
}

export function formatarBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function formatarDuracao(seg: number | null | undefined): string {
  if (seg == null || !Number.isFinite(seg) || seg < 0) return "0:00";
  const s = Math.round(seg);
  return `${Math.floor(s / 60)}:${dois(s % 60)}`;
}

// ---------- última leitura por usuário (localStorage, à prova de modo privado) ----------

const chaveLeituras = (usuario: string) => `crm:conversas:lidas:${usuario}`;

export function carregarLeituras(usuario: string, agora: Date = new Date()): { leituras: Leituras; base: string } {
  const vazio = { leituras: {}, base: agora.toISOString() };
  try {
    const cru = window.localStorage.getItem(chaveLeituras(usuario));
    if (!cru) {
      window.localStorage.setItem(chaveLeituras(usuario), JSON.stringify(vazio));
      return vazio;
    }
    const obj = JSON.parse(cru) as { leituras?: Leituras; base?: string };
    return { leituras: obj.leituras ?? {}, base: obj.base ?? vazio.base };
  } catch {
    return vazio;
  }
}

export function salvarLeitura(usuario: string, phone: string, iso: string): void {
  try {
    const atual = carregarLeituras(usuario);
    if ((atual.leituras[phone] ?? "") >= iso) return;
    atual.leituras[phone] = iso;
    window.localStorage.setItem(chaveLeituras(usuario), JSON.stringify(atual));
  } catch {
    /* localStorage indisponível: a não lida volta no próximo carregamento, sem quebrar a tela */
  }
}

// ---------- "marcar como não lida" à mão (localStorage por usuário, como as leituras) ----------

const chaveMarcadas = (usuario: string) => `crm:conversas:marcadas-nao-lidas:${usuario}`;

export function carregarMarcadas(usuario: string): Set<string> {
  try {
    const arr = JSON.parse(window.localStorage.getItem(chaveMarcadas(usuario)) ?? "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Liga ou desliga a marca de uma conversa (chave = chaveConversa). Falha de storage não quebra a tela. */
export function salvarMarcada(usuario: string, chave: string, marcada: boolean): void {
  try {
    const atual = carregarMarcadas(usuario);
    if (marcada) atual.add(chave); else atual.delete(chave);
    window.localStorage.setItem(chaveMarcadas(usuario), JSON.stringify([...atual]));
  } catch {
    /* localStorage indisponível: a marca vale só até recarregar */
  }
}
