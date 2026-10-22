import { supabase } from "@/integrations/supabase/client";
import type {
  Exercicio, TreinoFase, TreinoDia, TreinoExercicio, FaseCompleta,
  AlunaPlano, AlunaPlanoFase, AlunaAcesso, AlunaDieta, FeedbackCiclo,
  FeedbackResposta, TreinoLog, PerfilAluna, Periodicidade,
} from "./types";

// O types.ts do Supabase é gerado e ainda não conhece as tabelas desta camada.
// Até ser regerado, as linhas chegam sem tipo — os dois `any` abaixo concentram
// essa exceção num lugar só, e os mapeadores devolvem tipos concretos daqui
// para a frente.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type LinhaDb = Record<string, any>;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const db = supabase as any;

// ---------------------------------------------------------------- exercícios

const toExercicio = (r: LinhaDb): Exercicio => ({
  id: r.id,
  nome: r.nome,
  grupoMuscular: r.grupo_muscular,
  equipamento: r.equipamento,
  youtubeUrl: r.youtube_url,
  youtubeId: r.youtube_id,
  thumbnailUrl: r.thumbnail_url,
  instrucoes: r.instrucoes,
  nivel: r.nivel,
  tags: r.tags ?? [],
  ativo: r.ativo,
});

export async function fetchExercicios(incluirInativos = false): Promise<Exercicio[]> {
  let q = db.from("exercicios").select("*").order("nome");
  if (!incluirInativos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toExercicio);
}

export async function upsertExercicio(ex: Partial<Exercicio> & { nome: string }): Promise<Exercicio> {
  const row: Record<string, unknown> = {
    nome: ex.nome,
    grupo_muscular: ex.grupoMuscular ?? "outro",
    equipamento: ex.equipamento ?? null,
    youtube_url: ex.youtubeUrl ?? null,
    instrucoes: ex.instrucoes ?? null,
    nivel: ex.nivel ?? "todos",
    tags: ex.tags ?? [],
    ativo: ex.ativo ?? true,
  };
  if (ex.id) row.id = ex.id;

  const { data, error } = await db.from("exercicios").upsert(row, { onConflict: "id" }).select().single();
  if (error) throw error;
  return toExercicio(data);
}

export async function removerExercicio(id: string): Promise<void> {
  // Soft delete: o exercício pode estar prescrito em fases antigas.
  const { error } = await db.from("exercicios").update({ ativo: false }).eq("id", id);
  if (error) throw error;
}

// --------------------------------------------------------------------- fases

const toFase = (r: LinhaDb): TreinoFase => ({
  id: r.id,
  nome: r.nome,
  ordem: r.ordem,
  objetivo: r.objetivo,
  descricao: r.descricao,
  duracaoSemanas: r.duracao_semanas,
  nivel: r.nivel,
  cor: r.cor,
  ativo: r.ativo,
});

const toDia = (r: LinhaDb): TreinoDia => ({
  id: r.id,
  faseId: r.fase_id,
  nome: r.nome,
  ordem: r.ordem,
  foco: r.foco,
  observacao: r.observacao,
});

const toTreinoExercicio = (r: LinhaDb): TreinoExercicio => ({
  id: r.id,
  diaId: r.dia_id,
  exercicioId: r.exercicio_id,
  ordem: r.ordem,
  series: r.series,
  repeticoes: r.repeticoes,
  cargaSugerida: r.carga_sugerida,
  cadencia: r.cadencia,
  descansoSeg: r.descanso_seg,
  metodoAvancado: r.metodo_avancado,
  observacao: r.observacao,
  agrupamento: r.agrupamento,
  exercicio: r.exercicios ? toExercicio(r.exercicios) : undefined,
});

export async function fetchFases(incluirInativas = false): Promise<TreinoFase[]> {
  let q = db.from("treino_fases").select("*").order("ordem");
  if (!incluirInativas) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toFase);
}

/** Fase com dias e prescrição aninhados, na ordem certa. */
export async function fetchFaseCompleta(faseId: string): Promise<FaseCompleta | null> {
  const { data: faseRow, error: faseErr } = await db
    .from("treino_fases").select("*").eq("id", faseId).maybeSingle();
  if (faseErr) throw faseErr;
  if (!faseRow) return null;

  const { data: diasRows, error: diasErr } = await db
    .from("treino_dias").select("*").eq("fase_id", faseId).order("ordem");
  if (diasErr) throw diasErr;

  const dias = (diasRows ?? []).map(toDia);
  if (dias.length === 0) return { ...toFase(faseRow), dias: [] };

  const { data: exRows, error: exErr } = await db
    .from("treino_exercicios")
    .select("*, exercicios(*)")
    .in("dia_id", dias.map((d) => d.id))
    .order("ordem");
  if (exErr) throw exErr;

  const prescricoes = (exRows ?? []).map(toTreinoExercicio);
  return {
    ...toFase(faseRow),
    dias: dias.map((d) => ({
      ...d,
      exercicios: prescricoes.filter((p) => p.diaId === d.id),
    })),
  };
}

