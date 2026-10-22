// Substituições de alimento — a lógica que o site da aluna usa.
//
// Os números saem, nesta ordem: da planilha do Breno (aba "DOSAGEM NA LISTA DE
// SUBSTITUIÇÃO"), depois da TACO (aba "Lista de Pesquisa"). O que não está em
// nenhuma das duas não entra: a tela manda a aluna mostrar o rótulo pra ele.
//
// A troca sempre iguala o macronutriente principal do grupo e busca a caloria
// mais próxima. Nada aqui é calculado por fora dessas duas tabelas.

import tabela from "./tabela.json";

export type Fonte = "lista" | "taco" | "estimativa" | "marca";
export type Unidade = "g" | "ml" | "un";
export type Macro = "carb" | "ptn" | "fat" | "kcal";

export interface Alimento {
  /** Nome, exatamente como está na tabela de origem. */
  n: string;
  u: Unidade;
  /** Porção base usada pra derivar as taxas. */
  b: number;
  /** Porções que o Breno listou pra esse alimento. */
  p: number[];
  /** Valores por unidade (por grama, por ml ou por unidade). */
  kcal: number;
  ptn: number;
  carb: number;
  fat: number;
  /** Fibra por unidade, quando a tabela de fibras dele cobre o alimento. */
  fib?: number;
  /** Gramas de uma unidade, quando o nome diz ("Ovo inteiro 60g"). */
  gu?: number;
  /** 1 quando é carne ou peixe: aí o selo de magreza vale. */
  c?: 1;
  /** De que a conta é feita, quando o prato foi montado dos ingredientes. */
  obs?: string;
  /** Outras palavras pelas quais ela procura isso ("chocolate" achar o Snickers). */
  alias?: string;
  f: Fonte;
}

export interface Grupo {
  macro: Macro;
  itens: Alimento[];
}

export interface LinhaFibra {
  porcao: string;
  nome: string;
  kcal: number;
  fibra: number;
}

type TabelaBruta = Record<string, { macro: string; itens: unknown[] }>;

const bruta = tabela as unknown as TabelaBruta;

export const GRUPOS = [
  "CARBOIDRATOS",
  "PROTEÍNAS",
  "FRUTAS",
  "LEITE E DERIVADOS",
  "GORDURAS",
  "DOCES (100kcal)",
  "SUPLEMENTOS",
] as const;

export type NomeGrupo = (typeof GRUPOS)[number];

export const ROTULO_GRUPO: Record<NomeGrupo, string> = {
  CARBOIDRATOS: "Carboidratos",
  "PROTEÍNAS": "Proteínas",
  FRUTAS: "Frutas",
  "LEITE E DERIVADOS": "Leite e derivados",
  GORDURAS: "Gorduras",
  "DOCES (100kcal)": "Doces",
  SUPLEMENTOS: "Suplementos",
};

export const ROTULO_FONTE: Record<Fonte, string> = {
  lista: "Lista",
  taco: "TACO",
  estimativa: "Estimativa",
  marca: "Marca",
};

export const ROTULO_MACRO: Record<Macro, string> = {
  carb: "carboidrato",
  ptn: "proteína",
  fat: "gordura",
  kcal: "caloria",
};

export const MESMO_MACRO: Record<Macro, string> = {
  carb: "mesmo carboidrato",
  ptn: "mesma proteína",
  fat: "mesma gordura",
  kcal: "mesma caloria",
};

export const DADOS = Object.fromEntries(
  GRUPOS.map((g) => [g, bruta[g] as unknown as Grupo]),
) as Record<NomeGrupo, Grupo>;

export const FIBRAS = (bruta.FIBRAS?.itens ?? []) as unknown as LinhaFibra[];

/** Alimentos que a aluna costuma abrir primeiro. */
export const MAIS_BUSCADOS: [NomeGrupo, string][] = [
  ["CARBOIDRATOS", "Arroz branco cozido"],
  ["CARBOIDRATOS", "Feijão cozido"],
  ["CARBOIDRATOS", "Batata inglesa cozida"],
  ["CARBOIDRATOS", "Pão de forma integral"],
  ["PROTEÍNAS", "Peito de frango"],
  ["PROTEÍNAS", "Ovo inteiro 60g"],
  ["FRUTAS", "Banana prata"],
  ["LEITE E DERIVADOS", "Iogurte natural desnatado"],
];

// ---------------------------------------------------------------------------
// Vetos e versões controladas — vêm das regras do método, não da tabela
// ---------------------------------------------------------------------------

export interface Bloqueado {
  /** Palavras que tiram o alimento do veto (o refrigerante zero, por exemplo). */
  exceto?: string[];
  nome: string;
  frases: string[];
  motivo: string;
  troca: string;
}

export const BLOQUEADOS: Bloqueado[] = [
  {
    nome: "Maionese",
    frases: ["maionese"],
    motivo: "Muito calórica e entrega pouco prazer por caloria.",
    troca: "Katchup Heinz - 12g, ou Mostarda Heinz - 12g",
  },
  {
    nome: "Salsicha, linguiça, presunto, peito de peru, bacon e salame",
    frases: ["salsicha", "linguica", "presunto", "peito de peru", "bacon", "salame", "mortadela", "embutido"],
    motivo: "Embutido não entra como proteína do dia a dia: sódio alto e perfil ruim.",
    troca: "Peito de frango - 100g",
  },
  {
    nome: "Atum em óleo",
    frases: ["atum em oleo", "atum, conserva em oleo"],
    motivo: "O óleo da lata sobe a caloria sem necessidade.",
    troca: "Atum light em água, ou Tilapia grelhada - 70g",
  },
  {
    nome: "Polenguinho, cheddar e queijo amarelo processado",
    frases: ["polenguinho", "cheddar", "queijo prato"],
    motivo: "Gordura saturada alta e prazer baixo.",
    troca: "Queijo minas frescal - 20g, ou Requeijão light - 15g",
  },
  {
    nome: "Lámen, macarrão instantâneo e sopa pronta",
    frases: ["lamen", "miojo", "macarrao instantaneo", "sopa pronta"],
    motivo: "Uma porção sozinha estoura a meta de sódio do dia.",
    troca: "Macarrão cozido - 80g",
  },
  {
    nome: "Sazon, caldo Knorr e temperos prontos",
    frases: ["sazon", "caldo knorr", "tempero pronto"],
    motivo: "Mesmo motivo: sódio.",
    troca: "Alho, cebola, ervas, páprica e pimenta do reino",
  },
  {
    nome: "Refrigerante com açúcar",
    frases: ["refrigerante", "coca-cola", "guarana antarctica", "sprite", "fanta", "pepsi"],
    // o próprio nome do veto diz: é o com açúcar. A versão zero passa.
    exceto: ["zero", "sem acucar", "diet", "light"],
    motivo: "Açúcar líquido todo dia não cabe no plano.",
    troca: "Refrigerante zero ou água com gás e limão",
  },
  {
    nome: "Suco de fruta coado no dia a dia",
    frases: ["suco de fruta", "suco coado", "suco de laranja", ", suco"],
    motivo: "Coar tira a fibra e sobra o açúcar.",
    troca: "A fruta inteira, ou limonada sem açúcar",
  },
  {
    nome: "Batata palha, chips e biscoito salgado",
    frases: ["batata palha", "salgadinho", "biscoito salgado", "cream cracker", "chips"],
    motivo: "Sódio e gordura alta, saciedade nenhuma.",
    troca: "Biscoito de arroz Cemil - 6 unidades",
  },
  {
    nome: "Azeitona e palmito em salmoura, shoyu e molho inglês",
    frases: ["azeitona", "palmito", "shoyu", "molho ingles"],
    motivo: "Sódio concentrado.",
    troca: "Tomate, pepino e cenoura à vontade na salada",
  },
];

