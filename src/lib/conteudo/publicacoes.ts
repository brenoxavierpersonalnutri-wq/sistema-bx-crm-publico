// Publicar e agendar no Instagram pela Zernio, a partir do board de Conteúdo.
// Quem fala com a Zernio é o serviço headturbo-zernio na VPS (infra/zernio), nunca o navegador: a chave fica lá.
// O estado de cada envio mora em conteudo_publicacoes (migration 20261124100000), que o CRM só lê.
import { supabase } from "@/integrations/supabase/client";

export const ZERNIO_API: string =
  (import.meta.env.VITE_ZERNIO_API as string | undefined) || "https://SEU_VPS/zernio";

export const MODULO_CONTEUDO = "conteudo";

export type TipoPub = "feed" | "carrossel" | "reels" | "story";
export type StatusPub = "enviando" | "agendado" | "publicando" | "publicado" | "erro" | "cancelado";
export type TipoMidia = "image" | "video";

export interface Midia { url: string; tipo: TipoMidia; nome?: string }

export interface ContaIg { id: string; usuario: string | null; nome: string | null; foto: string | null; ativa: boolean }

export interface Publicacao {
  id: string;
  card_ref: string;
  perfil: string | null;
  card_texto: string | null;
  conta_id: string;
  conta_nome: string | null;
  tipo: TipoPub;
  legenda: string | null;
  midias: Midia[];
  agora: boolean;
  agendado_para: string | null;
  status: StatusPub;
  zernio_post_id: string | null;
  link_post: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
  publicado_em: string | null;
}

/** Card que o board pediu para publicar (mensagem do iframe). */
export interface CardPedido { card_ref: string; perfil: string; perfil_nome: string; coluna: string; texto: string }

export const ROTULO_TIPO: Record<TipoPub, string> = {
  feed: "Feed (1 imagem)",
  carrossel: "Carrossel (2 a 10)",
  reels: "Reels (1 vídeo)",
  story: "Story (1 imagem ou vídeo)",
};

export const ROTULO_STATUS: Record<StatusPub, string> = {
  enviando: "Enviando",
  agendado: "Agendado",
  publicando: "Publicando",
  publicado: "Publicado",
  erro: "Erro",
  cancelado: "Cancelado",
};

export const PENDENTES: StatusPub[] = ["enviando", "agendado", "publicando"];

export function podePublicar(isAdmin: boolean, modulos: ReadonlyArray<string>): boolean {
  return isAdmin || modulos.includes(MODULO_CONTEUDO);
}

export function tipoDoArquivo(mime: string): TipoMidia | null {
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  if (["video/mp4", "video/quicktime"].includes(mime)) return "video";
  return null;
}

/** Mesmas regras do serviço (infra/zernio/lib.mjs), para avisar antes de enviar. null = ok. */
export function conferirMidias(tipo: TipoPub, midias: Midia[]): string | null {
  const img = midias.filter((m) => m.tipo === "image").length;
  const vid = midias.length - img;
  if (midias.length === 0) return "falta a mídia";
  if (midias.length > 10) return "no máximo 10 mídias";
  if (tipo === "feed" && !(midias.length === 1 && img === 1)) return "feed leva exatamente 1 imagem (vídeo vai como reels; várias, como carrossel)";
  if (tipo === "carrossel" && midias.length < 2) return "carrossel precisa de 2 a 10 mídias";
  if (tipo === "reels" && !(midias.length === 1 && vid === 1)) return "reels leva exatamente 1 vídeo";
  if (tipo === "story" && midias.length !== 1) return "story leva exatamente 1 imagem ou vídeo";
  return null;
}

/** "2026-10-22T09:30" (input datetime-local, fuso do navegador) -> ISO com offset ("2026-10-22T09:30:00-03:00"). */
export function localParaIsoComFuso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sinal}${hh}:${mm}`;
}

/** Última publicação de cada card (para o selo no board). */
export function ultimaPorCard(lista: Publicacao[]): Record<string, { status: StatusPub; link: string | null; erro: string | null; quando: string | null; conta: string | null }> {
  const out: Record<string, { status: StatusPub; link: string | null; erro: string | null; quando: string | null; conta: string | null }> = {};
  const ordenada = [...lista].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  for (const p of ordenada) {
    out[p.card_ref] = { status: p.status, link: p.link_post, erro: p.erro, quando: p.agendado_para, conta: p.conta_nome };
  }
  return out;
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("sessão expirada: entre de novo no CRM");
  return t;
}

async function chamar<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${ZERNIO_API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${await token()}`, ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new Error("o serviço de publicação não respondeu (VPS fora do ar?)");
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.erro || `erro HTTP ${r.status}`), { resposta: j, status: r.status });
  return j as T;
}

export const listarContas = (forcar = false) =>
  chamar<{ contas: ContaIg[] }>("GET", `/v1/contas${forcar ? "?forcar=1" : ""}`).then((r) => r.contas);

export interface PedidoPublicar {
  card_ref: string;
  perfil: string;
  card_texto: string;
  conta_id: string;
  conta_nome: string | null;
  tipo: TipoPub;
  legenda: string;
  midias: Midia[];
  agendar_para: string | null; // null = agora
}

export interface RespostaPublicar { id: string; zernio_post_id: string | null; status: StatusPub; link: string | null; erro: string | null }

/** Publica/agenda. Erro da Zernio (422) volta como resposta com status "erro", não como exceção. */
export async function publicar(p: PedidoPublicar): Promise<RespostaPublicar> {
  try {
    return await chamar<RespostaPublicar>("POST", "/v1/publicar", { ...p, midias: p.midias.map(({ url, tipo }) => ({ url, tipo })) });
  } catch (e) {
    const r = (e as { resposta?: RespostaPublicar; status?: number }).resposta;
    if ((e as { status?: number }).status === 422 && r?.id) return r;
    throw e;
  }
}

export const cancelar = (id: string) => chamar<{ id: string; status: StatusPub }>("POST", "/v1/cancelar", { id });

/** Sobe o arquivo pelo serviço (que repassa ao armazenamento da Zernio). XHR para ter a barra de progresso. */
export async function subirMidia(arquivo: File, aoProgredir?: (pct: number) => void): Promise<Midia> {
  const tipo = tipoDoArquivo(arquivo.type);
  if (!tipo) throw new Error("formato não aceito (JPG, PNG, WEBP, MP4 ou MOV)");
  if (arquivo.size > 1024 * 1024 * 1024) throw new Error("arquivo acima de 1 GB");
  const t = await token();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${ZERNIO_API}/v1/midia`);
    xhr.setRequestHeader("authorization", `Bearer ${t}`);
    xhr.setRequestHeader("content-type", arquivo.type);
    xhr.setRequestHeader("x-nome-arquivo", encodeURIComponent(arquivo.name));
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && aoProgredir) aoProgredir(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = () => {
      let j: { url?: string; tipo?: TipoMidia; erro?: string } | null = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* corpo não-JSON */ }
      if (xhr.status === 200 && j?.url && j.tipo) resolve({ url: j.url, tipo: j.tipo, nome: arquivo.name });
      else reject(new Error(j?.erro || `upload falhou (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("o serviço de publicação não respondeu ao upload"));
    xhr.send(arquivo);
  });
}

/** Lê as publicações (RLS: só quem tem Conteúdo enxerga). */
export async function listarPublicacoes(): Promise<Publicacao[]> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("conteudo_publicacoes" as any)
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(300);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return (data ?? []) as unknown as Publicacao[];
}
