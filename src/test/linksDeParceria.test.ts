import { describe, it, expect } from "vitest";
import { apelidoDaParceira, linksDaParceria } from "@/lib/linksDeParceria";
import { DOMINIO_PUBLICO } from "@/lib/linkPublico";

describe("apelidoDaParceira", () => {
    it("tira o arroba e baixa a caixa", () => {
        expect(apelidoDaParceira("@MariaFit")).toBe("mariafit");
    });

    it("troca o que não é letra nem número por traço, sem repetir", () => {
        expect(apelidoDaParceira("maria.fit_oficial")).toBe("maria-fit-oficial");
        expect(apelidoDaParceira("maria   fit")).toBe("maria-fit");
    });

    it("não deixa traço sobrando nas pontas", () => {
        expect(apelidoDaParceira("@_maria_")).toBe("maria");
    });

    it("aguenta vazio e lixo sem quebrar", () => {
        expect(apelidoDaParceira("")).toBe("");
        expect(apelidoDaParceira("@@@")).toBe("");
    });
});

describe("linksDaParceria", () => {
    it("aponta pro domínio público do app, não pra um endereço escrito à mão", () => {
        // O bug era este: o domínio estava cravado como "novav.com.br", que não
        // aponta pra servidor nenhum. Prender ao DOMINIO_PUBLICO é o que impede
        // os dois de divergirem de novo.
        const { avaliacao, individual } = linksDaParceria("@mariafit");
        expect(avaliacao.startsWith(DOMINIO_PUBLICO)).toBe(true);
        expect(individual.startsWith(DOMINIO_PUBLICO)).toBe(true);
    });

    it("manda a avaliação pro formulário, não pra raiz (que é a tela logada)", () => {
        expect(linksDaParceria("@mariafit").avaliacao).toContain("/avaliacao?");
    });

    it("manda a individual pro /individual, que é o que etiqueta a origem", () => {
        expect(linksDaParceria("@mariafit").individual).toContain("/individual?");
    });

    it("leva as UTMs que dizem de qual parceira veio a lead", () => {
        const { avaliacao, individual } = linksDaParceria("@MariaFit");
        for (const url of [avaliacao, individual]) {
            const params = new URL(url).searchParams;
            expect(params.get("utm_source")).toBe("mariafit");
            expect(params.get("utm_medium")).toBe("parceria");
            expect(params.get("utm_campaign")).toBe("influencer");
        }
    });

    it("sem instagram, ainda gera link válido em vez de um utm_source vazio", () => {
        const { avaliacao } = linksDaParceria("");
        expect(new URL(avaliacao).searchParams.get("utm_source")).toBe("parceira");
    });

    it("os dois links são endereços que o navegador aceita", () => {
        const { avaliacao, individual } = linksDaParceria("@maria.fit");
        for (const url of [avaliacao, individual]) {
            expect(() => new URL(url)).not.toThrow();
            expect(new URL(url).protocol).toBe("https:");
        }
    });
});
