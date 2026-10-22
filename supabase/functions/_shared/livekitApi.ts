// Cliente mínimo da API do LiveKit (Twirp/JSON) e do Cloudflare Stream, sem SDK.
// LiveKit: LIVEKIT_URL (https://livekit.brenoxavier.com.br), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
//   Ordem: secrets da função (Deno.env) se os TRÊS existirem; senão integracao_config chave 'livekit'
//   (JSON {url, api_key, api_secret}), gravado pela VPS uma vez via live-pareamento (ninguém cola
//   segredo). Leitura com service role, cache em memória de 5 min por instância.
// Cloudflare: CF_ACCOUNT_ID, CF_STREAM_TOKEN (permissão Stream:Edit), CF_STREAM_CUSTOMER_CODE
//   (o "customer-XXXX" do subdomínio de reprodução).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tokenLiveKit, type VideoGrant } from "./liveCrypto.ts";
import { lerConfigGuardada } from "./pareamentoLive.ts";

export class ErroLiveKit extends Error {
  constructor(public status: number, public detalhe: unknown) {
    super(`LiveKit respondeu ${status}`);
  }
}

const TTL_MS = 5 * 60 * 1000;
let cacheBanco: { valor: { url: string; apiKey: string; apiSecret: string } | null; ate: number } | null = null;

async function credenciaisLiveKit(): Promise<{ url: string; apiKey: string; apiSecret: string } | null> {
  const url = Deno.env.get("LIVEKIT_URL") ?? "";
  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  if (url && apiKey && apiSecret) return { url, apiKey, apiSecret };

  if (cacheBanco && cacheBanco.ate > Date.now()) return cacheBanco.valor;
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !chave) return null;
  try {
    const db = createClient(supaUrl, chave, { auth: { persistSession: false } });
    const { data, error } = await db.from("integracao_config").select("valor").eq("chave", "livekit").maybeSingle();
    if (error) throw new Error(error.message);
    const c = lerConfigGuardada(data?.valor);
    const valor = c ? { url: c.url, apiKey: c.api_key, apiSecret: c.api_secret } : null;
    // sem valor: cache curto (30 s) pra pegar logo o pareamento recém-feito
    cacheBanco = { valor, ate: Date.now() + (valor ? TTL_MS : 30_000) };
    return valor;
  } catch (e) {
    console.error("livekit: não consegui ler integracao_config.livekit", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function envLiveKit() {
  const c = await credenciaisLiveKit();
  const url = c?.url ?? "";
  // https em produção; http só para localhost (teste local com livekit-server --dev)
  if (!c || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(url) || !c.apiKey || !c.apiSecret) {
    throw new ErroLiveKit(500, "LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET não configurados (nem no env, nem pareados)");
  }
  return { url: url.replace(/\/+$/, ""), wsUrl: url.replace(/^http/, "ws").replace(/\/+$/, ""), apiKey: c.apiKey, apiSecret: c.apiSecret };
}

async function twirp(servico: string, metodo: string, corpo: unknown, grant: VideoGrant) {
  const { url, apiKey, apiSecret } = await envLiveKit();
  const jwt = await tokenLiveKit({ apiKey, apiSecret, identity: "crm-edge", ttlSeg: 600, grant });
  const res = await fetch(`${url}/twirp/livekit.${servico}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroLiveKit(res.status, data);
  return data;
}

// ---- RoomService
export const criarSala = (nome: string, metadata: string) =>
  twirp("RoomService", "CreateRoom", { name: nome, empty_timeout: 600, metadata }, { roomCreate: true });

export const atualizarMetadataSala = (sala: string, metadata: string) =>
  twirp("RoomService", "UpdateRoomMetadata", { room: sala, metadata }, { roomAdmin: true, room: sala });

export const atualizarAtributos = (sala: string, identity: string, attributes: Record<string, string>) =>
  twirp("RoomService", "UpdateParticipant", { room: sala, identity, attributes }, { roomAdmin: true, room: sala });

export const removerParticipante = (sala: string, identity: string) =>
  twirp("RoomService", "RemoveParticipant", { room: sala, identity }, { roomAdmin: true, room: sala });

// ---- Egress
export const iniciarTransmissao = (sala: string, templateUrl: string, rtmpUrls: string[]) =>
  twirp(
    "Egress",
    "StartRoomCompositeEgress",
    {
      room_name: sala,
      layout: "custom",
      custom_base_url: templateUrl,
      stream_outputs: [{ protocol: "RTMP", urls: rtmpUrls }],
      preset: "H264_1080P_30",
    },
    { roomRecord: true },
  );

export const iniciarGravacao = (sala: string, templateUrl: string) =>
  twirp(
    "Egress",
    "StartRoomCompositeEgress",
    {
      room_name: sala,
      layout: "custom",
      custom_base_url: templateUrl,
      file_outputs: [{ file_type: "MP4", filepath: `/out/{room_name}-{time}.mp4` }],
      preset: "H264_1080P_30",
    },
    { roomRecord: true },
  );

export const atualizarSaidas = (egressId: string, adicionar: string[], remover: string[]) =>
  twirp(
    "Egress",
    "UpdateStream",
    { egress_id: egressId, add_output_urls: adicionar, remove_output_urls: remover },
    { roomRecord: true },
  );

export const pararEgress = (egressId: string) =>
  twirp("Egress", "StopEgress", { egress_id: egressId }, { roomRecord: true });

export const listarParticipantes = (sala: string) =>
  twirp("RoomService", "ListParticipants", { room: sala }, { roomAdmin: true, room: sala });

// ---- Ingress (vídeo da aula, URL_INPUT; corpo em _shared/aulaVideo.ts)
export const criarIngress = (corpo: Record<string, unknown>) =>
  twirp("Ingress", "CreateIngress", corpo, { ingressAdmin: true });

export const apagarIngress = (ingressId: string) =>
  twirp("Ingress", "DeleteIngress", { ingress_id: ingressId }, { ingressAdmin: true });

export const listarIngress = (sala: string) =>
  twirp("Ingress", "ListIngress", { room_name: sala }, { ingressAdmin: true });

// ---- Cloudflare Stream Live
export interface LiveInputCf {
  uid: string;
  rtmpsUrl: string;
  streamKey: string;
  hlsUrl: string;
}

/** O webinário próprio (Cloudflare Stream) só existe com os três secrets; RTMP/YouTube nunca dependem disto. */
export const cfStreamConfigurado = () =>
  !!(Deno.env.get("CF_ACCOUNT_ID") && Deno.env.get("CF_STREAM_TOKEN") && Deno.env.get("CF_STREAM_CUSTOMER_CODE"));

export async function criarLiveInputCf(nome: string): Promise<LiveInputCf> {
  const conta = Deno.env.get("CF_ACCOUNT_ID");
  const token = Deno.env.get("CF_STREAM_TOKEN");
  const cliente = Deno.env.get("CF_STREAM_CUSTOMER_CODE");
  if (!conta || !token || !cliente) throw new ErroLiveKit(500, "CF_ACCOUNT_ID/CF_STREAM_TOKEN/CF_STREAM_CUSTOMER_CODE ausentes");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/stream/live_inputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ meta: { name: nome }, recording: { mode: "automatic", timeoutSeconds: 60 } }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new ErroLiveKit(res.status, data?.errors ?? data);
  const r = data.result;
  return {
    uid: r.uid,
    rtmpsUrl: r.rtmps?.url ?? "rtmps://live.cloudflare.com:443/live/",
    streamKey: r.rtmps?.streamKey,
    hlsUrl: `https://${cliente}.cloudflarestream.com/${r.uid}/manifest/video.m3u8`,
  };
}
