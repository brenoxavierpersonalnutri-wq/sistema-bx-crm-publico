// Anamnese inicial da aluna — o que era o Google Forms "ANAMNESE INICIAL -
// SHAPE SLIM DEFINIDO (TIME BRENO XAVIER)", agora dentro do sistema.
//
// As perguntas e as opções são as do formulário original, na mesma ordem e com
// o mesmo texto. Mudar aqui muda a tela da aluna e a ficha que o time lê.

import { linkPublico } from "@/lib/linkPublico";

export interface AnamneseResposta {
  id?: string;
  aluna_id?: string;
  token?: string;
  status?: "pendente" | "respondida";
  respondida_em?: string | null;
  created_at?: string;

  // Seção 1 — quem é ela
  nome_completo?: string;
  instagram?: string;
  treina_onde?: string;
  data_nascimento?: string;
  profissao?: string;
  peso_altura?: string;
  restricao_medica?: string;
  ansiedade?: string;
  horas_trabalho?: string;
  esforco_diario?: string;
  horas_sono?: string;
  qualidade_sono?: string;
  intestino?: string;
  objetivo_atingido?: string;
  tres_incomodos?: string;
  modelo_corpo?: string;
  historico_corpo?: string;

  // Seção 2 — treino
  dores?: string;
  treina_musculacao?: string;
  /** Preenchido só quando ela marca "Outro" em treina_musculacao. */
  treina_musculacao_outro?: string;
  dias_disponiveis?: string; // múltipla escolha, separada por vírgula
  tempo_sessao?: string;
  outro_exercicio?: string;
  comentario_treino?: string;

  // Seção 3 — alimentação
  acompanhamento_nutricional?: string;
  restricao_alimentar?: string;
  define_alimentacao?: string;
  bebida_alcoolica?: string;
  fuma?: string;
  ingestao_doces?: string;
  dificuldade_alimentacao?: string;
  leva_refeicoes?: string;
  historico_cardiovascular?: string;
  refeicoes_dia?: number;
  suplemento?: string;
  medicacao?: string;
  desconta_estresse?: string;
  pronta_mudanca?: number;
  capaz_mudanca?: number;
  suporte_ambiente?: number;
  rotina_alimentar?: string;
  aceite?: boolean;
}

export const ANAMNESE_SECOES = ["Você", "Treino", "Alimentação"] as const;

export const TREINA_ONDE = [
  { value: "academia", label: "Academia" },
  { value: "casa", label: "Casa" },
] as const;

export const ANSIEDADE = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
] as const;

export const HORAS_TRABALHO = [
  { value: "ate_4", label: "Até 4 horas" },
  { value: "4_8", label: "4 a 8 horas" },
  { value: "8_12", label: "8 a 12 horas" },
  { value: "12_mais", label: "Mais de 12 horas" },
] as const;

export const ESFORCO_DIARIO = [
  { value: "nenhum", label: "Nenhum esforço" },
  { value: "pouco", label: "Pouco esforço" },
  { value: "medio", label: "Médio esforço" },
  { value: "alto", label: "Alto esforço" },
  { value: "exaustivo", label: "Exaustivo esforço" },
] as const;

export const HORAS_SONO = [
  { value: "0_3", label: "0 a 3 horas" },
  { value: "3_5", label: "3 a 5 horas" },
  { value: "5_7", label: "5 horas a 7 horas" },
  { value: "7_mais", label: "Mais de 7 horas" },
] as const;

export const QUALIDADE_SONO = [
  { value: "perfeito", label: "Perfeito, acordo todos os dias bem descansada" },
  { value: "media", label: "Média, alguns dias acordo bem, outros não" },
  { value: "ruim", label: "Ruim, mais noites ruins do que boas" },
  { value: "terrivel", label: "Terrível, nunca tenho uma boa noite de sono" },
] as const;

export const INTESTINO_ANAMNESE = [
  { value: "nao_todo_dia", label: "Não vou todo dia" },
  { value: "dia_sim_dia_nao", label: "Dia sim, dia não" },
  { value: "1x_pouco", label: "1x ao dia, mas sai pouco" },
  { value: "1x_boa", label: "1x ao dia e sai uma boa quantidade" },
  { value: "2x", label: "2x ao dia, meu intestino funciona muito bem" },
] as const;

export const TREINA_MUSCULACAO = [
  { value: "nao", label: "Não" },
  { value: "menos_6m", label: "Sim, menos de 6 meses" },
  { value: "mais_6m", label: "Sim, mais de 6 meses" },
  { value: "mais_2a", label: "Sim, mais de 2 anos" },
  { value: "outro", label: "Outro" },
] as const;

export const DIAS_DISPONIVEIS = [
  { value: "2x", label: "2x na semana" },
  { value: "3x", label: "3x na semana" },
  { value: "4x", label: "4x na semana" },
  { value: "5x", label: "5x na semana" },
  { value: "6x", label: "6x na semana" },
  { value: "todos", label: "Todos os dias" },
] as const;

