import { describe, expect, it } from "vitest";
import { ALIMENTOS, buscar, medidasDe, trocar, MAX_OPCOES } from "@/lib/trocaCerta";

const acharPorNome = (nome: string) => {
  const a = ALIMENTOS.find((x) => x.nome === nome);
  if (!a) throw new Error(`alimento de teste não existe na base: ${nome}`);
  return a;
};

describe("base TACO", () => {
  it("carrega os 597 alimentos", () => {
    expect(ALIMENTOS).toHaveLength(597);
  });

  it("marca embutido como vetado mesmo com a grafia antiga da TACO", () => {
    // A TACO escreve "Lingüiça" com trema. Sem normalizar acento o veto do
    // Breno passava batido — foi bug real durante a construção da base.
    const linguicas = ALIMENTOS.filter((a) => a.nome.startsWith("Lingüiça"));
    expect(linguicas.length).toBeGreaterThan(0);
    for (const l of linguicas) expect(l.vetado).toBe("embutido");
  });

  it("separa cru de cozido com valores bem diferentes", () => {
    const cru = acharPorNome("Arroz, tipo 1, cru");
    const cozido = acharPorNome("Arroz, tipo 1, cozido");
    expect(cru.preparo).toBe("cru");
    expect(cozido.preparo).toBe("cozido");
    expect(cru.kcal! / cozido.kcal!).toBeGreaterThan(2.5);
  });
});

describe("buscar", () => {
  it("acha sem acento e sem ordem exata", () => {
    expect(buscar("arroz integral").some((a) => a.nome === "Arroz, integral, cru")).toBe(true);
    expect(buscar("feijao").length).toBeGreaterThan(0);
  });

  it("devolve vazio pra termo vazio", () => {
    expect(buscar("   ")).toEqual([]);
  });
});

describe("trocar", () => {
  const arroz = () => acharPorNome("Arroz, tipo 1, cozido");

  it("casa a grama do macro dominante, não a caloria", () => {
    const r = trocar(arroz(), 100);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.macro).toBe("carbo");

    const origemCarbo = (arroz().carbo! * 100) / 100;
    for (const o of r.opcoes) {
      const carboOpcao = (o.alimento.carbo! * o.gramas) / 100;
      // arredondamento de grama inteira admite folga pequena
      expect(Math.abs(carboOpcao - origemCarbo)).toBeLessThan(2);
    }
  });

  it("respeita o teto de 3 opções do core/", () => {
    const r = trocar(arroz(), 100);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.opcoes.length).toBeLessThanOrEqual(MAX_OPCOES);
  });

  it("nunca oferece alimento vetado", () => {
    for (const origem of ALIMENTOS) {
      const r = trocar(origem, 100);
      if (!r.ok) continue;
      for (const o of r.opcoes) expect(o.alimento.vetado).toBeNull();
    }
  });

  it("não mistura grupo nem preparo", () => {
    for (const origem of ALIMENTOS.slice(0, 120)) {
      const r = trocar(origem, 100);
      if (!r.ok) continue;
      for (const o of r.opcoes) {
        expect(o.alimento.categoria).toBe(origem.categoria);
        expect(o.alimento.preparo).toBe(origem.preparo);
      }
    }
  });

  it("recusa quantidade zero ou negativa", () => {
    expect(trocar(arroz(), 0).ok).toBe(false);
    expect(trocar(arroz(), -10).ok).toBe(false);
  });

  it("não devolve porção que ninguém come", () => {
    for (const origem of ALIMENTOS.slice(0, 120)) {
      const r = trocar(origem, 100);
      if (!r.ok) continue;
      for (const o of r.opcoes) {
        expect(o.gramas).toBeGreaterThanOrEqual(5);
        expect(o.gramas).toBeLessThanOrEqual(600);
      }
    }
  });
});

describe("medidas caseiras", () => {
  it("dá colher de servir pro arroz", () => {
    const m = medidasDe(acharPorNome("Arroz, tipo 1, cozido"));
    expect(m.some((x) => x.nome.includes("colher de servir"))).toBe(true);
  });

  it("devolve vazio pro alimento sem medida curada — aí a aluna pesa", () => {
    expect(medidasDe(acharPorNome("Shoyu"))).toEqual([]);
  });
});
