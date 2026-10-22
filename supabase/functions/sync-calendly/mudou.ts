/**
 * Decide se a consulta precisa mesmo ser gravada.
 *
 * A sincronizacao regravava TODO evento da janela de 60 dias a cada rodada,
 * mesmo quando nada tinha mudado. Como ela roda o tempo todo, isso e escrita
 * continua no banco sem motivo: milhares de linhas reescritas por hora, cada
 * uma segurando conexao e inchando a tabela. Na pratica, entre uma rodada e a
 * seguinte quase nada muda -- um agendamento novo aqui, um cancelamento ali.
 *
 * Fica num arquivo proprio, sem nenhum import, pra poder ser testado fora do
 * Deno: e uma decisao que, se errar, faz a tela mostrar dado velho.
 *
 * A regra e conservadora: na duvida, grava. Gravar a mais custa escrita;
 * gravar a menos custa informacao errada na tela do time.
 */

/** Campos que nao entram na comparacao: um e a chave, o outro muda sempre. */
const IGNORADOS = new Set(["calendly_event_uri", "updated_at"]);

/** Campos de data/hora: o Postgres devolve em formato diferente do que mandamos. */
const INSTANTES = new Set(["start_time", "end_time"]);

export type ConsultaGravada = Record<string, unknown>;

/** null, undefined e "" sao a mesma ausencia pra efeito de comparacao. */
function normalizar(valor: unknown): string {
    if (valor === null || valor === undefined) return "";
    return String(valor).trim();
}

function mesmoInstante(a: unknown, b: unknown): boolean {
    const ta = Date.parse(normalizar(a));
    const tb = Date.parse(normalizar(b));
    // Se algum dos dois nao e data reconhecivel, cai na comparacao de texto.
    if (Number.isNaN(ta) || Number.isNaN(tb)) return normalizar(a) === normalizar(b);
    return ta === tb;
}

export function precisaGravar(
    novo: Record<string, unknown>,
    gravado: ConsultaGravada | undefined | null,
): boolean {
    // Evento que ainda nao existe na base sempre entra.
    if (!gravado) return true;

    for (const campo of Object.keys(novo)) {
        if (IGNORADOS.has(campo)) continue;

        // O que veio do banco nao traz este campo: nao da pra afirmar que e
        // igual, entao grava.
        if (!(campo in gravado)) return true;

        const iguais = INSTANTES.has(campo)
            ? mesmoInstante(novo[campo], gravado[campo])
            : normalizar(novo[campo]) === normalizar(gravado[campo]);

        if (!iguais) return true;
    }

    return false;
}
