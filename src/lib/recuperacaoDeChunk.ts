/**
 * Por que a entrada trava logo depois de uma publicação.
 *
 * O app é dividido em dezenas de pedaços (`lazy(() => import(...))`) e cada
 * pedaço tem um hash no nome. Publicar troca os hashes. Quem já estava com a
 * aba aberta — ou com o index.html antigo no cache — pede um
 * `/assets/algo-<hash-velho>.js` que não existe mais. O import falha, o
 * <Suspense> fica no fallback e a tela simplesmente não carrega. Entrar
 * funciona; o que não vem é a página depois do login.
 *
 * O código já tentava se recuperar disso, e falhava por duas razões:
 *
 * 1. Import dinâmico que falha vira PROMESSA REJEITADA, e promessa rejeitada
 *    não dispara o evento "error" da janela — dispara "unhandledrejection".
 *    Só o primeiro estava sendo ouvido, então na maior parte das vezes nada
 *    acontecia e a tela ficava branca.
 *
 * 2. A trava contra laço era uma marca de uma vez só na sessão, que nunca
 *    expirava. Recuperava a primeira publicação e nunca mais: na segunda, com
 *    a aba ainda aberta, travava de vez. Num dia de cinco publicações é
 *    exatamente o que o time sente como "toda vez que mexem, trava".
 *
 * 3. (14/10) Recarregar não adianta quando o NAVEGADOR guardou HTML no lugar
 *    do .js. Num deploy em andamento o Cloudflare respondeu o pedaço que
 *    ainda não existia com o index.html (200, cache de 4 h); o Chrome guardou
 *    e, a cada recarga, pegava o mesmo HTML do cache. Agora, antes de
 *    recarregar, o pedaço citado no erro é buscado de novo com
 *    `cache: "reload"`, que passa por cima do cache e sobrescreve a entrada
 *    envenenada. O servidor também deixou de mandar HTML pra /assets/ que
 *    não existe (public/assets/404.html), então isso não deve mais nascer —
 *    mas quem já está envenenado precisa desta limpeza pra sair.
 */

export const CHAVE_RECUPERACAO = "_recuperacao_de_chunk";
/** Depois disso sem erro, a contagem zera: nova publicação, nova chance. */
export const JANELA_DE_CONTAGEM_MS = 60_000;
/** Teto de recargas seguidas — passou disso, a tela pede ajuda em vez de girar. */
export const MAXIMO_DE_RECARGAS = 3;

export interface EstadoDeRecuperacao {
    em: number;
    n: number;
}

/**
 * Reconhece o erro de pedaço que sumiu, em qualquer das formas que ele chega.
 *
 * O arquivo sozinho NÃO basta: todo erro de execução do app nasce dentro de
 * `/assets/*.js` (é onde o código mora depois do build). Antes, qualquer erro
 * em produção — inclusive o NotFoundError que o React lança quando o tradutor
 * do Chrome mexe na tela — recarregava a página e jogava fora o que a pessoa
 * estava fazendo. Pelo arquivo, só conta a mensagem que não diz nada
 * ("Script error.") ou o index.html servido no lugar do .js ("Unexpected
 * token '<'"), que são as caras de pedaço que sumiu.
 */
export function ehErroDeChunk(texto: string, arquivo = ""): boolean {
    const t = (texto || "").toLowerCase().trim();
    if (
        t.includes("failed to fetch dynamically imported module") ||
        t.includes("error loading dynamically imported module") ||
        t.includes("importing a module script failed") ||
        t.includes("unable to preload css")
    ) return true;

    const doNossoBundle = arquivo.includes("/assets/") && arquivo.endsWith(".js");
    if (!doNossoBundle) return false;
    return (
        t === "" ||
        t.startsWith("script error") ||
        t.includes("unexpected token '<'") ||
        t.includes("unexpected token <")
    );
}

/** Texto de um motivo de rejeição, que raramente é uma Error de verdade. */
export function textoDoErro(motivo: unknown): string {
    if (typeof motivo === "string") return motivo;
    if (motivo && typeof motivo === "object") {
        const m = motivo as { message?: unknown };
        if (typeof m.message === "string") return m.message;
    }
    return "";
}

