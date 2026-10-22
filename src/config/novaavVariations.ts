// Variações de copy do hero da captação (portado do projeto novaav / cloudflare-magic-replicator).
// Selecionável via ?v=v1..v5 na rota /avaliacao.
import antesDepoisHero from "@/assets/novaav/antes-depois-hero.jpg";
import resultado1 from "@/assets/novaav/resultado-1.jpg";

export type VariationKey = "v1" | "v2" | "v3" | "v4" | "v5";

export type Variation = {
  key: VariationKey;
  headlineBefore: string;
  headlineHighlight: string;
  headlineAfter: string;
  cta: string;
  subtitleBefore: string;
  subtitleHighlight: string;
  subtitleAfter: string;
  photo: string;
};

export const variations: Record<VariationKey, Variation> = {
  v1: {
    key: "v1",
    headlineBefore: "PARABÉNS, VOCÊ GANHOU UMA ",
    headlineHighlight: "AVALIAÇÃO 100% GRATUITA",
    headlineAfter: "",
    cta: "Quero minha avaliação gratuita",
    subtitleBefore: "Análise da sua composição atual com ",
    subtitleHighlight: "especialista em falsa magra",
    subtitleAfter: ", 100% online no seu WhatsApp.",
    photo: antesDepoisHero,
  },
  v2: {
    key: "v2",
    headlineBefore: "",
    headlineHighlight: "AVALIAÇÃO GRATUITA COM ESPECIALISTA",
    headlineAfter: " em corpo definido",
    cta: "Quero falar com o especialista",
    subtitleBefore: "Descubra em 2 minutos ",
    subtitleHighlight: "o que trava sua definição",
    subtitleAfter: " e o que precisa ajustar pra sair do lugar.",
    photo: antesDepoisHero,
  },
  v3: {
    key: "v3",
    headlineBefore: "GANHOU UM ",
    headlineHighlight: "DIAGNÓSTICO GRATUITO",
    headlineAfter: " pra falsa magra e gordura teimosa",
    cta: "Quero meu diagnóstico agora",
    subtitleBefore: "Formulário rápido + ",
    subtitleHighlight: "análise personalizada",
    subtitleAfter: " com quem entende de gordura localizada de verdade.",
    photo: antesDepoisHero,
  },
  v4: {
    key: "v4",
    headlineBefore: "SÓ ",
    headlineHighlight: "2 VAGAS HOJE",
    headlineAfter: " PRA AVALIAÇÃO GRATUITA DE DEFINIÇÃO CORPORAL",
    cta: "Quero garantir minha vaga",
    subtitleBefore: "Análise ",
    subtitleHighlight: "100% personalizada",
    subtitleAfter: " da sua composição atual e do plano pra corpo definido.",
    photo: resultado1,
  },
  v5: {
    key: "v5",
    headlineBefore: "",
    headlineHighlight: "AVALIAÇÃO GRATUITA",
    headlineAfter: " pro seu corpo definido em 90 dias",
    cta: "Quero meu mapa dos 90 dias",
    subtitleBefore: "Sem dieta burra, sem 2 horas de treino, só ",
    subtitleHighlight: "o que trava a sua definição",
    subtitleAfter: " hoje.",
    photo: resultado1,
  },
};
