import { describe, expect, it, vi } from "vitest";
import {
    comLimiteDeTempo,
    TempoEsgotado,
    textoDeErro,
} from "@/lib/chamadaAoBanco";

describe("limite de tempo", () => {
    it("deixa passar o resultado que chega a tempo", async () => {
        await expect(comLimiteDeTempo(Promise.resolve("ok"), 50)).resolves.toBe("ok");
    });

    it("corta a consulta pendurada — é o que deixava a tela girando", async () => {
        vi.useFakeTimers();
        const travada = comLimiteDeTempo(new Promise<never>(() => { }), 20_000);
        const esperado = expect(travada).rejects.toBeInstanceOf(TempoEsgotado);
        await vi.advanceTimersByTimeAsync(20_000);
        await esperado;
        vi.useRealTimers();
    });
});

describe("texto do erro", () => {
    it("usa a mensagem do Postgres, que é a mais útil", () => {
        expect(textoDeErro({ message: "new row violates row-level security policy" }, "padrão"))
            .toBe("new row violates row-level security policy");
    });

    it("cai pra details e hint quando a mensagem vem vazia", () => {
        expect(textoDeErro({ message: "", details: "coluna x não existe" }, "padrão"))
            .toBe("coluna x não existe");
        expect(textoDeErro({ message: "", details: "", hint: "rode a migration" }, "padrão"))
            .toBe("rode a migration");
    });

    it("mostra o código quando não há texto nenhum", () => {
        expect(textoDeErro({ code: "42P01" }, "Não consegui gerar"))
            .toBe("Não consegui gerar (código 42P01).");
    });

    it("nunca devolve aviso vazio", () => {
        expect(textoDeErro({}, "Não consegui gerar")).toContain("não disse o motivo");
        expect(textoDeErro({ message: "{}" }, "Não consegui gerar")).toContain("não disse o motivo");
        expect(textoDeErro(null, "Não consegui gerar")).toContain("não disse o motivo");
    });

    it("explica o tempo esgotado sem jargão", () => {
        const texto = textoDeErro(new TempoEsgotado(), "Não consegui carregar a anamnese");
        expect(texto).toContain("Não consegui carregar a anamnese");
        expect(texto).toContain("não respondeu");
    });
});