/**
 * Decide se recarrega agora, dado o que já aconteceu nesta aba.
 * Fora da janela de contagem a conta zera — é outra publicação, não um laço.
 */
export function decidirRecarga(
    agora: number,
    anterior: EstadoDeRecuperacao | null
): { recarregar: boolean; estado: EstadoDeRecuperacao } {
    const dentroDaJanela =
        anterior !== null && agora - anterior.em <= JANELA_DE_CONTAGEM_MS;
    const tentativas = dentroDaJanela ? anterior.n : 0;

    if (tentativas >= MAXIMO_DE_RECARGAS) {
        return { recarregar: false, estado: { em: agora, n: tentativas } };
    }
    return { recarregar: true, estado: { em: agora, n: tentativas + 1 } };
}

export function lerEstado(bruto: string | null): EstadoDeRecuperacao | null {
    if (!bruto) return null;
    try {
        const v = JSON.parse(bruto) as Partial<EstadoDeRecuperacao>;
        if (typeof v?.em === "number" && typeof v?.n === "number") {
            return { em: v.em, n: v.n };
        }
    } catch { /* marca corrompida vale como ausente */ }
    return null;
}

/**
 * Pedaço do app que sumiu depois de uma publicação: recarrega pra buscar os
 * arquivos novos, com a trava contra laço acima. Usado pelos ouvintes da
 * janela (main.tsx) e pela rede de segurança das telas (TelaComErro), que
 * agora segura o erro do import preguiçoso antes de ele chegar à janela.
 * Devolve se era erro de pedaço.
 */
export function recuperarDeChunkQueSumiu(
    texto: string,
    arquivo = "",
    recarregar: () => void = () => window.location.reload(),
    limpar: (texto: string, arquivo: string) => Promise<void> = limparCacheDoErro
): boolean {
    if (!ehErroDeChunk(texto, arquivo)) return false;
    // A mesma falha chega por até três caminhos (vite:preloadError, a
    // promessa rejeitada e a TelaComErro). Contar cada um como tentativa
    // gastaria o teto numa recarga só.
    if (recuperacaoEmAndamento) return true;

    let anterior: EstadoDeRecuperacao | null = null;
    try { anterior = lerEstado(sessionStorage.getItem(CHAVE_RECUPERACAO)); }
    catch { /* navegador sem sessionStorage: segue e recarrega uma vez */ }

    const decisao = decidirRecarga(Date.now(), anterior);
    try { sessionStorage.setItem(CHAVE_RECUPERACAO, JSON.stringify(decisao.estado)); }
    catch { /* sem storage, a trava não persiste — melhor recarregar que travar */ }

    // Estourou o teto: para de recarregar e deixa a tela pedir ajuda, em vez
    // de entrar em laço de recarga contra um deploy quebrado.
    if (decisao.recarregar) {
        recuperacaoEmAndamento = true;
        // Limpa o cache do pedaço e só então recarrega; a limpeza tem prazo,
        // então a recarga acontece mesmo se a rede não responder.
        void limpar(texto, arquivo)
            .catch(() => { /* limpeza é melhor esforço */ })
            .then(() => recarregar());
    }
    return true;
}

let recuperacaoEmAndamento = false;

/** Só para testes: esquece a recuperação em andamento desta aba. */
export function reiniciarRecuperacaoParaTeste(): void {
    recuperacaoEmAndamento = false;
}

/** Prazo da limpeza antes de recarregar de qualquer jeito. */
export const PRAZO_DA_LIMPEZA_MS = 4_000;
/** Teto de pedaços revistos quando o erro não diz qual foi (Safari). */
export const MAXIMO_DE_PEDACOS_REVISTOS = 80;

function ehPedacoDoApp(url: URL, origem: string): boolean {
    return (
        url.origin === origem &&
        url.pathname.includes("/assets/") &&
        /\.(m?js|css)$/.test(url.pathname)
    );
}

/**
 * URLs de pedaço citadas no erro. Chrome ("Failed to fetch dynamically
 * imported module: https://…/assets/x.js") e Firefox põem a URL na mensagem;
 * o Vite põe o caminho do CSS; o evento "error" traz o arquivo. Safari não
 * diz nada — aí a lista volta vazia. Só do próprio site: nunca busca fora.
 */
