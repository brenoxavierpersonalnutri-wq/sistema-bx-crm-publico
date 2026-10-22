// YouTube Live pela YouTube Data API v3 (OAuth 2.0 do Google), sem Deno e sem banco: roda no Deno
// (youtube-oauth, live-control, google-pareamento) e no vitest (src/test/youtube.test.ts).
//
// O que mora aqui:
//  - URL do login do Google (escopo youtube.force-ssl, access_type=offline + prompt=consent pra
//    sempre voltar refresh_token) e leitura das credenciais do app (env OU integracao_config.google_oauth);
//  - cifra do refresh_token (AES-256-GCM, HKDF do LIVE_CHAVES_SEGREDO com contexto próprio, formato y1.<iv>.<ct>);
//  - corpo do liveBroadcast/liveStream, escolha do endereço de ingestão (RTMPS primeiro) e a regra de
//    quando transicionar o broadcast pra "live" (fallback do enableAutoStart);
//  - ClienteYouTube: as chamadas HTTP, com fetch injetável (o teste usa um falso).
// Nada aqui loga token, streamName ou client_secret.
import { b64url, deB64url } from "./liveCrypto.ts";

export const ESCOPO_YT = "https://www.googleapis.com/auth/youtube.force-ssl";
export const URL_AUTH_GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth";
export const URL_TOKEN_GOOGLE = "https://oauth2.googleapis.com/token";
export const URL_REVOGAR_GOOGLE = "https://oauth2.googleapis.com/revoke";
export const API_YT = "https://www.googleapis.com/youtube/v3";
export const ESTADO_OAUTH_MS = 15 * 60_000;
export const PRIVACIDADES = ["public", "unlisted", "private"] as const;
export type Privacidade = (typeof PRIVACIDADES)[number];

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ login

export function estadoAleatorio(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export const estadoValido = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(s);

export function urlAutorizacaoGoogle(o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(URL_AUTH_GOOGLE);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", ESCOPO_YT);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", o.state);
  return u.toString();
}

/** O code do Google tem "/" e "4/..."; só recusa o que claramente não é um code. */
export function limparCodeGoogle(c: unknown): string | null {
  if (typeof c !== "string") return null;
  const v = c.trim();
  return /^[A-Za-z0-9/_.~-]{10,512}$/.test(v) ? v : null;
}

export type CredGoogle = { clientId: string; clientSecret: string };

const ID_OK = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const SEGREDO_OK = /^[A-Za-z0-9_-]{20,128}$/;

