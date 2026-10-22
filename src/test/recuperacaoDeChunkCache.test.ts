import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    CHAVE_RECUPERACAO,
    limparCacheEnvenenado,
    MAXIMO_DE_RECARGAS,
    pedacosDaPagina,
    recuperarDeChunkQueSumiu,
    reiniciarRecuperacaoParaTeste,
    urlsDoErro,
} from "@/lib/recuperacaoDeChunk";

const ORIGEM = "https://equipe.brenoxavier.com.br";
const CHUNK = `${ORIGEM}/assets/receipt-DfgwYUdI.js`;
const ERRO_CHROME = `Failed to fetch dynamically imported module: ${CHUNK}`;

const resposta = (tipo: string) =>
    new Response("x", { status: 200, headers: { "content-type": tipo } });

/** Deixa a cadeia limpar → recarregar terminar. */
const esvaziarFila = () => new Promise((ok) => setTimeout(ok, 0));

describe("acha o pedaço citado no erro", () => {
    it("Chrome e Firefox põem a URL na mensagem", () => {
        expect(urlsDoErro(ERRO_CHROME, "", ORIGEM)).toEqual([CHUNK]);
        expect(urlsDoErro(`error loading dynamically imported module: ${CHUNK}`, "", ORIGEM)).toEqual([CHUNK]);
    });

    it("CSS do Vite vem com caminho relativo", () => {
        expect(urlsDoErro("Unable to preload CSS for /assets/a-1.css", "", ORIGEM)).toEqual([
            `${ORIGEM}/assets/a-1.css`,
        ]);
    });

    it("pega o arquivo do evento e tira o ponto final da frase", () => {
        expect(urlsDoErro("Script error.", `${CHUNK}`, ORIGEM)).toEqual([CHUNK]);
        expect(urlsDoErro(`falhou ${CHUNK}.`, "", ORIGEM)).toEqual([CHUNK]);
    });

    it("Safari não diz qual foi: lista vazia", () => {
        expect(urlsDoErro("Importing a module script failed.", "", ORIGEM)).toEqual([]);
    });

    it("nunca busca fora do site nem o que não é pedaço", () => {
        expect(urlsDoErro("Failed to fetch dynamically imported module: https://outro.com/assets/x.js", "", ORIGEM)).toEqual([]);
        expect(urlsDoErro(`Failed to fetch dynamically imported module: ${ORIGEM}/alunas`, "", ORIGEM)).toEqual([]);
    });

    it("filtra os pedaços da página e respeita o teto", () => {
        const nomes = [CHUNK, `${ORIGEM}/favicon.ico`, "https://cdn.x/assets/y.js", `${ORIGEM}/assets/b.css?v=1`];
        expect(pedacosDaPagina(nomes, ORIGEM)).toEqual([CHUNK, `${ORIGEM}/assets/b.css`]);
        const muitos = Array.from({ length: 200 }, (_, i) => `${ORIGEM}/assets/p${i}.js`);
        expect(pedacosDaPagina(muitos, ORIGEM).length).toBe(80);
    });
});

describe("limpa o cache envenenado", () => {
    it("com a URL, busca de novo ignorando o cache", async () => {
        const buscar = vi.fn(async () => resposta("application/javascript"));
        const refeitas = await limparCacheEnvenenado([CHUNK], [], buscar);
        expect(refeitas).toEqual([CHUNK]);
        expect(buscar).toHaveBeenCalledWith(CHUNK, expect.objectContaining({ cache: "reload" }));
    });

    it("sem URL, só refaz o pedaço que está guardado como HTML", async () => {
        const bom = `${ORIGEM}/assets/bom.js`;
        const buscar = vi.fn(async (url: string, init: RequestInit) => {
            if (init.cache === "force-cache") return resposta(url === CHUNK ? "text/html; charset=utf-8" : "application/javascript");
            return resposta("application/javascript");
        });
        const refeitas = await limparCacheEnvenenado([], [CHUNK, bom], buscar);
        expect(refeitas).toEqual([CHUNK]);
        const recargas = buscar.mock.calls.filter(([, init]) => init.cache === "reload").map(([u]) => u);
        expect(recargas).toEqual([CHUNK]);
    });

    it("falha de rede não derruba a limpeza", async () => {
        const buscar = vi.fn(async () => { throw new TypeError("offline"); });
        await expect(limparCacheEnvenenado([CHUNK], [], buscar)).resolves.toEqual([]);
    });
});

describe("recupera: limpa, recarrega, e não entra em laço", () => {
    beforeEach(() => {
        sessionStorage.clear();
        reiniciarRecuperacaoParaTeste();
    });
    afterEach(() => vi.useRealTimers());

    it("limpa o cache ANTES de recarregar", async () => {
        const ordem: string[] = [];
        const limpar = vi.fn(async () => { ordem.push("limpar"); });
        const recarregar = vi.fn(() => { ordem.push("recarregar"); });
        expect(recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, limpar)).toBe(true);
        await esvaziarFila();
        expect(ordem).toEqual(["limpar", "recarregar"]);
        expect(limpar).toHaveBeenCalledWith(ERRO_CHROME, "");
    });

    it("recarrega mesmo se a limpeza falhar", async () => {
        const recarregar = vi.fn();
        recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, async () => { throw new Error("x"); });
        await esvaziarFila();
        expect(recarregar).toHaveBeenCalledTimes(1);
    });

    it("a mesma falha por três caminhos vira UMA recarga e UMA tentativa", async () => {
        const recarregar = vi.fn();
        const limpar = vi.fn(async () => {});
        recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, limpar); // vite:preloadError
        recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, limpar); // TelaComErro
        recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, limpar); // unhandledrejection
        await esvaziarFila();
        expect(limpar).toHaveBeenCalledTimes(1);
        expect(recarregar).toHaveBeenCalledTimes(1);
        expect(JSON.parse(sessionStorage.getItem(CHAVE_RECUPERACAO)!).n).toBe(1);
    });

    it("para no teto entre recargas (a marca sobrevive no sessionStorage)", async () => {
        const recarregar = vi.fn();
        const limpar = vi.fn(async () => {});
        // Cada volta simula uma página nova: a flag em memória some, a marca fica.
        for (let i = 0; i < MAXIMO_DE_RECARGAS + 2; i++) {
            reiniciarRecuperacaoParaTeste();
            recuperarDeChunkQueSumiu(ERRO_CHROME, "", recarregar, limpar);
            await esvaziarFila();
        }
        expect(recarregar).toHaveBeenCalledTimes(MAXIMO_DE_RECARGAS);
        expect(limpar).toHaveBeenCalledTimes(MAXIMO_DE_RECARGAS);
    });

    it("erro comum da aplicação não limpa nem recarrega", async () => {
        const recarregar = vi.fn();
        const limpar = vi.fn(async () => {});
        expect(recuperarDeChunkQueSumiu("Cannot read properties of undefined", "", recarregar, limpar)).toBe(false);
        await esvaziarFila();
        expect(limpar).not.toHaveBeenCalled();
        expect(recarregar).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(CHAVE_RECUPERACAO)).toBeNull();
    });
});