export function urlsDoErro(texto: string, arquivo = "", origem: string): string[] {
    const achadas = new Set<string>();
    const candidatos = `${texto || ""} ${arquivo || ""}`.match(/(?:https?:\/\/[^\s'"()<>]+|\/[^\s'"()<>]*assets\/[^\s'"()<>]+)/g) ?? [];
    for (const bruto of candidatos) {
        const limpo = bruto.replace(/[.,;:]+$/, "");
        try {
            const url = new URL(limpo, origem);
            if (ehPedacoDoApp(url, origem)) achadas.add(url.origin + url.pathname);
        } catch { /* não é URL */ }
    }
    return [...achadas];
}

/** Pedaços que esta página já carregou (Resource Timing), do próprio site. */
export function pedacosDaPagina(nomes: string[], origem: string): string[] {
    const achadas = new Set<string>();
    for (const nome of nomes) {
        try {
            const url = new URL(nome, origem);
            if (ehPedacoDoApp(url, origem)) achadas.add(url.origin + url.pathname);
        } catch { /* ignora */ }
        if (achadas.size >= MAXIMO_DE_PEDACOS_REVISTOS) break;
    }
    return [...achadas];
}

type Buscador = (url: string, init: RequestInit) => Promise<Response>;

/** Resposta que veio como página HTML — é o veneno: um .js nunca é text/html. */
function veioHtml(r: Response): boolean {
    return (r.headers.get("content-type") || "").toLowerCase().includes("text/html");
}

/**
 * Tira do cache do navegador o HTML guardado no lugar dos pedaços.
 *
 * Com a URL em mãos, busca de novo com `cache: "reload"`: ignora o cache e
 * grava a resposta nova por cima (o .js de verdade, ou um 404 no-store que
 * não fica guardado). Sem URL (Safari), revê os pedaços que a página já
 * carregou lendo do cache (`force-cache`, sem ir à rede quando está lá) e
 * só refaz os que vieram como HTML.
 */
export async function limparCacheEnvenenado(
    urls: string[],
    suspeitos: string[],
    buscar: Buscador
): Promise<string[]> {
    const refeitas: string[] = [];
    const refazer = async (url: string) => {
        const r = await buscar(url, { cache: "reload", credentials: "same-origin" });
        await r.arrayBuffer().catch(() => undefined); // lê até o fim pra gravar no cache
        refeitas.push(url);
    };

    if (urls.length > 0) {
        await Promise.all(urls.map((u) => refazer(u).catch(() => undefined)));
        return refeitas;
    }

    await Promise.all(
        suspeitos.map(async (u) => {
            try {
                const emCache = await buscar(u, { cache: "force-cache", credentials: "same-origin" });
                const envenenado = veioHtml(emCache);
                await emCache.arrayBuffer().catch(() => undefined);
                if (envenenado) await refazer(u);
            } catch { /* segue com os outros */ }
        })
    );
    return refeitas;
}

/** A limpeza de verdade, com o navegador real e com prazo. */
export async function limparCacheDoErro(texto: string, arquivo = ""): Promise<void> {
    if (typeof window === "undefined" || typeof fetch !== "function") return;
    const origem = window.location.origin;
    const urls = urlsDoErro(texto, arquivo, origem);
    let suspeitos: string[] = [];
    if (urls.length === 0) {
        try {
            const nomes = performance.getEntriesByType("resource").map((e) => e.name);
            suspeitos = pedacosDaPagina(nomes, origem);
        } catch { /* sem Resource Timing */ }
    }
    const buscar: Buscador = (u, init) => fetch(u, init);
    await Promise.race([
        limparCacheEnvenenado(urls, suspeitos, buscar),
        new Promise<void>((ok) => setTimeout(ok, PRAZO_DA_LIMPEZA_MS)),
    ]);
}

/** Botão "Recarregar" da tela de erro: limpa o cache do pedaço antes, senão recarregar não adianta. */
export function limparERecarregar(
    texto: string,
    recarregar: () => void = () => window.location.reload()
): void {
    if (!ehErroDeChunk(texto)) { recarregar(); return; }
    void limparCacheDoErro(texto).catch(() => undefined).then(() => recarregar());
}
