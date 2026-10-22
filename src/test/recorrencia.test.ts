import { describe, it, expect } from "vitest";
import {
    alternarConclusao,
    chaveDia,
    cortarSerie,
    excluirSoEste,
    metaDaRegra,
    ocorreEm,
    ocorrenciaConcluida,
    ocorrenciasAntesDe,
    ocorrenciasEntre,
    opcaoDaRegra,
    regraDaOpcao,
    regraDaTarefa,
    resumoDaRegra,
    type RegraRecorrencia,
    type TarefaRecorrente,
} from "@/lib/recorrencia";

// Datas locais: o app expande no fuso de quem está olhando.
const d = (y: number, m: number, dia: number, h = 9, min = 0) => new Date(y, m - 1, dia, h, min);
const dias = (lista: Date[]) => lista.map(chaveDia);

function tarefa(inicio: Date, regra: RegraRecorrencia | null, extra: Record<string, any> = {}): TarefaRecorrente & { status?: string } {
    return {
        dueDate: inicio.toISOString(),
        recurrence: regra?.freq ?? "none",
        metadata: { ...(regra ? { recorrencia: metaDaRegra(regra) } : {}), ...extra },
    };
}

const nunca = { tipo: "nunca" } as const;

describe("ocorrenciasEntre — frequências", () => {
    it("tarefa sem repetição aparece só no próprio dia", () => {
        const t = tarefa(d(2026, 10, 14), null);
        expect(dias(ocorrenciasEntre(t, d(2026, 10, 1), d(2026, 10, 31)))).toEqual(["2026-10-14"]);
        expect(ocorrenciasEntre(t, d(2026, 11, 1), d(2026, 11, 30))).toEqual([]);
    });

    it("semanal: mesmo dia da semana, a partir da data original", () => {
        // 05/10/2026 é segunda-feira
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });
        expect(dias(ocorrenciasEntre(t, d(2026, 9, 28), d(2026, 10, 31)))).toEqual([
            "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26",
        ]);
    });

    it("quinzenal (a cada 2 semanas) pula a semana do meio", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 2, fim: nunca });
        expect(dias(ocorrenciasEntre(t, d(2026, 10, 1), d(2026, 11, 30)))).toEqual([
            "2026-10-05", "2026-10-19", "2026-11-02", "2026-11-16", "2026-11-30",
        ]);
    });

    it("quinzenal continua certo muito depois do início (atalho de salto)", () => {
        const t = tarefa(d(2026, 1, 5), { freq: "weekly", intervalo: 2, fim: nunca });
        // 05/01/2026 + 2 semanas * 26 = 04/01/2027... checa um mês inteiro bem à frente
        const out = dias(ocorrenciasEntre(t, d(2027, 3, 1), d(2027, 3, 31)));
        expect(out).toEqual(["2027-03-01", "2027-03-15", "2027-03-29"]);
    });

    it("mensal no dia 31 pula os meses sem dia 31 (não cai no 30)", () => {
        const t = tarefa(d(2026, 1, 31), { freq: "monthly", intervalo: 1, fim: nunca });
        expect(dias(ocorrenciasEntre(t, d(2026, 1, 1), d(2026, 8, 31)))).toEqual([
            "2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31",
        ]);
    });

    it("mensal no dia 15 acontece todo mês e mantém a hora", () => {
        const t = tarefa(d(2026, 11, 15, 14, 30), { freq: "monthly", intervalo: 1, fim: nunca });
        const out = ocorrenciasEntre(t, d(2026, 11, 1), d(2027, 2, 28));
        expect(dias(out)).toEqual(["2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15"]);
        expect(out.every((o) => o.getHours() === 14 && o.getMinutes() === 30)).toBe(true);
    });

    it("anual em 29/02 só em ano bissexto", () => {
        const t = tarefa(d(2028, 2, 29), { freq: "yearly", intervalo: 1, fim: nunca });
        expect(dias(ocorrenciasEntre(t, d(2028, 1, 1), d(2033, 12, 31)))).toEqual(["2028-02-29", "2032-02-29"]);
    });

    it("personalizado: a cada 3 dias", () => {
        const t = tarefa(d(2026, 10, 1), { freq: "daily", intervalo: 3, fim: nunca });
        expect(dias(ocorrenciasEntre(t, d(2026, 10, 1), d(2026, 10, 12)))).toEqual([
            "2026-10-01", "2026-10-04", "2026-10-07", "2026-10-10",
        ]);
    });

    it("nada antes da data original", () => {
        const t = tarefa(d(2026, 10, 20), { freq: "daily", intervalo: 1, fim: nunca });
        expect(ocorreEm(t, d(2026, 10, 19))).toBe(false);
        expect(ocorreEm(t, d(2026, 10, 20))).toBe(true);
    });

    it("tarefa antiga (só a coluna recurrence, sem metadata) segue funcionando", () => {
        const antiga: TarefaRecorrente = { dueDate: d(2026, 10, 5).toISOString(), recurrence: "weekly", metadata: {} };
        expect(regraDaTarefa(antiga)).toEqual({ freq: "weekly", intervalo: 1, fim: { tipo: "nunca" } });
        expect(ocorreEm(antiga, d(2026, 10, 12))).toBe(true);
    });
});

