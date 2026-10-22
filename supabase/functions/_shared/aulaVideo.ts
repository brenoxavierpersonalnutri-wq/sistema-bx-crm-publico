// Vídeo da aula (arquivo pré-gravado tocado "ao vivo" no palco) e agenda da live. Sem Deno e sem banco:
// roda nas edge functions (live-aula, livekit-webhook) e no vitest (src/test/livesAulaVideo.test.ts).
//
// Caminho do arquivo: navegador -> headturbo-aulas na VPS (upload em pedaços, https://livekit.../aulas/up/<id>)
// -> LiveKit Ingress URL_INPUT lê http://172.18.0.1:7890/aulas/arquivo/<id>?t=... (só de dentro da VPS)
// -> participante "Vídeo da aula" na sala -> o produtor põe no palco -> o Egress room_composite leva com
// banners/marca pro destino. Os tokens do servidor de aulas são HS256 com chave = hex(HMAC(api_secret, "headturbo-aulas-v1")):
// a mesma conta que infra/livekit/aulas/headturbo-aulas.py faz.
import { assinarJwt, hmacSha256 } from "./liveCrypto.ts";

export const PREFIXO_AULA = "aula-video";
export const NOME_PARTICIPANTE_AULA = "Vídeo da aula";
/** Endereço do servidor de aulas visto de dentro da VPS (o Ingress roda em rede host). */
export const ORIGEM_ARQUIVO_LOCAL = "http://172.18.0.1:7890";
export const MAX_BYTES_AULA = 8 * 1024 ** 3;
/**
 * Live programada com vídeo: o vídeo entra PRIMEIRO (Ingress) e só depois a transmissão (Egress), para o YouTube
 * nunca receber palco vazio. Espera o "Vídeo da aula" publicar imagem até este teto; passou, liga mesmo assim (a
 * tela do ar fica preta e limpa até a imagem chegar, nunca "Ninguém no palco").
 */
export const ESPERA_VIDEO_PUBLICAR_MS = 30_000;
export const PASSO_ESPERA_VIDEO_MS = 1_500;
/** (antigo) espera entre ligar o Egress e começar o vídeo; mantido só para quem ainda importa. */
export const ATRASO_VIDEO_MS = 20_000;

/** O participante do vídeo da aula já publica imagem? (lista do RoomService.ListParticipants) */
export function videoAulaPublicado(participantes: unknown, identity: string): boolean {
  const lista = Array.isArray(participantes) ? participantes : [];
  const p = lista.find((x: Record<string, unknown>) => x && x.identity === identity) as { tracks?: { type?: unknown; muted?: unknown }[] } | undefined;
  return !!p?.tracks?.some((t) => (t.type === 1 || t.type === "VIDEO") && t.muted !== true);
}
/** Depois disto, horário perdido não inicia mais sozinho (servidor fora, cron parado). */
export const JANELA_ATRASO_MS = 15 * 60_000;

export type EscopoAula = "up" | "fim" | "ler" | "del";

const ID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const idVideoValido = (v: unknown): v is string => typeof v === "string" && ID_OK.test(v);

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Chave dos tokens do servidor de aulas (texto hex), derivada do api_secret do LiveKit. */
export async function chaveAulas(apiSecret: string): Promise<string> {
  if (!apiSecret) throw new Error("api_secret do LiveKit ausente");
  return hex(await hmacSha256(apiSecret, "headturbo-aulas-v1"));
}

export async function tokenAula(o: { apiSecret: string; videoId: string; escopo: EscopoAula; ttlSeg: number; maxBytes?: number; agoraSeg?: number }): Promise<string> {
  if (!idVideoValido(o.videoId)) throw new Error("id de vídeo inválido");
  const agora = o.agoraSeg ?? Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { aud: "aulas", v: o.videoId, s: o.escopo, exp: agora + o.ttlSeg };
  if (o.maxBytes) claims.max = Math.min(o.maxBytes, MAX_BYTES_AULA);
  return assinarJwt(claims, await chaveAulas(o.apiSecret));
}

/**
 * Resposta do POST /aulas/fim/<id> -> o que gravar em live_videos.
 * 200 estado "pronto" (ou sem estado: servidor antigo) = pode tocar; 202 = convertendo para H.264 720p/30 fps (gravação de
 * tela do iPhone: HEVC, taxa variável, acima de 720p deixa o Ingress sem imagem); 200 estado "erro" = a conversão falhou
 * (o original fica guardado na VPS, mas não vai pro palco); qualquer outro status = erro na leitura.
 */
