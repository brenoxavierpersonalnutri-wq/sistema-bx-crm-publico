// Instagram Direct no CRM (Instagram API with Instagram Login), regras puras: sem Supabase, sem rede.
// Roda igual no Deno das edge functions e no Node dos testes (só WebCrypto).
//
// Doc oficial (conferida em 17/10/2026):
//  - Login e tokens: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
//    authorize em www.instagram.com/oauth/authorize; code (1 h, uso único) -> POST api.instagram.com/oauth/access_token
//    -> token curto -> GET graph.instagram.com/access_token?grant_type=ig_exchange_token -> token longo (60 dias),
//    renovável com GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token (token com 24 h+).
//  - Envio: .../messaging-api  POST graph.instagram.com/<versão>/me/messages, texto até 1000 bytes UTF-8,
//    imagem png/jpeg 8 MB (até 10 por mensagem), áudio aac/m4a/wav/mp4 25 MB, vídeo mp4/ogg/avi/mov/webm 25 MB,
//    arquivo pdf 25 MB. Só responde quem escreveu primeiro; janela de 24 h desde a última mensagem da pessoa.
//  - Fora das 24 h: tag HUMAN_AGENT (até 7 dias), recurso "Human Agent" que exige App Review
//    (developers.facebook.com/docs/features-reference/human-agent). Aqui só usa a tag se o dono ligar
//    integracao_config.instagram_human_agent = 'sim' depois da aprovação.
//  - Webhooks: .../instagram-platform/webhooks  GET hub.mode/hub.verify_token/hub.challenge; POST assinado
//    X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, app secret). O app precisa estar em modo Live.
//  - Limites (overview): Send API 100/s texto, 10/s áudio e vídeo, por conta profissional.

export const VERSAO_GRAPH = "v25.0";
export const GRAPH_IG = "https://graph.instagram.com";
export const URL_AUTORIZAR = "https://www.instagram.com/oauth/authorize";
export const URL_TOKEN_CURTO = "https://api.instagram.com/oauth/access_token";
export const ESCOPOS = ["instagram_business_basic", "instagram_business_manage_messages"] as const;
export const CAMPOS_WEBHOOK = ["messages", "messaging_postbacks", "messaging_seen"] as const;

export const PREFIXO_PHONE = "ig:";
export const JANELA_PADRAO_MS = 24 * 60 * 60 * 1000;
export const JANELA_HUMANO_MS = 7 * 24 * 60 * 60 * 1000;
export const TEXTO_MAX_BYTES = 1000;
export const ESTADO_OAUTH_MS = 15 * 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ identificação do contato

/** O CRM identifica toda conversa por "phone": no Direct é "ig:" + IGSID (id da pessoa nessa conta). */
export const phoneDoIgsid = (igsid: string): string => `${PREFIXO_PHONE}${igsid}`;
export const ehPhoneInstagram = (phone: string | null | undefined): boolean =>
  typeof phone === "string" && phone.startsWith(PREFIXO_PHONE) && phone.length > PREFIXO_PHONE.length;
export function igsidDoPhone(phone: string): string | null {
  if (!ehPhoneInstagram(phone)) return null;
  const id = phone.slice(PREFIXO_PHONE.length);
  return /^\d{5,40}$/.test(id) ? id : null;
}

// ------------------------------------------------------------------ janela de resposta

export type ModoEnvio = "normal" | "human_agent";
export interface DecisaoJanela {
  pode: boolean;
  modo: ModoEnvio | null;
  /** Até quando dá pra responder no modo decidido (ISO), quando há janela. */
  ate: string | null;
  aviso: string | null;
}

/**
 * Pode responder? Regra da Meta: só depois que a pessoa escreveu; 24 h normais desde a ÚLTIMA mensagem dela;
 * de 24 h a 7 dias só com a tag HUMAN_AGENT (e só se o recurso foi aprovado no App Review).
 */
export function decidirJanela(ultimaEntrada: string | null | undefined, agora: Date, humanAgentLiberado: boolean): DecisaoJanela {
  if (!ultimaEntrada) {
    return { pode: false, modo: null, ate: null, aviso: "Essa pessoa ainda não mandou mensagem no Direct. O Instagram só deixa responder quem escreveu primeiro." };
  }
  const t = Date.parse(ultimaEntrada);
  if (!Number.isFinite(t)) return { pode: false, modo: null, ate: null, aviso: "Data da última mensagem inválida." };
  const passou = agora.getTime() - t;
  if (passou < JANELA_PADRAO_MS) {
    return { pode: true, modo: "normal", ate: new Date(t + JANELA_PADRAO_MS).toISOString(), aviso: null };
  }
  if (passou < JANELA_HUMANO_MS) {
    if (humanAgentLiberado) {
      return { pode: true, modo: "human_agent", ate: new Date(t + JANELA_HUMANO_MS).toISOString(), aviso: "Fora das 24 h: vai com a etiqueta de atendimento humano (vale até 7 dias)." };
    }
    return {
      pode: false, modo: null, ate: null,
      aviso: "Passou de 24 h desde a última mensagem dessa pessoa. Para responder até 7 dias é preciso o recurso Human Agent aprovado pela Meta. Por enquanto, espere ela escrever de novo.",
    };
  }
  return { pode: false, modo: null, ate: null, aviso: "Passou de 7 dias desde a última mensagem dessa pessoa. O Instagram só libera de novo quando ela escrever." };
}

