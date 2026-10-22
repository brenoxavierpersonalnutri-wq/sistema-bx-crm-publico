// Contrato da API mobile-v1 — o mesmo formato que a Edge Function devolve.
// Copie esta pasta inteira para o projeto React Native.

export type Plataforma = "ios" | "android" | "web";

export interface Perfil {
  aluna_id: string;
  nome: string;
  primeiro_nome: string;
  programa: string;
  vence_em: string;
}

export interface ConfigApp {
  /** true quando a versão instalada é menor que a mínima suportada.
   *  O app deve bloquear a navegação e mandar para a loja. */
  atualizacao_obrigatoria: boolean;
  versao_minima?: string | null;
  url_loja?: string | null;
  manutencao: boolean;
  manutencao_mensagem?: string | null;
  aviso?: { titulo: string; corpo: string } | null;
}

export interface Video {
  youtube_id: string;
  /** Pronto para <WebView> ou react-native-youtube-iframe */
  embed_url: string;
  thumbnail_url: string;
}

export interface ExercicioPrescrito {
  id: string;
  ordem: number;
  nome: string;
  equipamento: string | null;
  grupo_muscular: string | null;
  instrucoes: string | null;
  video: Video | null;
  series: number;
  repeticoes: string;
  carga_sugerida: string | null;
  /** Ex.: "3-0-1-0" — excêntrica, pausa embaixo, concêntrica, pausa em cima */
  cadencia: string | null;
  descanso_seg: number | null;
  /** drop-set, bi-set, rest-pause… */
  metodo_avancado: string | null;
  observacao: string | null;
  /** Exercícios seguidos com a mesma letra formam bi-set / tri-set */
  agrupamento: string | null;
}

export interface DiaDeTreino {
  id: string;
  nome: string;
  foco: string | null;
  observacao: string | null;
  feito_hoje: boolean;
  exercicios: ExercicioPrescrito[];
}

export interface Treino {
  plano_fase_id: string;
  fase: {
    id: string;
    nome: string;
    ordem: number;
    objetivo: string | null;
    duracao_semanas: number;
    liberada_em: string;
  };
  total_fases_liberadas: number;
  dias: DiaDeTreino[];
}

export interface Dieta {
  id: string;
  titulo: string;
  tipo: "pdf" | "texto";
  conteudo: string | null;
  observacao: string | null;
  /** URL assinada, válida por 1 hora. Rebusque ao reabrir a tela. */
  arquivo_url: string | null;
  arquivo_nome: string | null;
  arquivo_expira_em: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}

export interface CicloFeedback {
  periodicidade: "semanal" | "quinzenal" | "mensal";
  proxima_data: string;
  ativo: boolean;
}

export interface RespostaFeedback {
  id: string;
  data: string;
  peso: number | null;
  adesao_dieta: number | null;
  adesao_treino: number | null;
  energia: number | null;
  sono: number | null;
  intestino: string | null;
  dificuldades: string | null;
  observacao: string | null;
  resposta_time: string | null;
  respondido_em: string | null;
}

export interface Notificacao {
  id: string;
  tipo: "fase_liberada" | "feedback_respondido" | "dieta_nova" | string;
  titulo: string;
  corpo: string;
  /** { rota: "treino" | "dieta" | "feedback", ... } — use para deep link */
  dados: Record<string, unknown>;
  enviada_em: string;
  lida: boolean;
}

export interface Bootstrap {
  perfil: Perfil | null;
  config: ConfigApp;
  treino: Treino | null;
  dieta: Dieta | null;
  feedback: { ciclo: CicloFeedback | null; ja_enviei_hoje: boolean };
  notificacoes_nao_lidas: number;
  servidor_em: string;
}

export interface Evolucao {
  treinos_30_dias: number;
  serie_peso: { data: string; peso: number }[];
  treinos: { id: string; data: string; duracao_min: number | null; intensidade: number | null }[];
}

export interface EnvioFeedback {
  data?: string;
  peso?: number | string | null;
  adesao_dieta?: number | null;
  adesao_treino?: number | null;
  energia?: number | null;
  sono?: number | null;
  intestino?: string | null;
  ciclo_menstrual?: string | null;
  dificuldades?: string | null;
  observacao?: string | null;
  fotos?: string[];
}

/** Códigos que o app precisa tratar de forma específica. */
export type CodigoErro =
  | "sem_token"
  | "token_invalido"
  | "sem_acesso"
  | "manutencao"
  | "rota_desconhecida"
  | "valor_invalido"
  | "erro_interno"
  | string;

export class ErroApi extends Error {
  constructor(
    public codigo: CodigoErro,
    mensagem: string,
    public status: number,
  ) {
    super(mensagem);
    this.name = "ErroApi";
  }

  /** Sessão caiu: mande para a tela de login. */
  get precisaRelogar() {
    return this.codigo === "sem_token" || this.codigo === "token_invalido";
  }

  /** E-mail não vinculado: mostre a tela "fale com a equipe". */
  get semAcesso() {
    return this.codigo === "sem_acesso";
  }
}