export async function upsertFase(fase: Partial<TreinoFase> & { nome: string }): Promise<TreinoFase> {
  const row: Record<string, unknown> = {
    nome: fase.nome,
    ordem: fase.ordem ?? 1,
    objetivo: fase.objetivo ?? null,
    descricao: fase.descricao ?? null,
    duracao_semanas: fase.duracaoSemanas ?? 4,
    nivel: fase.nivel ?? "todos",
    cor: fase.cor ?? null,
    ativo: fase.ativo ?? true,
  };
  if (fase.id) row.id = fase.id;

  const { data, error } = await db.from("treino_fases").upsert(row, { onConflict: "id" }).select().single();
  if (error) throw error;
  return toFase(data);
}

export async function removerFase(id: string): Promise<void> {
  const { error } = await db.from("treino_fases").delete().eq("id", id);
  if (error) throw error;
}

/** Copia a fase inteira (dias + prescrição) via RPC. */
export async function duplicarFase(faseId: string, novoNome?: string): Promise<string> {
  const { data, error } = await db.rpc("duplicar_fase", {
    _fase_id: faseId,
    _novo_nome: novoNome ?? null,
  });
  if (error) throw error;
  return data as string;
}

// ---------------------------------------------------------------------- dias

export async function upsertDia(dia: Partial<TreinoDia> & { faseId: string; nome: string }): Promise<TreinoDia> {
  const row: Record<string, unknown> = {
    fase_id: dia.faseId,
    nome: dia.nome,
    ordem: dia.ordem ?? 1,
    foco: dia.foco ?? null,
    observacao: dia.observacao ?? null,
  };
  if (dia.id) row.id = dia.id;

  const { data, error } = await db.from("treino_dias").upsert(row, { onConflict: "id" }).select().single();
  if (error) throw error;
  return toDia(data);
}

export async function removerDia(id: string): Promise<void> {
  const { error } = await db.from("treino_dias").delete().eq("id", id);
  if (error) throw error;
}

// --------------------------------------------------------------- prescrição

export async function upsertTreinoExercicio(
  te: Partial<TreinoExercicio> & { diaId: string; exercicioId: string },
): Promise<void> {
  const row: Record<string, unknown> = {
    dia_id: te.diaId,
    exercicio_id: te.exercicioId,
    ordem: te.ordem ?? 1,
    series: te.series ?? 3,
    repeticoes: te.repeticoes ?? "12",
    carga_sugerida: te.cargaSugerida ?? null,
    cadencia: te.cadencia ?? null,
    descanso_seg: te.descansoSeg ?? null,
    metodo_avancado: te.metodoAvancado ?? null,
    observacao: te.observacao ?? null,
    agrupamento: te.agrupamento ?? null,
  };
  if (te.id) row.id = te.id;

  const { error } = await db.from("treino_exercicios").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function removerTreinoExercicio(id: string): Promise<void> {
  const { error } = await db.from("treino_exercicios").delete().eq("id", id);
  if (error) throw error;
}

/** Grava a nova ordem depois de arrastar os exercícios na lista. */
export async function reordenarTreinoExercicios(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => db.from("treino_exercicios").update({ ordem: i + 1 }).eq("id", id)),
  );
}

// --------------------------------------------------------- plano da aluna

const toPlano = (r: LinhaDb): AlunaPlano => ({
  id: r.id,
  alunaId: r.aluna_id,
  nome: r.nome,
  dataInicio: r.data_inicio,
  intervaloDias: r.intervalo_dias,
  autoAvancar: r.auto_avancar,
  status: r.status,
  observacao: r.observacao,
});

const toPlanoFase = (r: LinhaDb): AlunaPlanoFase => ({
  id: r.id,
  planoId: r.plano_id,
  faseId: r.fase_id,
  ordem: r.ordem,
  dataLiberacao: r.data_liberacao,
  concluidaEm: r.concluida_em,
  observacao: r.observacao,
  fase: r.treino_fases ? toFase(r.treino_fases) : undefined,
});

