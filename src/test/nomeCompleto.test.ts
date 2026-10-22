import { describe, expect, it } from "vitest";
import { ehProvisorio, melhorNome } from "@/lib/nomeCompleto";

describe("nome provisório", () => {
    it("reconhece o que o sistema inventa quando não sabe quem é", () => {
        expect(ehProvisorio("Futura Aluna")).toBe(true);
        expect(ehProvisorio("futura aluna")).toBe(true);
        expect(ehProvisorio("Sem nome")).toBe(true);
        expect(ehProvisorio("")).toBe(true);
        expect(ehProvisorio(null)).toBe(true);
    });

    it("nome de gente não é provisório", () => {
        expect(ehProvisorio("Anna")).toBe(false);
        expect(ehProvisorio("Maria Clara")).toBe(false);
    });
});

describe("qual nome fica gravado", () => {
    it("completa o primeiro nome com o que ela preencheu", () => {
        expect(melhorNome("anna", "Anna Beatriz Souza")).toBe("Anna Beatriz Souza");
    });

    it("substitui o nome provisório do link sem nome", () => {
        expect(melhorNome("Futura Aluna", "Carla Rocha")).toBe("Carla Rocha");
        expect(melhorNome("", "Carla Rocha")).toBe("Carla Rocha");
    });

    it("ignora acento e caixa pra comparar o primeiro nome", () => {
        expect(melhorNome("monica", "Mônica Alves Pereira")).toBe("Mônica Alves Pereira");
    });

    it("NÃO troca quando o primeiro nome é outro — renomearia a pessoa errada", () => {
        expect(melhorNome("Maria", "Ana Paula Silva")).toBe("Maria");
    });

    it("não encurta quem já está completo", () => {
        expect(melhorNome("Maria Clara Souza", "Maria Clara")).toBe("Maria Clara Souza");
        expect(melhorNome("Maria Clara Souza", "Maria")).toBe("Maria Clara Souza");
    });

    it("formulário vazio ou provisório não mexe em nada", () => {
        expect(melhorNome("anna", "")).toBe("anna");
        expect(melhorNome("anna", null)).toBe("anna");
        expect(melhorNome("anna", "Sem nome")).toBe("anna");
    });

    it("mesmo nome não muda nada", () => {
        expect(melhorNome("Carla Rocha", "Carla Rocha")).toBe("Carla Rocha");
    });
});
