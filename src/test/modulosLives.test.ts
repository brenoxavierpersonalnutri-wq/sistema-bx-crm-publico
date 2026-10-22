// Liberação do módulo "lives": a área inteira (/lives e sub-rotas) segue a mesma chave.
import { describe, expect, it } from "vitest";
import { getModuleByPath, podeAbrirRota } from "@/lib/modules";

describe("módulo lives", () => {
  it("/lives e sub-rotas pedem a liberação lives", () => {
    for (const r of ["/lives", "/lives/", "/lives/estudio/abc", "/lives/webinar/abc/editar", "/lives/webinar/abc/ao-vivo"]) {
      expect(getModuleByPath(r)).toBe("lives");
      expect(podeAbrirRota(r, false, [])).toBe(false);
      expect(podeAbrirRota(r, false, ["lives"])).toBe(true);
      expect(podeAbrirRota(r, true, [])).toBe(true);
    }
  });
  it("não mexe nas outras áreas", () => {
    expect(getModuleByPath("/webinar")).toBeNull();
    expect(getModuleByPath("/funis")).toBe("funis");
  });
});
