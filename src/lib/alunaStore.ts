import { supabase } from "@/integrations/supabase/client";
import { Aluna } from "./alunaTypes";

function toDbRow(aluna: Aluna, userId: string) {
  return {
    id: aluna.id,
    user_id: userId,
    nome_completo: aluna.nomeCompleto,
    programa: aluna.programa,
    data_compra: aluna.dataCompra,
    duracao_plano: aluna.duracaoPlano,
    data_vencimento: aluna.dataVencimento,
    forma_pagamento: aluna.formaPagamento,
    pago: aluna.pago,
    deu_sinal: aluna.deuSinal ?? false,
    valor_sinal: aluna.valorSinal ?? 0,
    data_cobranca_sinal: aluna.dataCobrancaSinal ?? null,
    telefone: aluna.telefone ?? null,
    origem_lead: aluna.origemLead ?? null,
    anamnese_mfit: aluna.anamneseMfit ?? false,
    fotos_anamnese: aluna.fotosAnamnese ?? false,
    data_fotos_anamnese: aluna.dataFotosAnamnese ?? null,
    liberou_treino_dieta: aluna.liberouTreinoDieta ?? false,
    liberou_fotos: aluna.liberouFotos ?? false,
    data_avaliacao: aluna.dataAvaliacao ?? null,
    avaliacao_enviada: aluna.avaliacaoEnviada ?? false,
    residuo_pago: aluna.residuoPago ?? false,
    status: aluna.status ?? "ativa",
    renovacao_recusada: aluna.renovacaoRecusada ?? false,
  };
}

function fromDbRow(row: any): Aluna {
  return {
    id: row.id,
    nomeCompleto: row.nome_completo,
    programa: row.programa,
    dataCompra: row.data_compra,
    duracaoPlano: row.duracao_plano,
    dataVencimento: row.data_vencimento,
    formaPagamento: row.forma_pagamento,
    pago: row.pago,
    deuSinal: row.deu_sinal || undefined,
    valorSinal: row.valor_sinal || undefined,
    dataCobrancaSinal: row.data_cobranca_sinal || undefined,
    telefone: row.telefone || undefined,
    origemLead: row.origem_lead || undefined,
    anamneseMfit: row.anamnese_mfit || undefined,
    fotosAnamnese: row.fotos_anamnese || undefined,
    dataFotosAnamnese: row.data_fotos_anamnese || undefined,
    liberouTreinoDieta: row.liberou_treino_dieta || undefined,
    liberouFotos: row.liberou_fotos || undefined,
    dataAvaliacao: row.data_avaliacao || undefined,
    avaliacaoEnviada: row.avaliacao_enviada || undefined,
    residuoPago: row.residuo_pago || undefined,
    status: row.status || "ativa",
    renovacaoRecusada: row.renovacao_recusada || undefined,
    // Só leitura: toDbRow não manda is_teste, então o salvar da tela nunca mexe na marca.
    isTeste: row.is_teste === true ? true : undefined,
  };
}

export async function fetchAlunas(): Promise<Aluna[]> {
  const { data, error } = await supabase
    .from("alunas" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(fromDbRow);
}

export async function fetchAluna(id: string): Promise<Aluna | null> {
  const { data, error } = await supabase
    .from("alunas" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? fromDbRow(data) : null;
}

export async function upsertAluna(aluna: Aluna, userId: string): Promise<void> {
  const row = toDbRow(aluna, userId);
  const { error } = await supabase
    .from("alunas" as any)
    .upsert(row as any, { onConflict: "id" });
  if (error) {
    if ((error as any).code === "23505") {
      throw new Error("Já existe aluna com esse nome. Use a Gestão de Alunas para atualizar.");
    }
    throw error;
  }
}

export async function deleteAlunaDb(id: string): Promise<void> {
  const { error } = await supabase
    .from("alunas" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function importAlunasDb(alunas: Aluna[], userId: string): Promise<void> {
  const rows = alunas.map((a) => toDbRow(a, userId));
  const { error } = await supabase
    .from("alunas" as any)
    .insert(rows as any);
  if (error) throw error;
}
