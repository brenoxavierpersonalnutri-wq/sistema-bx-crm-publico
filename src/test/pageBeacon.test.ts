import { describe, it, expect, vi } from "vitest";
import { cmClickValido, montarBeacon, msValido, tipoDeNavegacao } from "@/lib/pageBeacon";

const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("msValido", () => {
  it("arredonda e aceita 0..120000", () => {
    expect(msValido(812.6)).toBe(813);
    expect(msValido(0)).toBe(0);
    expect(msValido(120000)).toBe(120000);
  });
  it("fora da faixa ou não número vira null", () => {
    expect(msValido(-1)).toBeNull();
    expect(msValido(120001)).toBeNull();
    expect(msValido(NaN)).toBeNull();
    expect(msValido("500")).toBeNull();
    expect(msValido(undefined)).toBeNull();
  });
});

describe("cmClickValido", () => {
  it("só uuid passa", () => {
    expect(cmClickValido(UUID.toUpperCase())).toBe(UUID);
    expect(cmClickValido("abc")).toBeNull();
    expect(cmClickValido(null)).toBeNull();
  });
});

describe("tipoDeNavegacao", () => {
  it("doc quando o documento é a própria variação; spa quando veio do /r/", () => {
    expect(tipoDeNavegacao({ name: "https://e.com/desafio/v1?x=1" }, "/desafio/v1")).toBe("doc");
    expect(tipoDeNavegacao({ name: "https://e.com/r/desafio?utm_source=meta" }, "/desafio/v1")).toBe("spa");
    expect(tipoDeNavegacao(undefined, "/desafio/v1")).toBe("doc");
  });
});

describe("montarBeacon", () => {
  it("view leva ttfb e render, não leva lcp", () => {
    const row = montarBeacon({
      page: "desafio",
      variant: "V2",
      kind: "view",
      search: `?cm_click=${UUID}&utm_source=meta`,
      nav: "doc",
      ttfb: 210.2,
      render: 1530.7,
      lcp: 9999,
    });
    expect(row).toEqual({
      page: "desafio",
      variant: "v2",
      kind: "view",
      cm_click: UUID,
      nav: "doc",
      ttfb_ms: 210,
      render_ms: 1531,
      lcp_ms: null,
    });
  });
  it("vitals leva só lcp; cm_click inválido vira null", () => {
    const row = montarBeacon({ page: "desafio", variant: "v1", kind: "vitals", search: "?cm_click=xx", nav: "doc", lcp: 2400, render: 1 });
    expect(row).toMatchObject({ cm_click: null, lcp_ms: 2400, render_ms: null, ttfb_ms: null });
  });
  it("página ou variação fora do padrão: não manda nada", () => {
    expect(montarBeacon({ page: "desafio", variant: "v1; drop", kind: "view", search: "", nav: "doc" })).toBeNull();
    expect(montarBeacon({ page: "", variant: "v1", kind: "view", search: "", nav: "doc" })).toBeNull();
  });
});

describe("montarBeacon por caminho", () => {
  it("spa: TTFB null (seria o do /r/), render conta do /r/ até pintar", () => {
    const row = montarBeacon({ page: "desafio", variant: "v1", kind: "view", search: "", nav: "spa", ttfb: 150, render: 900 });
    expect(row).toMatchObject({ nav: "spa", ttfb_ms: null, render_ms: 900 });
  });
  it("aba oculta: conta a view, sem tempo", () => {
    const row = montarBeacon({ page: "desafio", variant: "v1", kind: "view", search: "", nav: "doc", ttfb: 150, render: 900, oculta: true });
    expect(row).toMatchObject({ kind: "view", ttfb_ms: 150, render_ms: null });
  });
});

import { agendarUmaVez } from "@/lib/pageBeacon";

describe("agendarUmaVez", () => {
  it("sem rAF (aba oculta) dispara pela reserva, uma vez", () => {
    const filas: Array<[() => void, number]> = [];
    const fn = vi.fn();
    const disparar = agendarUmaVez(fn, { raf: () => 0, timeout: (cb, ms) => filas.push([cb, ms]), reservaMs: 1000 });
    expect(filas.map(([, ms]) => ms)).toEqual([1000]);
    filas[0][0]();
    disparar();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("com rAF dispara no quadro e a reserva não repete", () => {
    const filas: Array<() => void> = [];
    const fn = vi.fn();
    agendarUmaVez(fn, { raf: (cb) => cb(), timeout: (cb) => filas.push(cb) });
    filas.forEach((cb) => cb());
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("rAF que lança erro não impede a reserva", () => {
    const filas: Array<() => void> = [];
    const fn = vi.fn();
    agendarUmaVez(fn, { raf: () => { throw new Error("x"); }, timeout: (cb) => filas.push(cb) });
    filas.forEach((cb) => cb());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
