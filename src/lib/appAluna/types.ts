// Tipos da camada "app da aluna": biblioteca de exercícios, fases de treino,
// plano mensal, dieta e feedback.

export type GrupoMuscular =
  | "peito" | "costas" | "ombros" | "biceps" | "triceps"
  | "pernas" | "gluteos" | "posterior" | "panturrilha"
  | "abdomen" | "cardio" | "mobilidade" | "outro";

export const GRUPOS_MUSCULARES: { value: GrupoMuscular; label: string }[] = [
  { value: "peito", label: "Peito" },
  { value: "costas", label: "Costas" },
  { value: "ombros", label: "Ombros" },
  { value: "biceps", label: "Bíceps" },
  { value: "triceps", label: "Tríceps" },
  { value: "pernas", label: "Pernas" },
  { value: "gluteos", label: "Glúteos" },
  { value: "posterior", label: "Posterior de coxa" },
  { value: "panturrilha", label: "Panturrilha" },
  { value: "abdomen", label: "Abdômen" },
  { value: "cardio", label: "Cardio" },
  { value: "mobilidade", label: "Mobilidade" },
  { value: "outro", label: "Outro" },
];

export type Nivel = "iniciante" | "intermediario" | "avancado" | "todos";

export const NIVEIS: { value: Nivel; label: string }[] = [
  { value: "todos", label: "Todos os níveis" },
  { value: "iniciante", label: "Iniciante" },
  { value: "intermediario", label: "Intermediário" },
  { value: "avancado", label: "Avançado" },
];

// Métodos avançados que o Breno usa na prescrição
export const METODOS_AVANCADOS = [
  "drop-set",
  "bi-set",
  "tri-set",
  "rest-pause",
  "pico de contração",
  "isometria",
  "negativa",
  "pirâmide crescente",
  "pirâmide decrescente",
  "série queima",
  "cluster",
  "super-série",
] as const;

export interface Exercicio {
  id: string;
  nome: string;
  grupoMuscular: GrupoMuscular;
  equipamento?: string | null;
  youtubeUrl?: string | null;
  youtubeId?: string | null;
  thumbnailUrl?: string | null;
  instrucoes?: string | null;
  nivel: Nivel;
  tags: string[];
  ativo: boolean;
}

export interface TreinoFase {
  id: string;
  nome: string;
  ordem: number;
  objetivo?: string | null;
  descricao?: string | null;
  duracaoSemanas: number;
  nivel: Nivel;
  cor?: string | null;
  ativo: boolean;
}

export interface TreinoDia {
  id: string;
  faseId: string;
  nome: string;
  ordem: number;
  foco?: string | null;
  observacao?: string | null;
}

export interface TreinoExercicio {
  id: string;
  diaId: string;
  exercicioId: string;
  ordem: number;
  series: number;
  repeticoes: string;
  cargaSugerida?: string | null;
  cadencia?: string | null;
  descansoSeg?: number | null;
  metodoAvancado?: string | null;
  observacao?: string | null;
  /** Exercícios com a mesma letra formam bi-set / tri-set */
  agrupamento?: string | null;
  exercicio?: Exercicio;
}

/** Fase com dias e prescrição já aninhados — o formato que as telas consomem */
export interface FaseCompleta extends TreinoFase {
  dias: (TreinoDia & { exercicios: TreinoExercicio[] })[];
}

export type StatusPlano = "ativo" | "arquivado";

export interface AlunaPlano {
  id: string;
  alunaId: string;
  nome: string;
  dataInicio: string;
  intervaloDias: number;
  autoAvancar: boolean;
  status: StatusPlano;
  observacao?: string | null;
}

export interface AlunaPlanoFase {
  id: string;
  planoId: string;
  faseId: string;
  ordem: number;
  dataLiberacao: string;
  concluidaEm?: string | null;
  observacao?: string | null;
  fase?: TreinoFase;
}

export interface AlunaAcesso {
  id: string;
  alunaId: string;
  userId?: string | null;
  email: string;
  conviteToken?: string | null;
  ativo: boolean;
  ultimoAcesso?: string | null;
}

export type TipoDieta = "pdf" | "texto";

export interface AlunaDieta {
  id: string;
  alunaId: string;
  titulo: string;
  tipo: TipoDieta;
  arquivoPath?: string | null;
  arquivoNome?: string | null;
  conteudo?: string | null;
  observacao?: string | null;
  vigenciaInicio: string;
  vigenciaFim?: string | null;
  ativo: boolean;
}

export type Periodicidade = "semanal" | "quinzenal" | "mensal";

export const PERIODICIDADE_LABELS: Record<Periodicidade, string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};

export const PERIODICIDADE_DIAS: Record<Periodicidade, number> = {
  semanal: 7,
  quinzenal: 14,
  mensal: 30,
};

export interface FeedbackCiclo {
  id: string;
  alunaId: string;
  periodicidade: Periodicidade;
  diaSemana: number;
  proximaData: string;
  ativo: boolean;
}

export interface FeedbackResposta {
  id: string;
  alunaId: string;
  dataReferencia: string;
  peso?: number | null;
  medidas: Record<string, number | string>;
  adesaoDieta?: number | null;
  adesaoTreino?: number | null;
  energia?: number | null;
  sono?: number | null;
  intestino?: string | null;
  cicloMenstrual?: string | null;
  dificuldades?: string | null;
  observacao?: string | null;
  fotos: string[];
  status: "pendente" | "respondido" | "revisado";
  respostaTime?: string | null;
  respondidoEm?: string | null;
}

export interface TreinoLog {
  id: string;
  alunaId: string;
  planoFaseId?: string | null;
  diaId?: string | null;
  data: string;
  concluido: boolean;
  duracaoMin?: number | null;
  intensidade?: number | null;
  observacao?: string | null;
}

export interface PerfilAluna {
  alunaId: string;
  nomeCompleto: string;
  programa: string;
  dataVencimento: string;
}

/**
 * Extrai o ID de 11 caracteres de qualquer formato de link do YouTube.
 * Espelha o trigger `exercicio_preenche_youtube` no banco — serve para dar
 * preview imediato no formulário, antes de salvar.
 */
export function parseYoutubeId(url?: string | null): string | null {
  if (!url) return null;
  const limpo = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(limpo)) return limpo;
  const m = limpo.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function youtubeThumb(id?: string | null): string | null {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function youtubeEmbed(id?: string | null): string | null {
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1` : null;
}
