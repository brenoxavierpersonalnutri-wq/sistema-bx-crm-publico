// Acesso ao banco e às edge functions do módulo Lives/Webinário.
// As tabelas novas ainda não estão no types.ts gerado pelo Lovable: cliente sem tipo, como em crmRoteiros.
import { supabase } from "@/integrations/supabase/client";

export const db = supabase as any;

export interface LiveRoom {
  id: string;
  titulo: string;
  livekit_room: string;
  layout: string;
  cor: string | null;
  status: "rascunho" | "ao_vivo" | "encerrada";
  egress_id: string | null;
  gravacao_egress_id: string | null;
  cf_live_input_uid: string | null;
  cf_hls_url: string | null;
  cf_conectado: boolean;
  ultimo_erro: string | null;
  iniciada_em: string | null;
  created_at: string;
}

export interface LiveDestino {
  id: string;
  tipo: "youtube" | "facebook" | "instagram" | "cloudflare" | "custom";
  nome: string;
  rtmp_url: string;
  chave_final: string;
  ativo: boolean;
  no_ar: boolean;
  /** youtube_api = canal conectado por OAuth (a chave nasce no Ir ao vivo); manual = chave colada. */
  modo?: "manual" | "youtube_api";
  yt_conta_id?: string | null;
  yt_titulo?: string | null;
  yt_descricao?: string | null;
  yt_privacidade?: "public" | "unlisted" | "private" | null;
  yt_video_id?: string | null;
  yt_estado?: string | null;
  yt_erro?: string | null;
  yt_agendado_para?: string | null;
  yt_playlist_id?: string | null;
  yt_miniatura_ok?: boolean | null;
}

/** Colunas que o front pode ler (a chave cifrada não tem SELECT para authenticated). */
export const CAMPOS_DESTINO = "id, room_id, tipo, nome, rtmp_url, chave_final, ativo, no_ar, created_at";
/** Mesmas + as do YouTube conectado (migration 20261027100000). */
export const CAMPOS_DESTINO_YT = `${CAMPOS_DESTINO}, modo, yt_conta_id, yt_titulo, yt_descricao, yt_privacidade, yt_video_id, yt_estado, yt_erro`;

/** + live programada (migration 20261104100000). */
export const CAMPOS_DESTINO_AGENDA = `${CAMPOS_DESTINO_YT}, yt_agendado_para, yt_playlist_id, yt_miniatura_ok`;

/** Lê destinos com as colunas do YouTube; sem a migration nova, cai nas colunas antigas (a tela não quebra). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do cliente sem tipo (db), como o resto deste arquivo
export async function lerDestinos(filtro: (q: any) => any): Promise<{ data: any[] | null; error: unknown }> {
  const a = await filtro(db.from("live_destinations").select(CAMPOS_DESTINO_AGENDA));
  if (!a.error) return a;
  const r = await filtro(db.from("live_destinations").select(CAMPOS_DESTINO_YT));
  if (!r.error) return r;
  return filtro(db.from("live_destinations").select(CAMPOS_DESTINO));
}

export interface LiveOverlay {
  id: string;
  room_id: string;
  tipo: "logo" | "lower_third" | "banner";
  conteudo: { texto?: string; subtitulo?: string; url_imagem?: string; cor?: string };
  visivel: boolean;
  ordem: number;
}

export interface Webinar {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  capa_url: string | null;
  live_room_id: string | null;
  hls_offset_seg: number;
  chat_ativo: boolean;
  mostrar_presentes: boolean;
  lembretes_ativos: boolean;
  lembretes: Record<string, string>;
  status: "rascunho" | "publicado" | "arquivado";
}

export interface WebinarSessao {
  id: string;
  webinar_id: string;
  inicia_em: string;
  status: "agendada" | "ao_vivo" | "encerrada";
  iniciada_em: string | null;
  encerrada_em: string | null;
  hls_url: string | null;
}

async function chamar<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // FunctionsHttpError: o corpo JSON da função tem a mensagem útil
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) msg = (await ctx.json())?.error ?? msg;
    } catch {
      /* mantém a mensagem genérica */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const liveToken = (body: { room_id?: string; convite?: string; render?: string; nome?: string }) =>
  chamar<{ url: string; token: string; identity?: string; render_url?: string | null; titulo?: string }>("live-token", body);

export const liveControl = (acao: string, body: Record<string, unknown>) => chamar("live-control", { acao, ...body });

export const webinarRegister = (body: Record<string, unknown>) =>
  chamar<{ ok: boolean; token: string; sala_url: string; inicia_em: string }>("webinar-register", body);

export const webinarJoin = (token: string) => chamar("webinar-join", { token });
export const webinarPing = (token: string, extra: Record<string, unknown> = {}) => chamar("webinar-ping", { token, ...extra });

export const SERVIDORES_RTMP: Record<LiveDestino["tipo"], { rotulo: string; servidor: string; ajuda: string }> = {
  youtube: { rotulo: "YouTube", servidor: "rtmp://a.rtmp.youtube.com/live2", ajuda: "YouTube Studio > Transmitir ao vivo > Chave da transmissão" },
  facebook: { rotulo: "Facebook", servidor: "rtmps://live-api-s.facebook.com:443/rtmp", ajuda: "Facebook > Vídeo ao vivo > Software de streaming > Chave" },
  instagram: { rotulo: "Instagram Live", servidor: "", ajuda: "Conta profissional: Instagram (web) > Criar > Ao vivo > URL e chave (mudam a cada live)" },
  cloudflare: { rotulo: "Cloudflare Stream", servidor: "rtmps://live.cloudflare.com:443/live", ajuda: "Use o botão 'Criar Cloudflare Stream' (cria e guarda sozinho)" },
  custom: { rotulo: "RTMP manual", servidor: "", ajuda: "Qualquer servidor RTMP/RTMPS: cole o servidor e a chave" },
};
