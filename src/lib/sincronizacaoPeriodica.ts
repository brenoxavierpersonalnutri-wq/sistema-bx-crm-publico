/**
 * Regra de quando a tela pode disparar a sincronizacao do Calendly.
 *
 * Antes: cada tela chamava a cada 60 segundos, em cada aba aberta. Com o time
 * todo com o painel aberto — e duas telas diferentes fazendo isso — o banco
 * levava dezenas de sincronizacoes por minuto o dia inteiro. Cada uma varre a
 * tabela de consultas e grava evento por evento. E foi assim que o banco ficou
 * sem conexao livre, derrubando junto o login, que tambem precisa do banco.
 *
 * Tres freios, todos aqui pra poderem ser testados sem navegador:
 *
 *  - Aba escondida nao sincroniza. Painel esquecido aberto numa aba de fundo
 *    parou de contribuir.
 *  - Intervalo de 5 minutos em vez de 1. Agendamento do Calendly nao chega a
 *    cada minuto, entao o que se perde e quase nada.
 *  - A marca do ultimo disparo fica no navegador, nao na tela. Duas telas
 *    abertas no mesmo navegador passam a dividir o mesmo ritmo, em vez de
 *    somar.
 */

export const INTERVALO_DE_SINCRONIZACAO_MS = 5 * 60_000;
/** De quanto em quanto tempo a tela confere se ja pode sincronizar. */
export const INTERVALO_DE_CONFERENCIA_MS = 30_000;
export const CHAVE_ULTIMA_SINCRONIZACAO = "bx_ultima_sync_calendly";

export function deveSincronizar(
    agora: number,
    ultima: number | null,
    abaVisivel: boolean
): boolean {
    if (!abaVisivel) return false;
    if (ultima === null) return true;
    // Relogio do sistema pra tras (fuso, ajuste de hora) nao pode travar a
    // sincronizacao pra sempre.
    if (ultima > agora) return true;
    return agora - ultima >= INTERVALO_DE_SINCRONIZACAO_MS;
}

export function lerUltimaSincronizacao(bruto: string | null): number | null {
    if (!bruto) return null;
    const n = Number(bruto);
    return Number.isFinite(n) ? n : null;
}
