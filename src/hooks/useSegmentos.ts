// Segmentos do Banco de dados (/crm/banco): definições, contagens e páginas de pessoas.
// Lista detalhada só sai daqui (tela protegida pelo módulo "crm-banco"); o Dashboard não usa este hook.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { telefoneParaE164 } from "@/lib/baseLeads";
import {
  SEGMENTOS_PADRAO, VALORES_PROGRAMA, aplicarFiltro, hojeBRT, normalizarSegmento, type FiltrosTela, type Segmento,
} from "@/lib/crm/segmentos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PessoaBase {
  chave: string;
  telefone_e164: string | null;
  email: string | null;
  nome: string | null;
  primeira_entrada: string | null;
  ultima_entrada: string | null;
  origens: string[];
  tags: string[];
  nivel: string | null;
  comprador: boolean;
  /** só nos recortes de alunas (ativas / ex) */
  programa?: string | null;
  vencimento?: string | null;
  /** produto mais recente da pessoa (migration 20261122150000; antes dela vem vazio) */
  produto?: string | null;
}

const COLUNAS = "chave,telefone_e164,email,nome,primeira_entrada,ultima_entrada,origens,tags,nivel,comprador";

/** Carrega as definições (tabela crm_segmentos ou o seed embutido). Cache de módulo: menu e tela dividem. */
let cache: Promise<{ segmentos: Segmento[]; provisorio: boolean }> | null = null;
export function carregarSegmentos(forcar = false) {
  if (!cache || forcar) {
    cache = (async () => {
      try {
        const { data, error } = await db.from("crm_segmentos").select("*").eq("ativo", true).order("ordem");
        if (error || !data?.length) return { segmentos: SEGMENTOS_PADRAO, provisorio: true };
        const lista = (data as Record<string, unknown>[]).map(normalizarSegmento).filter((s): s is Segmento => !!s);
        return { segmentos: lista.length ? lista : SEGMENTOS_PADRAO, provisorio: !lista.length };
      } catch {
        return { segmentos: SEGMENTOS_PADRAO, provisorio: true };
      }
    })();
  }
  return cache;
}

export function useSegmentos(ligado = true) {
  const [estado, setEstado] = useState<{ segmentos: Segmento[]; provisorio: boolean } | null>(null);
  const recarregar = useCallback(async (forcar = false) => setEstado(await carregarSegmentos(forcar)), []);
  useEffect(() => {
    if (ligado) recarregar();
  }, [ligado, recarregar]);
  return { segmentos: estado?.segmentos ?? null, provisorio: estado?.provisorio ?? true, recarregar };
}

// Caminho antigo (sem a RPC): mesma regra da RPC — vencimento >= hoje (BRT), sem teste, status não entra.
const alunasAtivas = () =>
  db.from("alunas").select("id,nome_completo,telefone,programa,data_vencimento,created_at", { count: "exact" })
    .eq("is_teste", false).gte("data_vencimento", hojeBRT());

/** Telefones (E.164) das alunas com plano vigente — usados para tirar as ativas do recorte "ex". */
async function telefonesAtivas(): Promise<string[]> {
  const { data, error } = await alunasAtivas().range(0, 4999);
  if (error) throw new Error(`alunas: ${error.message}`);
  return [...new Set(((data ?? []) as { telefone: string | null }[]).map((a) => telefoneParaE164(a.telefone)).filter(Boolean) as string[])];
}

export interface Pagina {
  pessoas: PessoaBase[];
  total: number | null;
}

/** Linha devolvida por public.crm_segmento_listar (migration 20261029110000). */
export interface LinhaRpc extends Omit<PessoaBase, "origens" | "tags"> {
  origens: string[] | null;
  tags: string[] | null;
  total: number | string | null;
}

/** RPC não existe no banco (migration ainda não rodou): PostgREST devolve PGRST202 / "Could not find the function". */
export function rpcAusente(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  return erro.code === "PGRST202" || erro.code === "42883" || /could not find the function|function .* does not exist/i.test(erro.message ?? "");
}

/** Argumentos da RPC de lista: a tela pede por deslocamento (de), o banco por página. */
export function argsListar(s: Segmento, tela: FiltrosTela, de: number, tamanho: number) {
  const porPagina = Math.min(Math.max(tamanho, 1), 1000);
  const filtros: FiltrosTela = {};
  if (tela.busca?.trim()) filtros.busca = tela.busca.trim();
  if (tela.de) filtros.de = tela.de;
  if (tela.ate) filtros.ate = tela.ate;
  if (tela.comTelefone) filtros.comTelefone = true;
  if (tela.tag) filtros.tag = tela.tag;
  if (tela.tag && tela.tagVariantes?.length) filtros.tagVariantes = tela.tagVariantes;
  if (tela.produto) filtros.produto = tela.produto;
  return { p_slug: s.slug, p_filtros: filtros, p_pagina: Math.floor(Math.max(de, 0) / porPagina), p_por_pagina: porPagina };
}

