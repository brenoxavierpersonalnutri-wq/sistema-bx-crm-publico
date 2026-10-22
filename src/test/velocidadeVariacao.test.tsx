import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { velocidadeDaVariacao, type MetricaDaVariacao, type Resumo } from "@/lib/pageMetrics";
import { VelocidadeCell } from "@/components/rotator/AnalysisCells";

// A coluna Velocidade chamava a API do PageSpeed do Google sem chave, direto
// do navegador. Sem chave, toda chamada cai na cota compartilhada do Google
// (429 "Queries per day" no consumer project_number:583797351490, medido em
// 13/10/2026) e a célula virava "erro" em todas as variações. Agora a coluna
// usa o que o beacon já mede de visitante real.

const vazio: Resumo = { p50: null, p75: null, n: 0 };
const m = (o: Partial<MetricaDaVariacao>): MetricaDaVariacao => ({
  destination_id: "d1",
  label: "v1",
  url: "https://equipe.brenoxavier.com.br/desafio/v1",
  clicks: 50,
  loaded: 47,
  connectRate: 0.94,
  render: vazio,
  renderDoc: vazio,
  ttfb: vazio,
  lcp: vazio,
  ...o,
});

describe("velocidadeDaVariacao", () => {
  it("sem métrica ou sem nenhuma medição → null", () => {
    expect(velocidadeDaVariacao(undefined)).toBeNull();
    expect(velocidadeDaVariacao(m({ loaded: 0 }))).toBeNull();
  });

  it("usa o LCP p75 dos visitantes quando existe, com a régua do Core Web Vitals", () => {
    expect(velocidadeDaVariacao(m({ lcp: { p50: 1800, p75: 2400, n: 40 } }))).toEqual({
      ms: 2400, fonte: "lcp", n: 40, nivel: "bom",
    });
    expect(velocidadeDaVariacao(m({ lcp: { p50: 3000, p75: 3900, n: 40 } }))?.nivel).toBe("medio");
    expect(velocidadeDaVariacao(m({ lcp: { p50: 4000, p75: 4100, n: 40 } }))?.nivel).toBe("ruim");
  });

  it("sem LCP (ex.: navegador que não mede), cai no tempo até aparecer p75: spa antes de doc", () => {
    const spa = { p50: 3000, p75: 3500, n: 30 };
    const doc = { p50: 900, p75: 1200, n: 10 };
    expect(velocidadeDaVariacao(m({ render: spa, renderDoc: doc }))).toEqual({
      ms: 3500, fonte: "render", n: 30, nivel: "medio",
    });
    expect(velocidadeDaVariacao(m({ renderDoc: doc }))).toEqual({
      ms: 1200, fonte: "render", n: 10, nivel: "bom",
    });
  });
});

describe("VelocidadeCell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mostra o LCP real e não chama nenhuma API externa", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<VelocidadeCell metrica={m({ lcp: { p50: 1800, p75: 2400, n: 40 } })} />);
    expect(screen.getByText("2,4 s")).toBeTruthy();
    expect(screen.getByText(/LCP p75 · 40/)).toBeTruthy();
    expect(screen.queryByText("erro")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sem medição mostra traço, nunca 'erro'", () => {
    render(<VelocidadeCell metrica={undefined} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("erro")).toBeNull();
  });
});
