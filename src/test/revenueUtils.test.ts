import { describe, expect, it } from "vitest";
import {
    BOLETO_PARCELAS,
    getMetaValue,
    getRevenueComposition,
    parcelaDoBoleto,
    totalDoBoletoParcelado,
} from "@/lib/revenueUtils";
import type { Consultation } from "@/types/consultation";

/** Só os campos que o cálculo de faturamento olha. */
function consulta(campos: Partial<Consultation>): Consultation {
    return {
        id: "1",
        clientName: "Teste",
        clientPhone: null,
        date: "2026-09-01",
        startTime: null,
        endTime: null,
        status: "convertido",
        leadQuality: "quente",
        observation: "",
        attended: true,
        converted: true,
        closerObservation: "",
        receivedReminderMessages: null,
        via: null,
        ticketValue: null,
        paymentMethod: null,
        gaveSignal: null,
        signalValue: null,
        signalFollowUpDate: null,
        signalResiduePaid: null,
        negotiating: null,
        ...campos,
    } as Consultation;
}

describe("líquido é igual ao bruto", () => {
    it("não desconta taxa no plano cheio", () => {
        const r = getRevenueComposition(
            consulta({ ticketValue: 1500, paymentMethod: "pix" })
        );
        expect(r.gross).toBe(1500);
        expect(r.net).toBe(1500);
    });

    it("não desconta taxa no cartão", () => {
        const r = getRevenueComposition(
            consulta({ ticketValue: 1800, paymentMethod: "cartao-credito" })
        );
        expect(r.net).toBe(r.gross);
        expect(r.net).toBe(1800);
    });

    it("não desconta taxa no sinal", () => {
        const r = getRevenueComposition(
            consulta({ signalValue: 100, gaveSignal: true, signalResiduePaid: false })
        );
        expect(r.label).toBe("Sinal");
        expect(r.net).toBe(100);
        expect(r.gross).toBe(100);
    });
});

describe("parcela do boleto", () => {
    // Os três casos que o Breno passou.
    it.each([
        [1500, 150, 1800],
        [1800, 180, 2160],
        [2500, 250, 3000],
    ])("plano %i vira 12x %i (total %i)", (plano, parcela, total) => {
        expect(parcelaDoBoleto(plano)).toBe(parcela);
        expect(totalDoBoletoParcelado(plano)).toBe(total);
    });

    it("conta UMA parcela no faturamento, não o contrato inteiro", () => {
        const r = getRevenueComposition(
            consulta({ ticketValue: 1500, paymentMethod: "boleto" })
        );
        expect(r.net).toBe(150);
        expect(r.label).toBe(`Boleto (1 de ${BOLETO_PARCELAS}x)`);
    });

    it("acompanha o plano vendido — não é mais fixo em 97", () => {
        const a = getMetaValue(consulta({ ticketValue: 1500, paymentMethod: "boleto" }));
        const b = getMetaValue(consulta({ ticketValue: 2500, paymentMethod: "boleto" }));
        expect(a).not.toBe(b);
        expect(a).toBe(150);
        expect(b).toBe(250);
    });

    it("boleto sem valor de plano não quebra", () => {
        expect(getMetaValue(consulta({ ticketValue: null, paymentMethod: "boleto" }))).toBe(0);
    });
});

describe("regra do sinal continua valendo", () => {
    it("sinal com resíduo pago passa a contar o plano cheio", () => {
        const r = getRevenueComposition(
            consulta({
                ticketValue: 1500,
                signalValue: 100,
                gaveSignal: true,
                signalResiduePaid: true,
                paymentMethod: "pix",
            })
        );
        expect(r.net).toBe(1500);
        expect(r.replacesSignal).toBe(true);
    });

    it("sinal sem resíduo pago conta só o sinal", () => {
        const r = getRevenueComposition(
            consulta({
                ticketValue: 1500,
                signalValue: 100,
                gaveSignal: true,
                signalResiduePaid: false,
                paymentMethod: "pix",
            })
        );
        expect(r.net).toBe(100);
        expect(r.replacesSignal).toBe(false);
    });
});
