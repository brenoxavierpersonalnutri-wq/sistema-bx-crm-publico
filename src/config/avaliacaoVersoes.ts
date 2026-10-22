// Versões de teste da captação da avaliação: /avaliacao/v1 .. /avaliacao/v6.
// Pedido do Breno (13/10/2026): cada versão troca SÓ o título (H1) e a foto do
// meio; a v6 fica sem foto. Todo o resto (selo de vagas, botão, linha de baixo,
// quiz, pixel, "Quem sou eu", resultados) é o da /avaliacao, que continua
// intacta como controle — ela é pra onde os anúncios apontam.
//
// A base de copy de todas é a variação padrão da /avaliacao (v1 do ?v=). Esta
// lista NÃO tem relação com o ?v=v1..v5 de novaavVariations.
import resultado1 from "@/assets/novaav/resultado-1.jpg";
import resultado2 from "@/assets/novaav/resultado-2.jpg";
import resultado3 from "@/assets/novaav/resultado-3.jpg";
import resultado4 from "@/assets/novaav/resultado-4.jpg";
import brenoQuemSouEu from "@/assets/novaav/breno-quem-sou-eu.jpg";

export type AvaliacaoVersaoKey = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

export type AvaliacaoVersao = {
  key: AvaliacaoVersaoKey;
  /** Vai no parâmetro `versao` do Lead / Lead_qualificado e no `origem` da resposta. */
  rotulo: `avaliacao-${AvaliacaoVersaoKey}`;
  /** Parte branca do título. */
  headlineBefore: string;
  /** Trecho final, em amarelo (como na /avaliacao). */
  headlineHighlight: string;
  /** Foto do meio; null = sem foto (título maior pra segurar o topo). */
  photo: string | null;
};

export const AVALIACAO_VERSOES: readonly AvaliacaoVersao[] = [
  {
    key: "v1",
    rotulo: "avaliacao-v1",
    headlineBefore: "TODO MUNDO TE ACHA MAGRA. ",
    headlineHighlight: "SÓ VOCÊ SABE O QUE INCOMODA",
    photo: resultado1,
  },
  {
    key: "v2",
    rotulo: "avaliacao-v2",
    headlineBefore: "AQUELA GORDURINHA DO SUTIÃ QUE NINGUÉM CONSEGUE TIRAR ",
    headlineHighlight: "TEM EXPLICAÇÃO",
    photo: resultado3,
  },
  {
    key: "v3",
    rotulo: "avaliacao-v3",
    headlineBefore: "MAGRA VOCÊ JÁ É. ",
    headlineHighlight: "AGORA É SECAR E DEFINIR",
    photo: resultado2,
  },
  {
    key: "v4",
    rotulo: "avaliacao-v4",
    headlineBefore: "MAIS DE 800 MULHERES JÁ SECARAM A BARRIGA ",
    headlineHighlight: "COM PEQUENOS AJUSTES",
    photo: resultado4,
  },
  {
    key: "v5",
    rotulo: "avaliacao-v5",
    headlineBefore: "JUNTEI EDUCAÇÃO FÍSICA E NUTRIÇÃO NUM MÉTODO ",
    headlineHighlight: "SÓ PRA FALSA MAGRA",
    photo: brenoQuemSouEu,
  },
  {
    key: "v6",
    rotulo: "avaliacao-v6",
    headlineBefore: "SE VOCÊ PARECE MAGRA E A GORDURA LOCALIZADA NÃO SAI, ",
    headlineHighlight: "O PROBLEMA NUNCA FOI O PESO",
    photo: null,
  },
];

export function avaliacaoVersao(key: string | undefined): AvaliacaoVersao | undefined {
  if (!key) return undefined;
  const k = key.toLowerCase();
  return AVALIACAO_VERSOES.find((v) => v.key === k);
}
