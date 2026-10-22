import { describe, it, expect } from "vitest";
import {
    erroDoLinkDoGrupo,
    GRUPO_PADRAO,
    linkDoGrupo,
} from "@/lib/grupoDesqualificadas";

describe("erroDoLinkDoGrupo", () => {
    it("aceita convite de grupo do WhatsApp", () => {
        expect(erroDoLinkDoGrupo("https://chat.whatsapp.com/Gd73lCBmXo0CHZylIODKhl")).toBeNull();
        expect(erroDoLinkDoGrupo("https://chat.whatsapp.com/Gd73lCBmXo0CHZylIODKhl?mode=gi_t")).toBeNull();
    });

    it("recusa link de conversa, que abriria um chat em vez do grupo", () => {
        expect(erroDoLinkDoGrupo("https://wa.me/5531990000104")).toContain("convite de grupo");
    });

    it("recusa vazio", () => {
        expect(erroDoLinkDoGrupo("")).toContain("Cole o link");
        expect(erroDoLinkDoGrupo("   ")).toContain("Cole o link");
    });

    it("recusa o que não é endereço", () => {
        expect(erroDoLinkDoGrupo("grupo do whatsapp")).toContain("endereço válido");
    });

    it("recusa http sem s", () => {
        expect(erroDoLinkDoGrupo("http://chat.whatsapp.com/Gd73lCBmXo0CHZylIODKhl")).toContain("https");
    });

    it("recusa link sem o código do convite", () => {
        expect(erroDoLinkDoGrupo("https://chat.whatsapp.com/")).toContain("código");
    });
});

describe("linkDoGrupo", () => {
    it("usa o do banco quando ele serve", () => {
        const outro = "https://chat.whatsapp.com/OutroGrupoDeConvite99";
        expect(linkDoGrupo(outro)).toBe(outro);
    });

    it("cai no padrão quando o banco está vazio ou com lixo", () => {
        // Importa que isto nunca volte vazio: o botão com href vazio é o 404 de
        // volta, que foi exatamente o problema.
        for (const ruim of ["", "   ", null, undefined, "https://wa.me/5531999999999", "qualquer coisa"]) {
            expect(linkDoGrupo(ruim)).toBe(GRUPO_PADRAO);
        }
    });

    it("o padrão é um convite de grupo válido", () => {
        expect(erroDoLinkDoGrupo(GRUPO_PADRAO)).toBeNull();
    });

    it("nunca devolve um caminho interno — era /nqualf que dava 404", () => {
        for (const entrada of ["/nqualf", "", null]) {
            expect(linkDoGrupo(entrada).startsWith("https://chat.whatsapp.com/")).toBe(true);
        }
    });
});
