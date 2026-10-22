import { describe, it, expect } from "vitest";
import {
    AGENDA_ALUNAS_MODULE,
    AGENDA_CONTEUDO_MODULE,
    filtroDaAgenda,
    podeCriarTipo,
    podeVerTarefa,
    temCamadaConteudo,
    tiposCompartilhados,
} from "@/lib/agendaCamadas";

const EU = "u-eu";
const OUTRA = "u-outra";

const semNada = { isAdmin: false, modulos: [] as string[] };
const soConteudo = { isAdmin: false, modulos: [AGENDA_CONTEUDO_MODULE] };
const soReavaliacao = { isAdmin: false, modulos: [AGENDA_ALUNAS_MODULE] };
const admin = { isAdmin: true, modulos: [] as string[] };

describe("camada Conteúdo — quem vê", () => {
    it("quem tem a liberação vê tarefa de conteúdo de outra pessoa", () => {
        expect(podeVerTarefa({ userId: OUTRA, type: "conteudo" }, EU, soConteudo)).toBe(true);
    });

    it("admin vê a camada sem precisar da liberação", () => {
        expect(temCamadaConteudo(admin)).toBe(true);
        expect(podeVerTarefa({ userId: OUTRA, type: "conteudo" }, EU, admin)).toBe(true);
    });

    it("sem liberação não vê conteúdo — nem de outra pessoa, nem atribuído a ela", () => {
        expect(podeVerTarefa({ userId: OUTRA, type: "conteudo" }, EU, semNada)).toBe(false);
        expect(podeVerTarefa({ userId: EU, type: "conteudo" }, EU, semNada)).toBe(false);
    });

    it("liberação de Reavaliações não abre a camada de Conteúdo", () => {
        expect(podeVerTarefa({ userId: OUTRA, type: "conteudo" }, EU, soReavaliacao)).toBe(false);
    });

    it("liberação de Conteúdo não abre as reavaliações das alunas", () => {
        expect(podeVerTarefa({ userId: OUTRA, type: "reavaliacao" }, EU, soConteudo)).toBe(false);
        expect(podeVerTarefa({ userId: OUTRA, type: "reavaliacao" }, EU, soReavaliacao)).toBe(true);
    });

    it("as próprias tarefas comuns aparecem sempre; as dos outros, não", () => {
        expect(podeVerTarefa({ userId: EU, type: "manual" }, EU, semNada)).toBe(true);
        expect(podeVerTarefa({ userId: EU, type: "reavaliacao" }, EU, semNada)).toBe(true);
        expect(podeVerTarefa({ userId: OUTRA, type: "manual" }, EU, soConteudo)).toBe(false);
    });
});

describe("camada Conteúdo — quem cria", () => {
    it("só quem tem a liberação (ou admin) cria tarefa de conteúdo", () => {
        expect(podeCriarTipo("conteudo", soConteudo)).toBe(true);
        expect(podeCriarTipo("conteudo", admin)).toBe(true);
        expect(podeCriarTipo("conteudo", semNada)).toBe(false);
        expect(podeCriarTipo("conteudo", soReavaliacao)).toBe(false);
    });

    it("tarefa e meta continuam livres pra todo mundo", () => {
        expect(podeCriarTipo("manual", semNada)).toBe(true);
        expect(podeCriarTipo("meta", semNada)).toBe(true);
    });
});

describe("filtro da busca no banco", () => {
    it("sem liberação busca só as próprias", () => {
        expect(filtroDaAgenda(EU, semNada)).toBe(`user_id.eq.${EU}`);
    });

    it("com as duas liberações traz as duas camadas", () => {
        const ambos = { isAdmin: false, modulos: [AGENDA_ALUNAS_MODULE, AGENDA_CONTEUDO_MODULE] };
        expect(tiposCompartilhados(ambos)).toEqual(["reavaliacao", "liberacao", "residuo", "aviso", "conteudo"]);
        expect(filtroDaAgenda(EU, ambos)).toBe(`user_id.eq.${EU},type.in.(reavaliacao,liberacao,residuo,aviso,conteudo)`);
    });

    it("admin sem liberação de Reavaliações continua como antes (só as próprias + conteúdo)", () => {
        expect(filtroDaAgenda(EU, admin)).toBe(`user_id.eq.${EU},type.in.(conteudo)`);
    });
});
