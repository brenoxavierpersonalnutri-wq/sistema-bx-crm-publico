// Leituras e utilitários compartilhados pelas abas do Banco de dados (sem componente: fast refresh fica limpo).
import { supabase } from "@/integrations/supabase/client";
import { fonteTagsSupabase, variantesDasTags } from "@/lib/crm/tags";

// RPCs novas ainda não estão nos tipos gerados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;


/** Tag(s) escolhida(s) no seletor + as grafias gravadas de fato (o filtro do banco é exato). */
export async function comVariantes(tags: string[]): Promise<string[]> {
  if (!tags.length) return [];
  const lista = await fonteTagsSupabase.listar().catch(() => []);
  return variantesDasTags(lista, tags);
}

/** Baixa um CSV (com BOM, para o Excel abrir com acento). */
export function baixarCsv(nome: string, linhas: string[]) {
  const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ResumoOrigem {
  origem: string;
  linhas: number;
  ultimo_importado: string | null;
  ultima_entrada: string | null;
}

/** Linhas por origem (RPC base_leads_resumo_origens, migration 20261122150000). null = RPC ainda não existe. */
export async function lerResumoOrigens(): Promise<ResumoOrigem[] | null> {
  try {
    const { data, error } = await db.rpc("base_leads_resumo_origens");
    if (error) return null;
    return ((data ?? []) as ResumoOrigem[]).map((r) => ({ ...r, linhas: Number(r.linhas) }));
  } catch {
    return null;
  }
}

/** Produtos com contagem (RPC base_leads_produtos, migration 20261122150000). [] = RPC ainda não existe. */
export async function lerProdutos(): Promise<string[]> {
  try {
    const { data, error } = await db.rpc("base_leads_produtos");
    return error ? [] : ((data ?? []) as { produto: string }[]).map((p) => p.produto);
  } catch {
    return [];
  }
}

