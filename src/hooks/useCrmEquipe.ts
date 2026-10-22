// Estado compartilhado de permissões, departamentos e atendentes do CRM (migration 20261123100000).
// Mesmo padrão de useEtapas: estado em módulo (uma leitura para a tela toda) + useSyncExternalStore.
// Banco sem a migration (RPC/tabela ausente): acesso total como hoje, sem departamentos, sem atendentes —
// a tela fica igual à de antes até o SQL rodar.
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { acessoTotal, type MeuAcesso } from "@/lib/crm/acesso";
import { ordenarDepartamentos, type Atendente, type Departamento } from "@/lib/crm/departamentos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };

function criarLoja<T>(inicial: T, ler: () => Promise<T>) {
  let valor = inicial;
  let carregado = false;
  let andamento: Promise<void> | null = null;
  const ouvintes = new Set<() => void>();
  const publicar = (v: T) => { valor = v; carregado = true; ouvintes.forEach((f) => f()); };
  const recarregar = (): Promise<void> => {
    if (andamento) return andamento;
    andamento = ler().then(publicar, () => publicar(valor)).finally(() => { andamento = null; });
    return andamento;
  };
  const assinar = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
  const useLoja = (ligado = true) => {
    const v = useSyncExternalStore(assinar, () => valor, () => valor);
    useEffect(() => { if (ligado && !carregado) void recarregar(); }, [ligado]);
    return v;
  };
  return { useLoja, recarregar, definir: publicar, atual: () => valor };
}

const ausente = (e: unknown) =>
  !!e && typeof e === "object" && ["PGRST202", "42883", "PGRST204", "42P01", "PGRST205"].includes(String((e as { code?: string }).code));

// ------------------------------------------------------------------------------------------- meu acesso
const lojaAcesso = criarLoja<MeuAcesso | null>(null, async () => {
  const { data, error } = await db.rpc("crm_meu_acesso");
  if (error) {
    if (ausente(error)) return acessoTotal(); // migration pendente: como hoje
    throw error;
  }
  return data as MeuAcesso;
});
/** null enquanto carrega. */
export const useMeuAcessoCrm = () => lojaAcesso.useLoja();
export const recarregarMeuAcesso = lojaAcesso.recarregar;

// ------------------------------------------------------------------------------------------ departamentos
const lojaDeps = criarLoja<Departamento[]>([], async () => {
  const { data, error } = await db.from("crm_departamentos")
    .select("id, nome, cor, ativo, ordem, regra, fixo, etapa_origem").order("ordem");
  if (error) {
    if (ausente(error)) return [];
    throw error;
  }
  return ordenarDepartamentos((data ?? []) as Departamento[]);
});
export const useDepartamentos = (ligado = true) => lojaDeps.useLoja(ligado);
export const recarregarDepartamentos = lojaDeps.recarregar;

async function ok<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error((error as { message?: string }).message ?? String(error));
  return data;
}

export async function criarDepartamento(nome: string, cor: string): Promise<void> {
  const atual = lojaDeps.atual();
  const ordem = (atual.reduce((m, d) => Math.max(m, d.ordem), 0) || 0) + 10;
  await ok(db.from("crm_departamentos").insert({ nome: nome.trim(), cor, ordem }));
  await recarregarDepartamentos();
}

export async function editarDepartamento(id: string, patch: Partial<Pick<Departamento, "nome" | "cor" | "ativo">>): Promise<void> {
  await ok(db.from("crm_departamentos").update(patch).eq("id", id));
  await recarregarDepartamentos();
}

export async function excluirDepartamento(id: string): Promise<void> {
  await ok(db.from("crm_departamentos").delete().eq("id", id));
  await recarregarDepartamentos();
}

/** Grava a nova ordem (só as que mudaram). Otimista: a tela já mostra a ordem nova. */
export async function salvarOrdem(lista: Departamento[]): Promise<void> {
  const antes = new Map(lojaDeps.atual().map((d) => [d.id, d.ordem]));
  lojaDeps.definir(ordenarDepartamentos(lista));
  try {
    for (const d of lista) {
      if (antes.get(d.id) !== d.ordem) await ok(db.from("crm_departamentos").update({ ordem: d.ordem }).eq("id", d.id));
    }
  } finally {
    await recarregarDepartamentos();
  }
}

export async function importarDepartamentos(linhas: { nome: string; cor?: string; ativo?: boolean; origem_id?: string }[]): Promise<number> {
  const n = await ok<number>(db.rpc("crm_departamentos_importar", { p_lista: linhas }));
  await recarregarDepartamentos();
  return Number(n) || 0;
}

/** Troca/tira o departamento da conversa (RPC confere permissão; se o departamento veio de etapa, a etapa vai junto). */
export const definirDepartamentoDaConversa = (contatoId: string, departamentoId: string | null) =>
  ok(db.rpc("crm_departamento_definir", { p_contato_id: contatoId, p_departamento_id: departamentoId }));

// ------------------------------------------------------------------------------------------- atendentes
const lojaAtendentes = criarLoja<Atendente[]>([], async () => {
  const { data, error } = await db.rpc("crm_atendentes");
  if (error) {
    if (ausente(error)) return [];
    throw error;
  }
  return (data ?? []) as Atendente[];
});
export const useAtendentes = (ligado = true) => lojaAtendentes.useLoja(ligado);

/** Troca/tira o atendente à mão (cabeçalho da conversa). */
export const definirAtendenteDaConversa = (contatoId: string, atendenteId: string | null) =>
  ok(db.rpc("crm_atendente_definir", { p_contato_id: contatoId, p_atendente_id: atendenteId }));