describe("término", () => {
    it("em data: inclui o último dia e para depois dele", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: { tipo: "data", data: "2026-10-19" } });
        expect(dias(ocorrenciasEntre(t, d(2026, 10, 1), d(2026, 12, 31)))).toEqual([
            "2026-10-05", "2026-10-12", "2026-10-19",
        ]);
    });

    it("após N ocorrências", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 2, fim: { tipo: "ocorrencias", total: 3 } });
        expect(dias(ocorrenciasEntre(t, d(2026, 1, 1), d(2027, 12, 31)))).toEqual([
            "2026-10-05", "2026-10-19", "2026-11-02",
        ]);
    });

    it("após N: mês pulado (31) não conta como ocorrência", () => {
        const t = tarefa(d(2026, 1, 31), { freq: "monthly", intervalo: 1, fim: { tipo: "ocorrencias", total: 3 } });
        expect(dias(ocorrenciasEntre(t, d(2026, 1, 1), d(2027, 12, 31)))).toEqual([
            "2026-01-31", "2026-03-31", "2026-05-31",
        ]);
    });

    it("após N: janela que começa no meio da série respeita o total", () => {
        const t = tarefa(d(2026, 10, 1), { freq: "daily", intervalo: 1, fim: { tipo: "ocorrencias", total: 5 } });
        expect(dias(ocorrenciasEntre(t, d(2026, 10, 4), d(2026, 10, 31)))).toEqual(["2026-10-04", "2026-10-05"]);
    });
});

describe("exceções — \"só este evento\"", () => {
    const base = () => tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });

    it("excluir só este tira aquele dia e deixa os outros", () => {
        const t = base();
        const meta = excluirSoEste(t, d(2026, 10, 12));
        const t2 = { ...t, metadata: meta };
        expect(dias(ocorrenciasEntre(t2, d(2026, 10, 1), d(2026, 10, 31)))).toEqual([
            "2026-10-05", "2026-10-19", "2026-10-26",
        ]);
        expect(meta.recorrencia.excecoes).toEqual(["2026-10-12"]);
    });

    it("exceção conta no total (não empurra a série, como no iCalendar)", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: { tipo: "ocorrencias", total: 3 } });
        const t2 = { ...t, metadata: excluirSoEste(t, d(2026, 10, 12)) };
        expect(dias(ocorrenciasEntre(t2, d(2026, 10, 1), d(2026, 12, 31)))).toEqual(["2026-10-05", "2026-10-19"]);
    });

    it("excluir só este também limpa a conclusão daquele dia", () => {
        const t = base();
        const feito = { ...t, metadata: alternarConclusao(t, d(2026, 10, 12), true) };
        const meta = excluirSoEste(feito, d(2026, 10, 12));
        expect(meta.concluidas).toBeUndefined();
    });

    it("excluir duas vezes o mesmo dia não duplica", () => {
        const t = base();
        const t2 = { ...t, metadata: excluirSoEste(t, d(2026, 10, 12)) };
        expect(excluirSoEste(t2, d(2026, 10, 12)).recorrencia.excecoes).toEqual(["2026-10-12"]);
    });
});

describe("conclusão por ocorrência", () => {
    it("marcar uma ocorrência não conclui as outras", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });
        const t2 = { ...t, metadata: alternarConclusao(t, d(2026, 10, 12), true) };
        expect(ocorrenciaConcluida(t2, d(2026, 10, 12))).toBe(true);
        expect(ocorrenciaConcluida(t2, d(2026, 10, 19))).toBe(false);
        const t3 = { ...t2, metadata: alternarConclusao(t2, d(2026, 10, 12), false) };
        expect(ocorrenciaConcluida(t3, d(2026, 10, 12))).toBe(false);
    });

    it("tarefa simples usa o status da linha", () => {
        const t = { ...tarefa(d(2026, 10, 5), null), status: "completed" };
        expect(ocorrenciaConcluida(t, d(2026, 10, 5))).toBe(true);
    });
});

