// Teste de primeira dobra do Desafio Magra e Definida (21/10/2026).
// /desafio/v7, v8 e v9 usam a MESMA head (a que mais vendeu nos anúncios DMD)
// e o botão de compra na primeira dobra, visível sem rolar num celular de
// 390x844. Só muda o que vem entre a head e o botão:
//   v7: subhead curta, botão e prova (alunas e prints) logo abaixo do botão;
//   v8: foto de antes e depois, depois o botão;
//   v9: 3 benefícios em lista, botão e prazo real do preço.
// Do bloco "Dores" para baixo a página é a mesma das v1..v6.
// Ids continuam no formato vN porque o marcador da venda (cm_vN_<clique>)
// e o painel /teste só reconhecem esse formato.

export type DobraId = "prova" | "antes-depois" | "beneficios";

export type VarianteDobra = {
  id: "v7" | "v8" | "v9";
  dobra: DobraId;
  /** Ângulo, para leitura no painel /teste. */
  angulo: string;
};

/**
 * Head campeã dos anúncios DMD (ver o relatório de 21/10 em
 * ~/HEAD TURBO/entregaveis/dmd-paginas-teste/). Igual nas três versões.
 */
export const HEAD_CAMPEA = {
  titulo: "Definição feminina em 14 dias",
  destaque: "é impossível?",
} as const;

export const SUBHEAD_CURTA =
  "Treino e alimentação organizados dia a dia para quem tem gordura na barriga e flacidez, mesmo com rotina corrida.";

export const BENEFICIOS_DOBRA = [
  { forte: "Plano de 14 dias:", resto: " você sabe o que fazer em cada dia." },
  { forte: "Dieta AGE:", resto: " comida gostosa, ajustada ao seu peso, sem passar fome." },
  { forte: "Método Slim e Definida:", resto: " os 4 pilares que deixam o treino específico para definir, secar a barriga e ganhar glúteo." },
] as const;

/** Número que já está na página (seção "Quem sou eu"). */
export const ALUNAS_ATENDIDAS = "2.847";

/**
 * Prazo REAL do preço de R$29 (ISO, horário de Brasília), para a v9 mostrar
 * a contagem. null = sem prazo definido: a v9 mostra só o preço, sem
 * contagem, porque contagem que reinicia sozinha é urgência falsa.
 * Quem define a data é o Breno.
 */
export const PRECO_R29_ATE: string | null = null;

export const VARIANTES_DOBRA: readonly VarianteDobra[] = [
  { id: "v7", dobra: "prova", angulo: "Head + subhead + botão, prova abaixo do botão" },
  { id: "v8", dobra: "antes-depois", angulo: "Head + antes e depois + botão" },
  { id: "v9", dobra: "beneficios", angulo: "Head + 3 benefícios + botão + prazo real" },
];

export function varianteDobra(id: string | undefined): VarianteDobra | null {
  if (!id) return null;
  return VARIANTES_DOBRA.find((v) => v.id === id.toLowerCase()) ?? null;
}

/** Tempo que falta até o prazo, "2d 14h 05min" ou "14h 05min"; null se não há prazo ou já passou. */
export function faltaAte(prazoIso: string | null, agora: number): string | null {
  if (!prazoIso) return null;
  const fim = Date.parse(prazoIso);
  if (!Number.isFinite(fim) || fim <= agora) return null;
  const min = Math.floor((fim - agora) / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = String(min % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${h}h ${m}min` : `${h}h ${m}min`;
}
