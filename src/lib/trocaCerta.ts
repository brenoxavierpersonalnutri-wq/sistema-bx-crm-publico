/**
 * Troca Certa — motor de substituição de alimentos.
 *
 * Regras que vêm do core/ da consultoria (não são escolha de implementação):
 *
 *  - A troca é ancorada no MACRO DOMINANTE, não na caloria. Igualar caloria
 *    deixaria trocar 100 g de arroz por 40 g de castanha: mesma kcal, dieta
 *    destruída. Carbo troca por carbo pela grama de carboidrato, proteína por
 *    proteína pela grama de proteína.
 *  - Só troca dentro do MESMO GRUPO da TACO. Arroz não vira frango.
 *  - No MÁXIMO 3 opções. Regra do Breno: mais que isso a aluna trava na escolha.
 *  - Alimento VETADO nunca é oferecido como opção (continua consultável).
 *  - CRU e COZIDO são alimentos diferentes. Arroz tipo 1 cru tem 357 kcal/100 g
 *    contra 128 kcal/100 g cozido — errar isso erra a troca em quase 3x.
 */

import base from "@/data/taco-alimentos.json";

export type Macro = "carbo" | "proteina" | "gordura";

export type Alimento = {
  id: number;
  nome: string;
  categoria: string;
  /** cru · cozido · frito · grelhado · assado · refogado · torrado · null */
  preparo: string | null;
  kcal: number | null;
  carbo: number | null;
  prot: number | null;
  gord: number | null;
  fibra: number | null;
  sodio: number | null;
  macro: Macro | null;
  /** motivo do veto, ou null se pode ser oferecido */
  vetado: string | null;
};

export const ALIMENTOS: Alimento[] = (base as { alimentos: Alimento[] }).alimentos;

export const FONTE = (base as { fonte: string }).fonte;

/** Quantas opções a tela mostra. Regra do core/: no máximo 3. */
export const MAX_OPCOES = 3;

// --- busca ------------------------------------------------------------------

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca por termo, tolerante a acento — a TACO usa ortografia antiga
 * ("Lingüiça" com trema), então comparar com acento não acha o que a aluna digita.
 * Cada palavra do termo precisa aparecer, em qualquer ordem.
 */
export function buscar(termo: string, limite = 20): Alimento[] {
  const palavras = semAcento(termo.trim()).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  return ALIMENTOS.filter((a) => {
    const nome = semAcento(a.nome);
    return palavras.every((p) => nome.includes(p));
  })
    // nome mais curto primeiro: "Arroz, tipo 1, cozido" antes de "Salada de arroz…"
    .sort((a, b) => a.nome.length - b.nome.length)
    .slice(0, limite);
}

// --- medidas caseiras -------------------------------------------------------

/**
 * Medidas caseiras curadas, em gramas, a partir da Tabela de Medidas Referidas
 * da POF/IBGE.
 *
 * Por que curada e não a POF inteira: os 11.801 registros da POF usam nomes
 * próprios, que não casam 1:1 com os 597 da TACO. Casar por aproximação erra —
 * e grama errada aqui vira dieta errada. Então só entra o que dá pra afirmar,
 * e o resto a aluna pesa.
 *
 * `termos` casa por trecho do nome TACO, sem acento.
 */
export type MedidaCaseira = { nome: string; gramas: number };

const MEDIDAS: { termos: string[]; medidas: MedidaCaseira[] }[] = [
  { termos: ["arroz, tipo", "arroz, integral"], medidas: [
      { nome: "colher de servir cheia", gramas: 45 },
      { nome: "escumadeira", gramas: 90 },
  ]},
  { termos: ["feijao, carioca", "feijao, preto", "feijao, roxo"], medidas: [
      { nome: "concha média", gramas: 80 },
      { nome: "colher de servir cheia", gramas: 40 },
  ]},
  { termos: ["macarrao"], medidas: [
      { nome: "escumadeira", gramas: 70 },
      { nome: "pegador", gramas: 110 },
  ]},
  { termos: ["batata, inglesa", "batata, doce", "mandioca", "inhame"], medidas: [
      { nome: "unidade média", gramas: 130 },
      { nome: "colher de servir", gramas: 60 },
  ]},
  { termos: ["frango", "carne, bovina", "file", "patinho", "acem", "coxao"], medidas: [
      { nome: "filé médio", gramas: 100 },
      { nome: "colher de sopa desfiado", gramas: 20 },
  ]},
  { termos: ["ovo, de galinha"], medidas: [{ nome: "unidade", gramas: 50 }] },
  { termos: ["pao, frances", "pao, de forma", "pao, trigo"], medidas: [
      { nome: "unidade / fatia", gramas: 50 },
  ]},
  { termos: ["banana"], medidas: [{ nome: "unidade média", gramas: 100 }] },
  { termos: ["maca", "laranja", "manga", "mamao", "pera"], medidas: [
      { nome: "unidade média", gramas: 130 },
  ]},
  { termos: ["leite, de vaca", "iogurte"], medidas: [
      { nome: "copo (200 ml)", gramas: 200 },
      { nome: "xícara", gramas: 240 },
  ]},
  { termos: ["aveia"], medidas: [{ nome: "colher de sopa", gramas: 15 }] },
  { termos: ["azeite", "oleo, de soja", "manteiga", "margarina"], medidas: [
      { nome: "colher de sopa", gramas: 10 },
      { nome: "colher de chá", gramas: 4 },
  ]},
];

