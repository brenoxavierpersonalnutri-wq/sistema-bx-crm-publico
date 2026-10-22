export type ProgramType = "consultoria_slim" | "menos_gordura" | "slim_definida" | "plataforma_magra" | "elite";
export type PaymentMethod = "pix" | "tmb" | "pagtrust" | "hotmart";
export type PlanDuration = "1" | "2" | "3" | "4" | "6" | "8" | "12";
export type OrigemLead = "instagram" | "consulta" | "desafio_14_dias" | "indicacao" | "outro";

export interface Aluna {
  id: string;
  nomeCompleto: string;
  programa: ProgramType;
  dataCompra: string;
  duracaoPlano: PlanDuration;
  dataVencimento: string;
  formaPagamento: PaymentMethod;
  pago: boolean;
  deuSinal?: boolean;
  valorSinal?: number;
  dataCobrancaSinal?: string;
  telefone?: string;
  origemLead?: OrigemLead;
  /** Ela já preencheu a anamnese e se cadastrou no MFIT. */
  anamneseMfit?: boolean;
  fotosAnamnese?: boolean;
  dataFotosAnamnese?: string;
  liberouTreinoDieta?: boolean;
  liberouFotos?: boolean;
  dataAvaliacao?: string;
  avaliacaoEnviada?: boolean;
  residuoPago?: boolean;
  status?: string;
  renovacaoRecusada?: boolean;
  /** Aluna de teste do treinamento do time (só leitura: nasce pelo botão e não muda). Fica fora de toda métrica. */
  isTeste?: boolean;
}

export const PROGRAM_LABELS: Record<ProgramType, string> = {
  consultoria_slim: "Consultoria Slim",
  menos_gordura: "MGMD",
  slim_definida: "Slim Definida",
  plataforma_magra: "Plataforma Magra e Definida",
  elite: "Elite",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: "PIX",
  tmb: "TMB",
  pagtrust: "PagTrust",
  hotmart: "Hotmart",
};

export const DURATION_LABELS: Record<PlanDuration, string> = {
  "1": "1 mês",
  "2": "2 meses",
  "3": "Trimestral",
  "4": "Quadrimestral",
  "6": "Semestral",
  "8": "8 meses",
  "12": "Anual",
};

export const ORIGEM_LABELS: Record<OrigemLead, string> = {
  instagram: "Instagram",
  consulta: "Consulta",
  desafio_14_dias: "Desafio 14 dias",
  indicacao: "Indicação",
  outro: "Outro",
};
