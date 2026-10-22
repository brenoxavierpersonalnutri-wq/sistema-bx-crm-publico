import { describe, expect, it, vi } from "vitest";
import {
    comLimiteDeTempo,
    ehFalhaPassageira,
    mensagemDeErroDeAutenticacao,
    TempoEsgotado,
} from "@/lib/autenticacao";

describe("limite de tempo", () => {
    it("devolve o resultado quando a promessa responde a tempo", async () => {
        await expect(comLimiteDeTempo(Promise.resolve("ok"), 50)).resolves.toBe("ok");
    });

    it("rejeita com TempoEsgotado quando o servidor nunca responde", async () => {
        vi.useFakeTimers();
        // Promessa que nunca resolve: é o login travado que o time viu.
        const travada = comLimiteDeTempo(new Promise<never>(() => { }), 20_000);
        const esperado = expect(travada).rejects.toBeInstanceOf(TempoEsgotado);
        await vi.advanceTimersByTimeAsync(20_000);
        await esperado;
        vi.useRealTimers();
    });

    it("preserva o erro original quando a promessa falha antes do limite", async () => {
        await expect(
            comLimiteDeTempo(Promise.reject(new Error("caiu")), 50)
        ).rejects.toThrow("caiu");
    });
});

describe("mensagem de erro", () => {
    it("nunca devolve {} — era o que o toast mostrava", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "{}" })).toContain("sem descrição");
        expect(mensagemDeErroDeAutenticacao({})).toContain("sem descrição");
        expect(mensagemDeErroDeAutenticacao({ message: "" })).toContain("sem descrição");
        expect(mensagemDeErroDeAutenticacao({ message: "[object Object]" })).toContain("sem descrição");
    });

    it("diz que a senha está errada quando é isso mesmo", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "Invalid login credentials" }))
            .toBe("E-mail ou senha incorretos.");
    });

    it("separa falha do banco de erro de senha", () => {
        const texto = mensagemDeErroDeAutenticacao({ message: "Database error saving new user" });
        expect(texto).toContain("banco de dados");
        expect(texto).toContain("Não é a sua senha");
    });

    it("explica o tempo esgotado sem jargão", () => {
        expect(mensagemDeErroDeAutenticacao(new TempoEsgotado())).toContain("não respondeu");
    });

    it("deixa passar mensagem desconhecida em vez de engolir", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "Algo bem específico" }))
            .toBe("Algo bem específico");
    });
});

describe("erro sem texto ainda diz alguma coisa", () => {
    it("usa o código quando o texto vem vazio", () => {
        const texto = mensagemDeErroDeAutenticacao({ message: "", code: "unexpected_failure" });
        expect(texto).toContain("Não é a sua senha");
    });

    it("traduz o código conhecido mesmo sem texto", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "{}", code: "over_request_rate_limit" }))
            .toContain("Muitas tentativas");
    });

    it("mostra o código desconhecido em vez de engolir", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "", code: "algo_novo_do_servidor" }))
            .toContain("algo_novo_do_servidor");
    });

    it("separa servidor caído de senha errada pelo status", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "", status: 500 })).toContain("erro 500");
        expect(mensagemDeErroDeAutenticacao({ message: "", status: 500 })).toContain("Não é a sua senha");
        expect(mensagemDeErroDeAutenticacao({ message: "", status: 429 })).toContain("Muitas tentativas");
        expect(mensagemDeErroDeAutenticacao({ message: "", status: 400 })).toContain("erro 400");
    });

    it("texto continua tendo prioridade sobre código", () => {
        expect(mensagemDeErroDeAutenticacao({ message: "Invalid login credentials", status: 400 }))
            .toBe("E-mail ou senha incorretos.");
    });
});

describe("quando vale tentar de novo", () => {
    it("tenta de novo em falha de servidor", () => {
        expect(ehFalhaPassageira({ status: 500 })).toBe(true);
        expect(ehFalhaPassageira({ status: 502 })).toBe(true);
        expect(ehFalhaPassageira({ code: "unexpected_failure" })).toBe(true);
        expect(ehFalhaPassageira({ message: "Failed to fetch" })).toBe(true);
    });

    it("tenta de novo no erro totalmente vazio — foi o que o servidor devolveu", () => {
        expect(ehFalhaPassageira({})).toBe(true);
        expect(ehFalhaPassageira({ message: "{}" })).toBe(true);
    });

    it("NÃO repete senha errada: gastaria o limite de tentativas da conta", () => {
        expect(ehFalhaPassageira({ status: 400, message: "Invalid login credentials" })).toBe(false);
        expect(ehFalhaPassageira({ message: "Invalid login credentials" })).toBe(false);
    });

    it("não repete recusa conhecida do servidor", () => {
        expect(ehFalhaPassageira({ status: 429 })).toBe(false);
        expect(ehFalhaPassageira({ code: "over_request_rate_limit" })).toBe(false);
        expect(ehFalhaPassageira({ status: 401 })).toBe(false);
    });

    it("não repete tempo esgotado: dobraria a espera com a tela parada", () => {
        expect(ehFalhaPassageira(new TempoEsgotado())).toBe(false);
    });
});
