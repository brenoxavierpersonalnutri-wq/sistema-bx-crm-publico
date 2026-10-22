// Tipos e opções da Pesquisa de Satisfação (alunas Breno Xavier).

export interface PesquisaResponse {
  id?: string;
  created_at?: string;
  produto?: string; // slug do produto: "mgmd" | "elite"
  nome: string;
  tempo_programa?: string;
  plano?: string;
  satisfacao_geral?: number;
  expectativa_resultado?: number;
  surpreendeu?: string;
  decepcionou?: string;
  wpp_satisfacao?: number;
  wpp_tempo_resposta?: number;
  wpp_clareza?: number;
  wpp_frequencia?: string;
  wpp_ouvida?: string;
  wpp_melhorar?: string;
  comercial_nota?: number;
  comercial_pressao?: string;
  comercial_clareza?: string;
  comercial_melhorar?: string;
  insta_frequencia?: string;
  insta_utilidade?: number;
  insta_tipos?: string[];
  insta_ver_mais?: string;
  insta_cortar?: string;
  nps_nota?: number;
  nps_motivo?: string;
  nps_indicou?: string;
  nps_quem_fechou?: string;
  nps_depoimento?: string;
  mudaria_uma_coisa?: string;
  impede_resultado?: string;
  livre?: string;
  programa_indicacao_interesse?: string;
  programa_indicacao_nomes?: string;
  programa_indicacao_quer_contato?: boolean;
}

export const PROGRAMA_INDICACAO_INTERESSE = [
  { value: "sim", label: "Sim, tenho interesse" },
  { value: "talvez", label: "Talvez, depende" },
  { value: "nao", label: "Não tenho interesse no momento" },
] as const;

// Cada produto tem URL própria, header próprio e cor de destaque própria (mas
// o esquema visual permanece dark + dourado pra manter coesão de marca Breno).
export interface ProdutoConfig {
  slug: string;
  nome: string;
  tagline: string;
  rotulo: string; // pra exibir em filtros do dashboard
}

export const PRODUTOS: Record<"mgmd" | "elite", ProdutoConfig> = {
  mgmd: {
    slug: "mgmd",
    nome: "MGMD",
    tagline: "Menos Gordura, Mais Definição",
    rotulo: "MGMD",
  },
  elite: {
    slug: "elite",
    nome: "Consultoria de Elite",
    tagline: "Time Breno Xavier",
    rotulo: "Consultoria de Elite",
  },
};

export const PRODUTOS_LISTA: ProdutoConfig[] = [PRODUTOS.mgmd, PRODUTOS.elite];

export const TEMPO_PROGRAMA = [
  { value: "<1m", label: "Menos de 1 mês" },
  { value: "1-3m", label: "1 a 3 meses" },
  { value: "3-6m", label: "3 a 6 meses" },
  { value: "6-12m", label: "6 a 12 meses" },
  { value: "1+", label: "Mais de 1 ano" },
] as const;

// Sem "Semestral em dobro" (removido a pedido do Breno).
export const PLANOS = [
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
  { value: "nao_lembro", label: "Não lembro" },
] as const;

export const WPP_FREQUENCIA = [
  { value: "pouca", label: "Pouca" },
  { value: "boa", label: "Boa" },
  { value: "muita", label: "Muita" },
] as const;

export const WPP_OUVIDA = [
  { value: "sempre", label: "Sempre" },
  { value: "geralmente", label: "Geralmente" },
  { value: "as_vezes_nao", label: "Às vezes não" },
  { value: "raramente", label: "Raramente" },
] as const;

export const COMERCIAL_PRESSAO = [
  { value: "bem_sem_pressao", label: "Bem orientada, sem pressão" },
  { value: "bem_com_pressao", label: "Bem orientada, com pressão" },
  { value: "pouco_com_pressao", label: "Pouco orientada, com pressão" },
  { value: "mal_orientada", label: "Mal orientada" },
] as const;

export const COMERCIAL_CLAREZA = [
  { value: "sim", label: "Sim" },
  { value: "em_parte", label: "Em parte" },
  { value: "nao", label: "Não" },
] as const;

export const INSTA_FREQUENCIA = [
  { value: "todo_dia", label: "Todo dia" },
  { value: "algumas_semana", label: "Algumas vezes na semana" },
  { value: "raramente", label: "Raramente" },
  { value: "quase_nunca", label: "Quase nunca" },
  { value: "nao_sigo", label: "Não sigo" },
] as const;

export const INSTA_TIPOS = [
  "Treino",
  "Dieta",
  "Antes e depois",
  "Mindset",
  "Stories",
  "Lives",
  "Conteúdo educativo",
  "Bastidores",
] as const;

export const NPS_INDICOU = [
  { value: "sim_fechou", label: "Sim, e a pessoa fechou" },
  { value: "sim_nao_fechou", label: "Sim, mas a pessoa não fechou" },
  { value: "pretendo", label: "Ainda não, mas pretendo" },
  { value: "nao_pretendo", label: "Não pretendo" },
] as const;

export const NPS_DEPOIMENTO = [
  { value: "sim_nome", label: "Sim, com meu nome" },
  { value: "sim_anonimo", label: "Sim, mas anônimo" },
  { value: "nao", label: "Não" },
] as const;

export type NpsBucket = "promotora" | "passiva" | "detratora";

export function npsBucket(nota: number | undefined | null): NpsBucket | null {
  if (nota === undefined || nota === null) return null;
  if (nota >= 9) return "promotora";
  if (nota >= 7) return "passiva";
  return "detratora";
}

// Chave única do rascunho no localStorage (caso a aluna feche o navegador).
export const DRAFT_KEY = "pesquisa-satisfacao-draft-v1";
