import { describe, expect, it } from "vitest";
import {
    diaLotado,
    faixasDaData,
    gerarHorarios,
    horariosLivres,
    horariosOcupados,
    precisaTrocarDeMes,
    temVaga,
    type InfoDeAgenda,
} from "@/lib/agendaDisponibilidade";

/** Quarta-feira, pra casar com o dia da semana 3 da agenda semanal. */
const QUARTA = new Date(2026, 9, 7, 12, 0, 0); // 07/10/2026

function agenda(extra: Partial<InfoDeAgenda> = {}): InfoDeAgenda {
    return {
        booked_slots_map: {},
        capacity_per_slot: 1,
        slot_gap_minutes: 60,
        max_daily_bookings: 12,
        availability_weekly: { "3": [{ start: "09:00", end: "12:00" }] },
        availability_overrides: {},
        ...extra,
    };
}

describe("gerar horários", () => {
    it("não oferece horário cuja consulta passaria do fim da faixa", () => {
        // 11:00 + 60 = 12:00, cabe. 12:00 + 60 = 13:00, não cabe.
        expect(gerarHorarios([{ start: "09:00", end: "12:00" }], 60)).toEqual([
            "09:00", "10:00", "11:00",
        ]);
    });

    it("respeita o intervalo configurado", () => {
        expect(gerarHorarios([{ start: "09:00", end: "11:00" }], 40)).toEqual([
            "09:00", "09:40", "10:20",
        ]);
    });

    it("junta faixas sem repetir e em ordem", () => {
        const faixas = [
            { start: "14:00", end: "16:00" },
            { start: "09:00", end: "11:00" },
        ];
        expect(gerarHorarios(faixas, 60)).toEqual(["09:00", "10:00", "14:00", "15:00"]);
    });

    it("faixa vazia não gera nada", () => {
        expect(gerarHorarios([], 60)).toEqual([]);
    });
});

describe("ocupação do dia", () => {
    it("só conta como ocupado quem bateu a capacidade", () => {
        const info = agenda({ booked_slots_map: { "09:00": 1, "10:00": 0 }, capacity_per_slot: 1 });
        expect(horariosOcupados(info)).toEqual(["09:00"]);
    });

    it("capacidade maior que um segura o horário aberto", () => {
        const info = agenda({ booked_slots_map: { "09:00": 1 }, capacity_per_slot: 2 });
        expect(horariosOcupados(info)).toEqual([]);
    });

    it("dia lotado é pelo teto de reuniões, não pelas faixas", () => {
        expect(diaLotado(agenda({ booked_slots_map: { "09:00": 2, "10:00": 1 }, max_daily_bookings: 3 }))).toBe(true);
        expect(diaLotado(agenda({ booked_slots_map: { "09:00": 1 }, max_daily_bookings: 3 }))).toBe(false);
    });
});

describe("faixas da data", () => {
    it("exceção do dia vence a agenda semanal", () => {
        const info = agenda({
            availability_overrides: { "2026-10-07": [{ start: "15:00", end: "17:00" }] },
        });
        expect(faixasDaData(info, QUARTA)).toEqual([{ start: "15:00", end: "17:00" }]);
    });

    it("sem exceção, usa o dia da semana", () => {
        expect(faixasDaData(agenda(), QUARTA)).toEqual([{ start: "09:00", end: "12:00" }]);
    });

    it("dia da semana sem agenda não tem faixa", () => {
        const domingo = new Date(2026, 9, 4, 12, 0, 0);
        expect(faixasDaData(agenda(), domingo)).toEqual([]);
    });
});

describe("horários livres", () => {
    it("tira o que está encostado em horário já marcado", () => {
        // 10:00 marcado, distância mínima 60 minutos. 09:00 e 11:00 estão a
        // exatamente 60, então continuam valendo; o próprio 10:00 sai.
        const info = agenda({ booked_slots_map: { "10:00": 1 } });
        expect(horariosLivres(info, QUARTA)).toEqual(["09:00", "11:00"]);
    });

    it("dia lotado não tem horário livre, mesmo com faixa aberta", () => {
        const info = agenda({ max_daily_bookings: 1, booked_slots_map: { "09:00": 1 } });
        expect(horariosLivres(info, QUARTA)).toEqual([]);
    });

    it("no próprio dia, horário que já passou não aparece", () => {
        const agora = new Date(2026, 9, 7, 10, 15, 0);
        // 10:00 já passou; 10:30 é o limite (10:15 + 30), então 11:00 fica.
        expect(horariosLivres(agenda(), QUARTA, agora)).toEqual(["11:00"]);
    });

    it("em outro dia, a hora atual não filtra nada", () => {
        const agora = new Date(2026, 9, 6, 23, 0, 0);
        expect(horariosLivres(agenda(), QUARTA, agora)).toEqual(["09:00", "10:00", "11:00"]);
    });
});

describe("tem vaga — é o que decide o negrito no calendário", () => {
    it("dia com horário livre entra em negrito", () => {
        expect(temVaga(agenda(), QUARTA)).toBe(true);
    });

    it("dia lotado não entra", () => {
        expect(temVaga(agenda({ max_daily_bookings: 0 }), QUARTA)).toBe(false);
    });

    it("dia sem agenda naquele dia da semana não entra", () => {
        const domingo = new Date(2026, 9, 4, 12, 0, 0);
        expect(temVaga(agenda(), domingo)).toBe(false);
    });
});

describe("quando o calendário troca de mês", () => {
    const OUTUBRO = new Date(2026, 9, 1);

    it("não troca quando a data já está no mês exibido", () => {
        expect(precisaTrocarDeMes(OUTUBRO, new Date(2026, 9, 31), false)).toBe(false);
    });

    it("não troca pro mês seguinte quando os dois meses estão à vista", () => {
        // Era o bug: com 30/10 na tela a janela vai até 6/11, a escolha
        // automática caía em novembro, o calendário pulava pra lá e escondia o
        // 31 de outubro, que ainda dava pra marcar.
        expect(precisaTrocarDeMes(OUTUBRO, new Date(2026, 10, 2), true)).toBe(false);
    });

    it("troca pro mês seguinte quando só um mês está à vista", () => {
        expect(precisaTrocarDeMes(OUTUBRO, new Date(2026, 10, 2), false)).toBe(true);
    });

    it("troca quando a data está fora dos dois meses exibidos", () => {
        expect(precisaTrocarDeMes(OUTUBRO, new Date(2026, 11, 2), true)).toBe(true);
    });

    it("não confunde o mesmo mês de anos diferentes", () => {
        expect(precisaTrocarDeMes(OUTUBRO, new Date(2027, 9, 1), false)).toBe(true);
    });
});
