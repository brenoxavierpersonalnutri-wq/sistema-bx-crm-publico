import { describe, it, expect } from "vitest";
import {
  calcularMetricasPorVariacao,
  formatarMs,
  formatarTaxa,
  percentil,
  primeiraPorClique,
  resumir,
  type BeaconDoRotador,
} from "@/lib/pageMetrics";

const b = (o: Partial<BeaconDoRotador>): BeaconDoRotador => ({
  destination_id: "d1",
  cm_click: "c1",
  kind: "view",
  ttfb_ms: null,
  render_ms: null,
  lcp_ms: null,
  created_at: "2026-10-12T10:00:00Z",
  nav: "spa",
  ...o,
});

describe("percentil", () => {
  it("vazio → null; um valor → ele mesmo", () => {
    expect(percentil([], 0.5)).toBeNull();
    expect(percentil([700], 0.75)).toBe(700);
  });
  it("interpolação linear igual ao percentile_cont", () => {
    expect(percentil([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(percentil([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(percentil([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentil([10, 20, 30, 40, 50], 0.75)).toBe(40);
  });
  it("ignora NaN/Infinity", () => {
    expect(percentil([NaN, 5, Infinity, 15], 0.5)).toBe(10);
  });
});

describe("resumir", () => {
  it("descarta null e conta n", () => {
    expect(resumir([null, 100, undefined, 300])).toEqual({ p50: 200, p75: 250, n: 2 });
    expect(resumir([])).toEqual({ p50: null, p75: null, n: 0 });
  });
});

describe("primeiraPorClique", () => {
  it("fica com a primeira medição de cada clique (recarga não conta de novo)", () => {
    const out = primeiraPorClique(
      [
        b({ cm_click: "c1", render_ms: 900, created_at: "2026-10-12T10:00:05Z" }),
        b({ cm_click: "c1", render_ms: 400, created_at: "2026-10-12T10:00:01Z" }),
        b({ cm_click: "c2", render_ms: 1200 }),
        b({ cm_click: "c2", kind: "vitals", lcp_ms: 2000 }),
      ],
      "view",
    );
    expect(Object.fromEntries(out.map((x) => [x.cm_click, x.render_ms]))).toEqual({ c1: 400, c2: 1200 });
    expect(out).toHaveLength(2);
  });
});

describe("calcularMetricasPorVariacao", () => {
  const destinos = [
    { id: "d1", label: "v1", url: "https://e/desafio/v1" },
    { id: "d2", label: "v2", url: "https://e/desafio/v2" },
    { id: "d3", label: "v3", url: "https://e/desafio/v3" },
  ];

  it("conexão = cliques que carregaram ÷ cliques, por variação", () => {
    const beacons = [
      b({ destination_id: "d1", cm_click: "a", render_ms: 1000, ttfb_ms: 200 }),
      b({ destination_id: "d1", cm_click: "a", render_ms: 5000, ttfb_ms: 900, created_at: "2026-10-12T11:00:00Z" }),
      b({ destination_id: "d1", cm_click: "b", render_ms: 2000, ttfb_ms: 400 }),
      b({ destination_id: "d1", cm_click: "a", kind: "vitals", lcp_ms: 2500 }),
      b({ destination_id: "d2", cm_click: "c", render_ms: 3000, ttfb_ms: 300 }),
    ];
    const [m1, m2, m3] = calcularMetricasPorVariacao(destinos, { d1: 4, d2: 1, d3: 0 }, beacons);

    expect(m1.clicks).toBe(4);
    expect(m1.loaded).toBe(2);
    expect(m1.connectRate).toBe(0.5);
    expect(m1.render).toEqual({ p50: 1500, p75: 1750, n: 2 });
    expect(m1.renderDoc.n).toBe(0);
    expect(m1.ttfb).toEqual({ p50: 300, p75: 350, n: 2 });
    expect(m1.lcp).toEqual({ p50: 2500, p75: 2500, n: 1 });

    expect(m2.connectRate).toBe(1);
    expect(m3.clicks).toBe(0);
    expect(m3.connectRate).toBeNull();
    expect(m3.render.n).toBe(0);
  });

  it("conexão nunca passa de 100%", () => {
    const beacons = [b({ cm_click: "a" }), b({ cm_click: "b" }), b({ cm_click: "c" })];
    const [m1] = calcularMetricasPorVariacao(destinos.slice(0, 1), { d1: 2 }, beacons);
    expect(m1.loaded).toBe(2);
    expect(m1.connectRate).toBe(1);
  });

  it("vitals sem view não conta como carregou", () => {
    const [m1] = calcularMetricasPorVariacao(destinos.slice(0, 1), { d1: 3 }, [b({ kind: "vitals", lcp_ms: 1800 })]);
    expect(m1.loaded).toBe(0);
    expect(m1.connectRate).toBe(0);
    expect(m1.lcp.p50).toBe(1800);
  });
});

describe("caminhos não se misturam na mediana", () => {
  it("spa (clique no /r/ até aparecer) e doc (página direta) ficam separados", () => {
    const [m] = calcularMetricasPorVariacao(
      [{ id: "d1", label: "v1", url: "u" }],
      { d1: 3 },
      [
        b({ cm_click: "a", nav: "spa", render_ms: 2000 }),
        b({ cm_click: "b", nav: "spa", render_ms: 3000 }),
        b({ cm_click: "c", nav: "doc", render_ms: 400, ttfb_ms: 120 }),
      ],
    );
    expect(m.loaded).toBe(3);
    expect(m.render).toEqual({ p50: 2500, p75: 2750, n: 2 });
    expect(m.renderDoc).toEqual({ p50: 400, p75: 400, n: 1 });
    expect(m.ttfb).toEqual({ p50: 120, p75: 120, n: 1 });
  });
  it("aba oculta (render null) conta na conexão e fica fora do tempo", () => {
    const [m] = calcularMetricasPorVariacao([{ id: "d1", label: "v1", url: "u" }], { d1: 2 }, [
      b({ cm_click: "a", render_ms: null }),
      b({ cm_click: "b", render_ms: 1800 }),
    ]);
    expect(m.loaded).toBe(2);
    expect(m.render).toEqual({ p50: 1800, p75: 1800, n: 1 });
  });
});

describe("formatação", () => {
  it("ms e taxa em pt-BR", () => {
    expect(formatarMs(null)).toBe("—");
    expect(formatarMs(480.4)).toBe("480 ms");
    expect(formatarMs(1234)).toBe("1,2 s");
    expect(formatarTaxa(null)).toBe("—");
    expect(formatarTaxa(0.873)).toBe("87,3%");
  });
});