export interface Adequado {
  nome: string;
  frases: string[];
  vira: string;
  motivo: string;
}

export const ADEQUADOS: Adequado[] = [
  {
    nome: "Pasta de amendoim tradicional",
    frases: ["pasta de amendoim"],
    vira: "Pasta de amendoim em pó Better ou BTP - 15g",
    motivo: "Mesma ideia com cerca de um quarto das calorias.",
  },
  {
    nome: "Pão de queijo",
    frases: ["pao de queijo"],
    vira: "Pão de queijo fit congelado - 2 unidades pequenas",
    motivo: "Porção fechada, não é à vontade.",
  },
  {
    nome: "Nutella",
    frases: ["nutella", "creme de avela"],
    vira: "Cacacau em pó 50% - 20g com adoçante",
    motivo: "",
  },
  {
    nome: "Fritura",
    frases: ["fritura", "fritar"],
    vira: "AirFryer, pesando cru antes de ir",
    motivo: "",
  },
];

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/**
 * Normaliza pra busca: tira acento e pontuação. A TACO escreve
 * "Grão-de-bico, cru" e "Queijo, muçarela" — sem isso, quem digita
 * "grao de bico" ou "queijo mussarela" não acha nada.
 */
export const semAcento = (s: string) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Palavras que são a mesma coisa escritas de jeitos diferentes. Vale dos dois
 * lados — no que ela digita e no nome que está na tabela — senão "mussarela"
 * continua não achando "Queijo mozarela".
 */
const SINONIMOS: [RegExp, string][] = [
  [/\bmussarela\b|\bmozarela\b|\bmozzarella\b|\bmucarela\b/g, "muzarela"],
  [/\bnozes\b/g, "noz"],
  [/\bovos\b/g, "ovo"],
  [/\bfeijoes\b/g, "feijao"],
  [/\bbatatas\b/g, "batata"],
  [/\baipim\b|\bmacaxeira\b/g, "mandioca"],
  [/\bbatata baroa\b|\bmandioquinha\b/g, "mandioquinha"],
  [/\bbergamota\b|\bponcan\b/g, "tangerina"],
  [/\bcoalhada\b/g, "iogurte"],
  [/\bcatchup\b|\bketchup\b/g, "katchup"],
  [/\bacucar\b/g, "acucar"],
  // a carne seca virou "carne gorda" na tabela; quem procura pelo nome de casa acha
  [/\bcarne seca\b|\bcharque\b|\bjabá\b|\bjaba\b/g, "carne gorda"],
];

/** A chave de comparação: sem acento, sem pontuação e com os sinônimos. */
export function chave(s: string): string {
  let k = semAcento(s);
  SINONIMOS.forEach(([de, para]) => {
    k = k.replace(de, para);
  });
  return k;
}

/** Alimento vetado nunca vira opção, nem que exista na TACO. */
export function ehBloqueado(nome: string): boolean {
  return !!vetoDoAlimento(nome);
}

/** Qual regra do Breno pega esse alimento, se alguma. */
export function vetoDoAlimento(nome: string): Bloqueado | null {
  const n = semAcento(nome);
  // as frases também passam pelo semAcento: "coca-cola" vira "coca cola", que é
  // como o nome do alimento chega aqui
  return (
    BLOQUEADOS.find(
      (b) =>
        b.frases.some((f) => n.includes(semAcento(f))) &&
        !(b.exceto ?? []).some((e) => n.includes(semAcento(e))),
    ) ?? null
  );
}

/** O que ela escreveu bate com um vetado? Só vale quando nada foi achado. */
export function bloqueioDoTermo(texto: string): Bloqueado | null {
  const q = semAcento(texto).trim();
  if (q.length < 4) return null;
  return BLOQUEADOS.find((b) => b.frases.some((f) => q.includes(f) || f.startsWith(q))) ?? null;
}

export function adequadoDoTermo(texto: string): Adequado | null {
  const q = semAcento(texto).trim();
  if (q.length < 4) return null;
  return ADEQUADOS.find((a) => a.frases.some((f) => q.includes(f) || f.startsWith(q))) ?? null;
}

// ---------------------------------------------------------------------------
// Alimento repetido: o mesmo prato com dois nomes
// ---------------------------------------------------------------------------

/** Palavra que não muda o alimento: "Patinho" e "Carne, bovina, patinho". */
const GENERICO = new Set(["carne", "bovina", "bovino", "de", "da", "do", "e", "a", "o", "tipo"]);
/** Palavra que muda: se só um dos dois tem, são alimentos diferentes. */
const SEPARA = new Set([
  "suco", "refresco", "dietetico", "diet", "light", "zero", "integral", "desnatado", "semidesnatado",
  "defumado", "salgado", "seca", "seco", "po", "doce", "calda", "frito", "frita", "milanesa", "empanado",
  "recheado", "queijo", "frango", "porco", "peixe", "boi", "coco", "castanha", "chocolate", "sal",
  "verde", "folhas", "casca", "semente", "farinha", "oleo", "molho", "sopa", "pastel", "gorda",
  "instantaneo", "enlatado", "bolo", "biscoito", "torta", "acucar", "mel", "creme",
]);