describe("\"este e os futuros\" — corte da série", () => {
    it("série sem fim: a parte de antes termina na véspera", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });
        const corte = cortarSerie(t, d(2026, 10, 19));
        expect(corte.antes).not.toBeNull();
        const antes = { ...t, metadata: corte.antes!.metadata };
        expect(dias(ocorrenciasEntre(antes, d(2026, 10, 1), d(2026, 12, 31)))).toEqual(["2026-10-05", "2026-10-12"]);
        expect(corte.depois.regra.fim).toEqual({ tipo: "nunca" });
    });

    it("após N: o total se divide entre as duas partes", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: { tipo: "ocorrencias", total: 10 } });
        expect(ocorrenciasAntesDe(t, d(2026, 10, 26))).toBe(3);
        const corte = cortarSerie(t, d(2026, 10, 26));
        expect(corte.antes!.metadata.recorrencia.fim).toEqual({ tipo: "ocorrencias", total: 3 });
        expect(corte.depois.regra.fim).toEqual({ tipo: "ocorrencias", total: 7 });
    });

    it("no primeiro dia da série: a série inteira vai junto", () => {
        const t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });
        expect(cortarSerie(t, d(2026, 10, 5)).antes).toBeNull();
    });

    it("exceções e conclusões ficam cada uma do seu lado", () => {
        let t = tarefa(d(2026, 10, 5), { freq: "weekly", intervalo: 1, fim: nunca });
        t = { ...t, metadata: excluirSoEste(t, d(2026, 10, 12)) };
        t = { ...t, metadata: excluirSoEste(t, d(2026, 11, 2)) };
        t = { ...t, metadata: alternarConclusao(t, d(2026, 10, 5), true) };
        t = { ...t, metadata: alternarConclusao(t, d(2026, 10, 26), true) };
        const corte = cortarSerie(t, d(2026, 10, 19));
        expect(corte.antes!.metadata.recorrencia.excecoes).toEqual(["2026-10-12"]);
        expect(corte.antes!.metadata.concluidas).toEqual(["2026-10-05"]);
        expect(corte.depois.excecoes).toEqual(["2026-11-02"]);
        expect(corte.depois.concluidas).toEqual(["2026-10-26"]);
    });
});

describe("opções do seletor (igual ao Calendário do Mac)", () => {
    it("quinzenal vira weekly a cada 2 e volta pra opção certa", () => {
        const r = regraDaOpcao("biweekly", nunca)!;
        expect(r).toEqual({ freq: "weekly", intervalo: 2, fim: nunca });
        expect(opcaoDaRegra(r)).toBe("biweekly");
    });

    it("personalizado a cada 3 meses", () => {
        const r = regraDaOpcao("custom", nunca, { freq: "monthly", intervalo: 3 })!;
        expect(opcaoDaRegra(r)).toBe("custom");
        expect(resumoDaRegra(r)).toBe("A cada 3 meses");
    });

    it("resumo com término", () => {
        expect(resumoDaRegra({ freq: "monthly", intervalo: 1, fim: { tipo: "data", data: "2026-12-31" } })).toBe("Todo mês, até 31/12/2026");
        expect(resumoDaRegra({ freq: "weekly", intervalo: 2, fim: { tipo: "ocorrencias", total: 6 } })).toBe("A cada 2 semanas, 6 vezes");
        expect(regraDaOpcao("none", nunca)).toBeNull();
    });

    it("regra corrompida no banco não trava (intervalo 0 vira 1)", () => {
        const t: TarefaRecorrente = {
            dueDate: d(2026, 10, 1).toISOString(),
            recurrence: "daily",
            metadata: { recorrencia: { intervalo: 0, fim: { tipo: "ocorrencias", total: -3 } } },
        };
        expect(regraDaTarefa(t)).toEqual({ freq: "daily", intervalo: 1, fim: { tipo: "nunca" } });
        expect(ocorrenciasEntre(t, d(2026, 10, 1), d(2026, 10, 3))).toHaveLength(3);
    });
});