/** env primeiro (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET); senão o JSON de integracao_config.google_oauth. */
export function lerCredenciaisGoogle(env: { id?: string | null; secret?: string | null }, guardado: string | null): CredGoogle | null {
  const id = (env.id ?? "").trim();
  const sec = (env.secret ?? "").trim();
  if (id && sec) return { clientId: id, clientSecret: sec };
  if (!guardado) return null;
  try {
    const d = JSON.parse(guardado);
    const clientId = String(d.client_id ?? d.GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = String(d.client_secret ?? d.GOOGLE_CLIENT_SECRET ?? "").trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

export type FonteCred = "env" | "banco";
export type CandidatoGoogle = { fonte: FonteCred; cred: CredGoogle };

/**
 * Todas as credenciais configuradas, na ordem de preferência (env, depois integracao_config.google_oauth),
 * sem repetir o mesmo par. Serve pra cair no par do banco quando o secret do env está errado
 * (invalid_client) em vez de travar o login inteiro num secret só.
 */
export function candidatosCredGoogle(env: { id?: string | null; secret?: string | null }, guardado: string | null): CandidatoGoogle[] {
  const out: CandidatoGoogle[] = [];
  const doEnv = lerCredenciaisGoogle(env, null);
  if (doEnv) out.push({ fonte: "env", cred: doEnv });
  const doBanco = lerCredenciaisGoogle({}, guardado);
  if (doBanco && !out.some((c) => c.cred.clientId === doBanco.clientId && c.cred.clientSecret === doBanco.clientSecret)) {
    out.push({ fonte: "banco", cred: doBanco });
  }
  return out;
}

/** O Google recusou a credencial do app (client secret errado, cliente apagado/desativado), não o code/token. */
export const ehErroDeCliente = (e: unknown) =>
  e instanceof ErroGoogle && (e.razao === "invalid_client" || e.razao === "unauthorized_client" || e.razao === "deleted_client" || e.razao === "disabled_client");

export type EstadoSegredo = "ok" | "invalido" | "nao_medido";

/**
 * Confere o client secret sem login de ninguém: troca um code de mentira. O Google autentica o cliente ANTES
 * de olhar o code, então invalid_grant = secret aceito; invalid_client = secret errado. Um code falso nunca
 * devolve token, e nada da resposta sai daqui além do veredito.
 */
export async function conferirSegredoGoogle(cred: CredGoogle, redirectUri: string, f: Fetch = fetch): Promise<EstadoSegredo> {
  try {
    await ClienteYouTube.trocarCode(cred, "4/0-diagnostico-code-falso", redirectUri, f);
    return "nao_medido";
  } catch (e) {
    if (ehErroDeCliente(e)) return "invalido";
    if (e instanceof ErroGoogle && e.razao === "invalid_grant") return "ok";
    return "nao_medido";
  }
}

/** Tenta cada credencial; só pula pra próxima quando o Google recusa o cliente (o code não foi gasto). */
export async function comCredencial<T>(cands: CandidatoGoogle[], uso: (cred: CredGoogle) => Promise<T>): Promise<{ valor: T; fonte: FonteCred }> {
  if (!cands.length) throw new ErroGoogle(412, "sem_credencial", "faltam as credenciais do app Google");
  let ultimo: unknown = null;
  for (const c of cands) {
    try {
      return { valor: await uso(c.cred), fonte: c.fonte };
    } catch (e) {
      if (!ehErroDeCliente(e)) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

/** Mensagem pra tela quando o Google recusa o app (sem valor de segredo, só onde trocar). */
export const MOTIVO_SEGREDO_INVALIDO =
  "o Google recusou o client secret do app (GOOGLE_CLIENT_SECRET no Lovable Cloud não confere com o cliente BX Lives CRM)";

/** Corpo do google-pareamento (VPS -> CRM): valida e devolve o texto exato que vai pro banco. */
export function validarCorpoGoogle(corpo: string): { ok: true; valor: string } | { ok: false; motivo: string } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(corpo);
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, motivo: "corpo não é objeto" };
  const clientId = String(d.client_id ?? "").trim();
  const clientSecret = String(d.client_secret ?? "").trim();
  if (!ID_OK.test(clientId)) return { ok: false, motivo: "client_id inválido (…apps.googleusercontent.com)" };
  if (!SEGREDO_OK.test(clientSecret)) return { ok: false, motivo: "client_secret inválido" };
  return { ok: true, valor: JSON.stringify({ client_id: clientId, client_secret: clientSecret }) };
}

// ------------------------------------------------------------------ cifra do refresh_token

async function chaveToken(segredo: string): Promise<CryptoKey> {
  if (!segredo || segredo.length < 32) throw new Error("LIVE_CHAVES_SEGREDO ausente ou curto (mínimo 32)");
  const base = await crypto.subtle.importKey("raw", enc.encode(segredo), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("lives-youtube-v1"), info: enc.encode("refresh-token") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function cifrarTokenYt(token: string, segredo: string): Promise<string> {
  if (!token) throw new Error("token vazio");
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveToken(segredo), enc.encode(token)));
  return `y1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decifrarTokenYt(cifrado: string, segredo: string): Promise<string> {
  const p = (cifrado ?? "").split(".");
  if (p.length !== 3 || p[0] !== "y1") throw new Error("formato de token cifrado inválido");
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(p[1]) }, await chaveToken(segredo), deB64url(p[2])));
  } catch {
    throw new Error("não foi possível decifrar o token (segredo trocado ou dado adulterado)");
  }
}

// ------------------------------------------------------------------ destino e transmissão

export type ConfigDestinoYt = { titulo: string; descricao: string; privacidade: Privacidade };

/** Valida o que a tela manda pra um destino YouTube conectado. */
export function validarDestinoYt(b: Record<string, unknown>, tituloPadrao: string): { ok: true; cfg: ConfigDestinoYt } | { ok: false; motivo: string } {
  const titulo = String(b.titulo ?? "").replace(/[<>]/g, "").trim().slice(0, 100) || tituloPadrao.replace(/[<>]/g, "").trim().slice(0, 100);
  if (!titulo) return { ok: false, motivo: "título obrigatório" };
  const descricao = String(b.descricao ?? "").replace(/[<>]/g, "").slice(0, 5000);
  const privacidade = String(b.privacidade ?? "unlisted") as Privacidade;
  if (!PRIVACIDADES.includes(privacidade)) return { ok: false, motivo: "privacidade inválida (public, unlisted ou private)" };
  return { ok: true, cfg: { titulo, descricao, privacidade } };
}

/** liveBroadcasts.insert, agendado pra agora, com auto start/stop e sem monitor stream (vai direto pra live). */
export function corpoBroadcast(cfg: ConfigDestinoYt, agora: Date) {
  return {
    snippet: { title: cfg.titulo, description: cfg.descricao, scheduledStartTime: agora.toISOString() },
    status: { privacyStatus: cfg.privacidade, selfDeclaredMadeForKids: false },
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      enableDvr: true,
      recordFromStart: true,
      monitorStream: { enableMonitorStream: false },
    },
  };
}

/**
 * liveStreams.insert: RTMP, resolução e fps variáveis (o par exigido pela API). Reutilizável por padrão (o "Ir ao
 * vivo" na hora); a live PROGRAMADA usa um stream só dela (reutilizavel=false): com auto start, dois broadcasts
 * presos ao mesmo stream começariam juntos quando ele ficasse ativo.
 */
export function corpoStream(titulo: string, reutilizavel = true) {
  return {
    snippet: { title: titulo.slice(0, 128) || "Estúdio" },
    cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
    contentDetails: { isReusable: reutilizavel },
  };
}

/** liveBroadcasts.update (part=snippet,status) de uma live programada: título, descrição, data e privacidade. */
export function corpoAtualizarBroadcast(id: string, cfg: ConfigDestinoYt, quando: Date) {
  return {
    id,
    snippet: { title: cfg.titulo, description: cfg.descricao, scheduledStartTime: quando.toISOString() },
    status: { privacyStatus: cfg.privacidade, selfDeclaredMadeForKids: false },
  };
}

/** playlistItems.insert: o vídeo da live (id do broadcast) no fim da playlist. */
export const corpoItemPlaylist = (playlistId: string, videoId: string) => ({
  snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
});

/** playlists.insert (semana de aulas): título até 150, privacidade do YouTube. */
export const corpoPlaylist = (titulo: string, privacidade: Privacidade, descricao = "") => ({
  snippet: { title: titulo.replace(/[<>]/g, "").trim().slice(0, 150) || "Aulas", description: descricao.replace(/[<>]/g, "").slice(0, 5000) },
  status: { privacyStatus: privacidade },
});

/** Live programada ainda pode ser reaproveitada/editada (não começou nem terminou). */
export const broadcastAindaProgramado = (lifeCycle: string | undefined) =>
  lifeCycle === "created" || lifeCycle === "ready" || lifeCycle === "testing";

/** Servidor + chave do liveStream. RTMPS quando existir (a chave não trafega em claro). */
export function ingestaoDoStream(s: unknown): { servidor: string; chave: string } | null {
  const info = (s as { cdn?: { ingestionInfo?: Record<string, string> } })?.cdn?.ingestionInfo;
  const chave = String(info?.streamName ?? "").trim();
  const servidor = String(info?.rtmpsIngestionAddress || info?.ingestionAddress || "").trim();
  if (!chave || !/^rtmps?:\/\//i.test(servidor)) return null;
  return { servidor, chave };
}

/**
 * Fallback do enableAutoStart: com o stream recebendo (active) e o broadcast parado em ready/testing,
 * pede "live". Em qualquer outro caso, nada (live/complete já resolvidos; stream inativo = ainda chegando).
 */
export function precisaTransicionarLive(streamStatus: string | undefined, lifeCycle: string | undefined): boolean {
  return streamStatus === "active" && (lifeCycle === "ready" || lifeCycle === "testing");
}

/** Estado que a tela mostra, a partir do lifeCycleStatus do broadcast. */
export function estadoDoBroadcast(lifeCycle: string | undefined): "preparando" | "ao_vivo" | "encerrado" | "erro" {
  if (lifeCycle === "live" || lifeCycle === "liveStarting") return "ao_vivo";
  if (lifeCycle === "complete" || lifeCycle === "revoked") return "encerrado";
  if (!lifeCycle) return "erro";
  return "preparando";
}

export const linkYoutube = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
/** Link curto pra divulgar (aulas não listadas: quem tem o link assiste). */
export const linkCurtoYoutube = (videoId: string) => `https://youtu.be/${encodeURIComponent(videoId)}`;
export const URL_UPLOAD_THUMB = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

// ------------------------------------------------------------------ cliente HTTP

export class ErroGoogle extends Error {
  constructor(public status: number, public razao: string, msg: string) {
    super(msg);
  }
  /** refresh_token revogado/expirado: só reconectando a conta. */
  get precisaReconectar(): boolean {
    // invalid_client também vem com 401, mas é o secret do APP que está errado: reconectar a conta não resolve
    if (["invalid_client", "unauthorized_client", "deleted_client", "disabled_client"].includes(this.razao)) return false;
    return this.razao === "invalid_grant" || this.status === 401;
  }
}

/** Mensagem curta e sem dado sensível a partir do corpo de erro do Google. */
export function erroDoGoogle(status: number, corpo: unknown): ErroGoogle {
  const c = (corpo ?? {}) as { error?: unknown; error_description?: string };
  if (typeof c.error === "string") return new ErroGoogle(status, c.error, c.error_description || c.error);
  const e = (c.error ?? {}) as { message?: string; errors?: { reason?: string; message?: string }[] };
  const razao = e.errors?.[0]?.reason ?? `http_${status}`;
  const msg = String(e.message ?? e.errors?.[0]?.message ?? `HTTP ${status}`).replace(/rtmps?:\/\/[^\s"']+/gi, "rtmp://[oculto]").slice(0, 240);
  return new ErroGoogle(status, razao, msg);
}

type Fetch = typeof fetch;

export class ClienteYouTube {
  constructor(private accessToken: string, private f: Fetch = fetch) {}

  /** Troca o code (volta do login) por tokens. */
  static async trocarCode(cred: CredGoogle, code: string, redirectUri: string, f: Fetch = fetch) {
    return ClienteYouTube.token(f, {
      code, client_id: cred.clientId, client_secret: cred.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
    });
  }

  /** access_token novo a partir do refresh_token (o endpoint de token não gasta cota da API). */
  static async renovar(cred: CredGoogle, refreshToken: string, f: Fetch = fetch) {
    return ClienteYouTube.token(f, {
      refresh_token: refreshToken, client_id: cred.clientId, client_secret: cred.clientSecret, grant_type: "refresh_token",
    });
  }

  static async revogar(token: string, f: Fetch = fetch): Promise<boolean> {
    const r = await f(URL_REVOGAR_GOOGLE, { method: "POST", body: new URLSearchParams({ token }) });
    await r.body?.cancel().catch(() => {});
    return r.ok;
  }

  private static async token(f: Fetch, form: Record<string, string>) {
    const r = await f(URL_TOKEN_GOOGLE, { method: "POST", body: new URLSearchParams(form) });
    const j = (await r.json().catch(() => ({}))) as {
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
    };
    if (!r.ok || !j.access_token) throw erroDoGoogle(r.status, j);
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiraEmSeg: Number(j.expires_in) || 3600, escopos: (j.scope ?? "").split(" ").filter(Boolean) };
  }

  private async api(caminho: string, query: Record<string, string>, metodo = "GET", corpo?: unknown): Promise<Record<string, unknown>> {
    const u = new URL(`${API_YT}/${caminho}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    const r = await this.f(u.toString(), {
      method: metodo,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw erroDoGoogle(r.status, j);
    return j;
  }

  /** channels.list mine=true (1 unidade). */
  async canal(): Promise<{ id: string; titulo: string; foto: string | null } | null> {
    const j = await this.api("channels", { part: "snippet", mine: "true" });
    const c = (j.items as { id: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }[] | undefined)?.[0];
    if (!c) return null;
    const t = c.snippet?.thumbnails ?? {};
    return { id: c.id, titulo: c.snippet?.title ?? "", foto: t.medium?.url ?? t.default?.url ?? null };
  }

  inserirBroadcast(cfg: ConfigDestinoYt, agora = new Date()) {
    return this.api("liveBroadcasts", { part: "id,snippet,contentDetails,status" }, "POST", corpoBroadcast(cfg, agora));
  }

  inserirStream(titulo: string, reutilizavel = true) {
    return this.api("liveStreams", { part: "id,snippet,cdn,contentDetails,status" }, "POST", corpoStream(titulo, reutilizavel));
  }

  /** liveBroadcasts.insert agendado (live programada): mesma config do "Ir ao vivo", com a data escolhida. */
  inserirBroadcastAgendado(cfg: ConfigDestinoYt, quando: Date) {
    return this.api("liveBroadcasts", { part: "id,snippet,contentDetails,status" }, "POST", corpoBroadcast(cfg, quando));
  }

  atualizarBroadcast(id: string, cfg: ConfigDestinoYt, quando: Date) {
    return this.api("liveBroadcasts", { part: "id,snippet,status" }, "PUT", corpoAtualizarBroadcast(id, cfg, quando));
  }

  /** liveBroadcasts.delete (só live que não começou; a API recusa as outras). */
  async apagarBroadcast(id: string): Promise<void> {
    const u = new URL(`${API_YT}/liveBroadcasts`);
    u.searchParams.set("id", id);
    const r = await this.f(u.toString(), { method: "DELETE", headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!r.ok && r.status !== 404) throw erroDoGoogle(r.status, await r.json().catch(() => ({})));
    await r.body?.cancel().catch(() => {});
  }

  /** thumbnails.set (upload de mídia, escopo youtube.force-ssl basta). Canal sem verificação recusa (403). */
  async definirMiniatura(videoId: string, bytes: Uint8Array, mime: string): Promise<void> {
    const u = new URL(URL_UPLOAD_THUMB);
    u.searchParams.set("videoId", videoId);
    u.searchParams.set("uploadType", "media");
    const r = await this.f(u.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": mime },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw erroDoGoogle(r.status, j);
  }

  /** playlists.list mine=true (1 unidade): id e título, até 50. */
  async playlists(): Promise<{ id: string; titulo: string }[]> {
    const j = await this.api("playlists", { part: "id,snippet", mine: "true", maxResults: "50" });
    return ((j.items as { id: string; snippet?: { title?: string } }[] | undefined) ?? []).map((p) => ({ id: p.id, titulo: p.snippet?.title ?? p.id }));
  }

  async criarPlaylist(titulo: string, privacidade: Privacidade, descricao = ""): Promise<{ id: string; titulo: string }> {
    const j = await this.api("playlists", { part: "id,snippet,status" }, "POST", corpoPlaylist(titulo, privacidade, descricao));
    const id = String(j.id ?? "");
    if (!id) throw new ErroGoogle(502, "sem_playlist", "o YouTube não criou a playlist");
    return { id, titulo: (j.snippet as { title?: string } | undefined)?.title ?? titulo };
  }

  async apagarPlaylist(id: string): Promise<void> {
    const u = new URL(`${API_YT}/playlists`);
    u.searchParams.set("id", id);
    const r = await this.f(u.toString(), { method: "DELETE", headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!r.ok && r.status !== 404) throw erroDoGoogle(r.status, await r.json().catch(() => ({})));
    await r.body?.cancel().catch(() => {});
  }

  adicionarNaPlaylist(playlistId: string, videoId: string) {
    return this.api("playlistItems", { part: "id,snippet" }, "POST", corpoItemPlaylist(playlistId, videoId));
  }

  async obterStream(id: string): Promise<Record<string, unknown> | null> {
    const j = await this.api("liveStreams", { part: "id,cdn,status", id });
    return ((j.items as Record<string, unknown>[] | undefined) ?? [])[0] ?? null;
  }

  async obterBroadcast(id: string): Promise<Record<string, unknown> | null> {
    const j = await this.api("liveBroadcasts", { part: "id,status,contentDetails", id });
    return ((j.items as Record<string, unknown>[] | undefined) ?? [])[0] ?? null;
  }

  vincular(broadcastId: string, streamId: string) {
    return this.api("liveBroadcasts/bind", { id: broadcastId, part: "id,contentDetails", streamId }, "POST");
  }

  transicionar(broadcastId: string, para: "live" | "complete" | "testing") {
    return this.api("liveBroadcasts/transition", { id: broadcastId, broadcastStatus: para, part: "id,status" }, "POST");
  }
}