// ------------------------------------------------------------------ texto

const bytes = (s: string) => enc.encode(s).length;

/** Quebra texto em pedaços de até `max` bytes UTF-8, preferindo parágrafo, depois linha, depois palavra. */
export function dividirTexto(texto: string, max = TEXTO_MAX_BYTES): string[] {
  const limpo = texto.replace(/\r\n/g, "\n").trim();
  if (!limpo) return [];
  if (bytes(limpo) <= max) return [limpo];
  const partes: string[] = [];
  let atual = "";
  const empurrar = () => { if (atual.trim()) partes.push(atual.trim()); atual = ""; };
  const tokens = limpo.split(/(\n\n|\n| )/);
  for (const tk of tokens) {
    if (bytes(atual + tk) <= max) { atual += tk; continue; }
    empurrar();
    if (bytes(tk) <= max) { atual = tk.trim() ? tk : ""; continue; }
    // palavra maior que o teto (link enorme): corta por caractere sem quebrar emoji
    let pedaco = "";
    for (const ch of Array.from(tk)) {
      if (bytes(pedaco + ch) > max) { partes.push(pedaco); pedaco = ""; }
      pedaco += ch;
    }
    atual = pedaco;
  }
  empurrar();
  return partes;
}

// ------------------------------------------------------------------ mídia

export type TipoMidiaCRM = "image" | "audio" | "video" | "document";
export type TipoAnexoIG = "image" | "audio" | "video" | "file";

const LIMITES: Record<TipoMidiaCRM, { mb: number; ext: string[]; mime: RegExp; nome: string }> = {
  image: { mb: 8, ext: ["png", "jpg", "jpeg"], mime: /^image\/(png|jpe?g)$/i, nome: "Imagem (PNG ou JPEG, até 8 MB)" },
  audio: { mb: 25, ext: ["aac", "m4a", "wav", "mp4"], mime: /^audio\/(aac|mp4|x-m4a|m4a|wav|x-wav|wave)$/i, nome: "Áudio (AAC, M4A, WAV ou MP4, até 25 MB)" },
  video: { mb: 25, ext: ["mp4", "ogg", "avi", "mov", "webm"], mime: /^video\/(mp4|ogg|x-msvideo|avi|quicktime|webm)$/i, nome: "Vídeo (MP4, OGG, AVI, MOV ou WEBM, até 25 MB)" },
  document: { mb: 25, ext: ["pdf"], mime: /^application\/pdf$/i, nome: "Arquivo (só PDF, até 25 MB)" },
};

export const tipoAnexoIG = (t: TipoMidiaCRM): TipoAnexoIG => (t === "document" ? "file" : t);

const extensao = (nome: string | null | undefined) => {
  const m = /\.([a-z0-9]{2,5})(?:\?.*)?$/i.exec(String(nome ?? ""));
  return m ? m[1].toLowerCase() : "";
};

/** null = pode mandar; texto = motivo pra mostrar ao atendente. Sem mime nem nome, deixa a Meta decidir. */
export function validarMidia(tipo: TipoMidiaCRM, info: { mime?: string | null; nome?: string | null; tamanho?: number | null }): string | null {
  const l = LIMITES[tipo];
  if (!l) return "Tipo de mídia não suportado no Direct.";
  if (info.tamanho && info.tamanho > l.mb * 1024 * 1024) return `Arquivo grande demais para o Direct. Aceito: ${l.nome}.`;
  const ext = extensao(info.nome);
  const mimeOk = info.mime ? l.mime.test(info.mime) : null;
  const extOk = ext ? l.ext.includes(ext) : null;
  if (mimeOk === false && extOk !== true) return `Formato não aceito pelo Direct. Aceito: ${l.nome}.`;
  if (mimeOk === null && extOk === false) return `Formato não aceito pelo Direct. Aceito: ${l.nome}.`;
  return null;
}

// ------------------------------------------------------------------ corpo do envio

export type ConteudoEnvio = { texto: string } | { midia: { tipo: TipoMidiaCRM; url: string } };

