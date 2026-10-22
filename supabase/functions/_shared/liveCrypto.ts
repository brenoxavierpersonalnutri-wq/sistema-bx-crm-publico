// Cripto das lives, só WebCrypto (roda igual no Deno das edge functions e no Node dos testes).
//
//  - cifrarChave/decifrarChave: chave RTMP dos destinos em AES-256-GCM. A chave AES sai do
//    segredo LIVE_CHAVES_SEGREDO (env da edge function) por HKDF-SHA256. Formato "v1.<iv>.<ct>"
//    em base64url. A chave decifrada só existe dentro da função, na hora de montar a URL do Egress;
//    o front recebe no máximo os 4 últimos caracteres (finalDaChave).
//  - JWT HS256: token de acesso do LiveKit, chamada à API (Twirp) e conferência do webhook.
//  - sha256Hex: hash dos tokens de convite e de inscrição (o banco nunca guarda o token puro).
//  - tokenRender: token curto e assinado que abre /lives/render/:id em modo leitura.

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ base64url

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function iguaisTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function tokenAleatorio(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(texto)));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ cifra das chaves RTMP

const MIN_SEGREDO = 32;

/** Qual segredo das lives usar (regra pura, testável; quem lê env/banco é _shared/liveSegredo.ts):
 *  env com 32+ caracteres vence SEMPRE (não invalida o que já foi cifrado com ele); senão o do banco
 *  (integracao_config 'live_chaves_segredo'), se tiver 32+; senão null. */
export function escolherSegredoLive(env: string | null | undefined, banco: string | null | undefined): string | null {
  const e = (env ?? "").trim();
  if (e.length >= MIN_SEGREDO) return e;
  const b = (banco ?? "").trim();
  if (b.length >= MIN_SEGREDO) return b;
  return null;
}

async function chaveAes(segredo: string): Promise<CryptoKey> {
  if (!segredo || segredo.length < MIN_SEGREDO) {
    throw new Error(`LIVE_CHAVES_SEGREDO ausente ou curto (mínimo ${MIN_SEGREDO} caracteres)`);
  }
  const base = await crypto.subtle.importKey("raw", enc.encode(segredo), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("lives-destinos-v1"), info: enc.encode("chave-rtmp") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function cifrarChave(chave: string, segredo: string): Promise<string> {
  if (!chave) throw new Error("chave vazia");
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveAes(segredo), enc.encode(chave)),
  );
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decifrarChave(cifrada: string, segredo: string): Promise<string> {
  const partes = (cifrada ?? "").split(".");
  if (partes.length !== 3 || partes[0] !== "v1") throw new Error("formato de chave cifrada inválido");
  const iv = deB64url(partes[1]);
  const ct = deB64url(partes[2]);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await chaveAes(segredo), ct);
    return dec.decode(pt);
  } catch {
    throw new Error("não foi possível decifrar a chave (segredo trocado ou dado adulterado)");
  }
}

/** O que o front pode ver da chave: só o final. */
export function finalDaChave(chave: string): string {
  const c = (chave ?? "").trim();
  return c.length <= 4 ? "••••" : `••••${c.slice(-4)}`;
}

// ------------------------------------------------------------------ JWT HS256

async function hmacKey(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hmacSha256(segredo: string, msg: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(segredo), enc.encode(msg)));
}

export async function assinarJwt(claims: Record<string, unknown>, segredo: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmacSha256(segredo, `${head}.${body}`));
  return `${head}.${body}.${sig}`;
}

/** Confere assinatura HS256 e validade (exp/nbf, com 60 s de folga). Devolve as claims ou null. */
export async function verificarJwt(
  token: string,
  segredo: string,
  agoraSeg = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown> | null> {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null;
  let head: { alg?: string };
  let claims: Record<string, unknown>;
  try {
    head = JSON.parse(dec.decode(deB64url(partes[0])));
    claims = JSON.parse(dec.decode(deB64url(partes[1])));
  } catch {
    return null;
  }
  if (head.alg !== "HS256") return null;
  const esperado = b64url(await hmacSha256(segredo, `${partes[0]}.${partes[1]}`));
  if (!iguaisTempoConstante(esperado, partes[2])) return null;
  const folga = 60;
  if (typeof claims.exp === "number" && agoraSeg > claims.exp + folga) return null;
  if (typeof claims.nbf === "number" && agoraSeg + folga < claims.nbf) return null;
  return claims;
}

// ------------------------------------------------------------------ LiveKit

export interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  roomCreate?: boolean;
  roomRecord?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  canUpdateOwnMetadata?: boolean;
  hidden?: boolean;
  recorder?: boolean;
  ingressAdmin?: boolean;
}

