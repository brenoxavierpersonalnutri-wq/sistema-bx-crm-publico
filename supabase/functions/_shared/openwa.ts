// Lógica pura da integração com o OpenWA (gateway de WhatsApp na VPS).
// Sem Deno, sem rede: roda igual no Deno (edge functions) e no Node (vitest,
// src/test/openwa.test.ts). Só usa Web Crypto (crypto.subtle), que os dois têm.
//
// Três coisas moram aqui:
//  1. conferir a assinatura X-OpenWA-Signature dos webhooks (HMAC-SHA256 do corpo cru);
//  2. transformar o envelope do OpenWA no que o CRM grava (telefone, direção, mídia);
//  3. assinar as chamadas que as edge functions fazem ao proxy da VPS.

const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(mensagem));
  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparação em tempo constante (não para no primeiro byte diferente). */
export function iguaisTempoConstante(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let dif = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return dif === 0;
}

/**
 * Confere o header `X-OpenWA-Signature: sha256=<hex>` contra o corpo CRU
 * (exatamente os bytes recebidos, nunca um JSON re-serializado).
 */
export async function assinaturaOpenwaValida(
  corpoCru: string,
  header: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret || !header) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const esperado = await hmacSha256Hex(secret, corpoCru);
  return iguaisTempoConstante(esperado, m[1].toLowerCase());
}

// ---------------------------------------------------------------- telefone

const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Telefone válido no CRM: só dígitos, 10 a 15. */
export function telefoneValido(d: string): boolean {
  return /^\d{10,15}$/.test(d);
}

/**
 * Extrai o telefone de um WID do WhatsApp.
 * `5531999999999@c.us` e `5531999999999:12@s.whatsapp.net` viram `5531999999999`.
 * Grupo, canal, status, broadcast e `@lid` (id de privacidade, sem telefone) devolvem null.
 */
export function telefoneDoWid(wid: unknown): string | null {
  if (typeof wid !== "string" || !wid.includes("@")) return null;
  const [usuario, dominio] = wid.split("@");
  if (dominio !== "c.us" && dominio !== "s.whatsapp.net") return null;
  const d = soDigitos(usuario.split(":")[0]);
  return telefoneValido(d) ? d : null;
}

export const ehLid = (wid: unknown): boolean =>
  typeof wid === "string" && wid.endsWith("@lid");

/**
 * Grupo do WhatsApp: `120363...@g.us` (novo) ou `<criador>-<epoch>@g.us` (antigo).
 * No CRM o grupo é um contato com `phone` = o próprio JID (nunca só dígitos, então nenhum
 * caminho de envio, que exige 10 a 15 dígitos, consegue mandar mensagem pra ele) e `is_group`.
 */
export const ehGrupo = (wid: unknown): wid is string =>
  typeof wid === "string" && /^\d{5,25}(-\d{5,15})?@g\.us$/.test(wid);

// ------------------------------------------------------------ evento

export type EventoOpenwa =
  | { tipo: "ignorar"; motivo: string }
  | { tipo: "ack"; messageId: string; status: string }
  | {
      tipo: "mensagem";
      /** Telefone (só dígitos) ou, em grupo, o JID do grupo (…@g.us). É a chave do contato no CRM. */
      telefone: string;
      grupo: boolean;
      /** Em grupo: quem mandou (pushName/nome do participante) e o telefone dele, quando dá. */
      autorNome: string | null;
      autorTelefone: string | null;
      /** Em grupo: o WID de quem mandou (…@c.us ou …@lid). Chave estável do autor. */
      autorId: string | null;
      fromMe: boolean;
      messageId: string | null;
      chatId: string;
      corpo: string;
      mediaType: "image" | "video" | "audio" | "document" | "sticker" | null;
      mimetype: string | null;
      fileName: string | null;
      caption: string | null;
      nome: string | null;
      criadoEm: string | null;
      /** base64 quando o OpenWA mandou a mídia junto (até 1 MiB por padrão). */
      midiaInline: string | null;
      /** true quando há mídia mas ela não veio no corpo (precisa buscar no proxy). */
      midiaPendente: boolean;
      /** Telefone do PRÓPRIO número da sessão (data.to na recebida, data.from na enviada), quando é @c.us. */
      telefoneProprio: string | null;
    };

/**
 * UUID da sessão do OpenWA que gerou o webhook (`sessionId` no topo do envelope, v0.24.0 —
 * WebhookPayload em src/modules/webhook/webhook-delivery.service.ts). Vai dentro do corpo assinado.
 */
