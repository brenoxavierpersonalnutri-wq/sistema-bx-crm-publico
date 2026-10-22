// As 5 promessas da dobra principal do Desafio Magra e Definida.
// Só isto muda entre /desafio/v1..v5: o resto da página é idêntico, para o
// teste A/B medir a promessa e nada mais.
//
// Público: mulher de 24 a 45 anos, "falsa magra" (veste P/M, mas tem gordura
// localizada e flacidez). A promessa é definição, não emagrecimento.
// Regras de copy: acentos completos, sem travessão, sem número de quilos ou
// prazo de resultado garantido (política da Meta), oferta de 14 dias a R$29.
// v6 é a dobra da página oficial (breno-remix-showcase, HeroSection.tsx),
// copiada palavra por palavra, como controle do teste.

export type VarianteDesafio = {
  id: "v1" | "v2" | "v3" | "v4" | "v5" | "v6";
  /** Ângulo da promessa, para leitura no painel. */
  angulo: string;
  /** Primeira parte do título. */
  titulo: string;
  /** Fecho do título, em destaque (amarelo). */
  destaque: string;
  subtitulo: string;
  /** Trechos do subtítulo que vão em negrito branco (como na página oficial). */
  negritos?: readonly string[];
};

export const VARIANTES_DESAFIO: readonly VarianteDesafio[] = [
  {
    id: "v1",
    angulo: "Definir, não emagrecer",
    titulo: "Você não precisa emagrecer.",
    destaque: "Precisa definir.",
    subtitulo:
      "O Desafio Magra e Definida é um plano de 14 dias para quem veste P ou M, mas ainda se incomoda com a barriga e a flacidez. Treino para firmar e alimentação sem fome, por R$29.",
  },
  {
    id: "v2",
    angulo: "Espelho, não etiqueta",
    titulo: "Magra na roupa.",
    destaque: "Definida no espelho.",
    subtitulo:
      "Para a mulher que já veste P ou M e ainda vê gordura localizada e flacidez quando se olha sem roupa. São 14 dias de treino e alimentação guiados para deixar o corpo mais firme. Acesso por R$29.",
  },
  {
    id: "v3",
    angulo: "Sair do modo falsa magra",
    titulo: "14 dias para sair do",
    destaque: "modo falsa magra.",
    subtitulo:
      "Treino de força para ganhar firmeza e uma alimentação gostosa que sustenta o músculo, organizados dia a dia. Menos restrição, mais definição. Comece hoje por R$29.",
  },
  {
    id: "v4",
    angulo: "Cabe na rotina corrida",
    titulo: "Definição feminina que cabe na",
    destaque: "sua rotina corrida.",
    subtitulo:
      "Treinos objetivos em casa ou na academia e um cardápio sem fome, organizados para 14 dias. Para quem é magra na balança e quer um corpo mais firme. Tudo por R$29.",
  },
  {
    id: "v5",
    angulo: "Dieta não resolveu a barriga",
    titulo: "Já fez dieta e a barriga continuou?",
    destaque: "O que falta é definição.",
    subtitulo:
      "Perder peso não deixa o corpo firme. Em 14 dias você segue treino e alimentação pensados para quem já é magra, mas tem gordura localizada e flacidez. Por R$29, com a metodologia de personal e nutri.",
  },
  {
    id: "v6",
    angulo: "Página oficial (controle)",
    titulo: "DEFINIÇÃO FEMININA EM 14 DIAS",
    destaque: "É IMPOSSÍVEL?",
    subtitulo:
      "Definição feminina para mulheres reais que enfrentam gordura abdominal teimosa e flacidez, e querem resultados duradouros mesmo com rotina corrida",
    negritos: ["Definição feminina para mulheres reais", "gordura abdominal", "flacidez", "rotina corrida"],
  },
];

/** Quebra o subtítulo em trechos, marcando os que vão em negrito (na ordem em que aparecem). */
export function trechosDoSubtitulo(v: Pick<VarianteDesafio, "subtitulo" | "negritos">): Array<{ texto: string; negrito: boolean }> {
  const out: Array<{ texto: string; negrito: boolean }> = [];
  let resto = v.subtitulo;
  for (const n of v.negritos ?? []) {
    const i = resto.indexOf(n);
    if (i < 0 || !n) continue;
    if (i > 0) out.push({ texto: resto.slice(0, i), negrito: false });
    out.push({ texto: n, negrito: true });
    resto = resto.slice(i + n.length);
  }
  if (resto) out.push({ texto: resto, negrito: false });
  return out;
}

export function varianteDesafio(id: string | undefined): VarianteDesafio | null {
  if (!id) return null;
  return VARIANTES_DESAFIO.find((v) => v.id === id.toLowerCase()) ?? null;
}
