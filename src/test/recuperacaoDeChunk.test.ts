import { describe, expect, it } from "vitest";
import {
    decidirRecarga,
    ehErroDeChunk,
    JANELA_DE_CONTAGEM_MS,
    lerEstado,
    MAXIMO_DE_RECARGAS,
    textoDoErro,
} from "@/lib/recuperacaoDeChunk";

describe("reconhece o pedaço que sumiu", () => {
    it("pega as mensagens dos navegadores", () => {
        expect(ehErroDeChunk("Failed to fetch dynamically imported module: https://x/assets/a-1.js")).toBe(true);
        expect(ehErroDeChunk("error loading dynamically imported module")).toBe(true);
        expect(ehErroDeChunk("Importing a module script failed.")).toBe(true);
        expect(ehErroDeChunk("Unable to preload CSS for /assets/a-1.css")).toBe(true);
    });

    it("pega pelo arquivo quando a mensagem não diz nada", () => {
        expect(ehErroDeChunk("Script error.", "https://app/assets/Home-9f2a.js")).toBe(true);
    });

    it("não confunde com erro comum da aplicação", () => {
        expect(ehErroDeChunk("Cannot read properties of undefined")).toBe(false);
        expect(ehErroDeChunk("erro", "https://app/src/Home.tsx")).toBe(false);
    });

    it("lê o motivo de uma rejeição, que raramente é Error", () => {
        expect(textoDoErro({ message: "boom" })).toBe("boom");
        expect(textoDoErro("boom")).toBe("boom");
        expect(textoDoErro(undefined)).toBe("");
    });
});

describe("quando recarregar", () => {
    it("recarrega na primeira vez", () => {
        const { recarregar, estado } = decidirRecarga(1_000, null);
        expect(recarregar).toBe(true);
        expect(estado.n).toBe(1);
    });

    it("para no teto pra não entrar em laço", () => {
        const d = decidirRecarga(1_000, { em: 900, n: MAXIMO_DE_RECARGAS });
        expect(d.recarregar).toBe(false);
    });

    it("volta a recarregar numa publicação seguinte — era aqui que travava", () => {
        // Aba aberta o dia todo: o limite de uma vez só deixava a segunda
        // publicação sem recuperação nenhuma.
        const esgotado = { em: 1_000, n: MAXIMO_DE_RECARGAS };
        const depois = 1_000 + JANELA_DE_CONTAGEM_MS + 1;
        const d = decidirRecarga(depois, esgotado);
        expect(d.recarregar).toBe(true);
        expect(d.estado.n).toBe(1);
    });

    it("conta as tentativas dentro da mesma janela", () => {
        const a = decidirRecarga(1_000, null);
        const b = decidirRecarga(2_000, a.estado);
        const c = decidirRecarga(3_000, b.estado);
        const d = decidirRecarga(4_000, c.estado);
        expect([a, b, c].every((x) => x.recarregar)).toBe(true);
        expect(d.recarregar).toBe(false);
    });
});

describe("marca guardada no navegador", () => {
    it("trata ausente e corrompida como sem marca", () => {
        expect(lerEstado(null)).toBeNull();
        expect(lerEstado("não é json")).toBeNull();
        expect(lerEstado('{"em":"ontem"}')).toBeNull();
    });

    it("lê a marca válida", () => {
        expect(lerEstado('{"em":123,"n":2}')).toEqual({ em: 123, n: 2 });
    });
});
