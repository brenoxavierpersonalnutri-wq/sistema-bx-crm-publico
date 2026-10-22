import { describe, expect, it } from "vitest";
import {
    erroDoNumero,
    soDigitos,
    whatsappDoTime,
    WHATSAPP_DO_TIME_PADRAO,
} from "@/lib/destinoDasLeads";

describe("número do WhatsApp do time", () => {
    it("aceita o formato com DDI e DDD", () => {
        expect(erroDoNumero("5531990000104")).toBeNull();
        expect(erroDoNumero("+55 (31) 99000-0104")).toBeNull();
    });

    it("recusa número sem DDI — abriria conversa vazia, sem erro visível", () => {
        expect(erroDoNumero("31990000104")).toContain("55");
    });

    it("recusa número curto e número comprido demais", () => {
        expect(erroDoNumero("5531999")).toContain("curto");
        expect(erroDoNumero("55319900001041234")).toContain("comprido");
    });

    it("recusa vazio", () => {
        expect(erroDoNumero("")).toContain("DDI");
        expect(erroDoNumero("abc")).toContain("DDI");
    });

    it("tira tudo que não é dígito", () => {
        expect(soDigitos("+55 (31) 99000-0104")).toBe("5531990000104");
    });
});

describe("qual número vale de verdade", () => {
    it("usa o do banco quando ele serve", () => {
        expect(whatsappDoTime("+55 31 99999-8888")).toBe("5531999998888");
    });

    it("cai no padrão quando o banco está vazio", () => {
        expect(whatsappDoTime(null)).toBe(WHATSAPP_DO_TIME_PADRAO);
        expect(whatsappDoTime("")).toBe(WHATSAPP_DO_TIME_PADRAO);
    });

    it("cai no padrão quando o banco tem lixo — melhor o número certo que nenhum", () => {
        expect(whatsappDoTime("31990000104")).toBe(WHATSAPP_DO_TIME_PADRAO);
        expect(whatsappDoTime("liga pra mim")).toBe(WHATSAPP_DO_TIME_PADRAO);
    });
});
