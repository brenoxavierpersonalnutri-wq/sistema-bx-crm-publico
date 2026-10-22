import { describe, expect, it, vi } from "vitest";
import { buscarComLimite, fetchComLimite, LIMITE_DE_REDE_MS } from "@/lib/fetchComLimite";
import { TempoEsgotado } from "@/lib/chamadaAoBanco";

/**
 * Um fetch falso que respeita o signal, como o de verdade — inclusive quando o
 * abort já aconteceu ANTES de a chamada começar. O fetch real checa
 * `signal.aborted` na hora; só ouvir o evento futuro deixaria esse caso
 * pendurado pra sempre, e o teste de "abort pedido antes" nunca terminaria.
 */
function fetchQueNuncaResponde(): typeof globalThis.fetch {
    return (_entrada, init) =>
        new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) return reject(init.signal.reason);
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
}

describe("fetchComLimite", () => {
    it("deixa passar a resposta que chega a tempo", async () => {
        const rapido: typeof globalThis.fetch = async () => new Response("ok");
        const r = await fetchComLimite(1000, rapido)("https://x");
        expect(await r.text()).toBe("ok");
    });

    it("aborta a requisição pendurada — é o que deixava a tela girando", async () => {
        vi.useFakeTimers();
        const pendurado = fetchComLimite(20_000, fetchQueNuncaResponde())("https://x");
        const esperado = expect(pendurado).rejects.toBeInstanceOf(TempoEsgotado);
        await vi.advanceTimersByTimeAsync(20_000);
        await esperado;
        vi.useRealTimers();
    });

    it("manda o signal pro fetch de verdade, senão o abort não chega no socket", async () => {
        let recebeu: AbortSignal | null | undefined;
        const espiao: typeof globalThis.fetch = async (_e, init) => { recebeu = init?.signal; return new Response(""); };
        await fetchComLimite(1000, espiao)("https://x");
        expect(recebeu).toBeInstanceOf(AbortSignal);
    });

    it("respeita um abort que o chamador já tinha pedido", async () => {
        const controle = new AbortController();
        controle.abort(new Error("cancelado por mim"));
        await expect(
            fetchComLimite(1000, fetchQueNuncaResponde())("https://x", { signal: controle.signal }),
        ).rejects.toThrow("cancelado por mim");
    });

    it("limpa o temporizador quando a resposta chega, pra não abortar depois", async () => {
        vi.useFakeTimers();
        const rapido: typeof globalThis.fetch = async () => new Response("ok");
        await fetchComLimite(1000, rapido)("https://x");
        // Se o timer tivesse sobrado, avançar o relógio dispararia um abort órfão.
        expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
        vi.useRealTimers();
    });

    it("o limite padrão é generoso: tela de leads baixa mil linhas por página", () => {
        expect(LIMITE_DE_REDE_MS).toBeGreaterThanOrEqual(20_000);
    });
});

describe("buscarComLimite", () => {
    it("é o mesmo limite, pra chamada avulsa que não passa pelo cliente", async () => {
        vi.useFakeTimers();
        const original = globalThis.fetch;
        globalThis.fetch = fetchQueNuncaResponde();
        try {
            const p = buscarComLimite("https://x", undefined, 5_000);
            const esperado = expect(p).rejects.toBeInstanceOf(TempoEsgotado);
            await vi.advanceTimersByTimeAsync(5_000);
            await esperado;
        } finally {
            globalThis.fetch = original;
            vi.useRealTimers();
        }
    });
});