const palavrasDe = (nome: string) =>
  new Set(semAcento(nome).split(" ").filter((w) => w && !GENERICO.has(w)));

const contido = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
const sobra = (a: Set<string>, b: Set<string>) => [...b].filter((w) => !a.has(w));

/** Os números batem de perto o bastante pra ser o mesmo alimento? */
function numerosParecidos(a: Alimento, b: Alimento): boolean {
  const campos: [Macro | "fat", number, number][] = [
    ["kcal", 0.1, 0.15],
    ["ptn", 0.12, 0.006],
    ["carb", 0.12, 0.006],
    ["fat", 0.12, 0.006],
  ];
  return campos.every(([k, tol, piso]) => {
    const x = a[k as keyof Alimento] as number;
    const y = b[k as keyof Alimento] as number;
    return Math.abs(x - y) <= Math.max(piso, tol * Math.max(x, y));
  });
}

/**
 * A mesma comida entra na base por dois caminhos: a planilha do Breno chama de
 * "Patinho grelhado" e a TACO de "Carne, bovina, patinho, sem gordura,
 * grelhado". Quando o nome de um cabe dentro do outro sem palavra que mude o
 * alimento, e os números batem, a aluna vê um só — o da lista dele.
 */
const REPETIDOS = new Set<string>();
GRUPOS.forEach((g) => {
  const itens = DADOS[g].itens;
  const palavras = itens.map((i) => palavrasDe(i.n));
  itens.forEach((a, x) => {
    itens.forEach((b, y) => {
      if (x === y || a.u !== b.u) return;
      if (!palavras[x].size) return;
      const dentro = contido(palavras[x], palavras[y]);
      const iguais = dentro && contido(palavras[y], palavras[x]);
      // nomes iguais: fica o primeiro; nome contido: fica o mais curto
      if (!dentro || (iguais && x > y)) return;
      if (sobra(palavras[x], palavras[y]).some((w) => SEPARA.has(w))) return;
      if (!numerosParecidos(a, b)) return;
      // a lista do Breno ganha da TACO, em qualquer direção
      if (a.f === "taco" && b.f === "lista") REPETIDOS.add(`${g}|${a.n}`);
      else REPETIDOS.add(`${g}|${b.n}`);
    });
  });
});

/** Esse alimento é a cópia de outro que já está na tela? */
export function ehRepetido(grupo: NomeGrupo, item: Alimento): boolean {
  return REPETIDOS.has(`${grupo}|${item.n}`);
}

export interface Achado {
  grupo: NomeGrupo;
  item: Alimento;
}

export function todosItens(): Achado[] {
  const fora: Achado[] = [];
  GRUPOS.forEach((g) => DADOS[g].itens.forEach((item) => fora.push({ grupo: g, item })));
  return fora;
}

/** Busca por pedaço do nome. A lista do Breno vem antes da TACO. */
export function procura(termo: string, excluir?: string, limite = 8): Achado[] {
  const q = chave(termo);
  if (!q) return [];
  // O vetado continua aparecendo na busca: ela precisa achar o que comeu pra
  // pedir a troca. O que o veto decide é que ele nunca vira destino de troca,
  // e que ele desce pro fim da lista.
  const achou = todosItens().filter(
    ({ grupo, item }) =>
      chave(`${item.n} ${item.alias ?? ""}`).includes(q) && item.n !== excluir && !ehRepetido(grupo, item),
  );
  achou.sort((a, b) => {
    const pa = chave(a.item.n).startsWith(q) ? 0 : 1;
    const pb = chave(b.item.n).startsWith(q) ? 0 : 1;
    const fa = a.item.f === "lista" ? 0 : 1;
    const fb = b.item.f === "lista" ? 0 : 1;
    const va = ehBloqueado(a.item.n) ? 1 : 0;
    const vb = ehBloqueado(b.item.n) ? 1 : 0;
    const xa = pesoDoComum(q, a.item);
    const xb = pesoDoComum(q, b.item);
    // Carne magra na frente da gorda, procure ela por "carne" ou por "peito de
    // frango": é a ordem em que o Breno quer que a aluna veja a lista.
    const ma = pesoDaMagreza(a.item);
    const mb = pesoDaMagreza(b.item);
    // Ela pesa o que está no prato, então o preparado vem antes do cru — e,
    // entre os preparados, o frito fica por último.
    const ca = pesoDoPreparo(a.item);
    const cb = pesoDoPreparo(b.item);
    return va - vb || xa - xb || fa - fb || ma - mb || pa - pb || ca - cb || a.item.n.length - b.item.n.length;
  });
  return vitrine(q, achou, excluir).slice(0, limite);
}

/**
 * Quem escreve só "carne" não sabe ainda qual quer: abre com uma magra de cada
 * bicho — boi, porco, frango, peixe —, já pronta, e depois vem o resto.
 */
const VITRINE: [RegExp, string[]][] = [
  [/^carnes?$/, ["Patinho grelhado", "Porco, lombo, assado", "Peito de frango", "Tilapia grelhada"]],
];

function vitrine(termo: string, achou: Achado[], excluir?: string): Achado[] {
  const regra = VITRINE.find(([q]) => q.test(termo));
  if (!regra) return achou;
  const frente = regra[1]
    .map((nome) => todosItens().find(({ item }) => item.n === nome))
    .filter(
      (a): a is Achado =>
        !!a && a.item.n !== excluir && !ehBloqueado(a.item.n) && !ehRepetido(a.grupo, a.item),
    );
  const nomes = new Set(frente.map((a) => a.item.n));
  return [...frente, ...achou.filter((a) => !nomes.has(a.item.n))];
}

/**
 * Termos em que o comum vem antes do prescrito. A aluna que escreve "chocolate"
 * está procurando o que ela comeu — o ao leite, o bolo, o recheado —, não o 70%
 * que o Breno receita. Nesses termos o industrializado sobe e o da lista dele
 * desce um degrau; no resto da busca a lista dele continua mandando.
 */