export async function fetchPlanoAtivo(alunaId: string): Promise<AlunaPlano | null> {
  const { data, error } = await db
    .from("aluna_planos").select("*")
    .eq("aluna_id", alunaId).eq("status", "ativo")
    .maybeSingle();
  if (error) throw error;
  return data ? toPlano(data) : null;
}

export async function fetchPlanoFases(planoId: string): Promise<AlunaPlanoFase[]> {
  const { data, error } = await db
    .from("aluna_plano_fases")
    .select("*, treino_fases(*)")
    .eq("plano_id", planoId)
    .order("ordem");
  if (error) throw error;
  return (data ?? []).map(toPlanoFase);
}

/**
 * Enfileira as fases escolhidas para a aluna, liberando uma a cada
 * `intervaloDias`. Arquiva o plano ativo anterior. Retorna o id do novo plano.
 */
export async function atribuirFases(params: {
  alunaId: string;
  faseIds: string[];
  dataInicio: string;
  intervaloDias?: number;
  nome?: string;
}): Promise<string> {
  const { data, error } = await db.rpc("atribuir_fases_para_aluna", {
    _aluna_id: params.alunaId,
    _fase_ids: params.faseIds,
    _data_inicio: params.dataInicio,
    _intervalo_dias: params.intervaloDias ?? 30,
    _nome: params.nome ?? "Plano de treino",
  });
  if (error) throw error;
  return data as string;
}

/** Antecipa ou adia a abertura de uma fase específica. */
export async function ajustarLiberacaoFase(planoFaseId: string, data: string): Promise<void> {
  const { error } = await db
    .from("aluna_plano_fases").update({ data_liberacao: data }).eq("id", planoFaseId);
  if (error) throw error;
}

// -------------------------------------------------------- acesso ao app

const toAcesso = (r: LinhaDb): AlunaAcesso => ({
  id: r.id,
  alunaId: r.aluna_id,
  userId: r.user_id,
  email: r.email,
  conviteToken: r.convite_token,
  ativo: r.ativo,
  ultimoAcesso: r.ultimo_acesso,
});

export async function fetchAcessos(): Promise<AlunaAcesso[]> {
  const { data, error } = await db.from("aluna_acessos").select("*");
  if (error) throw error;
  return (data ?? []).map(toAcesso);
}

export async function fetchAcessoDaAluna(alunaId: string): Promise<AlunaAcesso | null> {
  const { data, error } = await db
    .from("aluna_acessos").select("*").eq("aluna_id", alunaId).maybeSingle();
  if (error) throw error;
  return data ? toAcesso(data) : null;
}

export async function liberarAcesso(alunaId: string, email: string): Promise<AlunaAcesso> {
  const { data, error } = await db
    .from("aluna_acessos")
    .upsert({ aluna_id: alunaId, email: email.trim().toLowerCase(), ativo: true }, { onConflict: "aluna_id" })
    .select().single();
  if (error) throw error;
  return toAcesso(data);
}

export async function alterarAcesso(alunaId: string, ativo: boolean): Promise<void> {
  const { error } = await db.from("aluna_acessos").update({ ativo }).eq("aluna_id", alunaId);
  if (error) throw error;
}

/** Chamado logo após o login da aluna: casa o e-mail do JWT com o cadastro. */
export async function vincularMeuAcesso(): Promise<string | null> {
  const { data, error } = await db.rpc("vincular_meu_acesso");
  if (error) throw error;
  return (data as string) ?? null;
}

export async function fetchMeuPerfil(): Promise<PerfilAluna | null> {
  const { data, error } = await db.rpc("meu_perfil_aluna");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    alunaId: row.aluna_id,
    nomeCompleto: row.nome_completo,
    programa: row.programa,
    dataVencimento: row.data_vencimento,
  };
}

// ---------------------------------------------------------------- dieta

const toDieta = (r: LinhaDb): AlunaDieta => ({
  id: r.id,
  alunaId: r.aluna_id,
  titulo: r.titulo,
  tipo: r.tipo,
  arquivoPath: r.arquivo_path,
  arquivoNome: r.arquivo_nome,
  conteudo: r.conteudo,
  observacao: r.observacao,
  vigenciaInicio: r.vigencia_inicio,
  vigenciaFim: r.vigencia_fim,
  ativo: r.ativo,
});

