import { describe, it, expect } from "vitest";
import {
    apenasDigitos,
    linkDeWhatsapp,
    numeroParaWhatsapp,
    telefoneCompleto,
    telefoneParecePlausivel,
} from "@/lib/telefoneDaLead";

describe("apenasDigitos", () => {
    it("tira espaço, traço, parêntese e mais", () => {
        expect(apenasDigitos("3414 34 424")).toBe("341434424");
        expect(apenasDigitos("(31) 99999-9999")).toBe("31999999999");
        expect(apenasDigitos("+55 31 99999 9999")).toBe("5531999999999");
    });

    it("aguenta vazio e nulo", () => {
        expect(apenasDigitos("")).toBe("");
        expect(apenasDigitos(null)).toBe("");
        expect(apenasDigitos(undefined)).toBe("");
    });
});

describe("telefoneCompleto", () => {
    it("monta com o DDI e sem nenhum espaço", () => {
        // Era exatamente este caso do print: espaços no meio chegando ao banco.
        expect(telefoneCompleto("55", "3414 34 424")).toBe("+55341434424");
        expect(telefoneCompleto("55", "(31) 99999-9999")).toBe("+5531999999999");
    });

    it("não duplica o DDI de quem colou o número inteiro", () => {
        expect(telefoneCompleto("55", "+55 31 99999-9999")).toBe("+5531999999999");
        expect(telefoneCompleto("55", "5531999999999")).toBe("+5531999999999");
    });

    it("NÃO confunde o DDD 55 com DDI — número do RS continua inteiro", () => {
        // 55 é DDD do Rio Grande do Sul. Olhar só o começo comeria o DDD e
        // deixaria a lead com um número que não existe.
        expect(telefoneCompleto("55", "55999887766")).toBe("+5555999887766");
        expect(telefoneCompleto("55", "5533334444")).toBe("+555533334444");
    });

    it("respeita outro DDI do seletor de país", () => {
        expect(telefoneCompleto("351", "912 345 678")).toBe("+351912345678");
        expect(telefoneCompleto("351", "351912345678")).toBe("+351912345678");
    });

    it("sem número, não inventa telefone", () => {
        expect(telefoneCompleto("55", "")).toBeNull();
        expect(telefoneCompleto("55", "   ")).toBeNull();
        expect(telefoneCompleto("55", null)).toBeNull();
    });

    it("sem DDI escolhido, assume Brasil", () => {
        expect(telefoneCompleto("", "31999999999")).toBe("+5531999999999");
    });

    it("o que sai nunca tem espaço nem pontuação", () => {
        for (const entrada of ["3414 34 424", "(31) 9 9999-9999", "+55 31 99999.9999"]) {
            const saida = telefoneCompleto("55", entrada);
            expect(saida).toMatch(/^\+\d+$/);
        }
    });
});

describe("telefoneParecePlausivel", () => {
    it("recusa número curto demais, mesmo com espaços enchendo", () => {
        expect(telefoneParecePlausivel("123 45")).toBe(false);
        expect(telefoneParecePlausivel("      ")).toBe(false);
    });

    it("aceita a partir de 8 dígitos", () => {
        expect(telefoneParecePlausivel("3333 4444")).toBe(true);
        expect(telefoneParecePlausivel("31999999999")).toBe(true);
    });
});

describe("numeroParaWhatsapp", () => {
    it("põe o DDI em número que não tem (linhas antigas de consultations)", () => {
        expect(numeroParaWhatsapp("31999887766")).toBe("5531999887766");
        expect(numeroParaWhatsapp("3133334444")).toBe("553133334444");
    });

    it("NÃO duplica o DDI de quem já tem (lead_form_responses, e agendamento novo)", () => {
        // Era este o link quebrado: "55" + "+5531999887766" virava
        // wa.me/555531999887766, que abre conversa com ninguém.
        expect(numeroParaWhatsapp("+5531999887766")).toBe("5531999887766");
        expect(numeroParaWhatsapp("5531999887766")).toBe("5531999887766");
    });

    it("não estraga número de fora do Brasil", () => {
        expect(numeroParaWhatsapp("+351912345678")).toBe("351912345678");
    });

    it("tira espaço e pontuação do que está gravado torto", () => {
        expect(numeroParaWhatsapp("3414 34 424")).toBe("55341434424");
        expect(numeroParaWhatsapp("(31) 99988-7766")).toBe("5531999887766");
    });

    it("sem número, não inventa link", () => {
        expect(numeroParaWhatsapp("")).toBeNull();
        expect(numeroParaWhatsapp(null)).toBeNull();
        expect(numeroParaWhatsapp("Não informado")).toBeNull();
    });
});

describe("linkDeWhatsapp", () => {
    it("monta o link com o número já corrigido", () => {
        expect(linkDeWhatsapp("31999887766")).toBe("https://wa.me/5531999887766");
        expect(linkDeWhatsapp("+5531999887766")).toBe("https://wa.me/5531999887766");
    });

    it("codifica o texto da mensagem", () => {
        const link = linkDeWhatsapp("31999887766", "Olá, tudo bem?");
        expect(link).toContain("?text=");
        expect(link).not.toContain(" ");
    });

    it("sem número, não devolve link", () => {
        expect(linkDeWhatsapp(null)).toBeNull();
    });
});
