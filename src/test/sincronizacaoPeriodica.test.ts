import { describe, expect, it } from "vitest";
import {
    deveSincronizar,
    INTERVALO_DE_SINCRONIZACAO_MS,
    lerUltimaSincronizacao,
} from "@/lib/sincronizacaoPeriodica";

describe("quando a tela pode sincronizar o Calendly", () => {
    it("nunca sincroniza com a aba escondida", () => {
        // Painel esquecido aberto numa aba de fundo era carga de graça no banco.
        expect(deveSincronizar(1_000_000, null, false)).toBe(false);
        expect(deveSincronizar(1_000_000, 0, false)).toBe(false);
    });

    it("sincroniza na primeira vez", () => {
        expect(deveSincronizar(1_000_000, null, true)).toBe(true);
    });

    it("segura antes dos 5 minutos — era de 1 em 1 minuto por aba", () => {
        const ultima = 1_000_000;
        expect(deveSincronizar(ultima + 60_000, ultima, true)).toBe(false);
        expect(deveSincronizar(ultima + INTERVALO_DE_SINCRONIZACAO_MS - 1, ultima, true)).toBe(false);
    });

    it("libera ao completar o intervalo", () => {
        const ultima = 1_000_000;
        expect(deveSincronizar(ultima + INTERVALO_DE_SINCRONIZACAO_MS, ultima, true)).toBe(true);
    });

    it("não trava pra sempre se o relógio andar pra trás", () => {
        expect(deveSincronizar(1_000, 9_999_999, true)).toBe(true);
    });

    it("marca ausente ou corrompida vale como nunca sincronizado", () => {
        expect(lerUltimaSincronizacao(null)).toBeNull();
        expect(lerUltimaSincronizacao("ontem")).toBeNull();
        expect(lerUltimaSincronizacao("1000")).toBe(1000);
    });
});