/** Converte a página da RPC (total repetido em cada linha) para o formato da tela. */
export function paginaDaRpc(linhas: LinhaRpc[] | null | undefined, pagina: number): Pagina {
  const lista = linhas ?? [];
  const pessoas = lista.map(({ total: _t, ...p }) => ({ ...p, origens: p.origens ?? [], tags: p.tags ?? [] })) as PessoaBase[];
  const bruto = lista[0]?.total;
  const total = bruto === null || bruto === undefined ? (pagina === 0 ? 0 : null) : Number(bruto);
  return { pessoas, total };
}

/** Caiu para o caminho antigo uma vez (RPC ausente): não tenta de novo nesta aba. */
let semRpc = false;

/** Uma página (ou a contagem, com tamanho 0) de um segmento. Lê pela RPC (cópia materializada / sistema do fitness). */
export async function lerSegmento(s: Segmento, tela: FiltrosTela, de = 0, tamanho = 50): Promise<Pagina> {
  if (!s.provisorio && !semRpc) {
    if (!tamanho) {
      const { data, error } = await db.rpc("crm_segmento_contar", { p_slug: s.slug });
      if (!error) return { pessoas: [], total: data === null || data === undefined ? null : Number(data) };
      if (!rpcAusente(error)) throw new Error(error.message);
      semRpc = true;
    } else {
      const args = argsListar(s, tela, de, tamanho);
      const { data, error } = await db.rpc("crm_segmento_listar", args);
      if (!error) return paginaDaRpc(data as LinhaRpc[], args.p_pagina);
      if (!rpcAusente(error)) throw new Error(error.message);
      semRpc = true;
    }
  }
  return lerSegmentoDireto(s, tela, de, tamanho);
}

/** Quando a cópia da base foi refeita pela última vez (pg_cron a cada 10 min). null = não deu para saber. */
export async function lerAtualizadoEm(): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("crm_banco_atualizado_em");
    return error || !data ? null : String(data);
  } catch {
    return null;
  }
}

/**
 * Caminho antigo (antes da 20261029110000): lê a visão pesada direto. Só serve enquanto a migration não roda;
 * o recorte "ex" aqui ainda é o da base de leads (comprador sem plano vigente).
 */
async function lerSegmentoDireto(s: Segmento, tela: FiltrosTela, de: number, tamanho: number): Promise<Pagina> {
  if (s.filtro.alunas === "ativas") {
    let q = alunasAtivas();
    // caminho antigo: filtra o programa pelo de-para padrão, sem a dedup por telefone (essa só existe na RPC)
    if (s.filtro.programa) q = q.in("programa", VALORES_PROGRAMA[s.filtro.programa]);
    const b = (tela.busca ?? "").replace(/[,()"'*%\\]/g, " ").trim();
    if (b) q = q.ilike("nome_completo", `%${b}%`);
    const { data, count, error } = tamanho ? await q.order("data_vencimento").range(de, de + tamanho - 1) : await q.range(0, 0);
    if (error) throw new Error(`alunas: ${error.message}`);
    const pessoas = ((tamanho ? data : []) ?? []).map((a: Record<string, string | null>) => ({
      chave: a.id as string,
      telefone_e164: telefoneParaE164(a.telefone),
      email: null,
      nome: a.nome_completo,
      primeira_entrada: a.created_at,
      ultima_entrada: a.created_at,
      origens: ["gestao-alunas"],
      tags: [],
      nivel: null,
      comprador: true,
      programa: a.programa,
      vencimento: a.data_vencimento,
    })) as PessoaBase[];
    return { pessoas, total: count ?? 0 };
  }
  const ex = s.filtro.alunas === "ex";
  const excluir = ex ? await telefonesAtivas() : [];
  const filtro = ex ? { ...s.filtro, comprador: true } : s.filtro;
  const q = aplicarFiltro(
    db.from("base_leads_unificada").select(tamanho ? COLUNAS : "chave", { count: "exact", head: !tamanho }),
    filtro, tela, excluir,
  );
  const { data, count, error } = tamanho ? await q.order("ultima_entrada", { ascending: false, nullsFirst: false }).range(de, de + tamanho - 1) : await q;
  if (error) throw new Error(error.message);
  return { pessoas: (data ?? []) as PessoaBase[], total: count ?? null };
}

export async function contarSegmento(s: Segmento): Promise<number | null> {
  try {
    return (await lerSegmento(s, {}, 0, 0)).total;
  } catch {
    return null;
  }
}

/** Todas as pessoas do filtro (para exportar / salvar lista), em páginas de 1000, até `teto`. */
export async function lerTudo(s: Segmento, tela: FiltrosTela, teto = 20000): Promise<PessoaBase[]> {
  const out: PessoaBase[] = [];
  for (let de = 0; de < teto; de += 1000) {
    const { pessoas } = await lerSegmento(s, tela, de, 1000);
    out.push(...pessoas);
    if (pessoas.length < 1000) break;
  }
  return out;
}
