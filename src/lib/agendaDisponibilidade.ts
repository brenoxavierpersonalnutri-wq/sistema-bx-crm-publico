import { addMinutes, format, getDay, isBefore, isSameDay } from "date-fns";

/**
 * Regra de "este dia tem horario livre?", num lugar so.
 *
 * Ela estava escrita tres vezes dentro da tela de agendamento — na busca do
 * dia, na escolha automatica do primeiro dia livre e na hora de desenhar os
 * botoes de horario —, com pequenas diferencas entre elas. Agora que o
 * calendario destaca em negrito os dias que ainda dao pra marcar, as tres
 * PRECISAM concordar: um dia em negrito que abre sem nenhum horario e pior do
 * que nao destacar nada.
 */

export interface FaixaDeHorario {
    start: string;
    end: string;
}

/** O que o RPC get_public_booking_info devolve para uma data. */
export interface InfoDeAgenda {
    booked_slots_map?: Record<string, number> | null;
    capacity_per_slot?: number | null;
    slot_gap_minutes?: number | null;
    max_daily_bookings?: number | null;
    availability_weekly?: Record<string, FaixaDeHorario[]> | null;
    availability_overrides?: Record<string, FaixaDeHorario[]> | null;
}

/**
 * Dois padroes diferentes, de proposito: eram os que ja estavam no codigo.
 * O intervalo entre horarios gerados cai em 40; a distancia minima de um
 * horario ja marcado cai em 60. Na pratica o banco sempre manda o valor, entao
 * isto so vale quando a configuracao esta faltando.
 */
export const GAP_PADRAO_PARA_GERAR = 40;
export const GAP_PADRAO_PARA_PROXIMIDADE = 60;
/** Ninguem marca pra daqui a cinco minutos. */
export const ANTECEDENCIA_MINIMA_MINUTOS = 30;

export function minutosDoHorario(horario: string): number {
    const [h, m] = horario.split(":").map(Number);
    return h * 60 + m;
}

/** Gera os horarios de inicio dentro das faixas, sem passar do fim da faixa. */
export function gerarHorarios(
    faixas: FaixaDeHorario[],
    gapMinutos: number = GAP_PADRAO_PARA_GERAR,
): string[] {
    const horarios: string[] = [];
    for (const faixa of faixas) {
        const [horaInicio, minutoInicio] = faixa.start.split(":").map(Number);
        const [horaFim, minutoFim] = faixa.end.split(":").map(Number);

        const atual = new Date();
        atual.setHours(horaInicio, minutoInicio, 0, 0);
        const fim = new Date();
        fim.setHours(horaFim, minutoFim, 0, 0);

        let cursor = atual;
        while (isBefore(cursor, fim) || cursor.getTime() === fim.getTime()) {
            // So entra se a consulta inteira couber antes do fim da faixa.
            const fimDoAtendimento = addMinutes(cursor, gapMinutos);
            if (isBefore(fimDoAtendimento, fim) || fimDoAtendimento.getTime() === fim.getTime()) {
                horarios.push(format(cursor, "HH:mm"));
            }
            cursor = addMinutes(cursor, gapMinutos);
        }
    }
    return Array.from(new Set(horarios)).sort();
}

/** Horarios que ja bateram a capacidade e portanto nao entram mais. */
export function horariosOcupados(info: InfoDeAgenda): string[] {
    const mapa = info.booked_slots_map || {};
    const capacidade = info.capacity_per_slot ?? 1;
    return Object.entries(mapa)
        .filter(([, quantidade]) => Number(quantidade) >= capacidade)
        .map(([horario]) => horario);
}

/** Bateu o teto de reunioes do dia, independente de sobrar faixa livre. */
export function diaLotado(info: InfoDeAgenda): boolean {
    const mapa = info.booked_slots_map || {};
    const total = Object.values(mapa).reduce((soma, n) => soma + Number(n), 0);
    return total >= (info.max_daily_bookings ?? 12);
}

/** As faixas que valem para esta data: excecao do dia, senao a do dia da semana. */
export function faixasDaData(info: InfoDeAgenda, data: Date): FaixaDeHorario[] {
    const chave = format(data, "yyyy-MM-dd");
    const excecoes = info.availability_overrides || {};
    if (excecoes[chave]) return excecoes[chave];
    const semanal = info.availability_weekly || {};
    return semanal[String(getDay(data))] || [];
}

/**
 * Horarios que a pessoa realmente consegue clicar nesta data.
 * Vazio significa dia sem vaga — e e isso que decide o negrito no calendario.
 */
export function horariosLivres(
    info: InfoDeAgenda,
    data: Date,
    agora: Date = new Date(),
): string[] {
    if (diaLotado(info)) return [];

    const ocupados = horariosOcupados(info);
    const gapProximidade = info.slot_gap_minutes ?? GAP_PADRAO_PARA_PROXIMIDADE;
    const gerados = gerarHorarios(
        faixasDaData(info, data),
        info.slot_gap_minutes ?? GAP_PADRAO_PARA_GERAR,
    );

    return gerados.filter((horario) => {
        const minutos = minutosDoHorario(horario);

        // Encostado demais em algo ja marcado.
        const coladoEmOutro = ocupados.some(
            (ocupado) => Math.abs(minutos - minutosDoHorario(ocupado)) < gapProximidade,
        );
        if (coladoEmOutro) return false;

        // Horario que ja passou (ou quase), quando a data e hoje.
        if (isSameDay(data, agora)) {
            const limite = agora.getHours() * 60 + agora.getMinutes() + ANTECEDENCIA_MINIMA_MINUTOS;
            if (minutos < limite) return false;
        }

        return true;
    });
}

/** O que o calendario precisa saber de cada dia. */
export function temVaga(info: InfoDeAgenda, data: Date, agora: Date = new Date()): boolean {
    return horariosLivres(info, data, agora).length > 0;
}


/**
 * O calendario precisa trocar de mes pra mostrar esta data?
 *
 * So quando ela nao esta em nenhum dos meses ja exibidos. Seguir a data
 * escolhida sempre tinha um efeito ruim na virada do mes: a escolha automatica
 * cai no mes seguinte, o calendario pulava pra ele, e o mes atual — que ainda
 * tem dias reservaveis — saia de vista. Com 30/10 na tela, a janela vai de
 * 31/10 a 6/11, e o calendario abria em novembro e dezembro: o 31 de outubro
 * ficava invisivel e dezembro ocupava o lugar de outubro.
 */
export function precisaTrocarDeMes(
    mesVisivel: Date,
    selecionada: Date,
    mostrandoDoisMeses: boolean,
): boolean {
    const mesmoMes = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

    if (mesmoMes(mesVisivel, selecionada)) return false;

    if (mostrandoDoisMeses) {
        const seguinte = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 1);
        if (mesmoMes(seguinte, selecionada)) return false;
    }

    return true;
}
