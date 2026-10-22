// YouTube conectado (OAuth do Google) no estúdio: contas, popup de login e conferência do broadcast.
// Tokens nunca chegam aqui: a tela lê só canal/foto/status de yt_contas e chama youtube-oauth/live-control.
import { supabase } from "@/integrations/supabase/client";
import { db, liveControl, SERVIDORES_RTMP, type LiveDestino } from "@/lib/lives/api";

export interface ContaYoutube {
  id: string;
  canal_id: string;
  titulo: string;
  foto_url: string | null;
  status: "conectado" | "desconectado";
  ultimo_erro: string | null;
  /** canal padrão do destino automático (migração 20261110120000) */
  padrao?: boolean;
}

export const PRIVACIDADES_YT = [
  { valor: "public", rotulo: "Público" },
  { valor: "unlisted", rotulo: "Não listado" },
  { valor: "private", rotulo: "Privado" },
] as const;
export type PrivacidadeYt = (typeof PRIVACIDADES_YT)[number]["valor"];

export const rotuloPrivacidade = (p: string | null | undefined) => PRIVACIDADES_YT.find((x) => x.valor === p)?.rotulo ?? "Não listado";

export const TIPO_MENSAGEM = "youtube-oauth";
/** Canal entre o popup (página de retorno) e o estúdio. BroadcastChannel porque a página do Google pode
 *  cortar o window.opener (Cross-Origin-Opener-Policy); postMessage pro opener fica como reforço. */
export const CANAL_RETORNO = "lives-youtube-oauth";
export type MensagemOauth = { tipo: typeof TIPO_MENSAGEM; status: "ok" | "erro"; motivo?: string };

/** Só aceita a mensagem do popup vinda da mesma origem e no formato esperado. */
export function lerMensagemOauth(ev: { origin: string; data: unknown }, origem: string): MensagemOauth | null {
  if (ev.origin !== origem) return null;
  const d = ev.data as Partial<MensagemOauth> | null;
  if (!d || d.tipo !== TIPO_MENSAGEM || (d.status !== "ok" && d.status !== "erro")) return null;
  return { tipo: TIPO_MENSAGEM, status: d.status, motivo: typeof d.motivo === "string" ? d.motivo.slice(0, 160) : undefined };
}

export function textoEstadoYt(d: Pick<LiveDestino, "yt_estado" | "yt_erro" | "no_ar">): string | null {
  if (d.yt_erro) return `erro: ${d.yt_erro}`;
  switch (d.yt_estado) {
    case "agendado": return "programada no YouTube";
    case "preparando": return d.no_ar ? "aguardando o YouTube receber o vídeo" : "transmissão criada";
    case "ao_vivo": return "ao vivo no YouTube";
    case "encerrado": return "encerrada no YouTube";
    case "erro": return "erro no YouTube";
    default: return null;
  }
}

/** Linha de baixo do destino: canal conectado (privacidade/estado) ou servidor manual com o final da chave. */
export function detalheDestino(d: LiveDestino): string {
  if (d.modo === "youtube_api") {
    const estado = textoEstadoYt(d);
    return `YouTube conectado · ${rotuloPrivacidade(d.yt_privacidade)}${estado ? ` · ${estado}` : ""}`;
  }
  return `${SERVIDORES_RTMP[d.tipo].rotulo} · chave ${d.chave_final}`;
}

export const linkYoutube = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

/** Vale chamar youtube-status? Só ao vivo, com destino conectado no ar que ainda não entrou "ao vivo". */
export function precisaConferirYt(salaStatus: string | undefined, destinos: LiveDestino[]): boolean {
  if (salaStatus !== "ao_vivo") return false;
  return destinos.some((d) => d.modo === "youtube_api" && d.no_ar && d.yt_estado !== "ao_vivo" && d.yt_estado !== "encerrado");
}

/**
 * Destino YouTube automático (sem clique): vale chamar o garantir-youtube ao abrir o estúdio? Só no modo live, fora do
 * ar e sem nenhum destino YouTube conectado (mesmo desligado: desligar foi escolha de quem opera).
 */
