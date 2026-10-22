import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  contaNoTotal,
  lerPedido,
  lerValorBR,
  pedidosAtribuidos,
  resumirSemVersao,
  totaisComSemVersao,
  type VendaSemVersao,
} from "@/lib/rotatorSemVersao";
import { roasECpa } from "@/lib/rotatorMeta";

// /r/desafio, 13/10/2026: só a venda da v3 (R$ 17) tinha o marcador, então o
// ROAS do teste inteiro aparecia 0,11x. As outras 8 vendas aprovadas do
// produto em 12 e 13/10 (painel da PagTrust, R$ 172,98 no total com a da v3)
// entram como "sem versão": somam no total do teste, não em variação.

const ROTADOR = "d3fbebfd-89c5-4d00-9a0f-ca0d13ec18c4";
const venda = (order_id: string, value: number | string, extra: Partial<VendaSemVersao> = {}): VendaSemVersao => ({
  id: `id-${order_id}`,
  rotator_link_id: ROTADOR,
  order_id,
  value,
  sold_at: "2026-10-13T13:51:07Z",
  source: "pagtrust-manual",
  note: null,
  atribuida: false,
  ...extra,
});

const semente = [
  venda("13372733", "17.00"),
  venda("13372505", "17.00"),
  venda("13372471", "17.00"),
  venda("13371943", "17.00"),
  venda("pagtrust-20261012-223527", "36.98"),
  venda("13370557", "17.00"),
  venda("13370421", "17.00"),
  venda("13370415", "17.00"),
];

describe("resumirSemVersao", () => {
  it("as 8 vendas da semente somam R$ 155,98", () => {
    expect(resumirSemVersao(semente, new Set())).toEqual({ purchases: 8, revenue: 155.98, ignoradas: 0 });
  });

  it("pedido que já é compra de uma variação não conta de novo (flag do banco ou pedido carregado)", () => {
    const vendas = [...semente, venda("13373083", 17, { atribuida: true })];
    expect(resumirSemVersao(vendas, new Set())).toEqual({ purchases: 8, revenue: 155.98, ignoradas: 1 });

    // webhook trouxe 13372733 com marcador depois que o painel leu a view
    const atribuidos = pedidosAtribuidos([
      { event_type: "purchase", order_id: "13373083" },
      { event_type: "purchase", order_id: " 13372733 " },
      { event_type: "checkout", order_id: null },
    ]);
    expect(resumirSemVersao(semente, atribuidos)).toEqual({ purchases: 7, revenue: 138.98, ignoradas: 1 });
  });

  it("valor inválido ou negativo não soma; pedido repetido conta uma vez", () => {
    const r = resumirSemVersao([venda("A", "x"), venda("B", -5), venda("C", 10), venda("C", 10)], new Set());
    expect(r).toEqual({ purchases: 3, revenue: 10, ignoradas: 0 });
  });

  it("contaNoTotal", () => {
    expect(contaNoTotal({ order_id: "1", atribuida: false }, new Set())).toBe(true);
    expect(contaNoTotal({ order_id: "1", atribuida: true }, new Set())).toBe(false);
    expect(contaNoTotal({ order_id: "1", atribuida: null }, new Set(["1"]))).toBe(false);
  });
});

describe("totaisComSemVersao + ROAS do teste inteiro", () => {
  const base = { clicks: 900, checkouts: 30, purchases: 1, revenue: 17, checkout_rate: (30 / 900) * 100 };

  it("total = atribuídas + sem versão: 9 vendas, R$ 172,98", () => {
    const t = totaisComSemVersao(base, resumirSemVersao(semente, new Set(["13373083"])));
    expect(t).toMatchObject({
      clicks: 900,
      checkouts: 30,
      purchases: 9,
      revenue: 172.98,
      purchases_atribuidas: 1,
      revenue_atribuida: 17,
      sem_versao: { purchases: 8, revenue: 155.98, ignoradas: 0 },
    });
    expect(t.conversion_rate).toBeCloseTo(1);
    expect(t.avg_ticket).toBeCloseTo(19.22, 2);
  });

  it("ROAS = receita total ÷ investimento; CPA = investimento ÷ compras totais", () => {
    const t = totaisComSemVersao(base, resumirSemVersao(semente, new Set()));
    const antes = roasECpa(147.06, base.revenue, base.purchases);
    const depois = roasECpa(147.06, t.revenue, t.purchases);
    expect(antes.roas?.toFixed(2)).toBe("0.12");
    expect(depois.roas).toBeCloseTo(172.98 / 147.06);
    expect(depois.cpa).toBeCloseTo(147.06 / 9);
  });

  it("sem venda sem versão, nada muda", () => {
    const t = totaisComSemVersao(base, resumirSemVersao([], new Set()));
    expect(t).toMatchObject({ purchases: 1, revenue: 17, sem_versao: { purchases: 0, revenue: 0, ignoradas: 0 } });
  });
});

