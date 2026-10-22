import { describe, expect, it } from "vitest";
import {
  amostraBeta,
  calcularOtimizacao,
  PARAMETROS_PADRAO,
  pesosComLimites,
  rngComSemente,
} from "@/lib/rotatorOtimizacao";

const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("otimização do rotador (Thompson Sampling)", () => {
  it("sem dados: validação, tráfego igual", () => {
    const r = calcularOtimizacao(
      [1, 2, 3, 4, 5].map((i) => ({ id: `v${i}`, visitas: 0, compras: 0 })),
      PARAMETROS_PADRAO,
      rngComSemente(1),
    );
    expect(r.fase).toBe("validando");
    for (const id of ["v1", "v2", "v3", "v4", "v5"]) {
      expect(r.pesos[id]).toBeCloseTo(0.2, 10);
      expect(r.status[id]).toBe("validando: faltam 100 visitas");
      expect(r.probMelhor[id]).toBeGreaterThan(0.1);
      expect(r.probMelhor[id]).toBeLessThan(0.3);
    }
  });

  it("sem variações", () => {
    expect(calcularOtimizacao([]).fase).toBe("sem_variacoes");
  });

  it("validação: visitas ok mas poucas compras no teste segue igual, mesmo com uma variação na frente", () => {
    const r = calcularOtimizacao(
      [
        { id: "a", visitas: 150, compras: 6 },
        { id: "b", visitas: 150, compras: 1 },
        { id: "c", visitas: 80, compras: 0 },
      ],
      PARAMETROS_PADRAO,
      rngComSemente(2),
    );
    expect(r.fase).toBe("validando");
    expect(r.pesos.a).toBeCloseTo(1 / 3, 10);
    expect(r.status.a).toBe("validando: faltam 3 compras no teste");
    expect(r.status.c).toBe("validando: faltam 20 visitas");
  });

  it("validação: compras ok, uma variação nova sem visitas segura o teste", () => {
    const r = calcularOtimizacao(
      [
        { id: "a", visitas: 300, compras: 14 },
        { id: "b", visitas: 300, compras: 8 },
        { id: "c", visitas: 0, compras: 0 },
      ],
      PARAMETROS_PADRAO,
      rngComSemente(6),
    );
    expect(r.fase).toBe("validando");
    expect(r.status.a).toBe("validando: aguardando as outras variações");
    expect(r.status.c).toBe("validando: faltam 100 visitas");
  });

  it("campeã clara: passa de 95%, fica sem teto e as outras no piso", () => {
    const r = calcularOtimizacao(
      [
        { id: "a", visitas: 1000, compras: 60 },
        { id: "b", visitas: 1000, compras: 20 },
        { id: "c", visitas: 1000, compras: 18 },
      ],
      PARAMETROS_PADRAO,
      rngComSemente(3),
    );
    expect(r.fase).toBe("campea");
    expect(r.probMelhor.a).toBeGreaterThanOrEqual(0.95);
    expect(r.status.a).toMatch(/^campeã com (9[5-9]|100)%$/);
    expect(r.status.b).toBe("otimizando");
    expect(r.pesos.b).toBeCloseTo(0.05, 6);
    expect(r.pesos.c).toBeCloseTo(0.05, 6);
    expect(r.pesos.a).toBeCloseTo(0.9, 6);
    expect(soma(r.pesos)).toBeCloseTo(1, 10);
  });

  it("líder sem 95%: teto de 80%", () => {
    const r = calcularOtimizacao(
      [
        { id: "a", visitas: 300, compras: 14 },
        { id: "b", visitas: 300, compras: 8 },
      ],
      PARAMETROS_PADRAO,
      rngComSemente(4),
    );
    expect(r.fase).toBe("otimizando");
    expect(r.probMelhor.a).toBeGreaterThan(0.8);
    expect(r.probMelhor.a).toBeLessThan(0.95);
    expect(r.pesos.a).toBeCloseTo(0.8, 6);
    expect(r.pesos.b).toBeCloseTo(0.2, 6);
  });

  it("empate: pesos perto de iguais", () => {
    const r = calcularOtimizacao(
      [
        { id: "a", visitas: 500, compras: 20 },
        { id: "b", visitas: 500, compras: 20 },
        { id: "c", visitas: 500, compras: 20 },
      ],
      PARAMETROS_PADRAO,
      rngComSemente(5),
    );
    expect(r.fase).toBe("otimizando");
    for (const id of ["a", "b", "c"]) {
      expect(r.pesos[id]).toBeGreaterThan(0.27);
      expect(r.pesos[id]).toBeLessThan(0.4);
      expect(r.status[id]).toBe("otimizando");
    }
    expect(soma(r.pesos)).toBeCloseTo(1, 10);
  });

  it("pesosComLimites: piso, teto, redistribuição e casos-limite", () => {
    const w = pesosComLimites([0.7, 0.29, 0.01, 0], 0.05, 0.8, false);
    expect(w[2]).toBeCloseTo(0.05, 10);
    expect(w[3]).toBeCloseTo(0.05, 10);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(w[0] / w[1]).toBeCloseTo(0.7 / 0.29, 6);

    expect(pesosComLimites([1, 0], 0.05, 0.8, false)).toEqual([0.8, expect.closeTo(0.2, 10)]);
    expect(pesosComLimites([1, 0], 0.05, 0.8, true)[0]).toBeCloseTo(0.95, 10);
    // piso inviável (30 variações x 5% > 100%) vira tráfego igual
    const muitas = pesosComLimites(new Array(30).fill(0).map((_, i) => (i === 0 ? 1 : 0)), 0.05, 0.8, false);
    for (const x of muitas) expect(x).toBeCloseTo(1 / 30, 10);
    expect(pesosComLimites([0.3], 0.05, 0.8, false)).toEqual([1]);
  });

  it("amostraBeta tem a média certa", () => {
    const rng = rngComSemente(9);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += amostraBeta(3, 7, rng);
    expect(s / 20000).toBeCloseTo(0.3, 2);
  });
});