export interface FimAula {
  status: "pronto" | "convertendo" | "erro";
  erro: string | null;
  progresso: number | null;
  campos: { bytes?: number | null; duracao_seg?: number | null; largura?: number | null; altura?: number | null; tem_audio?: boolean };
}
export function lerFimAula(http: number, dados: Record<string, unknown>): FimAula {
  const d = dados as { bytes?: number; duracao_seg?: number; video?: { largura?: number; altura?: number } | null; audio?: boolean; estado?: string; erro?: string; progresso?: number };
  const medidas = {
    duracao_seg: typeof d.duracao_seg === "number" ? d.duracao_seg : null,
    largura: d.video?.largura ?? null,
    altura: d.video?.altura ?? null,
    tem_audio: !!d.audio,
  };
  if (http === 202) {
    const p = Number(d.progresso);
    return { status: "convertendo", erro: null, progresso: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0, campos: medidas };
  }
  if (http !== 200) return { status: "erro", erro: String(d.erro ?? `servidor de aulas respondeu ${http}`), progresso: null, campos: {} };
  if (d.estado === "erro") {
    return { status: "erro", erro: String(d.erro ?? "não consegui converter o vídeo para tocar no palco"), progresso: null, campos: { bytes: d.bytes ?? null, ...medidas } };
  }
  return { status: "pronto", erro: null, progresso: null, campos: { bytes: d.bytes ?? null, ...medidas } };
}

/** https://livekit.../aulas a partir da LIVEKIT_URL (o Caddy encaminha /aulas/up e /aulas/fim). */
export const baseAulasPublica = (livekitUrl: string) => `${livekitUrl.replace(/\/+$/, "")}/aulas`;

export const urlArquivoLocal = (videoId: string, token: string) =>
  `${ORIGEM_ARQUIVO_LOCAL}/aulas/arquivo/${videoId}?t=${encodeURIComponent(token)}`;

export const identityAula = (videoId: string) => `${PREFIXO_AULA}-${videoId.replace(/-/g, "").slice(0, 12)}`;
export const ehParticipanteAula = (identity: string | null | undefined) => !!identity && identity.startsWith(`${PREFIXO_AULA}-`);

/**
 * CreateIngress (Twirp/JSON) do tipo URL_INPUT. Vídeo como "câmera" (o palco trata igual) em 720p de uma
 * camada só: a VPS tem 4 vCPU e o Egress já pede 2,5 durante a live. Áudio como "microfone".
 */
export function corpoCriarIngress(o: { sala: string; videoId: string; url: string; nomeArquivo?: string }) {
  return {
    input_type: "URL_INPUT",
    name: `aula ${o.videoId.slice(0, 8)} ${String(o.nomeArquivo ?? "").slice(0, 60)}`.trim(),
    room_name: o.sala,
    participant_identity: identityAula(o.videoId),
    participant_name: NOME_PARTICIPANTE_AULA,
    url: o.url,
    video: { name: "video-aula", source: "CAMERA", preset: "H264_720P_30FPS_1_LAYER" },
    audio: { name: "audio-aula", source: "MICROPHONE", preset: "OPUS_STEREO_96KBPS" },
  };
}

// ------------------------------------------------------------------ agenda (tick do pg_cron)

export interface SalaAgenda {
  id: string;
  status: string;
  agendada_em: string | null;
  auto_iniciar: boolean | null;
  aula_video_id: string | null;
  agenda_processada_em: string | null;
  aula_tocando_desde: string | null;
  aula_encerrar_ao_fim: boolean | null;
  aula_duracao_seg?: number | null;
  /** quando a transmissão atual entrou no ar (live-control ir-ao-vivo) */
  iniciada_em?: string | null;
}

/** Live que o tick iniciou e ficou no ar sem vídeo tocando: encerra depois disto (se não houver humano no estúdio). */
export const ORFA_MS = 10 * 60_000;
/** A transmissão no ar é a que o tick iniciou se entrou no ar até isto depois de marcar a sala como processada. */
export const FOLGA_INICIO_MS = 5 * 60_000;

export type DecisaoTick =
  | { acao: "nada" }
  | { acao: "iniciar" }
  | { acao: "avisar" }
  | { acao: "atrasada" }
  | { acao: "encerrar" }
  /** live que o tick iniciou está no ar sem vídeo: o tick confere se há humano no estúdio; sem humano, encerra */
  | { acao: "conferir-orfa" };

/** Live que o tick iniciou e está no ar sem vídeo tocando há mais de ORFA_MS (regra conferir-orfa do decidirTick). */
export function salaOrfa(s: SalaAgenda, agora: Date): boolean {
  if (s.status !== "ao_vivo" || !s.auto_iniciar || !s.agenda_processada_em || !s.iniciada_em) return false;
  if (s.aula_tocando_desde) return false;
  const proc = new Date(s.agenda_processada_em).getTime();
  const ini = new Date(s.iniciada_em).getTime();
  if (!Number.isFinite(proc) || !Number.isFinite(ini)) return false;
  if (ini < proc - 60_000 || ini > proc + FOLGA_INICIO_MS) return false;
  return agora.getTime() - ini >= ORFA_MS;
}