export async function fetchDietas(alunaId: string): Promise<AlunaDieta[]> {
  const { data, error } = await db
    .from("aluna_dietas").select("*")
    .eq("aluna_id", alunaId)
    .order("vigencia_inicio", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toDieta);
}

export async function upsertDieta(d: Partial<AlunaDieta> & { alunaId: string }): Promise<AlunaDieta> {
  const row: Record<string, unknown> = {
    aluna_id: d.alunaId,
    titulo: d.titulo ?? "Plano alimentar",
    tipo: d.tipo ?? "pdf",
    arquivo_path: d.arquivoPath ?? null,
    arquivo_nome: d.arquivoNome ?? null,
    conteudo: d.conteudo ?? null,
    observacao: d.observacao ?? null,
    vigencia_inicio: d.vigenciaInicio ?? new Date().toISOString().slice(0, 10),
    vigencia_fim: d.vigenciaFim ?? null,
    ativo: d.ativo ?? true,
  };
  if (d.id) row.id = d.id;

  const { data, error } = await db.from("aluna_dietas").upsert(row, { onConflict: "id" }).select().single();
  if (error) throw error;
  return toDieta(data);
}

export async function removerDieta(id: string): Promise<void> {
  const { error } = await db.from("aluna_dietas").delete().eq("id", id);
  if (error) throw error;
}

/** Sobe o PDF no bucket privado. O caminho começa com o id da aluna — é assim
 *  que a policy de storage identifica a dona do arquivo. */