export function corpoEnvio(igsid: string, conteudo: ConteudoEnvio, modo: ModoEnvio): Record<string, unknown> {
  const message = "texto" in conteudo
    ? { text: conteudo.texto }
    : conteudo.midia.tipo === "image"
      ? { attachments: [{ type: "image", payload: { url: conteudo.midia.url } }] }
      : { attachment: { type: tipoAnexoIG(conteudo.midia.tipo), payload: { url: conteudo.midia.url } } };
  const base: Record<string, unknown> = { recipient: { id: igsid }, message };
  if (modo === "human_agent") return { ...base, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
  return { ...base, messaging_type: "RESPONSE" };
}

// ------------------------------------------------------------------ OAuth

export function urlAutorizacao(p: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.appId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: ESCOPOS.join(","),
    state: p.state,
    enable_fb_login: "0",
    force_reauth: "true",
  });
  return `${URL_AUTORIZAR}?${q.toString()}`;
}

/** A Meta pode devolver o code com "#_" no fim (doc do Business Login). */
export const limparCode = (code: string | null): string | null => {
  const c = (code ?? "").replace(/#_$/, "").trim();
  return /^[A-Za-z0-9_\-.#]{10,2048}$/.test(c) ? c : null;
};

export const estadoValido = (state: string | null): boolean => !!state && /^[A-Za-z0-9_-]{24,64}$/.test(state);

/** Permissões que o login devolveu ("a,b" ou ["a","b"]). Falta a de mensagens = conexão inútil. */
export function faltamPermissoes(recebidas: string | string[] | null | undefined): string[] {
  const lista = Array.isArray(recebidas) ? recebidas : String(recebidas ?? "").split(",");
  const tem = new Set(lista.map((s) => s.trim()).filter(Boolean));
  return ESCOPOS.filter((e) => !tem.has(e));
}

// ------------------------------------------------------------------ assinatura do webhook

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function iguaisTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function hmacSha256Hex(corpo: string | Uint8Array, segredo: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const dados = new Uint8Array(typeof corpo === "string" ? enc.encode(corpo) : corpo);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, dados)));
}

/** X-Hub-Signature-256: "sha256=<hex>" sobre o corpo CRU, com o app secret. Qualquer desvio = false. */
export async function assinaturaValida(corpo: string | Uint8Array, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!segredo || !cabecalho) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim());
  if (!m) return false;
  const esperado = await hmacSha256Hex(corpo, segredo);
  return iguaisTempoConstante(esperado, m[1].toLowerCase());
}

/** Resposta ao GET de verificação: o challenge, ou null (403). */
export function respostaVerificacao(params: URLSearchParams, tokenEsperado: string | null): string | null {
  if (!tokenEsperado) return null;
  const modo = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const desafio = params.get("hub.challenge");
  if (modo !== "subscribe" || !desafio || desafio.length > 256) return null;
  return iguaisTempoConstante(token, tokenEsperado) ? desafio : null;
}

// ------------------------------------------------------------------ leitura do webhook

export interface AnexoRecebido {
  tipo: "image" | "audio" | "video" | "document" | "sticker" | "link";
  url: string | null;
}

export type EventoIG =
  | {
    tipo: "mensagem" | "eco";
    /** Conta profissional (entry.id): de quem é o Direct. */
    contaIgId: string;
    /** A outra pessoa (IGSID). */
    igsid: string;
    mid: string;
    texto: string;
    anexos: AnexoRecebido[];
    /** Resposta a story / anúncio / referência: texto curto pra contexto. */
    contexto: string | null;
    em: string;
  }
  | { tipo: "lida"; contaIgId: string; igsid: string; mid: string | null; watermark: string | null; em: string }
  | { tipo: "postback"; contaIgId: string; igsid: string; mid: string | null; titulo: string; payload: string; em: string }
  | { tipo: "apagada"; contaIgId: string; igsid: string; mid: string; em: string };

type Obj = Record<string, unknown>;
const ehObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const quando = (ts: unknown): string => {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
};

function tipoAnexo(t: string): AnexoRecebido["tipo"] | null {
  switch (t) {
    case "image": case "audio": case "video": case "sticker": return t;
    case "file": return "document";
    case "share": case "story_mention": case "ig_reel": case "reel": case "ig_post": case "template": case "fallback": return "link";
    default: return null;
  }
}