const PRIMEIRO_O_COMUM: [RegExp, RegExp][] = [
  [/\bchocolate\b|\bchocolates\b/, /ao leite|meio amargo|recheado|wafer|bolo|achocolatado|bombom/i],
];

function pesoDoComum(termo: string, item: Alimento): number {
  const regra = PRIMEIRO_O_COMUM.find(([q]) => q.test(termo));
  if (!regra) return 0;
  // ela comeu um Bis, um Sonho de Valsa, um KitKat — a marca vem primeiro, o
  // genérico da tabela logo atrás, e o que o Breno receita por último
  if (item.f === "marca") return 0;
  return regra[1].test(item.n) ? 1 : 2;
}

/**
 * Na busca, a magreza da carne pesa logo depois da lista do Breno: extremamente
 * magra primeiro, depois a magra, e a carne gorda por último. O que não é carne
 * fica no meio, onde sempre esteve.
 */
function pesoDaMagreza(item: Alimento): number {
  if (!item.c) return 1;
  const selo = seloDaCarne(item);
  return selo ? (selo.nivel === "extrema" ? 0 : 1) : 2;
}

/** Na busca: primeiro o pronto do dia a dia, depois o frito, depois o cru. */
function pesoDoPreparo(item: Alimento): number {
  if (CRUS.has(item.n)) return 2;
  return FRITOS.has(item.n) ? 1 : 0;
}

export function achaAlimento(grupo: NomeGrupo, nome: string): Alimento | null {
  return DADOS[grupo].itens.find((i) => i.n === nome) ?? null;
}

// ---------------------------------------------------------------------------
// Quantidade: grama, unidade ou porção
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Preparo: cru, cozido, grelhado — e quanta água some no caminho
// ---------------------------------------------------------------------------

/** As palavras de preparo que a TACO usa no nome do alimento. */
const PALAVRA_PREPARO: Record<string, string> = {
  cru: "cru",
  crua: "cru",
  crus: "cru",
  cruas: "cru",
  cozido: "cozido",
  cozida: "cozido",
  grelhado: "grelhado",
  grelhada: "grelhado",
  assado: "assado",
  assada: "assado",
  refogado: "refogado",
  refogada: "refogado",
  frito: "frito",
  frita: "frito",
};

/** A ordem em que os preparos aparecem pra ela. */
const ORDEM_PREPARO = ["cru", "cozido", "grelhado", "assado", "refogado", "frito"];

export interface Preparo {
  id: string;
  grupo: NomeGrupo;
  item: Alimento;
}

/** Separa "Carne, bovina, patinho, sem gordura, grelhado" em base e preparo. */
export function separaPreparo(nome: string): { base: string; preparo: string | null } {
  const n = semAcento(nome);
  for (const palavra of Object.keys(PALAVRA_PREPARO)) {
    const re = new RegExp(`(^| )${palavra}( |$)`);
    if (re.test(n)) {
      return { base: n.replace(re, " ").replace(/\s+/g, " ").trim(), preparo: PALAVRA_PREPARO[palavra] };
    }
  }
  return { base: n, preparo: null };
}

/** Todos os preparos que a TACO traz do mesmo alimento, agrupados. */
const FAMILIAS = new Map<string, Preparo[]>();
/** Os nomes que a TACO traz crus — a busca deixa eles pro fim. */
const CRUS = new Set<string>();
/** E os fritos, que ficam atrás do cozido e do grelhado. */
const FRITOS = new Set<string>();
GRUPOS.forEach((g) =>
  DADOS[g].itens.forEach((item) => {
    const { base, preparo } = separaPreparo(item.n);
    if (!preparo) return;
    if (preparo === "cru") CRUS.add(item.n);
    if (preparo === "frito") FRITOS.add(item.n);
    const chave = `${g}|${base}`;
    const lista = FAMILIAS.get(chave);
    if (lista) lista.push({ id: preparo, grupo: g, item });
    else FAMILIAS.set(chave, [{ id: preparo, grupo: g, item }]);
  }),
);

/** Em que preparo esse alimento está, quando o nome diz. */
export function preparoDoItem(item: Alimento): string | null {
  return separaPreparo(item.n).preparo;
}

/**
 * Os outros preparos do mesmo alimento na TACO. Só entra o que a tabela tem de
 * verdade — nada de conta inventada em cima do cru.
 */
export function preparosDe(grupo: NomeGrupo, item: Alimento): Preparo[] {
  const { base, preparo } = separaPreparo(item.n);
  if (!preparo) return [];
  const familia = FAMILIAS.get(`${grupo}|${base}`) ?? [];
  const vistos = new Set<string>();
  return familia
    .filter((p) => (vistos.has(p.id) ? false : vistos.add(p.id)))
    .sort((a, b) => ORDEM_PREPARO.indexOf(a.id) - ORDEM_PREPARO.indexOf(b.id));
}

/**
 * Quanto sobra do peso cru depois de pronto: 100g de carne crua viram ~67g
 * grelhados. Sai da mediana dos pares cru/preparado da própria TACO — só dos
 * pares com proteína alta, porque é a proteína que fica no alimento enquanto a
 * água sai, e em alimento de proteína baixa essa conta vira ruído.
 */
const RENDIMENTO = new Map<string, number>();
{
  const juntos = new Map<string, number[]>();
  FAMILIAS.forEach((familia, chave) => {
    const grupo = chave.split("|")[0];
    const cru = familia.find((p) => p.id === "cru");
    if (!cru || cru.item.ptn < 0.05) return;
    familia.forEach((p) => {
      if (p.id === "cru" || !p.item.ptn) return;
      const k = `${grupo}|${p.id}`;
      const lista = juntos.get(k);
      const valor = cru.item.ptn / p.item.ptn;
      if (lista) lista.push(valor);
      else juntos.set(k, [valor]);
    });
  });
  juntos.forEach((vals, k) => {
    // Poucos pares, ou pares que discordam entre si, não viram regra: é assim
    // que a carne entra (os pares fecham em 10%) e o arroz e a aveia ficam de
    // fora (de 1,2 a 4,7 vezes, dependendo do grão).
    if (vals.length < 5) return;
    const ordenado = [...vals].sort((a, b) => a - b);
    const meio = Math.floor(ordenado.length / 2);
    const mediana = ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
    const q1 = ordenado[Math.floor(ordenado.length / 4)];
    const q3 = ordenado[Math.floor((3 * ordenado.length) / 4)];
    if (!mediana || (q3 - q1) / mediana > 0.25) return;
    RENDIMENTO.set(k, mediana);
  });
}