describe("leitura do formulário", () => {
  it("valor em reais", () => {
    expect(lerValorBR("17,00")).toBe(17);
    expect(lerValorBR("36,98")).toBe(36.98);
    expect(lerValorBR("R$ 1.234,56")).toBe(1234.56);
    expect(lerValorBR("17.5")).toBe(17.5);
    expect(lerValorBR("17")).toBe(17);
    expect(lerValorBR("")).toBeNull();
    expect(lerValorBR("-1")).toBeNull();
    expect(lerValorBR("abc")).toBeNull();
    expect(lerValorBR("1,234")).toBeNull();
  });
  it("pedido", () => {
    expect(lerPedido(" 13372733 ")).toBe("13372733");
    expect(lerPedido("   ")).toBeNull();
    expect(lerPedido("x".repeat(201))).toBeNull();
  });
});

// getTotalStats com um Supabase de mentira: linhas por variação iguais, totais com sem versão.
type Linha = Record<string, unknown>;
const tabelas: Record<string, object[]> = {};
const erros: Record<string, { message: string; code?: string } | undefined> = {};

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let single = false;
    let cabecalho = false;
    const resolver = () => {
      if (erros[tabela]) return { data: null, error: erros[tabela], count: null };
      const linhas = (tabelas[tabela] || []).filter((l) => filtros.every(([c, v]) => (l as Linha)[c] === v));
      if (cabecalho) return { data: null, error: null, count: linhas.length };
      return { data: single ? linhas[0] ?? null : linhas, error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder encadeável de mentira
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) cabecalho = true; return q; },
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      order: () => q,
      range: () => q,
      limit: () => q,
      in: () => q,
      single: () => { single = true; return q; },
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, falha),
    };
    return q;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

import { rotatorApi } from "@/lib/rotatorApi";

describe("rotatorApi.getTotalStats", () => {
  beforeEach(() => {
    for (const k of Object.keys(tabelas)) delete tabelas[k];
    for (const k of Object.keys(erros)) delete erros[k];
    tabelas.rotator_links = [{ id: ROTADOR, conversion_rule: null }];
    tabelas.rotator_destinations = [
      { id: "d1", rotator_id: ROTADOR, url: "https://equipe.brenoxavier.com.br/desafio/v1", label: "v1", weight: 10 },
      { id: "d3", rotator_id: ROTADOR, url: "https://equipe.brenoxavier.com.br/desafio/v3", label: "v3", weight: 10 },
    ];
    tabelas.rotator_clicks = [
      ...Array.from({ length: 5 }, (_, i) => ({ destination_id: "d1", click_id: `a${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ destination_id: "d3", click_id: `c${i}` })),
    ];
    tabelas.rotator_events_por_destino = [
      { rotator_id: ROTADOR, destination_id: "d3", click_id: "c0", event_type: "purchase", value: 17, page_url: null, order_id: "13373083" },
    ];
    tabelas.rotator_vendas_sem_versao_painel = [
      ...semente,
      venda("13373083", 17, { atribuida: false }), // view desatualizada: o pedido carregado já barra
    ];
  });

  it("variações iguais; totais com as vendas sem versão", async () => {
    const { stats, totals } = await rotatorApi.getTotalStats(ROTADOR);
    expect(stats.map((s) => [s.label, s.clicks, s.purchases, s.revenue])).toEqual([
      ["v1", 5, 0, 0],
      ["v3", 4, 1, 17],
    ]);
    expect(totals).toMatchObject({ clicks: 9, purchases: 9, revenue: 172.98, purchases_atribuidas: 1, revenue_atribuida: 17 });
    expect(totals.sem_versao).toEqual({ purchases: 8, revenue: 155.98, ignoradas: 1 });
  });

  it("sem a tabela no banco (SQL ainda não rodou), totais ficam só com as atribuídas", async () => {
    erros.rotator_vendas_sem_versao_painel = { message: 'relation "rotator_vendas_sem_versao_painel" does not exist', code: "42P01" };
    const { totals } = await rotatorApi.getTotalStats(ROTADOR);
    expect(totals).toMatchObject({ purchases: 1, revenue: 17, sem_versao: { purchases: 0, revenue: 0, ignoradas: 0 } });
  });
});