export async function tokenLiveKit(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  ttlSeg?: number;
  grant: VideoGrant;
  attributes?: Record<string, string>;
  metadata?: string;
  agoraSeg?: number;
}): Promise<string> {
  const agora = opts.agoraSeg ?? Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: opts.apiKey,
    sub: opts.identity,
    jti: opts.identity,
    nbf: agora - 10,
    exp: agora + (opts.ttlSeg ?? 6 * 3600),
    video: opts.grant,
  };
  if (opts.name) claims.name = opts.name;
  if (opts.attributes) claims.attributes = opts.attributes;
  if (opts.metadata) claims.metadata = opts.metadata;
  return assinarJwt(claims, opts.apiSecret);
}

/**
 * Webhook do LiveKit: Authorization = JWT HS256 (iss = API key) com a claim sha256 =
 * base64(sha256(corpo cru)). Devolve true só com assinatura, emissor e hash certos.
 */
export async function webhookLiveKitValido(
  corpo: string,
  authorization: string | null,
  apiKey: string,
  apiSecret: string,
  agoraSeg?: number,
): Promise<boolean> {
  if (!authorization) return false;
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const claims = await verificarJwt(token, apiSecret, agoraSeg);
  if (!claims || claims.iss !== apiKey) return false;
  const hash = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(corpo))));
  return typeof claims.sha256 === "string" && iguaisTempoConstante(claims.sha256, hash);
}

// ------------------------------------------------------------------ Cloudflare Stream

/**
 * Webhook do Cloudflare Stream (vídeo pronto): header Webhook-Signature "time=<unix>,sig1=<hex>",
 * sig1 = HMAC-SHA256(segredo, "<time>.<corpo>"). Recusa assinatura com mais de 5 min.
 */
export async function webhookCfStreamValido(
  corpo: string,
  header: string | null,
  segredo: string,
  agoraSeg = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !segredo) return false;
  const campos = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const time = Number(campos.time);
  const sig = String(campos.sig1 ?? "");
  if (!Number.isFinite(time) || !sig) return false;
  if (Math.abs(agoraSeg - time) > 300) return false;
  const esperado = [...(await hmacSha256(segredo, `${campos.time}.${corpo}`))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return iguaisTempoConstante(esperado, sig.toLowerCase());
}

// ------------------------------------------------------------------ token de leitura do render

/** "<roomId>.<exp>.<sig>" — abre a prévia /lives/render/:id sem login, só leitura, com validade. */
export async function tokenRender(roomId: string, segredo: string, ttlSeg = 12 * 3600, agoraSeg?: number) {
  const exp = (agoraSeg ?? Math.floor(Date.now() / 1000)) + ttlSeg;
  const sig = b64url(await hmacSha256(segredo, `render.${roomId}.${exp}`));
  return `${roomId}.${exp}.${sig}`;
}

export async function conferirTokenRender(
  token: string,
  segredo: string,
  agoraSeg = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null;
  const [roomId, expTxt, sig] = partes;
  const exp = Number(expTxt);
  if (!/^[0-9a-f-]{36}$/i.test(roomId) || !Number.isFinite(exp) || agoraSeg > exp) return null;
  const esperado = b64url(await hmacSha256(segredo, `render.${roomId}.${exp}`));
  return iguaisTempoConstante(esperado, sig) ? roomId : null;
}

// ------------------------------------------------------------------ URLs de destino

/** URL final do RTMP: servidor + "/" + chave (sem barra dobrada). */
export function urlRtmpCompleta(servidor: string, chave: string): string {
  const s = (servidor ?? "").trim().replace(/\/+$/, "");
  if (!/^rtmps?:\/\//i.test(s)) throw new Error("servidor RTMP precisa começar com rtmp:// ou rtmps://");
  const k = (chave ?? "").trim().replace(/^\/+/, "");
  if (!k) throw new Error("chave de transmissão vazia");
  return `${s}/${k}`;
}

// ------------------------------------------------------------------ link mágico da inscrição

/**
 * Token da inscrição no webinário: "<registration_id>.<base64url(HMAC-SHA256(segredo, 'wreg.'+id))>".
 * Idêntico ao public.webinar_token_de() do SQL (segredo = integracao_config.webinar_token_segredo),
 * então a edge function gera o link e a RPC do chat confere sem token guardado no banco.
 */
export async function tokenInscricao(regId: string, segredo: string): Promise<string> {
  return `${regId}.${b64url(await hmacSha256(segredo, `wreg.${regId}`))}`;
}

export async function conferirTokenInscricao(token: string, segredo: string): Promise<string | null> {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m || !segredo) return null;
  return iguaisTempoConstante(await tokenInscricao(m[1], segredo), token) ? m[1] : null;
}
