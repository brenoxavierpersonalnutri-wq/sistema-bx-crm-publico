/**
 * O que faltava em toda chamada ao banco feita direto da tela: um limite de
 * tempo e uma mensagem legivel.
 *
 * Nenhuma consulta do Supabase tem timeout por padrao. Quando o banco nao
 * responde, a promessa fica pendurada pra sempre: o `finally` que desliga o
 * carregando nunca roda, e a tela gira sem fim. Foi assim no login, e e assim
 * em toda tela que chama o banco sem este cuidado.
 *
 * E o erro do PostgREST quase sempre tem o texto util fora de `message` —
 * `details`, `hint` e `code` dizem mais. Mostrar so `message` transforma "a
 * politica de acesso barrou esta linha" em aviso vazio.
 */

export const TIMEOUT_PADRAO_MS = 20_000;

export class TempoEsgotado extends Error {
    constructor() {
        super("o servidor não respondeu a tempo");
        this.name = "TempoEsgotado";
    }
}

/** Rejeita com TempoEsgotado se a promessa não resolver dentro de `ms`. */
export function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number = TIMEOUT_PADRAO_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const id = setTimeout(() => reject(new TempoEsgotado()), ms);
        promessa.then(resolve, reject);
        // Limpa o timer nos dois desfechos sem trocar o resultado da promessa.
        promessa.catch(() => { }).then(() => clearTimeout(id));
    });
}

function limpar(texto: unknown): string {
    if (typeof texto !== "string") return "";
    const t = texto.trim();
    if (!t || t === "{}" || t === "[object Object]" || t === "null" || t === "undefined") return "";
    return t;
}

/**
 * Texto para mostrar a quem está usando o sistema. Nunca volta vazio: um aviso
 * sem motivo faz a pessoa clicar de novo achando que foi azar.
 */
export function textoDeErro(erro: unknown, padrao: string): string {
    if (erro instanceof TempoEsgotado) {
        return `${padrao}: o servidor não respondeu. Tente de novo em alguns minutos.`;
    }

    if (erro && typeof erro === "object") {
        const e = erro as Record<string, unknown>;
        // Ordem de utilidade real: a mensagem do Postgres costuma ser a melhor,
        // e details/hint explicam quando ela vem curta demais.
        for (const campo of ["message", "details", "hint"]) {
            const texto = limpar(e[campo]);
            if (texto) return texto;
        }
        const codigo = limpar(e["code"]);
        if (codigo) return `${padrao} (código ${codigo}).`;
    }

    const direto = limpar(erro);
    if (direto) return direto;

    return `${padrao}. O servidor não disse o motivo.`;
}
