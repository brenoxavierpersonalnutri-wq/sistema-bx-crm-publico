import { describe, it, expect } from "vitest";
import {
  calcularResultadosPorVariacao,
  melhorVariacao,
  totaisDosResultados,
  type EventoDoRotador,
} from "@/lib/rotatorResultados";

const destinos = [
  { id: "d1", label: "v1", url: "https://equipe.brenoxavier.com.br/desafio/v1", weight: 10 },
  { id: "d2", label: "v2", url: "https://equipe.brenoxavier.com.br/desafio/v2", weight: 10 },
  { id: "d3", label: "v3", url: "https://equipe.brenoxavier.com.br/desafio/v3", weight: 10 },
];

const ev = (destination_id: string, click_id: string, event_type: string, value: number | string = 0, order_id: string | null = null, page_url: string | null = null): EventoDoRotador => ({
  destination_id, click_id, event_type, value, page_url, order_id,
});

describe("calcularResultadosPorVariacao", () => {
  const eventos = [
    ev("d1", "a", "checkout"), ev("d1", "a", "checkout"), ev("d1", "b", "checkout"),
    ev("d1", "a", "purchase", 17, "P1"),
    ev("d1", "a", "purchase", "9.90", "P2"), // order bump: receita sim, compra não
    ev("d2", "c", "checkout"),
    ev("d2", "c", "purchase", 17, "P3"),
    ev("d2", "c", "purchase", 17, "P3"), // nunca deveria existir (índice único), mas não soma duas vezes
    ev("d2", "d", "pageview"),
  ];
  const r = calcularResultadosPorVariacao(destinos, { d1: 100, d2: 40, d3: 0 }, eventos, { type: "pixel" });

  it("checkout e compra contam clique distinto", () => {
    expect(r.map((x) => [x.label, x.clicks, x.checkouts, x.purchases])).toEqual([
      ["v1", 100, 2, 1],
      ["v2", 40, 1, 1],
      ["v3", 0, 0, 0],
    ]);
  });
  it("receita soma um por pedido, inclusive bump", () => {
    expect(r[0].revenue).toBeCloseTo(26.9);
    expect(r[1].revenue).toBe(17);
    expect(r[0].avg_ticket).toBeCloseTo(26.9);
  });
  it("conversão = compras ÷ visitas; checkout rate = checkouts ÷ visitas; sem visita, 0", () => {
    expect(r[0].conversion_rate).toBeCloseTo(1);
    expect(r[1].conversion_rate).toBeCloseTo(2.5);
    expect(r[0].checkout_rate).toBeCloseTo(2);
    expect(r[2].conversion_rate).toBe(0);
  });
  it("melhor variação = maior conversão (v2)", () => {
    expect(melhorVariacao(r)).toBe("d2");
  });
  it("totais", () => {
    expect(totaisDosResultados(r)).toMatchObject({ clicks: 140, checkouts: 3, purchases: 2, conversion_rate: (2 / 140) * 100 });
  });
});

describe("melhorVariacao", () => {
  const base = { label: "", url: "", weight: 10, avg_ticket: 0, checkouts: 0, checkout_rate: 0 };
  it("sem compra, ninguém é destaque", () => {
    expect(melhorVariacao([{ ...base, destination_id: "x", clicks: 10, purchases: 0, revenue: 0, conversion_rate: 0 }])).toBeNull();
  });
  it("empate na conversão vai para quem fatura mais por visita", () => {
    expect(
      melhorVariacao([
        { ...base, destination_id: "x", clicks: 100, purchases: 1, revenue: 17, conversion_rate: 1 },
        { ...base, destination_id: "y", clicks: 100, purchases: 1, revenue: 26.9, conversion_rate: 1 },
      ]),
    ).toBe("y");
  });
});

describe("regra de conversão por URL continua igual", () => {
  it("compra = clique com pageview casando a regra, sem receita", () => {
    const eventos = [
      ev("d1", "a", "pageview", 0, null, "https://site.com/agendar?x=1"),
      ev("d1", "a", "pageview", 0, null, "https://site.com/agendar"),
      ev("d1", "b", "pageview", 0, null, "https://site.com/outra"),
      ev("d1", "b", "purchase", 50, "P9"),
    ];
    const r = calcularResultadosPorVariacao(destinos.slice(0, 1), { d1: 10 }, eventos, { type: "url_contains", value: "agendar" });
    expect(r[0]).toMatchObject({ purchases: 1, revenue: 0, conversion_rate: 10 });
  });
});