export function sessionIdDoEnvelope(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const v = (envelope as Record<string, unknown>).sessionId;
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

const TIPOS_MIDIA: Record<string, "image" | "video" | "audio" | "document" | "sticker"> = {
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  ptt: "audio",
  document: "document",
  sticker: "sticker",
};

export const rotuloMidia = (t: string | null): string =>
  t === "image" ? "[foto]" :
  t === "audio" ? "[áudio]" :
  t === "video" ? "[vídeo]" :
  t === "document" ? "[documento]" :
  t === "sticker" ? "[figurinha]" : "[mídia]";

const ROTULO_OUTROS: Record<string, string> = {
  location: "[localização]",
  contact: "[contato]",
  vcard: "[contato]",
  multi_vcard: "[contato]",
  poll: "[enquete]",
  poll_creation: "[enquete]",
  call: "[ligação]",
  call_log: "[ligação]",
  order: "[pedido]",
  product: "[produto]",
  masked: "[mensagem protegida]",
};

/**
 * Evento SEM conteúdo que não é mensagem de ninguém (18/10/2026, causa do "[mensagem]" do comercial-fit-2):
 * ao parear um aparelho novo o WhatsApp Web cria em CADA conversa um aviso de sistema (criptografia de
 * ponta a ponta, troca de número de segurança, gp2...). O OpenWA v0.24.0 (message-mapper.ts,
 * mapWwebjsMessageType) transforma todo tipo que não conhece em "unknown", com body vazio, e o horário é
 * o do pareamento. Gravar isso virava uma bolha "[mensagem]" às 19:0x com 1 não lida em toda conversa.
 * Regra: sem texto, sem mídia e sem rótulo conhecido = ignorar (não existe conteúdo a mostrar).
 */
export function semConteudo(tipoMsg: string, texto: string | null, temMidia: boolean): boolean {
  return !texto && !temMidia && !ROTULO_OUTROS[tipoMsg];
}

const STATUS_ACK = new Set(["pending", "sent", "delivered", "read", "failed"]);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/**
 * Converte o envelope `{ event, data, ... }` do OpenWA no que o CRM grava.
 * Trata message.received, message.sent e message.ack; o resto é ignorado.
 * Grupo vira mensagem com `grupo: true` (telefone = JID do grupo, autor separado);
 * status, canal e broadcast continuam ignorados.
 */
export function interpretarEventoOpenwa(envelope: unknown): EventoOpenwa {
  if (!envelope || typeof envelope !== "object") return { tipo: "ignorar", motivo: "corpo inválido" };
  const e = envelope as Record<string, unknown>;
  const evento = String(e.event ?? "");
  const data = (e.data && typeof e.data === "object") ? e.data as Record<string, unknown> : null;
  if (!data) return { tipo: "ignorar", motivo: `sem data (${evento || "?"})` };

  if (evento === "message.ack") {
    const messageId = str(data.messageId) ?? str(data.id);
    const status = String(data.status ?? "").toLowerCase();
    if (!messageId || !STATUS_ACK.has(status)) return { tipo: "ignorar", motivo: "ack incompleto" };
    return { tipo: "ack", messageId, status };
  }

  if (evento !== "message.received" && evento !== "message.sent") {
    return { tipo: "ignorar", motivo: `evento ${evento || "?"}` };
  }

  const fromMe = evento === "message.sent" || data.fromMe === true;
  const kind = String(data.kind ?? "");
  const chatId = str(data.chatId) ?? (fromMe ? str(data.to) : str(data.from)) ?? "";

  if (data.isStatusBroadcast === true || /@(newsletter|broadcast)$/.test(chatId)) {
    return { tipo: "ignorar", motivo: "canal/status/broadcast" };
  }
  const grupo = ehGrupo(chatId);
  if (!grupo && (data.isGroup === true || (kind && kind !== "individual"))) {
    return { tipo: "ignorar", motivo: `chat ${kind || "grupo"} sem id de grupo` };
  }
  if (/@g\.us$/.test(chatId) && !grupo) return { tipo: "ignorar", motivo: "grupo com id inválido" };

  const contatoRem = (data.contact && typeof data.contact === "object") ? data.contact as Record<string, unknown> : {};
  let autorNome: string | null = null;
  let autorTelefone: string | null = null;
  let autorId: string | null = null;
  if (grupo && !fromMe) {
    const a = str(data.author);
    autorId = a && a.length <= 80 ? a : null;
    autorNome = str(contatoRem.pushName) ?? str(contatoRem.name) ?? str(contatoRem.shortName);
    const sp = soDigitos(data.senderPhone);
    const cn = soDigitos(contatoRem.number);
    autorTelefone = telefoneDoWid(data.author) ?? (telefoneValido(sp) ? sp : telefoneValido(cn) ? cn : null);
    if (autorNome) autorNome = autorNome.slice(0, 120);
  }

  let telefone = grupo ? chatId : telefoneDoWid(chatId);
  if (!telefone && ehLid(chatId) && !fromMe) {
    // @lid: o telefone só vem em senderPhone (RESOLVE_LID_TO_PHONE=true no OpenWA)
    const sp = soDigitos(data.senderPhone);
    const contato = (data.contact && typeof data.contact === "object") ? data.contact as Record<string, unknown> : {};
    const cn = soDigitos(contato.number);
    telefone = telefoneValido(sp) ? sp : telefoneValido(cn) ? cn : null;
  }
  if (!telefone) return { tipo: "ignorar", motivo: ehLid(chatId) ? "lid sem telefone" : "sem telefone" };

  const tipoMsg = String(data.type ?? "text").toLowerCase();
  if (tipoMsg === "revoked") return { tipo: "ignorar", motivo: "mensagem apagada" };

  const media = (data.media && typeof data.media === "object") ? data.media as Record<string, unknown> : null;
  const mediaType = TIPOS_MIDIA[tipoMsg] ?? null;
  const texto = str(data.body);
  const caption = mediaType ? texto : null;
  const mimetype = str(media?.mimetype);
  const fileName = str(media?.filename);
  const midiaInline = mediaType && media && media.omitted !== true ? str(media.data) : null;
  const midiaPendente = Boolean(mediaType) && !midiaInline;

  if (semConteudo(tipoMsg, texto, Boolean(mediaType))) {
    return { tipo: "ignorar", motivo: `sem conteúdo (tipo ${tipoMsg.slice(0, 30)})` };
  }

  const corpo = mediaType
    ? (caption ?? (tipoMsg === "document" && fileName ? fileName : rotuloMidia(mediaType)))
    : (texto ?? ROTULO_OUTROS[tipoMsg]);

  // em grupo o "contact" é o participante, não o grupo: o nome do grupo vem da lista de chats
  const nome = fromMe || grupo ? null : (str(contatoRem.pushName) ?? str(contatoRem.name));

  const ts = Number(data.timestamp);
  const criadoEm = Number.isFinite(ts) && ts > 0
    ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString()
    : null;

  return {
    tipo: "mensagem",
    telefone,
    grupo,
    autorNome,
    autorTelefone,
    autorId,
    fromMe,
    messageId: str(data.id),
    chatId,
    corpo,
    mediaType,
    mimetype,
    fileName,
    caption,
    nome,
    criadoEm,
    midiaInline,
    midiaPendente,
    telefoneProprio: telefoneDoWid(fromMe ? data.from : data.to),
  };
}

/** Extensão de arquivo a partir do mimetype (pro nome no bucket). */
export function extensaoDoMime(mime: string | null, fileName?: string | null): string {
  const doNome = fileName && fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (/^[a-z0-9]{1,8}$/.test(doNome)) return doNome;
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  const mapa: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "audio/mp4": "m4a", "audio/aac": "aac", "application/pdf": "pdf",
  };
  return mapa[m] ?? "bin";
}