/**
 * O que o tick faz com uma sala agora:
 *  - na hora (até 30 s antes), não processada: com "iniciar sozinho" + vídeo -> iniciar; senão -> avisar no painel;
 *  - passou da janela (15 min) sem processar: marca como perdida (nunca começa uma aula 2 h atrasada);
 *  - ao vivo tocando o vídeo com "encerrar ao fim": vídeo já acabou (duração + 90 s de folga) -> encerrar
 *    (o webhook ingress_ended faz isso na hora; aqui é a rede de segurança);
 *  - ao vivo, iniciada pelo tick (iniciar sozinho), há mais de 10 min e SEM vídeo tocando (o vídeo não subiu, ou
 *    acabou e o encerrar falhou) -> conferir-orfa: o tick olha o estúdio e, sem humano, encerra. Live que alguém
 *    pôs no ar depois, na mão (iniciada_em longe da hora em que o tick processou), não entra nesta regra.
 */
export function decidirTick(s: SalaAgenda, agora: Date): DecisaoTick {
  const t = agora.getTime();
  if (s.status === "ao_vivo" && s.aula_encerrar_ao_fim && s.aula_tocando_desde && s.aula_duracao_seg) {
    const fim = new Date(s.aula_tocando_desde).getTime() + s.aula_duracao_seg * 1000 + 90_000;
    if (t >= fim) return { acao: "encerrar" };
  }
  if (salaOrfa(s, agora)) return { acao: "conferir-orfa" };
  if (!s.agendada_em || s.agenda_processada_em) return { acao: "nada" };
  const quando = new Date(s.agendada_em).getTime();
  if (!Number.isFinite(quando) || t < quando - 30_000) return { acao: "nada" };
  if (t > quando + JANELA_ATRASO_MS) return { acao: "atrasada" };
  if (s.status === "ao_vivo") return { acao: "nada" };
  return s.auto_iniciar && s.aula_video_id ? { acao: "iniciar" } : { acao: "avisar" };
}

/**
 * Tem gente de verdade no estúdio? (lista do RoomService.ListParticipants). Não conta o "Vídeo da aula" (Ingress),
 * o Egress (gravador/transmissão, oculto) nem agentes. kind chega como número (0 STANDARD, 1 INGRESS, 2 EGRESS,
 * 3 SIP, 4 AGENT) ou texto, conforme a versão.
 */
export function haHumanoNoEstudio(participantes: unknown): boolean {
  const lista = Array.isArray(participantes) ? participantes : [];
  return lista.some((p: Record<string, unknown>) => {
    if (!p || typeof p !== "object") return false;
    const identity = String(p.identity ?? "");
    if (!identity || ehParticipanteAula(identity) || /^EG_|^IN_/.test(identity)) return false;
    const kind = p.kind;
    if (kind != null && kind !== 0 && kind !== "STANDARD" && kind !== 3 && kind !== "SIP") return false;
    const perm = (p.permission ?? {}) as Record<string, unknown>;
    if (perm.hidden === true || perm.recorder === true) return false;
    return true;
  });
}

/** Valida a data da programação: futura (com 2 min de folga) e até 1 ano à frente. */
export function quandoProgramavel(iso: unknown, agora: Date): { ok: true; quando: Date } | { ok: false; motivo: string } {
  if (typeof iso !== "string" || !iso) return { ok: false, motivo: "escolha data e hora" };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { ok: false, motivo: "data inválida" };
  if (d.getTime() < agora.getTime() + 2 * 60_000) return { ok: false, motivo: "a data precisa estar pelo menos 2 minutos no futuro" };
  if (d.getTime() > agora.getTime() + 366 * 86_400_000) return { ok: false, motivo: "no máximo 1 ano à frente" };
  return { ok: true, quando: d };
}

/** Miniatura do YouTube: JPEG ou PNG, até 2 MB (limite da API thumbnails.set). */
export function lerMiniatura(m: unknown): { ok: true; bytes: Uint8Array; mime: string } | { ok: false; motivo: string } | null {
  if (m == null) return null;
  const o = m as { base64?: unknown; mime?: unknown };
  const mime = String(o.mime ?? "");
  if (!["image/jpeg", "image/png"].includes(mime)) return { ok: false, motivo: "miniatura: use JPG ou PNG" };
  const b64 = String(o.base64 ?? "").replace(/^data:[^,]*,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { ok: false, motivo: "miniatura inválida" };
  let bytes: Uint8Array;
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, motivo: "miniatura inválida" };
  }
  if (!bytes.length) return { ok: false, motivo: "miniatura vazia" };
  if (bytes.length > 2 * 1024 * 1024) return { ok: false, motivo: "miniatura acima de 2 MB (limite do YouTube)" };
  return { ok: true, bytes, mime };
}
