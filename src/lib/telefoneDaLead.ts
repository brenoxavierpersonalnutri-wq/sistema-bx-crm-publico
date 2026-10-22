/**
 * O telefone que a lead digita no formulário, e o que sai dele.
 *
 * Duas coisas davam errado aqui, e as duas em silêncio.
 *
 * A primeira: o campo aceitava qualquer coisa. "3414 34 424" passava, com
 * espaços no meio.
 *
 * A segunda, pior: o número já era normalizado (`+DDI` + dígitos) e entrava
 * certo nos parâmetros do /agendar — e logo depois o laço que copia as
 * respostas pra URL passava por cima dele com o texto cru, porque o campo do
 * WhatsApp também tem `dbField`. O /agendar então gravava em
 * `consultations.client_phone` o que a pessoa tinha digitado: com espaços e
 * sem o DDI. A função do banco não normaliza nada, grava o que recebe.
 *
 * O estrago não aparece na hora. O número torto quebra o cruzamento da lead
 * com o agendamento (que casa por telefone) e vai torto pra qualquer coisa que
 * consuma esse campo depois, inclusive a API oficial do WhatsApp.
 *
 * Por isso a montagem mora aqui, numa função só, usada nos dois caminhos: o que
 * vai pro banco e o que vai pra URL. Enquanto eram dois trechos parecidos em
 * lugares diferentes, um podia desandar sem o outro saber.
 */

/** Só os dígitos. É o que o WhatsApp entende; o resto é enfeite de digitação. */
export function apenasDigitos(valor: string | null | undefined): string {
    return (valor ?? "").replace(/\D/g, "");
}

/** Tamanho mínimo pra valer como telefone, sem contar o DDI. */
export const MINIMO_DE_DIGITOS = 8;

/**
 * Quanto precisa sobrar, depois de tirar o DDI, pra acreditar que o DDI estava
 * mesmo ali — e não era parte do número.
 *
 * O Brasil tem uma armadilha própria: **55 é DDI e também é DDD** (Rio Grande
 * do Sul). Um número de Santa Maria começa com 55 sem ter DDI nenhum. Olhar só
 * o começo comeria o DDD e deixaria a lead com um número que não existe. Aí o
 * desempate é o tamanho: com DDI são 12 ou 13 dígitos, sem DDI são 10 ou 11 —
 * então só tiramos o 55 da frente se sobrarem 10 ou mais.
 *
 * Fora do Brasil essa colisão não existe (nenhum prefixo local de Portugal é
 * 351), então basta sobrar um número plausível.
 */
const LOCAL_MINIMO_POR_DDI: Record<string, number> = { "55": 10 };

/**
 * O número pronto pra gravar: `+` DDI e dígitos, sem espaço nem pontuação.
 * Volta null quando não há número — gravar string vazia só cria lead fantasma.
 */
export function telefoneCompleto(
    ddi: string | null | undefined,
    digitado: string | null | undefined,
): string | null {
    const numero = apenasDigitos(digitado);
    if (!numero) return null;

    const codigo = apenasDigitos(ddi) || "55";

    // Quem colou o número inteiro (com DDI) não deve recebê-lo duas vezes — mas
    // só tiramos o prefixo se o que sobrar ainda for um número local inteiro.
    // Sem essa conferência, o 55 de DDD viraria DDI e o número perderia o DDD.
    const minimoLocal = LOCAL_MINIMO_POR_DDI[codigo] ?? MINIMO_DE_DIGITOS;
    const jaTemDdi =
        numero.startsWith(codigo) &&
        numero.length - codigo.length >= minimoLocal;

    const local = jaTemDdi ? numero.slice(codigo.length) : numero;
    return `+${codigo}${local}`;
}

export function telefoneParecePlausivel(digitado: string | null | undefined): boolean {
    return apenasDigitos(digitado).length >= MINIMO_DE_DIGITOS;
}

/**
 * O número pronto pra montar link do WhatsApp, a partir do que está gravado.
 *
 * Existe porque o banco tem os dois formatos. `lead_form_responses.telefone`
 * sempre teve o DDI; `consultations.client_phone` era gravado sem ele, até a
 * correção da saída do formulário — então as linhas antigas continuam curtas e
 * as novas vêm completas. Quem montava o link cravando "55" na frente acertava
 * num caso e produzia `wa.me/5555…` no outro, que abre conversa com ninguém.
 *
 * A regra que decide é o tamanho, não o começo — pelo mesmo motivo de sempre:
 * 55 também é DDD. Um número local tem 10 ou 11 dígitos; com DDI, 12 ou 13.
 */
export function numeroParaWhatsapp(telefone: string | null | undefined): string | null {
    const digitos = apenasDigitos(telefone);
    if (!digitos) return null;
    return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/** Link de conversa do WhatsApp, com texto opcional já codificado. */
export function linkDeWhatsapp(
    telefone: string | null | undefined,
    texto?: string,
): string | null {
    const numero = numeroParaWhatsapp(telefone);
    if (!numero) return null;
    return texto
        ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
        : `https://wa.me/${numero}`;
}