// ------------------------------------------------- assinatura do proxy

/**
 * Texto canônico assinado nas chamadas edge function -> proxy da VPS.
 * O proxy (infra/wa-proxy/lib.mjs) monta exatamente o mesmo texto.
 */
export function textoCanonicoProxy(ts: string, nonce: string, metodo: string, caminho: string, corpo: string): string {
  return `${ts}\n${nonce}\n${metodo.toUpperCase()}\n${caminho}\n${corpo}`;
}

export async function assinarChamadaProxy(
  secret: string,
  metodo: string,
  caminho: string,
  corpo: string,
  agoraMs: number = Date.now(),
  nonce?: string,
): Promise<{ ts: string; nonce: string; assinatura: string }> {
  const ts = String(Math.floor(agoraMs / 1000));
  const n = nonce ?? Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const assinatura = await hmacSha256Hex(secret, textoCanonicoProxy(ts, n, metodo, caminho, corpo));
  return { ts, nonce: n, assinatura };
}

// ------------------------------------------------- foto de perfil

/** Foto do contato/grupo vale 7 dias; depois disso, a próxima mensagem dispara uma atualização. */
export const AVATAR_VALIDADE_MS = 7 * 24 * 3600 * 1000;

export function avatarPrecisaAtualizar(atualizadoEm: string | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!atualizadoEm) return true;
  const t = Date.parse(atualizadoEm);
  return !Number.isFinite(t) || agoraMs - t > AVATAR_VALIDADE_MS;
}

/** chatId que o OpenWA entende para a foto: o próprio JID do grupo, ou <telefone>@c.us. */
export function chatIdDoContato(phone: string): string | null {
  if (ehGrupo(phone)) return phone;
  return telefoneValido(phone) ? `${phone}@c.us` : null;
}

/** Caminho da foto no bucket: hash do telefone/JID (não dá pra adivinhar a foto de alguém pelo número). */
export async function caminhoAvatar(phone: string, mime: string | null): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(`avatar:${phone}`));
  const hex = Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${hex.slice(0, 2)}/${hex}.${ext}`;
}
