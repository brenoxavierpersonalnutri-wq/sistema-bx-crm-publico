import { describe, expect, it } from "vitest";
import { getModuleByPath, podeAbrirRota, temComercial, ROTAS_COMERCIAL } from "@/lib/modules";

describe("área Comercial (Monitoramento das Consultas)", () => {
  it("todas as rotas da área pedem o módulo comercial", () => {
    for (const r of ROTAS_COMERCIAL) expect(getModuleByPath(r)).toBe("comercial");
    expect(getModuleByPath("/vendas/funil/")).toBe("comercial");
  });

  it("sem liberação: barrado em cada rota da área; outras rotas seguem como eram", () => {
    for (const r of ROTAS_COMERCIAL) expect(podeAbrirRota(r, false, ["alunas"])).toBe(false);
    expect(podeAbrirRota("/alunas", false, ["alunas"])).toBe(true);
    expect(podeAbrirRota("/financeiro", false, ["alunas"])).toBe(false);
    expect(podeAbrirRota("/colaborador", false, [])).toBe(true);
  });

  it("com comercial ou admin: abre a área inteira", () => {
    for (const r of ROTAS_COMERCIAL) {
      expect(podeAbrirRota(r, false, ["comercial"])).toBe(true);
      expect(podeAbrirRota(r, true, [])).toBe(true);
    }
  });

  it("liberações antigas valem até o SQL convertê-las", () => {
    expect(temComercial(false, ["vendas"])).toBe(true);
    expect(temComercial(false, ["mensal"])).toBe(true);
    expect(temComercial(false, ["agenda-conteudo"])).toBe(false);
  });
});
