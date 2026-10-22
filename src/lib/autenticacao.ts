/**
 * Duas coisas que faltavam em toda chamada de login/cadastro: um limite de
 * tempo e uma mensagem legível.
 *
 * Sem limite de tempo, uma chamada que o servidor nunca responde deixa o botão
 * girando pra sempre — foi o "logando infinitamente" que o time relatou.
 * Sem tradução do erro, o toast mostrava "{}": quando o servidor de auth
 * responde erro sem corpo, `error.message` vem vazio ou como um objeto
 * serializado, e a pessoa fica sem saber se errou a senha ou se o sistema caiu.
 */

import { comLimiteDeTempo, TempoEsgotado } from "@/lib/chamadaAoBanco";

// O limite de tempo e generico: vive em chamadaAoBanco, usado por toda tela que
// fala com o banco. Reexportado aqui porque login e cadastro ja o importam
// deste modulo.
export { comLimiteDeTempo, TempoEsgotado };

export const TIMEOUT_AUTENTICACAO_MS = 20_000;

/**
 * Quantas vezes o login tenta quando a falha e do servidor, nao da senha.
 *
 * Servidor de autenticacao que responde 500 de vez em quando faz o time achar
 * que o sistema caiu. Na pratica a segunda tentativa costuma passar. Duas
 * tentativas, nao mais: a partir dai nao e instabilidade, e queda.
 */
export const TENTATIVAS_DE_LOGIN = 2;
export const ESPERA_ENTRE_TENTATIVAS_MS = 800;

/**
 * Mensagens que o Supabase devolve em inglês, e o que elas significam pra quem
 * está tentando entrar. O que não estiver aqui passa direto — mensagem
 * desconhecida ainda é melhor que nenhuma.
 */
const TRADUCAO: { contem: string; texto: string }[] = [
    { contem: "invalid login credentials", texto: "E-mail ou senha incorretos." },
    { contem: "email not confirmed", texto: "Confirme seu e-mail no link que enviamos antes de entrar." },
    { contem: "user already registered", texto: "Esse e-mail já tem cadastro. Tente entrar ou use 'Esqueci minha senha'." },
    { contem: "email address is invalid", texto: "Esse e-mail não é válido." },
    { contem: "password should be at least", texto: "A senha precisa ter pelo menos 6 caracteres." },
    { contem: "email rate limit exceeded", texto: "Muitas tentativas seguidas. Espere um minuto e tente de novo." },
    { contem: "over_request_rate_limit", texto: "Muitas tentativas seguidas. Espere um minuto e tente de novo." },
    // Erro do banco por trás do serviço de autenticação: não é culpa de quem
    // está tentando entrar, e insistir na senha não resolve.
    { contem: "database error", texto: "O banco de dados não respondeu ao serviço de login. Não é a sua senha — tente de novo em alguns minutos." },
    { contem: "unexpected_failure", texto: "O serviço de login falhou no servidor. Não é a sua senha — tente de novo em alguns minutos." },
];

/**
 * Texto que vai pro toast. Nunca devolve vazio, "{}" ou "[object Object]" —
 * é justamente nesses casos que a pessoa ficava sem informação nenhuma.
 */
export function mensagemDeErroDeAutenticacao(erro: unknown): string {
    if (erro instanceof TempoEsgotado) {
        return "O servidor de login não respondeu. Verifique sua internet e tente de novo.";
    }

    const bruta = extrairTexto(erro);
    // O servidor manda tres coisas, e nem sempre as tres: texto, codigo e
    // status HTTP. Ler so o texto foi o que produziu "erro sem descricao" numa
    // resposta que dizia, no codigo, exatamente o que tinha acontecido.
    const codigo = extrairCodigo(erro);
    const status = extrairStatus(erro);

    const conhecida = TRADUCAO.find((t) =>
        `${bruta} ${codigo}`.toLowerCase().includes(t.contem)
    );
    if (conhecida) return conhecida.texto;

    if (bruta) return bruta;

    // Sem texto: o codigo e o status ainda dizem muito mais que "sem descricao".
    if (status === 429) {
        return "Muitas tentativas de login seguidas. Espere um minuto e tente de novo.";
    }
    if (codigo) {
        return `O servidor de login recusou com o código "${codigo}". Não é a sua senha — mande esse código para quem cuida do sistema.`;
    }
    if (status !== null && status >= 500) {
        return `O serviço de login falhou no servidor (erro ${status}). Não é a sua senha — tente de novo em alguns minutos.`;
    }
    if (status !== null) {
        return `O servidor de login recusou (erro ${status}) sem dizer o motivo. Tente de novo em alguns minutos.`;
    }

    return "O servidor de login respondeu com um erro sem descrição. Tente de novo em alguns minutos.";
}

/** Codigo de erro legivel por maquina, que o Supabase manda separado do texto. */
function extrairCodigo(erro: unknown): string {
    if (erro && typeof erro === "object") {
        const e = erro as { code?: unknown; error_code?: unknown; error?: unknown };
        for (const campo of [e.code, e.error_code, e.error]) {
            if (typeof campo === "string") {
                const texto = limpar(campo);
                if (texto) return texto;
            }
        }
    }
    return "";
}

/** Status HTTP da resposta: separa "senha errada" (4xx) de "servidor caiu" (5xx). */
function extrairStatus(erro: unknown): number | null {
    if (erro && typeof erro === "object") {
        const e = erro as { status?: unknown };
        if (typeof e.status === "number" && Number.isFinite(e.status)) return e.status;
    }
    return null;
}

function extrairTexto(erro: unknown): string {
    if (typeof erro === "string") return limpar(erro);
    if (erro && typeof erro === "object") {
        const e = erro as { message?: unknown; error_description?: unknown; msg?: unknown };
        for (const campo of [e.message, e.error_description, e.msg]) {
            if (typeof campo === "string") {
                const texto = limpar(campo);
                if (texto) return texto;
            }
        }
    }
    return "";
}

/** "{}" e "[object Object]" são ruído de serialização, não mensagem. */
function limpar(texto: string): string {
    const t = texto.trim();
    if (!t || t === "{}" || t === "[object Object]" || t === "null" || t === "undefined") return "";
    return t;
}


/**
 * Vale a pena tentar de novo?
 *
 * So quando a culpa e do servidor. Senha errada tem que falhar na hora — repetir
 * gasta o limite de tentativas da conta e ainda demora pra dizer o obvio.
 *
 * Tempo esgotado tambem nao repete: a pessoa ja esperou 20 segundos, e repetir
 * dobraria a espera com a tela parada.
 */
export function ehFalhaPassageira(erro: unknown): boolean {
    if (erro instanceof TempoEsgotado) return false;

    const status = extrairStatus(erro);
    if (status !== null) return status >= 500;

    const codigo = extrairCodigo(erro).toLowerCase();
    if (codigo.includes("unexpected_failure")) return true;
    if (codigo) return false;

    const texto = extrairTexto(erro).toLowerCase();
    if (texto.includes("failed to fetch") || texto.includes("network") || texto.includes("fetch failed")) {
        return true;
    }
    // Erro totalmente vazio: foi o que o servidor devolveu hoje. Sem texto, sem
    // codigo e sem status nao da pra culpar a senha — entao tenta de novo.
    return !texto;
}
