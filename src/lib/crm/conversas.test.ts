import { describe, expect, it } from "vitest";
import { iniciais } from "./conversas";

describe("iniciais", () => {
  it("ignora emoji no fim", () => {
    expect(iniciais("Pequeno Rebanho 🐑")).toBe("PR");
    expect(iniciais("Fundo de Funil 🧙🏼‍♂️")).toBe("FF");
  });
  it("nunca devolve surrogate solto", () => {
    expect(iniciais("🐑 Pequeno")).not.toMatch(/[\uD800-\uDFFF]/);
    expect(iniciais("P🐑")).toBe("P");
  });
  it("só emoji devolve o emoji inteiro", () => {
    expect(iniciais("🧙🏼‍♂️")).toBe("🧙🏼‍♂️");
    expect(iniciais("🐑")).toBe("🐑");
  });
  it("só símbolos devolve #", () => {
    expect(iniciais("!!!")).toBe("#");
  });
  it("casos normais", () => {
    expect(iniciais("Ana Souza")).toBe("AS");
    expect(iniciais("Ana")).toBe("AN");
    expect(iniciais("Álvaro")).toBe("ÁL");
    expect(iniciais("+55 (11) 99999-1234")).toBe("34");
    expect(iniciais("", "xx")).toBe("xx");
  });
});