export function precisaGarantirYt(salaStatus: string | null | undefined, destinos: Pick<LiveDestino, "modo">[], modo: "live" | "gravacao" = "live"): boolean {
  if (modo !== "live" || salaStatus === "ao_vivo") return false;
  return !destinos.some((d) => d.modo === "youtube_api");
}

export type ResultadoGarantirYt = { criado: boolean; ativado: boolean; destino_id: string | null; motivo?: string };

/** Pede ao live-control o destino YouTube da sala (idempotente). Falha não interrompe quem chamou: devolve null. */
export async function garantirYoutube(roomId: string, o: { ativar?: boolean; contaId?: string | null } = {}): Promise<ResultadoGarantirYt | null> {
  try {
    return (await liveControl("garantir-youtube", { room_id: roomId, ativar: o.ativar === true, ...(o.contaId ? { yt_conta_id: o.contaId } : {}) })) as ResultadoGarantirYt;
  } catch {
    return null;
  }
}

async function chamarOauth<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("youtube-oauth", { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) msg = (await ctx.json())?.error ?? msg;
    } catch {
      /* mantém a genérica */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function listarContasYt(): Promise<ContaYoutube[]> {
  const com = await db.from("yt_contas").select("id, canal_id, titulo, foto_url, status, ultimo_erro, padrao").order("criado_em");
  if (!com.error) return com.data ?? [];
  // sem a migração do canal padrão a coluna não existe: lista sem ela (nunca esconder os canais)
  const { data, error } = await db.from("yt_contas").select("id, canal_id, titulo, foto_url, status, ultimo_erro").order("criado_em");
  return error ? [] : (data ?? []);
}

/** Canal padrão (destino automático): o marcado; sem marca, o primeiro conectado. */
export function canalPadraoYt(contas: ContaYoutube[]): ContaYoutube | null {
  const c = contas.filter((x) => x.status === "conectado");
  return c.find((x) => x.padrao) ?? c[0] ?? null;
}

export const definirCanalPadrao = (contaId: string) => chamarOauth<{ ok: boolean }>({ acao: "definir-padrao", conta_id: contaId });

export const desconectarContaYt = (contaId: string) => chamarOauth<{ ok: boolean; revogado: boolean }>({ acao: "desconectar", conta_id: contaId });

/**
 * Abre o login do Google num popup. A janela abre ANTES da chamada (senão o bloqueador de popup barra,
 * porque o clique já passou) e recebe a URL quando a função responde. Resolve quando o popup avisa ou fecha.
 */
export async function conectarYoutubePopup(): Promise<MensagemOauth> {
  const w = window.open("about:blank", "conectar-youtube", "width=520,height=680");
  let url: string;
  try {
    url = (await chamarOauth<{ url: string }>({ acao: "iniciar" })).url;
  } catch (e) {
    w?.close();
    throw e;
  }
  if (!w) {
    window.location.href = url; // popup bloqueado: segue na mesma aba e volta pela página de retorno
    return new Promise(() => {});
  }
  w.location.href = url;
  return new Promise((resolve) => {
    let feito = false;
    const fim = (m: MensagemOauth) => {
      if (feito) return;
      feito = true;
      window.removeEventListener("message", ouvir);
      parar();
      clearInterval(t);
      resolve(m);
    };
    const ouvir = (ev: MessageEvent) => {
      const m = lerMensagemOauth(ev, window.location.origin);
      if (m) fim(m);
    };
    window.addEventListener("message", ouvir);
    const parar = ouvirRetornoYt(fim);
    const t = setInterval(() => {
      if (w.closed) fim({ tipo: TIPO_MENSAGEM, status: "erro", motivo: "janela fechada" });
    }, 700);
  });
}

/** Assina o aviso da página de retorno (BroadcastChannel, mesma origem). Devolve a função de parar. */
export function ouvirRetornoYt(cb: (m: MensagemOauth) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const bc = new BroadcastChannel(CANAL_RETORNO);
  bc.onmessage = (ev) => {
    const m = lerMensagemOauth({ origin: window.location.origin, data: ev.data }, window.location.origin);
    if (m) cb(m);
  };
  return () => bc.close();
}