/** Proteína mínima pra valer a conta de rendimento (carne, peixe, ovo). */
const PTN_PRA_RENDIMENTO = 0.1;

/**
 * O rendimento que dá pra usar nesse alimento cru — e em que preparo. Só devolve
 * quando a TACO não tem a versão pronta dele (aí a versão pronta é melhor) e
 * quando é alimento de proteína, onde a mediana dos pares fecha apertada.
 */
export function rendimentoDe(grupo: NomeGrupo, item: Alimento): { preparo: string; rende: number } | null {
  if (preparoDoItem(item) !== "cru" || item.ptn < PTN_PRA_RENDIMENTO) return null;
  if (preparosDe(grupo, item).length > 1) return null;
  for (const preparo of ["grelhado", "cozido", "assado"]) {
    const rende = RENDIMENTO.get(`${grupo}|${preparo}`);
    if (rende) return { preparo, rende };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selo de magreza da carne
// ---------------------------------------------------------------------------

export interface Selo {
  nivel: "extrema" | "magra";
  texto: string;
  /** Gordura por 100g, que é o que decide o selo. */
  gordura: number;
}

/**
 * Carne e peixe ganham selo pela gordura por 100g: abaixo de 5g é extremamente
 * magra, abaixo de 10g é mais magra. Acima disso não tem selo — é o corte gordo,
 * e a conta da tela já mostra o que ele custa em caloria.
 */
export function seloDaCarne(item: Alimento): Selo | null {
  if (!item.c) return null;
  const porGrama = item.u === "g" || item.u === "ml" ? item.fat : item.gu ? item.fat / item.gu : null;
  if (porGrama === null) return null;
  const gordura = Math.round(porGrama * 1000) / 10;
  if (gordura < 5) return { nivel: "extrema", texto: "CARNE EXTREMAMENTE MAGRA", gordura };
  if (gordura < 10) return { nivel: "magra", texto: "CARNE MAIS MAGRA", gordura };
  return null;
}

export interface Medida {
  id: "nativa" | "porcao" | "grama" | "pronto";
  rotulo: string;
  curto: string;
  /** Quantas unidades nativas cabem em 1 desta medida. */
  fator: number;
}

/**
 * Em que unidades esse alimento pode ser contado. Só entra o que é real: grama
 * sai da planilha, porção é a primeira porção listada por ele, e unidade só
 * quando o peso da unidade está escrito no nome ("Ovo inteiro 60g").
 */
export function medidasDe(item: Alimento): Medida[] {
  const fora: Medida[] = [];
  if (item.u === "g") fora.push({ id: "nativa", rotulo: "gramas", curto: "g", fator: 1 });
  if (item.u === "ml") fora.push({ id: "nativa", rotulo: "ml", curto: "ml", fator: 1 });
  if (item.u === "un")
    fora.push({ id: "nativa", rotulo: item.b === 1 ? "unidade" : "unidades", curto: "un", fator: 1 });

  const porcao = item.p?.length ? item.p[0] : item.b;
  if (porcao && porcao !== 1) fora.push({ id: "porcao", rotulo: "porções", curto: "porção", fator: porcao });
  if (item.u === "un" && item.gu) fora.push({ id: "grama", rotulo: "gramas", curto: "g", fator: 1 / item.gu });
  return fora;
}

/**
 * As medidas do alimento mais, quando ele só existe cru na TACO, o peso já
 * pronto: ela pesa o que está no prato e a conta volta pro peso cru sozinha.
 */
export function medidasComPreparo(grupo: NomeGrupo, item: Alimento): Medida[] {
  const fora = medidasDe(item);
  const r = rendimentoDe(grupo, item);
  if (r && item.u === "g") {
    // 1 grama pronta veio de 1/rendimento gramas cruas — é assim que ela pesa o
    // que está no prato e a conta volta pro peso cru sozinha.
    fora.push({
      id: "pronto",
      rotulo: `gramas ${r.preparo}`,
      curto: `g ${r.preparo}`,
      fator: 1 / r.rende,
    });
  }
  return fora;
}

export function medidaAtiva(item: Alimento, id: Medida["id"], lista = medidasDe(item)): Medida {
  return lista.find((m) => m.id === id) ?? lista[0];
}

// ---------------------------------------------------------------------------
// Quanto pesa uma unidade — pra troca sair sempre em gramas
// ---------------------------------------------------------------------------

/**
 * Item contado por unidade que a planilha não pesa, mas que tem gêmeo cru na
 * TACO: o peso da unidade sai da divisão do macro principal da unidade (lista)
 * pelo macro por grama do gêmeo (TACO). Só as duas tabelas, nada de fora.
 * Maçã: 19,7g de carboidrato ÷ 0,152 g/g (Fuji) ≈ 130g.
 * Mexirica fica de fora de propósito: as três variedades da TACO dão de 93g a
 * 148g por unidade, e chutar uma delas seria inventar.
 */
const GEMEO_TACO: Record<string, { grupo: NomeGrupo; taco: string; macro: "carb" | "ptn" }> = {
  "Maça": { grupo: "FRUTAS", taco: "Maçã, Fuji, com casca, crua", macro: "carb" },
  "Banana prata": { grupo: "FRUTAS", taco: "Banana, prata, crua", macro: "carb" },
  "Pão de sal francês": { grupo: "CARBOIDRATOS", taco: "Pão, trigo, francês", macro: "carb" },
  "Pão de forma integral": { grupo: "CARBOIDRATOS", taco: "Pão, trigo, forma, integral", macro: "carb" },
  "Clara de ovo": { grupo: "PROTEÍNAS", taco: "Ovo, de galinha, clara, cozida/10minutos", macro: "ptn" },
};

const PESO_DERIVADO = new Map<string, number>();
for (const [nome, g] of Object.entries(GEMEO_TACO)) {
  const lista = DADOS[g.grupo]?.itens.find((i) => i.n === nome && i.u === "un");
  const taco = DADOS[g.grupo]?.itens.find((i) => i.n === g.taco && i.u === "g");
  if (lista && taco && taco[g.macro] > 0 && lista[g.macro] > 0) {
    PESO_DERIVADO.set(nome, Math.round(lista[g.macro] / taco[g.macro] / 5) * 5);
  }
}

/** Peso escrito no nome: "Snickers (45g)", "Twix (pacote 45g)", "(52,7g)". */
function pesoNoNome(nome: string): number | null {
  const m = nome.match(/\((?:[^()]*\s)?(\d+(?:,\d+)?)\s?g\)/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/**
 * Gramas de uma unidade desse alimento, ou null quando a base não tem como
 * saber. Ordem: o campo `gu` da tabela, o peso escrito no nome, e o peso
 * derivado do gêmeo da TACO.
 */
export function pesoDaUnidade(item: Alimento): number | null {
  if (item.u !== "un") return null;
  if (item.gu) return item.gu;
  return pesoNoNome(item.n) ?? PESO_DERIVADO.get(item.n) ?? null;
}

/** De onde veio o peso da unidade — pro relatório e pros testes. */
export function origemDoPeso(item: Alimento): "tabela" | "nome" | "derivado" | null {
  if (item.u !== "un") return null;
  if (item.gu) return "tabela";
  if (pesoNoNome(item.n) !== null) return "nome";
  if (PESO_DERIVADO.has(item.n)) return "derivado";
  return null;
}

/** Gramas que dá pra pesar em casa: inteiro até 40g, múltiplo de 5 dali pra cima. */
export function arredondaGramas(v: number): number {
  if (v >= 40) return Math.round(v / 5) * 5;
  return Math.max(1, Math.round(v));
}

const inteiro = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;
const virgula = (v: number) => String(v).replace(".", ",");

/**
 * A quantidade de uma troca, já do jeito que a aluna vai ver. A regra do Breno
 * (19/10/2026): grama é sempre o valor principal; unidade só aparece quando é
 * um número inteiro, e aí com as gramas do lado. Nada de "0,5 unidade".
 *
 * Devolve `qtd` na unidade nativa do item, pra macro e caloria saírem da mesma
 * quantidade que está escrita na tela.
 */
export function quantidadeDaTroca(item: Alimento, exata: number): number {
  if (item.u !== "un") return arredondaGramas(exata);
  const peso = pesoDaUnidade(item);
  if (!peso) return Math.max(1, Math.round(exata));
  const gramas = exata * peso;
  const n = Math.round(exata);
  // Cai a 5% de uma unidade inteira: conta em unidade, que é como ela come.
  if (n >= 1 && Math.abs(n * peso - gramas) <= gramas * 0.05) return n;
  return arredondaGramas(gramas) / peso;
}

export function escreveQtd(v: number, item: Alimento): string {
  if (item.u === "un") {
    const peso = pesoDaUnidade(item);
    if (inteiro(v) && Math.round(v) >= 1) {
      const n = Math.round(v);
      const rot = `${n} ${n === 1 ? "unidade" : "unidades"}`;
      return peso ? `${rot} (≈${arredondaGramas(n * peso)} g)` : rot;
    }
    if (peso) return `${arredondaGramas(v * peso)} g`;
    // Sem peso e quebrado (só acontece na quantidade que ela mesma digitou).
    return `${virgula(Math.round(v * 10) / 10)} unidades`;
  }
  return `${virgula(Math.round(v * 10) / 10)} ${item.u}`;
}

/**
 * Onde o mais e o menos da refeição param: em grama que dá pra pesar quando a
 * unidade tem peso, senão em centésimos.
 */
export function ajustaPasso(item: Alimento, v: number): number {
  const q = Math.max(0, v);
  const peso = pesoDaUnidade(item);
  if (item.u === "un" && peso) return q <= 0 ? 0 : arredondaGramas(q * peso) / peso;
  return Math.round(q * 100) / 100;
}

/**
 * O que ela digitou no campo QUANTIDADE, na unidade nativa. Campo vazio,
 * zero ou lixo é 0: sem quantidade, não tem troca pra mostrar.
 */
export function qtdDoCampo(texto: string, fator: number): number {
  const t = texto.trim().replace(",", ".");
  if (!t) return 0;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0 || v > 5000) return 0;
  return v * fator;
}

/** Arredonda pra um número que dá pra pesar ou contar em casa. */
export function arredonda(v: number, unidade: Unidade): number {
  if (unidade === "un") return Math.max(0.5, Math.round(v * 2) / 2);
  if (v >= 200) return Math.round(v / 10) * 10;
  if (v >= 40) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  return Math.max(1, Math.round(v));
}

// ---------------------------------------------------------------------------
// A troca
// ---------------------------------------------------------------------------

export interface Troca {
  item: Alimento;
  qtd: number;
  kcal: number;
  macro: number;
  deltaKcal: number;
  /** A quantidade caiu exatamente numa porção que ele já listou. */
  naLista: boolean;
}

export function calculaTroca(grupo: NomeGrupo, item: Alimento, quantidade: number, alvo: Alimento): Troca {
  const macro = DADOS[grupo].macro;
  const alvoMacro = item[macro] * quantidade;
  const alvoKcal = item.kcal * quantidade;
  const qtd = quantidadeDaTroca(alvo, alvoMacro / alvo[macro]);
  const kcal = alvo.kcal * qtd;
  return {
    item: alvo,
    qtd,
    kcal,
    macro: alvo[macro] * qtd,
    deltaKcal: kcal - alvoKcal,
    naLista: (alvo.p ?? []).some((p) => Math.abs(p - qtd) < 0.001),
  };
}

/**
 * O papel do alimento no prato. A tabela agrupa pelo macro que mais pesa em
 * caloria, então picanha, costela e salmão caem em gorduras — mas no prato eles
 * são a proteína da refeição, e é assim que a divisão tem que tratar. Só vale
 * pra quem tem proteína de verdade e tira daí um quarto da caloria: amendoim,
 * toucinho e leite em pó seguem sendo gordura.
 */
export function papelNoPrato(grupo: NomeGrupo, item: Alimento): Macro {
  const macro = DADOS[grupo].macro;
  if (macro !== "ptn" && item.ptn >= 0.15 && item.ptn * 4 >= item.kcal * 0.25) return "ptn";
  return macro;
}

/**
 * Onde procurar a troca desse alimento. Carne gorda está no grupo das gorduras
 * porque é de lá que vem a maior parte da caloria dela, mas ninguém troca carne
 * por abacate: a troca de carne se procura entre as carnes.
 */
export function grupoDaTroca(grupo: NomeGrupo, item: Alimento): NomeGrupo {
  return item.c && papelNoPrato(grupo, item) === "ptn" ? "PROTEÍNAS" : grupo;
}

export function trocasDe(grupoPedido: NomeGrupo, item: Alimento, quantidade: number): Troca[] {
  const grupo = grupoDaTroca(grupoPedido, item);
  const macro = DADOS[grupo].macro;
  if (!(item[macro] * quantidade)) return [];
  return DADOS[grupo].itens
    .filter((o) => o.n !== item.n && o[macro] > 0 && !ehBloqueado(o.n) && !ehRepetido(grupo, o))
    .map((o) => calculaTroca(grupo, item, quantidade, o))
    .filter((t) => t.qtd > 0 && Number.isFinite(t.kcal))
    // Ordem que o Breno pediu: primeiro a lista dele, depois a TACO. Dentro de
    // cada fonte, a caloria mais próxima na frente.
    .sort(
      (a, b) =>
        (a.item.f === "lista" ? 0 : 1) - (b.item.f === "lista" ? 0 : 1) ||
        Math.abs(a.deltaKcal) - Math.abs(b.deltaKcal),
    );
}

const g1 = (v: number) => `${(Math.round(v * 10) / 10).toString().replace(".", ",")}g`;

export interface Opiniao {
  selo: string;
  texto: string;
}

/**
 * O que a aluna ganha e o que ela perde nessa troca. Sem terrorismo: fala do
 * volume no prato, da proteína, da gordura e da fibra, e não julga alimento.
 */
export function opiniao(item: Alimento, quantidade: number, grupo: NomeGrupo, t: Troca): Opiniao {
  const macro = DADOS[grupo].macro;
  const kcalA = item.kcal * quantidade;
  const dKcal = Math.round(t.deltaKcal);
  const dPtn = t.item.ptn * t.qtd - item.ptn * quantidade;
  const dFat = t.item.fat * t.qtd - item.fat * quantidade;
  const dCarb = t.item.carb * t.qtd - item.carb * quantidade;
  const fibA = item.fib ? item.fib * quantidade : null;
  const fibB = t.item.fib ? t.item.fib * t.qtd : null;

  // Volume só se compara quando os dois estão na mesma unidade.
  const razao = item.u === t.item.u && quantidade ? t.qtd / quantidade : null;

  const frases: string[] = [];
  const leve = Math.abs(dKcal) <= Math.max(8, kcalA * 0.04);

  if (leve) frases.push("Fecha a mesma caloria.");
  else if (dKcal < 0) frases.push(`São ${Math.abs(dKcal)} kcal a menos.`);
  else frases.push(`São ${dKcal} kcal a mais.`);

  if (razao && razao >= 1.35) frases.push("É mais comida no prato pela mesma conta, sacia melhor.");
  else if (razao && razao <= 0.7) frases.push("É menos volume no prato, a fome volta mais cedo.");

  if (dPtn >= 3) frases.push(`Entrega ${g1(dPtn)} a mais de proteína.`);
  else if (dPtn <= -3) frases.push(`Perde ${g1(-dPtn)} de proteína, encaixa isso em outra refeição.`);

  if (dFat >= 5) frases.push(`Sobe ${g1(dFat)} de gordura.`);
  else if (dFat <= -5) frases.push(`Desce ${g1(-dFat)} de gordura.`);

  if (macro !== "carb" && dCarb >= 8) frases.push(`Traz ${g1(dCarb)} a mais de carboidrato.`);

  if (fibA !== null && fibB !== null) {
    const dFib = fibB - fibA;
    if (dFib >= 1) frases.push(`Ganha ${g1(dFib)} de fibra.`);
    else if (dFib <= -1) frases.push(`Perde ${g1(-dFib)} de fibra.`);
  } else if (fibB !== null && fibB >= 3) {
    frases.push(`Entrega ${g1(fibB)} de fibra.`);
  }

  let selo = "Troca direta";
  if (!leve && dKcal < 0) selo = "Mais leve";
  else if (!leve && dKcal > 0) selo = "Pesa um pouco mais";
  if (razao && razao >= 1.35 && leve) selo = "Mais volume";
  if (dPtn >= 5) selo = "Mais proteína";

  return { selo, texto: frases.slice(0, 3).join(" ") };
}

// ---------------------------------------------------------------------------
// Refeição completa
// ---------------------------------------------------------------------------

import refeicoesProntas from "./refeicoes.json";

export interface ItemRefeicao {
  qtd: string;
  nome: string;
  kcal: number;
  ptn: number;
  carb: number;
  fat: number;
}

export interface RefeicaoPronta {
  nome: string;
  itens: ItemRefeicao[];
  kcal: number;
  ptn: number;
  carb: number;
  fat: number;
  fib: number;
}

/**
 * As refeições montadas da planilha do Breno (abas "REFEIÇÕES PRONTAS" e
 * "LANCHES"). Só entraram as que fecham exatamente com o total que ele escreveu
 * — a planilha empilha duas refeições na mesma coluna em alguns pontos, e
 * chutar onde uma termina daria refeição que ele não montou.
 */
export const REFEICOES = refeicoesProntas as unknown as RefeicaoPronta[];

/** Um prato que ela montou: alimento da base mais a quantidade dela. */
export interface PratoItem {
  grupo: NomeGrupo;
  item: Alimento;
  qtd: number;
}

export interface Conta {
  kcal: number;
  ptn: number;
  carb: number;
  fat: number;
  fib: number;
}

export function somaDoPrato(prato: PratoItem[]): Conta {
  return prato.reduce<Conta>(
    (acc, { item, qtd }) => ({
      kcal: acc.kcal + item.kcal * qtd,
      ptn: acc.ptn + item.ptn * qtd,
      carb: acc.carb + item.carb * qtd,
      fat: acc.fat + item.fat * qtd,
      fib: acc.fib + (item.fib ?? 0) * qtd,
    }),
    { kcal: 0, ptn: 0, carb: 0, fat: 0, fib: 0 },
  );
}

/**
 * As refeições dele que chegam perto da conta do prato. A caloria manda, a
 * proteína vem logo atrás porque é o que segura a fome, e carboidrato e gordura
 * entram com meio peso. A fibra só pesa quando o prato dela já é rico em fibra —
 * aí trocar por uma refeição sem fibra nenhuma seria uma troca ruim.
 */
export function refeicoesProximas(conta: Conta, quantas = 3): RefeicaoPronta[] {
  if (!conta.kcal) return [];
  const dist = (a: number, b: number, piso: number) => Math.abs(a - b) / Math.max(b, piso);
  return [...REFEICOES]
    .map((r) => ({
      r,
      peso:
        dist(r.kcal, conta.kcal, 150) +
        dist(r.ptn, conta.ptn, 10) / 2 +
        dist(r.carb, conta.carb, 20) / 4 +
        dist(r.fat, conta.fat, 10) / 4 +
        (conta.fib >= 4 ? dist(r.fib ?? 0, conta.fib, 4) / 2 : 0),
    }))
    .sort((a, b) => a.peso - b.peso)
    .slice(0, quantas)
    .map((x) => x.r);
}

export interface TrocaDoPrato {
  de: PratoItem;
  para: Troca | null;
}

/**
 * A troca que faz sentido no prato. A conta do macro sozinha às vezes devolve
 * 420g de cenoura no lugar do arroz ou 6 claras no lugar do frango: fecha a
 * matemática e não é comida que alguém põe no prato. Então aqui a preferência é
 * pela lista do Breno e por uma quantidade parecida com a original — o resto
 * continua disponível na tela de um alimento só.
 */
export function melhorTrocaDoPrato(grupo: NomeGrupo, item: Alimento, qtd: number): Troca | null {
  const todas = trocasDe(grupo, item, qtd);
  if (!todas.length) return null;
  const plausivel = (t: Troca) => {
    if (t.item.u !== item.u || !qtd) return false;
    const razao = t.qtd / qtd;
    return razao >= 0.4 && razao <= 2.5;
  };
  return todas.find((t) => t.item.f === "lista" && plausivel(t)) ?? todas.find(plausivel) ?? todas[0];
}

// ---------------------------------------------------------------------------
// A troca que ela dirige: ela diz por quais alimentos quer trocar
// ---------------------------------------------------------------------------

export interface AlvoTroca {
  id: number;
  grupo: NomeGrupo;
  item: Alimento;
  /** Quantidade que ela fixou na mão; o resto se acomoda em volta. */
  travada?: number;
}

export interface Distribuido {
  id: number;
  grupo: NomeGrupo;
  item: Alimento;
  qtd: number;
  travada: boolean;
  /** O macro da refeição que esse alimento está cobrindo. */
  macro: Macro;
  /** Verdadeiro quando a refeição não tem esse macro pra dividir. */
  semAlvo: boolean;
}

/** De quanto em quanto vale mexer nessa quantidade, pra ela ir calibrando. */
export function passoDe(item: Alimento, qtd: number): number {
  if (item.u === "un") {
    const peso = pesoDaUnidade(item);
    if (!peso) return 1;
    return (qtd * peso >= 60 ? 10 : 5) / peso;
  }
  if (qtd >= 200) return 20;
  if (qtd >= 60) return 10;
  return 5;
}

/**
 * Divide a conta da refeição entre os alimentos que ela escolheu.
 *
 * A ordem é a que o Breno usa no papel: a proteína fecha a proteína, a gordura
 * fecha a gordura, e o carboidrato fecha o que sobrou de caloria. Assim a
 * proteína não cai quando ela troca frango por carne mais gorda — quem paga a
 * diferença é o arroz, que é o que ele faria na dieta.
 *
 * O que ela fixa na mão sai da conta antes de tudo e o resto se acomoda em
 * volta: é assim que "quero mais batata" vira "então menos macarrão".
 */
export function distribuiTroca(conta: Conta, alvos: AlvoTroca[]): Distribuido[] {
  const feito = new Map<number, Distribuido>();
  const macroDe = (a: AlvoTroca) => papelNoPrato(a.grupo, a.item);
  const presa = (a: AlvoTroca) => (typeof a.travada === "number" && a.travada > 0 ? a.travada : null);

  let kcalSobrando = conta.kcal;
  const registra = (a: AlvoTroca, qtd: number, macro: Macro, semAlvo: boolean, travada: boolean) => {
    feito.set(a.id, { ...a, qtd, travada, macro, semAlvo });
    kcalSobrando -= a.item.kcal * qtd;
  };

  // 1) o que ela fixou sai da conta antes de tudo
  alvos.forEach((a) => {
    const q = presa(a);
    if (q !== null) registra(a, q, macroDe(a), false, true);
  });

  // 2) proteína e gordura fecham o próprio macro
  (["ptn", "fat"] as const).forEach((macro) => {
    const livres = alvos.filter((a) => macroDe(a) === macro && presa(a) === null);
    if (!livres.length) return;
    const jaPresa = alvos
      .filter((a) => macroDe(a) === macro && presa(a) !== null)
      .reduce((s, a) => s + a.item[macro] * (presa(a) as number), 0);
    const fatia = Math.max(0, conta[macro] - jaPresa) / livres.length;
    livres.forEach((a) =>
      registra(
        a,
        fatia > 0 && a.item[macro] > 0 ? quantidadeDaTroca(a.item, fatia / a.item[macro]) : 0,
        macro,
        fatia <= 0,
        false,
      ),
    );
  });

  // 3) carboidrato e doce fecham a caloria que sobrou
  const resto = alvos.filter(
    (a) => (macroDe(a) === "carb" || macroDe(a) === "kcal") && presa(a) === null,
  );
  if (resto.length) {
    const pote = Math.max(0, kcalSobrando);
    const fatia = pote / resto.length;
    resto.forEach((a) =>
      registra(
        a,
        fatia > 0 && a.item.kcal > 0 ? quantidadeDaTroca(a.item, fatia / a.item.kcal) : 0,
        macroDe(a),
        fatia <= 0,
        false,
      ),
    );
  }

  // Devolve na ordem em que ela escreveu.
  return alvos.map((a) => feito.get(a.id)!).filter(Boolean);
}

/** A mesma refeição, com cada alimento trocado pelo melhor equivalente. */
export function pratoTrocadoItemAItem(prato: PratoItem[]): TrocaDoPrato[] {
  return prato.map((p) => ({ de: p, para: melhorTrocaDoPrato(p.grupo, p.item, p.qtd) }));
}