function lerMensagem(ev: Obj, contaIgId: string): EventoIG | null {
  const msg = ev.message as Obj;
  const remetente = str((ev.sender as Obj | undefined)?.id);
  const destinatario = str((ev.recipient as Obj | undefined)?.id);
  const eco = msg.is_echo === true;
  const igsid = eco ? destinatario : remetente;
  const mid = str(msg.mid);
  if (!igsid || !mid || igsid === contaIgId && !eco) return null;
  if (msg.is_deleted === true) return { tipo: "apagada", contaIgId, igsid, mid, em: quando(ev.timestamp) };
  const anexos: AnexoRecebido[] = [];
  for (const a of Array.isArray(msg.attachments) ? msg.attachments : []) {
    if (!ehObj(a)) continue;
    const t = tipoAnexo(str(a.type));
    if (!t) continue;
    const url = str((a.payload as Obj | undefined)?.url) || null;
    anexos.push({ tipo: t, url });
  }
  let contexto: string | null = null;
  const replyTo = msg.reply_to as Obj | undefined;
  if (ehObj(replyTo) && ehObj(replyTo.story)) contexto = "Respondeu ao seu story";
  const ref = (ev.referral ?? msg.referral) as Obj | undefined;
  if (ehObj(ref)) {
    const fonte = str(ref.source).toUpperCase();
    contexto = fonte === "ADS" || ref.ad_id ? "Veio de um anúncio" : contexto ?? "Veio de um link";
  }
  if (anexos.some((a) => a.tipo === "link") && !contexto) contexto = "Compartilhou um post ou reel";
  return { tipo: eco ? "eco" : "mensagem", contaIgId, igsid, mid, texto: str(msg.text), anexos, contexto, em: quando(ev.timestamp) };
}

/** Converte o corpo do webhook (object "instagram") numa lista de eventos que o CRM entende. Ignora o resto. */
export function interpretarWebhook(corpo: unknown): EventoIG[] {
  if (!ehObj(corpo) || corpo.object !== "instagram" || !Array.isArray(corpo.entry)) return [];
  const out: EventoIG[] = [];
  for (const entry of corpo.entry) {
    if (!ehObj(entry)) continue;
    const contaIgId = str(entry.id);
    if (!contaIgId) continue;
    const eventos: Obj[] = [];
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) if (ehObj(m)) eventos.push(m);
    // formato "changes" (painel de teste do app e algumas assinaturas): value já é o evento de messaging
    for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
      if (ehObj(c) && ehObj(c.value) && ["messages", "messaging_postbacks", "messaging_seen"].includes(str(c.field))) eventos.push(c.value);
    }
    for (const ev of eventos) {
      const remetente = str((ev.sender as Obj | undefined)?.id);
      if (ehObj(ev.message)) {
        const e = lerMensagem(ev, contaIgId);
        if (e) out.push(e);
      } else if (ehObj(ev.read)) {
        out.push({ tipo: "lida", contaIgId, igsid: remetente, mid: str(ev.read.mid) || null, watermark: str(ev.read.watermark) || null, em: quando(ev.timestamp) });
      } else if (ehObj(ev.postback)) {
        out.push({
          tipo: "postback", contaIgId, igsid: remetente, mid: str(ev.postback.mid) || null,
          titulo: str(ev.postback.title), payload: str(ev.postback.payload), em: quando(ev.timestamp),
        });
      }
    }
  }
  return out.filter((e) => !!e.igsid);
}

/** Texto que vai na coluna body (o CRM mostra a mídia pela coluna media_*). */
export function corpoDaMensagem(e: Extract<EventoIG, { tipo: "mensagem" | "eco" }>): string {
  const partes: string[] = [];
  if (e.contexto) partes.push(`[${e.contexto}]`);
  if (e.texto) partes.push(e.texto);
  return partes.join("\n");
}

// ------------------------------------------------------------------ cifra do token

const MIN_SEGREDO = 32;

async function chaveToken(segredo: string): Promise<CryptoKey> {
  if (!segredo || segredo.length < MIN_SEGREDO) throw new Error(`IG_TOKEN_SEGREDO ausente ou curto (mínimo ${MIN_SEGREDO} caracteres)`);
  const base = await crypto.subtle.importKey("raw", enc.encode(segredo), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("instagram-token-v1"), info: enc.encode("token-ig") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

function b64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** AES-256-GCM, formato "v1.<iv>.<ct>". O token decifrado só existe dentro da função. */
export async function cifrarToken(token: string, segredo: string): Promise<string> {
  if (!token) throw new Error("token vazio");
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveToken(segredo), enc.encode(token)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decifrarToken(cifrado: string, segredo: string): Promise<string> {
  const [v, iv, ct] = String(cifrado ?? "").split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("token cifrado em formato desconhecido");
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(iv) }, await chaveToken(segredo), deB64url(ct));
  return dec.decode(claro);
}

export function estadoAleatorio(n = 24): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** Token longo vence em 60 dias; renova quando faltar menos de 10 (e tiver 24 h de vida, regra da Meta). */
export function precisaRenovar(expiraEm: string | null | undefined, agora: Date): boolean {
  if (!expiraEm) return false;
  const t = Date.parse(expiraEm);
  return Number.isFinite(t) && t > agora.getTime() && t - agora.getTime() < 10 * 24 * 60 * 60 * 1000;
}
