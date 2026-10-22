// Vídeo da aula e live programada (lado da tela). O arquivo vai direto pro servidor de aulas da VPS em pedaços
// (retoma de onde parou se a conexão cair); a edge function live-aula só emite o token e registra os dados.
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/lives/api";

export interface LiveVideo {
  id: string;
  nome: string;
  bytes: number | null;
  duracao_seg: number | null;
  largura: number | null;
  altura: number | null;
  tem_audio: boolean | null;
  /** convertendo = a VPS está passando para H.264 720p/30 fps (gravação de tela do iPhone etc.); só "pronto" toca */
  status: "enviando" | "convertendo" | "pronto" | "erro";
  erro: string | null;
  created_at: string;
}

export const PREFIXO_AULA = "aula-video-";
export const ehParticipanteAula = (identity: string | null | undefined) => !!identity && identity.startsWith(PREFIXO_AULA);
export const TAMANHO_PEDACO = 16 * 1024 * 1024;
export const MAX_BYTES = 8 * 1024 ** 3;
export const TIPOS_VIDEO = ["video/mp4", "video/quicktime", "video/x-m4v"];

export async function liveAula<T = Record<string, unknown>>(acao: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("live-aula", { body: { acao, ...body } });
  if (error) {
    let msg = error.message;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FunctionsHttpError traz o corpo em context
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

export async function listarVideos(): Promise<LiveVideo[]> {
  const { data, error } = await db.from("live_videos").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

// ------------------------------------------------------------------ estado do vídeo no palco

export type FaseVideo = "parado" | "tocando" | "terminando";

/** Quanto já tocou e quanto falta (a partir do início gravado no banco e da duração medida na VPS). */
export function estadoVideo(o: { tocandoDesde: string | null | undefined; duracaoSeg: number | null | undefined; agora: number }): {
  fase: FaseVideo;
  decorrido: number;
  restante: number | null;
  progresso: number | null;
} {
  if (!o.tocandoDesde) return { fase: "parado", decorrido: 0, restante: null, progresso: null };
  const decorrido = Math.max(0, (o.agora - new Date(o.tocandoDesde).getTime()) / 1000);
  if (!o.duracaoSeg) return { fase: "tocando", decorrido, restante: null, progresso: null };
  const restante = Math.max(0, o.duracaoSeg - decorrido);
  return { fase: restante === 0 ? "terminando" : "tocando", decorrido, restante, progresso: Math.min(1, decorrido / o.duracaoSeg) };
}

export function formatarBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

/** Linha de status do vídeo que ainda não está pronto (lista da aba "Vídeo da aula"). */
export function textoVideoPendente(v: Pick<LiveVideo, "status" | "erro">, progresso?: number | null): string {
  if (v.status === "convertendo") {
    const p = typeof progresso === "number" && progresso > 0 ? ` ${Math.floor(Math.min(progresso, 0.99) * 100)}%` : "…";
    return `convertendo para tocar no palco${p}`;
  }
  if (v.status === "enviando") return "envio não terminou";
  return `erro: ${v.erro ?? "não foi possível ler"}`;
}

export function validarArquivo(f: { name: string; size: number; type: string }): string | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (!TIPOS_VIDEO.includes(f.type) && !["mp4", "mov", "m4v"].includes(ext)) return "Use um arquivo MP4 ou MOV.";
  if (f.size <= 0) return "Arquivo vazio.";
  if (f.size > MAX_BYTES) return "Arquivo acima de 8 GB.";
  return null;
}

/** Duração lida pelo navegador antes de subir (a VPS mede de novo com ffprobe no fim). */
export function duracaoDoArquivo(f: File): Promise<number | null> {
  return new Promise((ok) => {
    try {
      const v = document.createElement("video");
      const url = URL.createObjectURL(f);
      const fim = (d: number | null) => {
        URL.revokeObjectURL(url);
        ok(d);
      };
      v.preload = "metadata";
      v.onloadedmetadata = () => fim(Number.isFinite(v.duration) ? v.duration : null);
      v.onerror = () => fim(null);
      setTimeout(() => fim(null), 8000);
      v.src = url;
    } catch {
      ok(null);
    }
  });
}

// ------------------------------------------------------------------ upload em pedaços

export interface Transporte {
  /** PUT de um pedaço; devolve o total que o servidor já tem (X-Recebido). */
  enviar(url: string, token: string, offset: number, pedaco: Blob, onBytes: (n: number) => void, sinal?: AbortSignal): Promise<{ status: number; recebido: number }>;
  /** HEAD: quanto o servidor já tem (retomar). */
  consultar(url: string, token: string): Promise<number>;
}

export const transporteXhr: Transporte = {
  enviar(url, token, offset, pedaco, onBytes, sinal) {
    return new Promise((ok, falha) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Authorization", `Bearer ${token}`);
      x.setRequestHeader("X-Offset", String(offset));
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => onBytes(e.loaded);
      x.onload = () => ok({ status: x.status, recebido: Number(x.getResponseHeader("X-Recebido") ?? -1) });
      x.onerror = () => falha(new Error("conexão caiu"));
      x.ontimeout = () => falha(new Error("tempo esgotado"));
      x.timeout = 10 * 60_000;
      sinal?.addEventListener("abort", () => x.abort());
      x.onabort = () => falha(new DOMException("cancelado", "AbortError"));
      x.send(pedaco);
    });
  },
  async consultar(url, token) {
    const r = await fetch(url, { method: "HEAD", headers: { Authorization: `Bearer ${token}` } });
    return Number(r.headers.get("X-Recebido") ?? 0);
  },
};

/**
 * Sobe o arquivo em pedaços de 16 MB. Se um pedaço falhar (rede), pergunta ao servidor quanto já tem e continua dali,
 * até 5 tentativas seguidas. 409 = o servidor tem outro offset: realinha. Progresso de 0 a 1.
 */
export async function enviarEmPedacos(o: {
  arquivo: Blob;
  base: string;
  videoId: string;
  token: string;
  onProgresso?: (fracao: number) => void;
  sinal?: AbortSignal;
  transporte?: Transporte;
  pedaco?: number;
  esperaMs?: number;
}): Promise<void> {
  const t = o.transporte ?? transporteXhr;
  const url = `${o.base}/up/${o.videoId}`;
  const tam = o.pedaco ?? TAMANHO_PEDACO;
  const total = o.arquivo.size;
  let offset = await t.consultar(url, o.token).catch(() => 0);
  let falhas = 0;
  while (offset < total) {
    if (o.sinal?.aborted) throw new DOMException("cancelado", "AbortError");
    const fim = Math.min(total, offset + tam);
    try {
      const r = await t.enviar(url, o.token, offset, o.arquivo.slice(offset, fim), (n) => o.onProgresso?.((offset + n) / total), o.sinal);
      if (r.status === 200) {
        offset = r.recebido >= 0 ? r.recebido : fim;
        falhas = 0;
        o.onProgresso?.(offset / total);
        continue;
      }
      if (r.status === 409 && r.recebido >= 0) {
        offset = r.recebido;
        continue;
      }
      if (r.status === 401) throw new Error("o link de envio expirou: envie de novo");
      if (r.status === 413) throw new Error("arquivo maior que o permitido");
      if (r.status === 507) throw new Error("o disco do servidor está quase cheio");
      throw new Error(`servidor respondeu ${r.status}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      if (/expirou|maior que|disco/.test((e as Error).message)) throw e;
      falhas += 1;
      if (falhas >= 5) throw new Error(`o envio parou: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, (o.esperaMs ?? 2000) * falhas));
      offset = await t.consultar(url, o.token).catch(() => offset);
    }
  }
}

