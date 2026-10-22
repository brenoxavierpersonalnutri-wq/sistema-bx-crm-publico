// Aluna de teste: o time cria uma aluna de mentira para treinar o fluxo
// (anamnese, feedback, agenda) e apaga quando termina.
//
// No banco (supabase/migrations/20261014150000_aluna_teste.sql):
//   alunas.is_teste           marca que não muda depois de criada
//   criar_aluna_teste()       única porta para criar (nome "TESTE – Treinamento
//                             <data hora>", telefone (00) 90000-NNNN)
//   apagar_aluna_teste(id)    apaga a aluna e o que foi gerado para ela; RECUSA
//                             se a aluna for real
//
// Aluna de teste aparece nas listas (com o selo TESTE) mas fica fora de toda
// contagem e métrica: cartões do topo, painel, vencimentos, sinais, feedbacks.
import { supabase } from "@/integrations/supabase/client";
import type { Aluna } from "./alunaTypes";

const db = supabase as any;

/** E-mail para usar no treino quando algum formulário pedir: o domínio .invalid não entrega a ninguém. */
export const EMAIL_ALUNA_TESTE = "teste@exemplo.invalid";

export const ehAlunaTeste = (a: Pick<Aluna, "isTeste"> | null | undefined): boolean => a?.isTeste === true;

/** As alunas que contam: tudo menos as de teste. Usar em toda contagem e métrica. */
export function semAlunasTeste<T extends Pick<Aluna, "isTeste">>(alunas: T[]): T[] {
  return alunas.filter((a) => !ehAlunaTeste(a));
}

/**
 * Telefone de teste: DDD 00, que não existe. Serve para tirar das métricas um
 * feedback que chegou só com o telefone (sem aluna_id).
 */
export function ehTelefoneDeTeste(telefone: string | null | undefined): boolean {
  let d = (telefone ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return (d.length === 10 || d.length === 11) && d.startsWith("00");
}

/**
 * Tira das métricas o feedback do treino: pelo aluna_id de uma aluna de
 * teste, ou pelo telefone de teste quando ele chegou sem aluna_id.
 */
export function semFeedbacksDeTeste<T extends { aluna_id?: string | null; telefone?: string | null }>(
  feedbacks: T[],
  alunas: Pick<Aluna, "id" | "isTeste">[],
): T[] {
  const idsTeste = new Set(alunas.filter(ehAlunaTeste).map((a) => a.id));
  return feedbacks.filter((f) => !(f.aluna_id && idsTeste.has(f.aluna_id)) && !ehTelefoneDeTeste(f.telefone));
}

/** Quem vê os botões: admin ou quem tem o módulo Gestão de Alunas. O banco confere de novo. */
export function podeGerirAlunaTeste(isAdmin: boolean, modulos: ReadonlyArray<string>): boolean {
  return isAdmin || modulos.includes("alunas");
}

export interface AlunaTesteCriada {
  id: string;
  nome: string;
  telefone: string;
}

export async function criarAlunaTeste(): Promise<AlunaTesteCriada> {
  const { data, error } = await db.rpc("criar_aluna_teste");
  if (error) throw error;
  return data as AlunaTesteCriada;
}

export interface AlunaTesteApagada {
  aluna: number;
  anamneses: number;
  feedbacks: number;
  tarefas: number;
  /** Arquivos que não consegui tirar do storage (o banco já foi limpo). */
  arquivosPendentes: number;
}

const BUCKETS_DA_ALUNA = ["dietas", "feedback-fotos"] as const;

/**
 * Apaga a aluna de teste. O banco decide primeiro (e recusa aluna real); só
 * depois de ele confirmar é que os arquivos da pasta dela no storage saem.
 */
export async function apagarAlunaTeste(alunaId: string): Promise<AlunaTesteApagada> {
  const { data, error } = await db.rpc("apagar_aluna_teste", { _aluna: alunaId });
  if (error) throw error;
  const r = (data ?? {}) as Partial<AlunaTesteApagada>;
  if (r.aluna !== 1) throw new Error("O banco não confirmou que apagou a aluna de teste.");

  let arquivosPendentes = 0;
  for (const bucket of BUCKETS_DA_ALUNA) {
    try {
      const { data: arquivos, error: eList } = await supabase.storage.from(bucket).list(alunaId, { limit: 1000 });
      if (eList || !arquivos?.length) continue;
      const caminhos = arquivos.map((f) => `${alunaId}/${f.name}`);
      const { error: eRm } = await supabase.storage.from(bucket).remove(caminhos);
      if (eRm) arquivosPendentes += caminhos.length;
    } catch {
      arquivosPendentes += 1;
    }
  }

  return {
    aluna: 1,
    anamneses: r.anamneses ?? 0,
    feedbacks: r.feedbacks ?? 0,
    tarefas: r.tarefas ?? 0,
    arquivosPendentes,
  };
}
