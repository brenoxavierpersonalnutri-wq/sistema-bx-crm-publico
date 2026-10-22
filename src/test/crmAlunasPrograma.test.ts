// Alunas ativas por programa (MGMD / ELITE / PLATAFORMA) — migration 20261031100000. A regra em SQL
// (de-para, dedup por telefone, RPCs) é testada em supabase/tests/alunas-programa; aqui, o lado da tela.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

const { SEGMENTOS_PADRAO, normalizarSegmento, regraAlunas, nomeCompletoSegmento, VALORES_PROGRAMA } = await import("@/lib/crm/segmentos");
const mod = await import("@/hooks/useSegmentos");

describe("4 segmentos de alunas ativas", () => {
  it("Todas + MGMD + ELITE + PLATAFORMA, nessa ordem, com o filtro de programa", () => {
    const al = SEGMENTOS_PADRAO.filter((s) => s.filtro.alunas === "ativas");
    expect(al.map((s) => s.nome)).toEqual(["Alunas ativas — Todas", "MGMD", "ELITE", "PLATAFORMA"]);
    expect(al.map((s) => s.filtro.programa ?? null)).toEqual([null, "mgmd", "elite", "plataforma"]);
  });
  it("de-para padrão = valores reais de alunas.programa (alunaTypes.ts)", () => {
    expect(VALORES_PROGRAMA).toEqual({ mgmd: ["menos_gordura"], elite: ["elite"], plataforma: ["plataforma_magra"] });
  });
  it("normalizarSegmento guarda programa só junto de alunas e só se válido", () => {
    expect(normalizarSegmento({ id: "x", nome: "MGMD", filtro: { alunas: "ativas", programa: "mgmd" } })?.filtro).toEqual({ alunas: "ativas", programa: "mgmd" });
    expect(normalizarSegmento({ id: "x", nome: "X", filtro: { alunas: "ativas", programa: "slim" } })?.filtro).toEqual({ alunas: "ativas" });
    expect(normalizarSegmento({ id: "x", nome: "X", filtro: { programa: "mgmd" } })?.filtro).toEqual({});
  });
  it("regra e nome no seletor de gatilho deixam claro o programa", () => {
    expect(regraAlunas({ alunas: "ativas", programa: "elite" })).toMatch(/Programa ELITE: alunas.programa = elite/);
    expect(regraAlunas({ alunas: "ativas" })).toMatch(/Uma linha por pessoa/);
    expect(nomeCompletoSegmento("MGMD", { alunas: "ativas", programa: "mgmd" })).toBe("Alunas ativas — MGMD");
    expect(nomeCompletoSegmento("Ex-alunas", { alunas: "ex" })).toBe("Ex-alunas");
  });
});

describe("leitura", () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });
  it("pelo banco: contagem do MGMD vai pela RPC com o slug", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });
    const s = { ...SEGMENTOS_PADRAO.find((x) => x.slug === "alunas-ativas-mgmd")!, provisorio: false };
    expect(await mod.contarSegmento(s)).toBe(42);
    expect(rpc).toHaveBeenCalledWith("crm_segmento_contar", { p_slug: "alunas-ativas-mgmd" });
  });
  it("caminho antigo (seed): filtra alunas.programa pelo de-para", async () => {
    const chamadas: [string, unknown[]][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "in", "ilike", "order"]) q[m] = (...a: unknown[]) => { chamadas.push([m, a]); return q; };
    q.range = () => Promise.resolve({ data: [], count: 0, error: null });
    from.mockReturnValue(q);
    const s = SEGMENTOS_PADRAO.find((x) => x.slug === "alunas-ativas-plataforma")!;
    await mod.lerSegmento(s, {}, 0, 0);
    expect(chamadas).toContainEqual(["in", ["programa", ["plataforma_magra"]]]);
  });
});
