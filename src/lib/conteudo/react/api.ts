// Estúdio React: fala com o serviço headturbo-react na VPS (infra/react) e com a tabela conteudo_reacts (lista de
// projetos, migration 20261125100000). Os vídeos vão direto para a VPS em pedaços de 8 MB, retomáveis: se a internet
// do celular cair no meio, o envio continua de onde parou (HEAD devolve quantos bytes o servidor já tem).
import { supabase } from "@/integrations/supabase/client";
import type { Trecho } from "./linhaTempo";
import type { AjustesEdicao, BaseEdicao, EdicaoSalva, TrechoEd } from "./edicao";

export const REACT_API: string = (import.meta.env.VITE_REACT_API as string | undefined) || "https://SEU_VPS/react";

export const PEDACO = 8 * 1024 * 1024;
export const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type Arquivo = "original" | "reacao";
export type Layout = "dividido" | "cheia_longos";
export type Modo = "aqui" | "separado";
export type StatusReact = "rascunho" | "enviando" | "montando" | "pronto" | "erro";

export interface ProjetoReact {
  id: string;
  titulo: string;
  perfil: string | null;
  modo: Modo;
  layout: Layout;
  legenda: boolean;
  cortar_silencio: boolean;
  linha_tempo: Trecho[];
  original_nome: string | null;
  original_bytes: number | null;
  duracao_gravacao_seg: number | null;
  duracao_final_seg: number | null;
  status: StatusReact;
  erro: string | null;
  publicacao_id: string | null;
  /** colunas da migration 20261201100000 (podem faltar se ela ainda não rodou) */
  edicao_ia?: boolean | null;
  duracao_max_seg?: number | null;
  ia_uso?: ResumoIA | null;
  /** colunas da migration 20261205100000 (opcionais: sem ela a VPS guarda a edição e o link por 15 dias) */
  edicao?: EdicaoSalva | null;
  modelo_edicao?: string | null;
  origem_url?: string | null;
  origem_autor?: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface PedidoMontar {
  modo: Modo;
  layout: Layout;
  legenda: boolean;
  cortar_silencio: boolean;
  /** Edição com IA (Claude da assinatura, na VPS) */
  ia: boolean;
  /** duração máxima do vídeo final, em segundos (15 a 600) */
  duracao_max: number;
  /** modelo de edição (legenda e título): "nativo" é o padrão */
  modelo?: string;
  trechos: Trecho[] | TrechoEd[];
  /** escolhas da tela de edição (volume geral, gancho/título da IA, cortes da IA restaurados) */
  edicao?: AjustesEdicao;
}

export interface UsoIA {
  modelo: string;
  fonte: string;
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: number;
  custo_lista_usd?: number;
  segundos: number;
}

export interface ResumoIA {
  ligada: boolean;
  aplicada?: boolean;
  titulo?: string;
  gancho_seg?: number;
  cortes?: number;
  segundos_cortados_ia?: number;
  comentarios_removidos?: number;
  comentarios_tirados_pela_duracao?: number;
  tocando_encurtado_seg?: number;
  zooms?: number;
  duracao_antes_seg?: number;
  duracao_depois_seg?: number;
  duracao_max_seg?: number;
  uso?: UsoIA | null;
}

export interface ResultadoMontagem {
  duracao_seg: number;
  duracao_gravacao_seg: number;
  segundos_cortados: number;
  pecas: number;
  comentarios: number;
  legendas: number;
  avisos: string[];
  bytes: number;
  segundos_montagem: number;
  modelo?: string;
  ia?: ResumoIA;
}

export interface EstadoServico {
  estado: "novo" | "na_fila" | "montando" | "pronto" | "erro";
  etapa?: string;
  progresso?: number;
  erro?: string;
  fila?: number;
  resultado?: ResultadoMontagem;
  recebidos?: Record<Arquivo, boolean>;
  arquivo?: string;
  baixar?: string;
  capa?: string;
}

export const ROTULO_STATUS: Record<StatusReact, string> = {
  rascunho: "Rascunho",
  enviando: "Enviando",
  montando: "Montando",
  pronto: "Pronto",
  erro: "Erro",
};

/** Endereço que o serviço devolve ("/v1/arquivo/...") -> absoluto. */
export const urlAbsoluta = (caminho?: string) => (caminho ? `${REACT_API}${caminho}` : undefined);

/** Título padrão a partir do nome do arquivo ("Treino-perna FINAL.mp4" -> "Treino-perna FINAL"). */
export function tituloDoArquivo(nome: string): string {
  const t = nome.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").trim();
  return (t || "React").slice(0, 120);
}

/** Próximo pedaço a mandar: [início, fim) ou null quando acabou. */
export function proximoPedaco(total: number, recebido: number, pedaco = PEDACO): [number, number] | null {
  if (recebido >= total) return null;
  return [recebido, Math.min(total, recebido + pedaco)];
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("sessão expirada: entre de novo no CRM");
  return t;
}

async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${REACT_API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${await token()}`, ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new Error("o servidor do Estúdio React não respondeu (VPS fora do ar ou sem internet)");
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.erro || `erro HTTP ${r.status}`), { status: r.status, resposta: j });
  return j as T;
}

// ------------------------------------------------------------------ projetos (Supabase, RLS)

function erroTabela(e: { message: string; code?: string }) {
  if (e.code === "42P01" || e.code === "PGRST205") {
    return new Error("A tabela conteudo_reacts ainda não existe: falta rodar a migration 20261125100000 no SQL do Supabase.");
  }
  return Object.assign(new Error(e.message), { code: e.code });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabela = () => supabase.from("conteudo_reacts" as any);

export async function criarProjeto(dados: Partial<ProjetoReact>): Promise<ProjetoReact> {
  const { data, error } = await tabela().insert(dados as never).select("*").single();
  if (error) throw erroTabela(error);
  return data as unknown as ProjetoReact;
}

export async function atualizarProjeto(id: string, patch: Partial<ProjetoReact>): Promise<void> {
  const { error } = await tabela().update(patch as never).eq("id", id);
  if (error) throw erroTabela(error);
}

/** Colunas novas (edicao_ia, duracao_max_seg, ia_uso): grava se a migration 20261201100000 já rodou; senão ignora. */
export async function atualizarColunasIA(id: string, patch: { edicao_ia?: boolean; duracao_max_seg?: number; ia_uso?: ResumoIA | null }): Promise<void> {
  try {
    await tabela().update(patch as never).eq("id", id);
  } catch {
    /* coluna ainda não existe: segue sem gravar */
  }
}

export async function listarProjetos(): Promise<ProjetoReact[]> {
  const { data, error } = await tabela().select("*").order("criado_em", { ascending: false }).limit(30);
  if (error) throw erroTabela(error);
  return (data ?? []) as unknown as ProjetoReact[];
}

/**
 * Colunas que dependem de migration opcional (edicao, modelo_edicao, origem_url, origem_autor): uma chamada por grupo,
 * para a falta de uma coluna não derrubar a gravação das outras. Sem a migration, o PostgREST recusa e seguimos.
 */
export async function atualizarColunasOpcionais(id: string, patch: Partial<Pick<ProjetoReact, "edicao" | "modelo_edicao" | "origem_url" | "origem_autor">>): Promise<boolean> {
  try {
    const { error } = await tabela().update(patch as never).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** Apaga os arquivos na VPS e a linha. */
export async function apagarProjeto(id: string): Promise<void> {
  try {
    await chamar("DELETE", `/v1/projeto/${id}`);
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  const { error } = await tabela().delete().eq("id", id);
  if (error) throw erroTabela(error);
}

// ------------------------------------------------------------------ upload em pedaços

async function recebido(id: string, arq: Arquivo): Promise<{ bytes: number; completo: boolean }> {
  const r = await fetch(`${REACT_API}/v1/up/${id}/${arq}`, { method: "HEAD", headers: { authorization: `Bearer ${await token()}` } });
  if (r.status === 401) throw new Error("sessão expirada: entre de novo no CRM");
  if (r.status === 403) throw new Error("seu usuário não tem acesso ao Conteúdo");
  if (r.status === 404) throw new Error("projeto não encontrado (a migration conteudo_reacts foi aplicada?)");
  if (!r.ok) throw new Error(`o servidor recusou (HTTP ${r.status})`);
  return { bytes: Number(r.headers.get("X-Recebido") || 0), completo: r.headers.get("X-Completo") === "1" };
}

function putPedaco(url: string, tok: string, offset: number, corpo: Blob, aoProgredir: (bytes: number) => void, sinal?: AbortSignal) {
  return new Promise<{ status: number; recebido: number | null; erro?: string }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("authorization", `Bearer ${tok}`);
    xhr.setRequestHeader("x-offset", String(offset));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.timeout = 5 * 60_000;
    xhr.upload.onprogress = (ev) => aoProgredir(ev.loaded);
    const fim = () => {
      let erro: string | undefined;
      try { erro = JSON.parse(xhr.responseText || "{}")?.erro; } catch { /* corpo vazio */ }
      const rec = xhr.getResponseHeader("X-Recebido");
      resolve({ status: xhr.status, recebido: rec === null ? null : Number(rec), erro });
    };
    xhr.onload = fim;
    xhr.onerror = () => resolve({ status: 0, recebido: null });
    xhr.ontimeout = () => resolve({ status: 0, recebido: null });
    xhr.onabort = () => resolve({ status: -1, recebido: null });
    sinal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(corpo);
  });
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Sobe o arquivo em pedaços, retomando de onde o servidor parou. `aoProgredir` recebe 0..1.
 * Até 8 tentativas por pedaço (internet do celular oscilando), com espera crescente.
 */
export async function subirArquivo(id: string, arq: Arquivo, arquivo: Blob, aoProgredir?: (frac: number) => void, sinal?: AbortSignal): Promise<void> {
  if (arquivo.size <= 0) throw new Error("arquivo vazio");
  if (arquivo.size > MAX_BYTES) throw new Error("arquivo acima de 2 GB");
  let { bytes: feito, completo } = await recebido(id, arq);
  if (completo && feito === arquivo.size) {
    aoProgredir?.(1);
    return;
  }
  if (completo || feito > arquivo.size) feito = 0; // outro arquivo com o mesmo nome: manda do zero
  const url = `${REACT_API}/v1/up/${id}/${arq}`;
  let falhas = 0;
  for (let p = proximoPedaco(arquivo.size, feito); p; p = proximoPedaco(arquivo.size, feito)) {
    if (sinal?.aborted) throw new Error("envio cancelado");
    const [a, b] = p;
    const r = await putPedaco(url, await token(), a, arquivo.slice(a, b), (n) => aoProgredir?.((a + n) / arquivo.size), sinal);
    if (r.status === -1) throw new Error("envio cancelado");
    if (r.status === 200 && r.recebido !== null) {
      feito = r.recebido;
      falhas = 0;
      aoProgredir?.(feito / arquivo.size);
      continue;
    }
    if (r.status === 409 && r.recebido !== null) { feito = r.recebido; continue; } // o servidor diz onde parou
    if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 413 || r.status === 507) {
      throw new Error(r.erro || `o servidor recusou o envio (HTTP ${r.status})`);
    }
    falhas += 1;
    if (falhas > 8) throw new Error("a internet caiu várias vezes seguidas: tente de novo (o envio continua de onde parou)");
    await esperar(Math.min(15_000, 1000 * 2 ** falhas));
    try { feito = (await recebido(id, arq)).bytes; } catch { /* tenta de novo no próximo giro */ }
  }
}

export interface InfoArquivo { ok: boolean; bytes: number; duracao_seg: number | null; video: { largura: number; altura: number } | null; audio: boolean }

export const fecharArquivo = (id: string, arq: Arquivo) => chamar<InfoArquivo>("POST", `/v1/fim/${id}/${arq}`);

export const montar = (id: string, pedido: PedidoMontar) => chamar<{ estado: string; fila: number }>("POST", `/v1/montar/${id}`, pedido);

export async function estadoMontagem(id: string): Promise<EstadoServico> {
  const e = await chamar<EstadoServico>("GET", `/v1/estado/${id}`);
  return { ...e, arquivo: urlAbsoluta(e.arquivo), baixar: urlAbsoluta(e.baixar), capa: urlAbsoluta(e.capa) };
}

/** O MP4 pronto como File (para mandar à Zernio pelo painel de publicar). */
export async function baixarFinal(url: string, titulo: string): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`não consegui baixar o vídeo pronto (HTTP ${r.status})`);
  const blob = await r.blob();
  const nome = `${titulo.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "react"}.mp4`;
  return new File([blob], nome, { type: "video/mp4" });
}

// ------------------------------------------------------------------ tela de edição

export interface RespostaEdicao {
  base: BaseEdicao | null;
  salva: EdicaoSalva | null;
  falas: [number, number][] | null;
  previas: { original: string | null; reacao: string | null };
  montando: boolean;
  link: EstadoLink | null;
}

/** O que a tela de edição precisa do servidor: base da última montagem, edição salva, falas e as prévias leves. */
export async function lerEdicao(id: string): Promise<RespostaEdicao> {
  const r = await chamar<RespostaEdicao>("GET", `/v1/edicao/${id}`);
  return { ...r, previas: { original: urlAbsoluta(r.previas?.original ?? undefined) ?? null, reacao: urlAbsoluta(r.previas?.reacao ?? undefined) ?? null } };
}

/** Salva as escolhas na VPS (sempre) e no banco (se a migration 20261205100000 já rodou). */
export async function salvarEdicao(id: string, trechos: TrechoEd[], edicao: AjustesEdicao): Promise<{ banco: boolean }> {
  await chamarPut(`/v1/edicao/${id}`, { trechos, edicao });
  const banco = await atualizarColunasOpcionais(id, { edicao: { trechos, edicao, salvo_em: Math.floor(Date.now() / 1000) } });
  return { banco };
}

async function chamarPut<T>(caminho: string, corpo: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${REACT_API}${caminho}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new Error("o servidor do Estúdio React não respondeu (VPS fora do ar ou sem internet)");
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.erro || `erro HTTP ${r.status}`), { status: r.status });
  return j as T;
}

// ------------------------------------------------------------------ modelos de edição

export interface ModeloEdicao { id: string; nome: string; descricao?: string }
export interface ListaModelos { padrao: string; modelos: ModeloEdicao[]; planejados: { id: string; nome: string; aguardando: string }[] }

export const MODELOS_RESERVA: ListaModelos = { padrao: "nativo", modelos: [{ id: "nativo", nome: "Nativo (padrão)" }], planejados: [] };

export async function listarModelos(): Promise<ListaModelos> {
  try {
    const r = await fetch(`${REACT_API}/v1/modelos`);
    if (!r.ok) return MODELOS_RESERVA;
    const j = (await r.json()) as ListaModelos;
    return j?.modelos?.length ? j : MODELOS_RESERVA;
  } catch {
    return MODELOS_RESERVA;
  }
}

// ------------------------------------------------------------------ vídeo original pelo link (Instagram)

export interface EstadoLink {
  estado: "nenhum" | "baixando" | "pronto" | "erro";
  progresso?: number;
  etapa?: string;
  erro?: string;
  url?: string;
  plataforma?: string;
  autor?: string;
  titulo?: string;
  duracao_seg?: number;
  bytes?: number;
  arquivo?: string | null;
}

/** Aceita o link colado como veio (com ?igsh=, sem https). O serviço confere e limpa. */
export function pareceLink(texto: string): boolean {
  return /(instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/[\w-]{5,}|tiktok\.com\/|youtube\.com\/shorts\/)/i.test(texto.trim());
}

export const carregarLink = (id: string, url: string) => chamar<{ estado: string; url: string; plataforma: string }>("POST", `/v1/link/${id}`, { url });

export async function estadoLink(id: string): Promise<EstadoLink> {
  const e = await chamar<EstadoLink>("GET", `/v1/link/${id}`);
  return { ...e, arquivo: urlAbsoluta(e.arquivo ?? undefined) ?? null };
}

/** Traz o vídeo baixado pela VPS para o navegador (o player de gravar toca do arquivo local, sem travar). */
export async function trazerVideo(url: string, nome: string, aoProgredir?: (frac: number) => void): Promise<File> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`não consegui trazer o vídeo da VPS (HTTP ${r.status})`);
  const total = Number(r.headers.get("Content-Length") || 0);
  const leitor = r.body.getReader();
  const partes: BlobPart[] = [];
  let lido = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value as BlobPart);
    lido += value.length;
    if (total) aoProgredir?.(lido / total);
  }
  return new File(partes, nome, { type: "video/mp4" });
}

/** "Vídeo original: @autor" para a legenda do post (crédito ao autor, se ele quiser). */
export function textoCredito(autor?: string | null, url?: string | null): string {
  if (!autor && !url) return "";
  const quem = autor ? (/^[\w.]+$/.test(autor) ? `@${autor}` : autor) : "";
  return `Vídeo original: ${quem}${quem && url ? " " : ""}${url && !quem ? url : ""}`.trim();
}