/** Medidas caseiras disponíveis para um alimento. Vazio = só grama. */
export function medidasDe(alimento: Alimento): MedidaCaseira[] {
  const nome = semAcento(alimento.nome);
  return MEDIDAS.find((m) => m.termos.some((t) => nome.includes(t)))?.medidas ?? [];
}

// --- troca ------------------------------------------------------------------

/** Gramas do macro dominante em `qtd` gramas do alimento. É a âncora da troca. */
function ancora(a: Alimento, qtd: number): number {
  const porCem = a.macro === "carbo" ? a.carbo : a.macro === "proteina" ? a.prot : a.gord;
  return ((porCem ?? 0) * qtd) / 100;
}

export type Opcao = {
  alimento: Alimento;
  /** quanto comer do substituto, em gramas, para casar o macro dominante */
  gramas: number;
  /** diferença de caloria contra o alimento original, em kcal */
  deltaKcal: number;
};

/**
 * Resultado da troca.
 *
 * Shape único em vez de união discriminada de proposito: este projeto roda com
 * `strict: false`, e sem strictNullChecks o TypeScript não estreita
 * `{ok:true}|{ok:false}`. Campo sempre presente evita depender disso.
 */
export type Resultado = {
  ok: boolean;
  /** preenchido quando ok */
  macro: Macro | null;
  /** preenchido quando ok; no máximo MAX_OPCOES */
  opcoes: Opcao[];
  /** preenchido quando !ok — texto pronto pra mostrar pra aluna */
  motivo: string | null;
};

const falhou = (motivo: string): Resultado => ({ ok: false, macro: null, opcoes: [], motivo });

/**
 * Dado um alimento e uma quantidade em gramas, devolve até 3 substitutos do
 * mesmo grupo, já com a gramagem equivalente calculada.
 *
 * Ordena por proximidade calórica: entre dois substitutos que casam o macro,
 * o que mexe menos no total do dia vem primeiro.
 */
export function trocar(origem: Alimento, gramas: number): Resultado {
  if (!(gramas > 0)) return falhou("Coloca uma quantidade maior que zero.");
  if (!origem.macro) {
    return falhou("Esse alimento não tem macro suficiente pra servir de base de troca.");
  }

  const alvo = ancora(origem, gramas);
  if (alvo <= 0) {
    return falhou("Esse alimento não tem macro suficiente pra servir de base de troca.");
  }

  const kcalOrigem = ((origem.kcal ?? 0) * gramas) / 100;

  const opcoes = ALIMENTOS.filter((a) =>
    a.id !== origem.id &&
    !a.vetado &&                      // core/: vetado nunca é oferecido
    a.categoria === origem.categoria && // só troca dentro do mesmo grupo
    a.macro === origem.macro &&
    a.preparo === origem.preparo &&   // cru só troca por cru, cozido por cozido
    (ancora(a, 100) > 0)
  )
    .map((a) => {
      const g = (alvo * 100) / ancora(a, 100);
      return {
        alimento: a,
        gramas: Math.round(g),
        deltaKcal: Math.round(((a.kcal ?? 0) * g) / 100 - kcalOrigem),
      };
    })
    // porção absurda não é troca de verdade: ninguém come 900 g nem 3 g
    .filter((o) => o.gramas >= 5 && o.gramas <= 600)
    .sort((a, b) => Math.abs(a.deltaKcal) - Math.abs(b.deltaKcal))
    .slice(0, MAX_OPCOES);

  if (!opcoes.length) {
    return falhou("Não achei substituto equivalente pra esse alimento nesse preparo.");
  }
  return { ok: true, macro: origem.macro, opcoes, motivo: null };
}

export const NOME_MACRO: Record<Macro, string> = {
  carbo: "carboidrato",
  proteina: "proteína",
  gordura: "gordura",
};
