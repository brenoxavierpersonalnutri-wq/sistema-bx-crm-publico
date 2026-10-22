// Banco de dados rápido (/crm/banco): RPCs crm_segmento_contar / crm_segmento_listar (migration 20261029110000)
// e a regra de Alunas ativas / Ex-alunas do sistema do fitness. A regra em SQL é testada em
// supabase/tests/banco-segmentos (Postgres local); aqui, o lado da tela.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

const { SEGMENTOS_PADRAO, REGRA_ALUNAS, normalizarSegmento } = await import("@/lib/crm/segmentos");
const mod = await import("@/hooks/useSegmentos");

const doBanco = (slug: string) => ({ ...SEGMENTOS_PADRAO.find((s) => s.slug === slug)!, provisorio: false });

describe("segmentos de alunas: regra do sistema do fitness", () => {
  it("ex-alunas não depende mais da base de leads (sem 'comprador'), ativas idem", () => {
    expect(SEGMENTOS_PADRAO.find((s) => s.slug === "ex-alunas")!.filtro).toEqual({ alunas: "ex" });
    expect(SEGMENTOS_PADRAO.find((s) => s.slug === "alunas-ativas")!.filtro).toEqual({ alunas: "ativas" });
    expect(normalizarSegmento({ id: "x", nome: "Ex", filtro: { alunas: "ex" } })?.filtro).toEqual({ alunas: "ex" });
  });
  it("texto da regra diz a fonte e o critério exato", () => {
    expect(REGRA_ALUNAS.ativas).toMatch(/Gestão de Alunas/);
    expect(REGRA_ALUNAS.ativas).toMatch(/vencimento do plano hoje ou depois/);
    expect(REGRA_ALUNAS.ativas).toMatch(/status ativa\/inativa não entra/);
    expect(REGRA_ALUNAS.ativas).toMatch(/teste/);
    expect(REGRA_ALUNAS.ex).toMatch(/Monitoramento das Consultas/);
    expect(REGRA_ALUNAS.ex).toMatch(/convertida, sem reembolso/);
    expect(REGRA_ALUNAS.ex).toMatch(/não é aluna ativa/);
  });
});

describe("RPC dos segmentos", () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });

  it("argsListar: deslocamento vira página, filtros vazios não vão", () => {
    const s = doBanco("avaliacao-qualificados");
    expect(mod.argsListar(s, { busca: "  ana ", comTelefone: false }, 100, 50))
      .toEqual({ p_slug: "avaliacao-qualificados", p_filtros: { busca: "ana" }, p_pagina: 2, p_por_pagina: 50 });
    expect(mod.argsListar(s, { de: "2026-10-01", ate: "2026-10-18", comTelefone: true, tag: "comprou" }, 3000, 1000).p_pagina).toBe(3);
    expect(mod.argsListar(s, {}, 0, 5000).p_por_pagina).toBe(1000);
  });

  it("paginaDaRpc: tira o total das linhas; página vazia no começo = 0", () => {
    const r = mod.paginaDaRpc([{ chave: "+55", telefone_e164: "+55", email: null, nome: "A", primeira_entrada: null, ultima_entrada: null, origens: null, tags: ["t"], nivel: "A", comprador: false, total: "3" }], 0);
    expect(r.total).toBe(3);
    expect(r.pessoas[0]).not.toHaveProperty("total");
    expect(r.pessoas[0].origens).toEqual([]);
    expect(mod.paginaDaRpc([], 0).total).toBe(0);
    expect(mod.paginaDaRpc([], 4).total).toBeNull();
  });

  it("contagem e lista saem da RPC (não tocam na visão pesada)", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "crm_segmento_contar" ? { data: 151, error: null } : { data: [{ chave: "k", origens: ["gestao-alunas"], tags: [], total: 151 }], error: null });
    expect(await mod.contarSegmento(doBanco("alunas-ativas"))).toBe(151);
    expect(rpc).toHaveBeenCalledWith("crm_segmento_contar", { p_slug: "alunas-ativas" });
    const p = await mod.lerSegmento(doBanco("ex-alunas"), { busca: "eva" }, 50, 50);
    expect(rpc).toHaveBeenLastCalledWith("crm_segmento_listar", { p_slug: "ex-alunas", p_filtros: { busca: "eva" }, p_pagina: 1, p_por_pagina: 50 });
    expect(p.total).toBe(151);
    expect(from).not.toHaveBeenCalled();
  });

  it("erro de verdade (ex.: timeout) aparece, não vira contagem falsa", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(mod.lerSegmento(doBanco("todos"), {}, 0, 50)).rejects.toThrow(/timeout/);
    expect(await mod.contarSegmento(doBanco("todos"))).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("RPC ausente (migration não rodou): reconhece e cai no caminho antigo", async () => {
    expect(mod.rpcAusente({ code: "PGRST202", message: "Could not find the function public.crm_segmento_contar(p_slug)" })).toBe(true);
    expect(mod.rpcAusente({ code: "57014", message: "timeout" })).toBe(false);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const q: Record<string, unknown> = {};
    const chamadas: unknown[][] = [];
    const proxy: unknown = new Proxy(q, {
      get: (_, k: string) => k === "then"
        ? (ok: (v: unknown) => void) => ok({ data: [], count: 7, error: null })
        : (...a: unknown[]) => { chamadas.push([k, ...a]); return proxy; },
    });
    from.mockReturnValue(proxy);
    expect(await mod.contarSegmento(doBanco("alunas-ativas"))).toBe(7);
    expect(from).toHaveBeenCalledWith("alunas");
    // mesma regra da RPC: sem filtro de status
    expect(chamadas.some((c) => c[0] === "eq" && c[1] === "status")).toBe(false);
    expect(chamadas).toContainEqual(["eq", "is_teste", false]);
  });
});
