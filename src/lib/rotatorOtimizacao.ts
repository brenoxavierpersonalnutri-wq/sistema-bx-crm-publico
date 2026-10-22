// =============================================================
// Otimização automática do rotador (multi-armed bandit, Thompson Sampling).
//
// Implementação de REFERÊNCIA: o cálculo que vale para o sorteio roda no
// banco (função SQL public.rotator_otimizar, migration
// 20261016180000_rotator_otimizacao.sql), que grava o peso em
// rotator_destinations.weight — o mesmo campo que a edge function
// rotator-redirect já usa no sorteio. Este arquivo espelha as mesmas regras
// para os testes e para a tela; mudou aqui, muda lá.
//
// Regras:
//  - Validação: enquanto alguma variação tiver menos que minVisitas visitas
//    OU o teste tiver menos que minCompras compras no total, tráfego igual.
//  - Depois: peso = P(ser a melhor), por Monte Carlo sobre
//    Beta(compras+1, visitas-compras+1), com piso por variação e teto para a
//    campeã enquanto ela não passar de 95% de confiança.
// =============================================================

export type ParametrosOtimizacao = {
  minVisitas: number;
  minCompras: number;
  /** fração, ex.: 0.05 */
  piso: number;
  /** fração, ex.: 0.8 */
  teto: number;
  amostras?: number;
};

export const PARAMETROS_PADRAO: ParametrosOtimizacao = {
  minVisitas: 100,
  minCompras: 10,
  piso: 0.05,
  teto: 0.8,
  amostras: 2000,
};

export const CONFIANCA_CAMPEA = 0.95;

export type BracoDoTeste = { id: string; visitas: number; compras: number };

export type ResultadoOtimizacao = {
  fase: "sem_variacoes" | "validando" | "otimizando" | "campea";
  pesos: Record<string, number>;
  probMelhor: Record<string, number>;
  status: Record<string, string>;
};

type Rng = () => number;

function normal(rng: Rng): number {
  let u = 0;
  while (u <= Number.EPSILON) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) por Marsaglia-Tsang. Aqui shape >= 1 sempre (compras+1). */
export function amostraGamma(shape: number, rng: Rng = Math.random): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function amostraBeta(a: number, b: number, rng: Rng = Math.random): number {
  const x = amostraGamma(a, rng);
  const y = amostraGamma(b, rng);
  return x / (x + y);
}

/** P(cada braço ser o melhor), Monte Carlo sobre Beta(compras+1, visitas-compras+1). */
export function probabilidadeDeSerMelhor(bracos: BracoDoTeste[], amostras = 2000, rng: Rng = Math.random): number[] {
  const n = bracos.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const vitorias = new Array(n).fill(0);
  const ab = bracos.map((b) => {
    const v = Math.max(0, b.visitas);
    const c = Math.min(Math.max(0, b.compras), v);
    return [c + 1, v - c + 1] as const;
  });
  for (let s = 0; s < amostras; s++) {
    let melhor = 0;
    let max = -1;
    for (let i = 0; i < n; i++) {
      const x = amostraBeta(ab[i][0], ab[i][1], rng);
      if (x > max) { max = x; melhor = i; }
    }
    vitorias[melhor]++;
  }
  return vitorias.map((w) => w / amostras);
}

/**
 * Pesos a partir das probabilidades, com piso por variação e teto (o teto não
 * vale quando `semTeto`, isto é, campeã com confiança >= 95%). Soma 1.
 * w_i = clamp(λ·p_i, piso, teto), com λ achado por bisseção para a soma dar 1:
 * entre as variações fora dos limites, a proporção entre as probabilidades
 * se mantém. Se nem com todas as de prob > 0 no teto a soma chega a 1, o que
 * falta vai em partes iguais para as de prob 0.
 */
export function pesosComLimites(probs: number[], piso: number, teto: number, semTeto: boolean): number[] {
  const n = probs.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const lo = Math.min(Math.max(piso, 0), 1 / n);
  const hi = semTeto ? 1 : Math.max(Math.min(teto, 1), 1 / n);
  const p = probs.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
  const somaCom = (lambda: number) => p.reduce((s, x) => s + clamp(lambda * x), 0);

  const positivos = p.filter((x) => x > 0).length;
  const maxSoma = positivos * hi + (n - positivos) * lo;
  if (maxSoma < 1) {
    const extra = (1 - maxSoma) / (n - positivos);
    return p.map((x) => (x > 0 ? hi : lo + extra));
  }
  let a = 0;
  let b = 1;
  while (somaCom(b) < 1) b *= 2;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (somaCom(m) < 1) a = m; else b = m;
  }
  const w = p.map((x) => clamp(b * x));
  const s = w.reduce((x, y) => x + y, 0);
  return w.map((x) => x / s);
}

export function calcularOtimizacao(
  bracos: BracoDoTeste[],
  params: ParametrosOtimizacao = PARAMETROS_PADRAO,
  rng: Rng = Math.random,
): ResultadoOtimizacao {
  const pesos: Record<string, number> = {};
  const probMelhor: Record<string, number> = {};
  const status: Record<string, string> = {};
  if (bracos.length === 0) return { fase: "sem_variacoes", pesos, probMelhor, status };

  const probs = probabilidadeDeSerMelhor(bracos, params.amostras ?? 2000, rng);
  bracos.forEach((b, i) => { probMelhor[b.id] = probs[i]; });

  const totalCompras = bracos.reduce((s, b) => s + Math.max(0, b.compras), 0);
  const faltamCompras = Math.max(0, params.minCompras - totalCompras);
  const validando = faltamCompras > 0 || bracos.some((b) => b.visitas < params.minVisitas);

  if (validando) {
    for (const b of bracos) {
      pesos[b.id] = 1 / bracos.length;
      const faltamVisitas = Math.max(0, params.minVisitas - b.visitas);
      status[b.id] = faltamVisitas > 0
        ? `validando: faltam ${faltamVisitas} visitas`
        : faltamCompras > 0
          ? `validando: faltam ${faltamCompras} compras no teste`
          : "validando: aguardando as outras variações";
    }
    return { fase: "validando", pesos, probMelhor, status };
  }

  const max = Math.max(...probs);
  const campea = max >= CONFIANCA_CAMPEA;
  const w = pesosComLimites(probs, params.piso, params.teto, campea);
  bracos.forEach((b, i) => {
    pesos[b.id] = w[i];
    status[b.id] = campea && probs[i] === max
      ? `campeã com ${Math.floor(probs[i] * 100)}%`
      : "otimizando";
  });
  return { fase: campea ? "campea" : "otimizando", pesos, probMelhor, status };
}

/** RNG determinístico (mulberry32) para testes. */
export function rngComSemente(semente: number): Rng {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