/**
 * Fluxo completo: registra, sobe e conclui (a VPS mede a duração). Pode voltar "convertendo": a VPS converte em segundo
 * plano e a aba acompanha (concluirVideo de novo a cada 10 s) até "pronto" ou "erro".
 */
export async function subirVideo(arquivo: File, o: { roomId?: string; onProgresso?: (f: number) => void; sinal?: AbortSignal }): Promise<LiveVideo> {
  const erro = validarArquivo(arquivo);
  if (erro) throw new Error(erro);
  const duracao = await duracaoDoArquivo(arquivo);
  const r = await liveAula<{ video: LiveVideo; upload: { base: string; token: string } }>("video-criar", {
    nome: arquivo.name, bytes: arquivo.size, duracao_seg: duracao, room_id: o.roomId,
  });
  await enviarEmPedacos({ arquivo, base: r.upload.base, videoId: r.video.id, token: r.upload.token, onProgresso: o.onProgresso, sinal: o.sinal });
  return (await concluirVideo(r.video.id)).video;
}

/** Lista já atualizando quem estava "convertendo" (a conversão pode ter acabado com a aba fechada). */
export async function listarVideosAtualizados(): Promise<LiveVideo[]> {
  const lista = await listarVideos();
  return Promise.all(lista.map((v) => (v.status === "convertendo" ? concluirVideo(v.id).then((r) => r.video ?? v).catch(() => v) : v)));
}

/** Fecha o envio na VPS ou, se já fechou, pergunta como está a conversão. */
export function concluirVideo(videoId: string): Promise<{ video: LiveVideo; progresso: number | null }> {
  return liveAula<{ video: LiveVideo; progresso: number | null }>("video-concluir", { video_id: videoId });
}

// ------------------------------------------------------------------ programação

export function arquivoParaBase64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => falha(new Error("não consegui ler a imagem"));
    r.readAsDataURL(f);
  });
}

/** datetime-local (hora do navegador) a partir de ISO, e o contrário. */
export function paraDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface LinkProgramado {
  destino_id: string;
  nome: string;
  video_id: string;
  link: string;
}

/** Aviso do painel: live programada cuja hora chegou e ninguém entrou (sem vídeo para iniciar sozinha). */
export function avisoComecaAgora(s: { status: string; agenda_aviso_em?: string | null; auto_iniciar?: boolean | null }, agora: number): boolean {
  if (!s.agenda_aviso_em || s.status === "ao_vivo" || s.auto_iniciar) return false;
  return agora - new Date(s.agenda_aviso_em).getTime() < 30 * 60_000;
}