export async function uploadDietaPdf(alunaId: string, file: File): Promise<{ path: string; nome: string }> {
  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `${alunaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("dietas").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/pdf",
  });
  if (error) throw error;
  return { path, nome: file.name };
}

/** Bucket é privado: o acesso sai por URL assinada de curta duração. */
export async function urlAssinadaDieta(path: string, segundos = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from("dietas").createSignedUrl(path, segundos);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ------------------------------------------------------------- feedback

const toCiclo = (r: LinhaDb): FeedbackCiclo => ({
  id: r.id,
  alunaId: r.aluna_id,
  periodicidade: r.periodicidade,
  diaSemana: r.dia_semana,
  proximaData: r.proxima_data,
  ativo: r.ativo,
});

const toFeedback = (r: LinhaDb): FeedbackResposta => ({
  id: r.id,
  alunaId: r.aluna_id,
  dataReferencia: r.data_referencia,
  peso: r.peso,
  medidas: r.medidas ?? {},
  adesaoDieta: r.adesao_dieta,
  adesaoTreino: r.adesao_treino,
  energia: r.energia,
  sono: r.sono,
  intestino: r.intestino,
  cicloMenstrual: r.ciclo_menstrual,
  dificuldades: r.dificuldades,
  observacao: r.observacao,
  fotos: r.fotos ?? [],
  status: r.status,
  respostaTime: r.resposta_time,
  respondidoEm: r.respondido_em,
});

export async function fetchCiclo(alunaId: string): Promise<FeedbackCiclo | null> {
  const { data, error } = await db
    .from("feedback_ciclos").select("*").eq("aluna_id", alunaId).maybeSingle();
  if (error) throw error;
  return data ? toCiclo(data) : null;
}

export async function salvarCiclo(c: {
  alunaId: string;
  periodicidade: Periodicidade;
  diaSemana?: number;
  proximaData: string;
  ativo?: boolean;
}): Promise<void> {
  const { error } = await db.from("feedback_ciclos").upsert(
    {
      aluna_id: c.alunaId,
      periodicidade: c.periodicidade,
      dia_semana: c.diaSemana ?? 1,
      proxima_data: c.proximaData,
      ativo: c.ativo ?? true,
    },
    { onConflict: "aluna_id" },
  );
  if (error) throw error;
}

export async function fetchFeedbacks(alunaId?: string): Promise<FeedbackResposta[]> {
  let q = db.from("feedback_respostas").select("*").order("data_referencia", { ascending: false });
  if (alunaId) q = q.eq("aluna_id", alunaId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toFeedback);
}

export async function enviarFeedback(f: Partial<FeedbackResposta> & { alunaId: string }): Promise<void> {
  const row: Record<string, unknown> = {
    aluna_id: f.alunaId,
    data_referencia: f.dataReferencia ?? new Date().toISOString().slice(0, 10),
    peso: f.peso ?? null,
    medidas: f.medidas ?? {},
    adesao_dieta: f.adesaoDieta ?? null,
    adesao_treino: f.adesaoTreino ?? null,
    energia: f.energia ?? null,
    sono: f.sono ?? null,
    intestino: f.intestino ?? null,
    ciclo_menstrual: f.cicloMenstrual ?? null,
    dificuldades: f.dificuldades ?? null,
    observacao: f.observacao ?? null,
    fotos: f.fotos ?? [],
    status: "respondido",
  };
  const { error } = await db
    .from("feedback_respostas")
    .upsert(row, { onConflict: "aluna_id,data_referencia" });
  if (error) throw error;
}

/** Resposta do time ao feedback — só o time consegue gravar (RLS). */
export async function responderFeedback(id: string, texto: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await db
    .from("feedback_respostas")
    .update({
      resposta_time: texto,
      respondido_em: new Date().toISOString(),
      respondido_por: userData?.user?.id ?? null,
      status: "revisado",
    })
    .eq("id", id);
  if (error) throw error;
}

export async function uploadFotoFeedback(alunaId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${alunaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("feedback-fotos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

export async function urlAssinadaFoto(path: string, segundos = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from("feedback-fotos").createSignedUrl(path, segundos);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ------------------------------------------------------- log de treino

const toLog = (r: LinhaDb): TreinoLog => ({
  id: r.id,
  alunaId: r.aluna_id,
  planoFaseId: r.plano_fase_id,
  diaId: r.dia_id,
  data: r.data,
  concluido: r.concluido,
  duracaoMin: r.duracao_min,
  intensidade: r.intensidade,
  observacao: r.observacao,
});

export async function fetchLogs(alunaId: string, limite = 120): Promise<TreinoLog[]> {
  const { data, error } = await db
    .from("aluna_treino_logs").select("*")
    .eq("aluna_id", alunaId)
    .order("data", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []).map(toLog);
}

export async function registrarTreino(log: {
  alunaId: string;
  diaId: string;
  planoFaseId?: string | null;
  data?: string;
  duracaoMin?: number | null;
  intensidade?: number | null;
  observacao?: string | null;
}): Promise<void> {
  const { error } = await db.from("aluna_treino_logs").upsert(
    {
      aluna_id: log.alunaId,
      dia_id: log.diaId,
      plano_fase_id: log.planoFaseId ?? null,
      data: log.data ?? new Date().toISOString().slice(0, 10),
      concluido: true,
      duracao_min: log.duracaoMin ?? null,
      intensidade: log.intensidade ?? null,
      observacao: log.observacao ?? null,
    },
    { onConflict: "aluna_id,dia_id,data" },
  );
  if (error) throw error;
}

export async function desfazerTreino(alunaId: string, diaId: string, data: string): Promise<void> {
  const { error } = await db
    .from("aluna_treino_logs").delete()
    .eq("aluna_id", alunaId).eq("dia_id", diaId).eq("data", data);
  if (error) throw error;
}

// ------------------------------------------------- visão do app da aluna

/**
 * O que a aluna vê ao abrir o app: a fase corrente já montada.
 * A RLS só devolve as fases cuja data de liberação chegou, então a fase
 * atual é simplesmente a última da fila visível.
 */
export async function fetchMeuTreinoAtual(): Promise<{
  plano: AlunaPlano | null;
  fases: AlunaPlanoFase[];
  faseAtual: FaseCompleta | null;
  planoFaseAtualId: string | null;
}> {
  const { data: planos, error: planoErr } = await db
    .from("aluna_planos").select("*").eq("status", "ativo").limit(1);
  if (planoErr) throw planoErr;

  const plano = planos?.[0] ? toPlano(planos[0]) : null;
  if (!plano) return { plano: null, fases: [], faseAtual: null, planoFaseAtualId: null };

  const fases = await fetchPlanoFases(plano.id);
  const atual = fases[fases.length - 1] ?? null;
  if (!atual) return { plano, fases, faseAtual: null, planoFaseAtualId: null };

  const faseAtual = await fetchFaseCompleta(atual.faseId);
  return { plano, fases, faseAtual, planoFaseAtualId: atual.id };
}

/** Dieta vigente hoje. */
export async function fetchMinhaDieta(alunaId: string): Promise<AlunaDieta | null> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("aluna_dietas").select("*")
    .eq("aluna_id", alunaId)
    .eq("ativo", true)
    .lte("vigencia_inicio", hoje)
    .order("vigencia_inicio", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  const dieta = toDieta(row);
  // Vencida? Então não há dieta vigente.
  if (dieta.vigenciaFim && dieta.vigenciaFim < hoje) return null;
  return dieta;
}
