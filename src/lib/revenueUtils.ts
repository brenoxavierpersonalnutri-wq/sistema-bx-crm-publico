import { Consultation } from "@/types/consultation";

/**
 * Faturamento líquido é igual ao bruto.
 *
 * Antes daqui descontava-se 6,22% de taxa da PagTrust. Não desconta mais: o
 * valor que cai na InfinitePay é o mesmo do bruto, então manter o desconto
 * subestimava o faturamento em toda tela que usa este arquivo.
 */

/**
 * Boleto é parcelado em 12x, e a parcela padrão é 1/10 do valor do plano —
 * é assim que o juro entra no preço:
 *
 *   plano 1.500 → 12x 150 = 1.800
 *   plano 1.800 → 12x 180 = 2.160
 *   plano 2.500 → 12x 250 = 3.000
 *
 * Não existe campo de parcelas no cadastro da consulta, então estes dois
 * números são fixos. Se algum plano fugir da regra, é aqui que se mexe.
 */
export const BOLETO_PARCELAS = 12;
export const BOLETO_DIVISOR_DA_PARCELA = 10;

/** Valor de UMA parcela do boleto, a partir do valor cheio do plano. */
export function parcelaDoBoleto(valorDoPlano: number): number {
    return Math.round(valorDoPlano / BOLETO_DIVISOR_DA_PARCELA);
}

/** Total que o plano custa parcelado no boleto, já com o juro embutido. */
export function totalDoBoletoParcelado(valorDoPlano: number): number {
    return parcelaDoBoleto(valorDoPlano) * BOLETO_PARCELAS;
}

export interface RevenueComposition {
    gross: number;
    net: number;
    label: string;
    replacesSignal: boolean;
}

export function getRevenueComposition(c: Consultation): RevenueComposition {
    if (c.paymentMethod === "boleto") {
        // Conta UMA parcela, não o contrato inteiro: a tela mede faturamento do
        // período, e num mês só entra a parcela daquele mês. Antes era um valor
        // fixo de R$ 97, que não acompanhava o plano vendido.
        const parcela = parcelaDoBoleto(c.ticketValue || 0);
        return {
            gross: parcela,
            net: parcela,
            label: `Boleto (1 de ${BOLETO_PARCELAS}x)`,
            replacesSignal: false,
        };
    }

    if (c.gaveSignal && !c.signalResiduePaid) {
        const gross = c.signalValue || 0;
        return {
            gross,
            net: gross,
            label: "Sinal",
            replacesSignal: false,
        };
    }

    const gross = c.ticketValue || 0;
    return {
        gross,
        net: gross,
        label: c.gaveSignal && c.signalResiduePaid ? "Plano cheio (substitui sinal)" : "Plano cheio",
        replacesSignal: Boolean(c.gaveSignal && c.signalResiduePaid),
    };
}

/**
 * Valor contado para a meta de faturamento.
 * Boleto: uma parcela do plano. Sinal sem resíduo pago: só o sinal.
 * Nos demais casos: o valor cheio do plano.
 */
export function getMetaValue(c: Consultation): number {
    return getRevenueComposition(c).net;
}