export const TEMPO_SESSAO = [
  { value: "20_30", label: "20 a 30 minutos por dia" },
  { value: "30_50", label: "30 a 50 minutos por dia" },
  { value: "50_90", label: "50 a 90 minutos por dia" },
  { value: "90_mais", label: "Mais de 1h e 30 minutos por dia" },
] as const;

export const DEFINE_ALIMENTACAO = [
  { value: "excelente", label: "Excelente" },
  { value: "boa", label: "Boa" },
  { value: "normal", label: "Normal" },
  { value: "ruim", label: "Ruim" },
  { value: "pessima", label: "Péssima" },
] as const;

export const BEBIDA_ALCOOLICA = [
  { value: "nao", label: "Não" },
  { value: "eventualmente", label: "Eventualmente" },
  { value: "fim_de_semana", label: "Finais de semana" },
  { value: "diariamente", label: "Diariamente" },
] as const;

export const FUMA = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "parei", label: "Fumava, mas parei" },
] as const;

export const INGESTAO_DOCES = [
  { value: "raramente", label: "Raramente" },
  { value: "eventualmente", label: "Eventualmente" },
  { value: "diariamente", label: "Diariamente" },
] as const;

export const SIM_NAO = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
] as const;

export const DESCONTA_ESTRESSE = [
  { value: "sim", label: "Sim" },
  { value: "as_vezes", label: "Às vezes" },
  { value: "nunca", label: "Nunca" },
] as const;

export const REFEICOES_DIA = [1, 2, 3, 4, 5, 6] as const;

export const ROTINA_ALIMENTAR_EXEMPLO =
  "Ex.: café da manhã 08h, 1 pão francês, 1 pedaço de queijo e 1 fruta. Almoço 12h, 1 colher cheia de arroz, 1 concha de feijão, 2 bifes médios de frango e um bombom de sobremesa. Coloca tudo, e se você tem costume de beliscar, coloca também. O teu resultado depende disso.";

export const AVISO_CARGAS =
  "Você realiza agachamento, levantamento terra, afundo ou stiff com mais de 40kg? Se sim, manda os vídeos da tua execução pelo e-mail de contato.";

export const TERMO_FINAL =
  "Declaro para os devidos fins que as respostas prestadas aqui são verdadeiras e poderão ser utilizadas como referência. É de minha responsabilidade assistir as aulas sobre treino e alimentação, e ajustar tudo que for necessário dentro das minhas especificidades ou restrições.";

/** Rótulo legível de uma opção fechada, pro painel e pra leitura da ficha. */
export function rotuloAnamnese(
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  valor?: string | null,
): string | null {
  if (!valor) return null;
  return opcoes.find((o) => o.value === valor)?.label ?? valor;
}

/** Múltipla escolha guardada em uma coluna só, separada por vírgula. */
export function rotulosAnamnese(
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  valor?: string | null,
): string | null {
  const lista = (valor ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (lista.length === 0) return null;
  return lista.map((v) => opcoes.find((o) => o.value === v)?.label ?? v).join(", ");
}

/**
 * A mensagem de boas-vindas que o Breno manda quando a aluna entra. É o texto
 * dele; o link da anamnese no item 4, que antes era um Google Forms fixo, agora
 * é o link da própria aluna. Os `*asteriscos*` são o negrito do WhatsApp, e a
 * mensagem não leva emoji: os keycaps (1..4) e o emoji com tom de pele chegavam
 * quebrados como "?" em parte dos aparelhos.
 */
export function mensagemBoasVindas(linkAnamnese: string): string {
  return `Que bom que você iniciou, fico realmente muitoooo feliz!!! Vou te mandar um vídeo que gravei aqui para mostrar onde você vai achar tudo, ok?

Vamos para o passo a passo:

*1.* No seu e-mail chegou uma mensagem da plataforma *PagTrust*.
Lá você vai encontrar o *Módulo de Avaliações* e os *Pilares da Fundação Slim e Definida* (4 vídeos curtos que vou te ensinar o que é um treino intenso e com qualidade de movimento)

*2.* Cadastre-se aqui por favor no *APP MFIT PERSONAL* para que eu possa liberar TUDO para você!! (PS: O acesso só vai ser liberado dentro do aplicativo para você, quando eu terminar de prescrever tudo para você, combinado?)
https://client.mfitpersonal.com.br/out/signup-link/NzI0NTk=

*3. TODO CONTATO A PARTIR DE AGORA TEM QUE SER APENAS NESSE NÚMERO, OK?* QUALQUER DÚVIDA SOBRE CONSULTORIA, QUALQUER EVENTUALIDADE QUE TIVER, FAVOR CHAMAR NESSE NÚMERO

*4.* Vou te mandar o *link da anamnese* por aqui, para facilitar, pode ser?
${linkAnamnese}

*VAMOS JUNTOS!!* Após o envio, peço até *3 dias úteis* para a liberação de tudo, combinado?

*SEJA BEM-VINDA AO TIME!!!*
Estou ansioso pelo seu resultado!`;
}

/** O link que a aluna recebe, a partir do token gerado. */
export function linkAnamnese(token: string): string {
  return linkPublico(`/anamnese/${token}`);
}
