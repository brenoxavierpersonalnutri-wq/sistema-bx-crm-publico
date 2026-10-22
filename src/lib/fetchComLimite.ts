import { TempoEsgotado } from "@/lib/chamadaAoBanco";

/**
 * Um `fetch` que desiste.
 *
 * O cliente do Supabase era criado sem limite de tempo nenhum. Uma requisição
 * que o servidor aceita e nunca responde — conexão meio aberta, proxy que
 * engole, instância acordando — fica pendurada pra sempre: o `await` nunca
 * volta, o `setLoading(false)` nunca roda, e a tela gira até a pessoa desistir.
 * Era isso o "página carregando e não abre", às vezes no login, às vezes
 * dentro da ferramenta. Trinta e oito arquivos chamam o banco; oito tinham
 * limite. Este é o lugar onde os outros trinta ganham um de uma vez.
 *
 * Aborta de verdade, com AbortController — não só rejeita a promessa e deixa
 * o socket ocupado. O builder do Supabase captura o abort e devolve `{ error }`
 * em vez de lançar, então as telas que já tratam `error` saem do carregando
 * sozinhas, sem precisar mexer em cada uma.
 *
 * Generoso de propósito: 30s. A tela de leads baixa páginas de mil linhas, e
 * numa rede ruim isso demora. Um limite apertado trocaria "pendura pra sempre"
 * por "falha pra quem está no 3G", que não é melhora. Quem precisa de menos
 * (o login, que é curto) já tem o próprio limite por cima deste.
 */
export const LIMITE_DE_REDE_MS = 30_000;

type Fetch = typeof globalThis.fetch;

/**
 * Devolve um `fetch` com o limite embutido, no formato que `createClient`
 * aceita em `global.fetch`. Respeita um `signal` que já venha na chamada: se o
 * chamador abortar antes, abortamos junto.
 */
export function fetchComLimite(ms: number = LIMITE_DE_REDE_MS, base: Fetch = globalThis.fetch.bind(globalThis)): Fetch {
    return async (entrada, init) => {
        const controle = new AbortController();
        const temporizador = setTimeout(() => controle.abort(new TempoEsgotado()), ms);

        const externo = init?.signal;
        if (externo) {
            if (externo.aborted) controle.abort(externo.reason);
            else externo.addEventListener("abort", () => controle.abort(externo.reason), { once: true });
        }

        try {
            return await base(entrada, { ...init, signal: controle.signal });
        } finally {
            clearTimeout(temporizador);
        }
    };
}

/** Pra chamadas avulsas (`fetch(url, init)`) que não passam pelo cliente. */
export function buscarComLimite(entrada: RequestInfo | URL, init?: RequestInit, ms: number = LIMITE_DE_REDE_MS): Promise<Response> {
    return fetchComLimite(ms)(entrada, init);
}
