import { describe, it, expect } from "vitest";
import { telefoneParaE164, separarTags, dataDeOrigem, linhaParaLead, emLotes, celulaCsv, lerTodasAsPaginas } from "@/lib/baseLeads";

describe("telefoneParaE164", () => {
  it("normaliza formatos BR", () => {
    expect(telefoneParaE164("+5531999998888")).toBe("+5531999998888");
    expect(telefoneParaE164("(31) 99999-8888")).toBe("+5531999998888");
    expect(telefoneParaE164("031 99999 8888")).toBe("+5531999998888");
    expect(telefoneParaE164("3133334444")).toBe("+553133334444");
    expect(telefoneParaE164("553133334444")).toBe("+553133334444");
  });
  it("rejeita inválidos", () => {
    expect(telefoneParaE164("")).toBeNull();
    expect(telefoneParaE164(null)).toBeNull();
    expect(telefoneParaE164("+1415555")).toBeNull();
    expect(telefoneParaE164("1234567")).toBeNull();
    expect(telefoneParaE164("+5501999998888")).toBeNull();
    expect(telefoneParaE164("31 89999-8888")).toBeNull();
  });
});

describe("separarTags", () => {
  it("separa por vírgula e ponto e vírgula, sem vazios nem repetidas", () => {
    expect(separarTags("a, b;c,,a ; ")).toEqual(["a", "b", "c"]);
    expect(separarTags("")).toEqual([]);
    expect(separarTags(undefined)).toEqual([]);
  });
});

describe("dataDeOrigem", () => {
  it("converte dd/mm/aaaa hh:mm:ss de Brasília para UTC", () => {
    expect(dataDeOrigem("16/10/2026 14:30:05")).toBe("2026-10-16T17:30:05.000Z");
    expect(dataDeOrigem("lixo")).toBeNull();
  });
});

describe("linhaParaLead / lotes / csv", () => {
  it("monta a linha", () => {
    const l = linhaParaLead({ id: "9", name: " Ana ", phone: "31999998888", email: "A@B.com", tags: "x,y", status: "1", created_at: "01/01/2026 00:00:00", "nome-do-produto": "P" });
    expect(l).toMatchObject({ origem_id: "9", nome: "Ana", telefone_e164: "+5531999998888", email: "a@b.com", tags: ["x", "y"], produto: "P" });
    expect(l?.origem).toBe("sellflux");
    expect(linhaParaLead({ id: "" } as never)).toBeNull();
  });
  it("origem pagtrust pelo prefixo do id", () => {
    expect(linhaParaLead({ id: "pagtrust:yahoo:123" } as never)).toMatchObject({ origem: "pagtrust", origem_id: "pagtrust:yahoo:123" });
    expect(linhaParaLead({ id: "x-pagtrust:1" } as never)?.origem).toBe("sellflux");
  });
  it("lotes de 500", () => {
    expect(emLotes(Array.from({ length: 1001 }, (_, i) => i)).map((l) => l.length)).toEqual([500, 500, 1]);
  });
  it("protege fórmula e aspas", () => {
    expect(celulaCsv("=1+1")).toBe("'=1+1");
    expect(celulaCsv('a"b')).toBe('"a""b"');
    expect(celulaCsv(["x", "y"])).toBe('"x,y"');
  });
});

describe("lerTodasAsPaginas", () => {
  const fonte = (total: number) => {
    const chamadas: Array<[number, number]> = [];
    const buscar = async (de: number, ate: number) => {
      chamadas.push([de, ate]);
      const fim = Math.min(ate, total - 1);
      return fim < de ? [] : Array.from({ length: fim - de + 1 }, (_, i) => de + i);
    };
    return { buscar, chamadas };
  };

  it("tabela pequena: uma requisição só", async () => {
    const { buscar, chamadas } = fonte(7);
    expect(await lerTodasAsPaginas(buscar, { tamanho: 10 })).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(chamadas).toEqual([[0, 9]]);
  });

  it("lê tudo, em ordem, sem duplicar, com páginas em paralelo", async () => {
    const { buscar } = fonte(42_137);
    const avancos: number[] = [];
    const r = await lerTodasAsPaginas(buscar, { tamanho: 1000, paralelo: 4, aoAvancar: (p) => avancos.push(p.length) });
    expect(r.length).toBe(42_137);
    expect(r[0]).toBe(0);
    expect(r[r.length - 1]).toBe(42_136);
    expect(new Set(r).size).toBe(42_137);
    expect(avancos[0]).toBe(1000);
    expect(avancos[avancos.length - 1]).toBe(42_137);
  });

  it("total múltiplo exato do tamanho termina", async () => {
    const { buscar } = fonte(3000);
    expect((await lerTodasAsPaginas(buscar, { tamanho: 1000, paralelo: 2 })).length).toBe(3000);
  });

  it("erro em qualquer página rejeita (a tela sai do carregando)", async () => {
    const buscar = async (de: number) => {
      if (de === 5000) throw new Error("canceling statement due to statement timeout");
      return Array.from({ length: 1000 }, (_, i) => de + i);
    };
    await expect(lerTodasAsPaginas(buscar, { tamanho: 1000, paralelo: 4 })).rejects.toThrow("statement timeout");
  });
});
