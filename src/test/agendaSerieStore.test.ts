import { describe, it, expect, vi, beforeEach } from "vitest";

// Registra o que o store manda pro banco, sem banco nenhum.
const ops: { op: string; payload?: any; filtros: [string, string, any][] }[] = [];

vi.mock("@/integrations/supabase/client", () => {
    const builder = (op: string, payload?: any) => {
        const reg = { op, payload, filtros: [] as [string, string, any][] };
        ops.push(reg);
        const b: any = {
            eq: (c: string, v: any) => { reg.filtros.push(["eq", c, v]); return b; },
            neq: (c: string, v: any) => { reg.filtros.push(["neq", c, v]); return b; },
            in: (c: string, v: any) => { reg.filtros.push(["in", c, v]); return b; },
            then: (res: any) => Promise.resolve({ error: null, data: [] }).then(res),
        };
        return b;
    };
    return {
        supabase: {
            from: () => ({
                upsert: (p: any) => builder("upsert", p),
                update: (p: any) => builder("update", p),
                delete: () => builder("delete"),
            }),
        },
    };
});

import { deleteOccurrence, saveOccurrence } from "@/lib/taskStore";
import { metaDaRegra, ocorrenciasEntre, chaveDia } from "@/lib/recorrencia";
import type { CollaboratorTask } from "@/lib/taskTypes";

const d = (y: number, m: number, dia: number, h = 9) => new Date(y, m - 1, dia, h, 0);

function serieSemanal(total?: number): CollaboratorTask {
    return {
        id: "serie-1",
        userId: "u1",
        createdBy: null,
        title: "Reunião de pauta",
        description: null,
        dueDate: d(2026, 10, 5).toISOString(),
        status: "pending",
        type: "conteudo",
        recurrence: "weekly",
        metadata: {
            recorrencia: metaDaRegra({
                freq: "weekly",
                intervalo: 1,
                fim: total ? { tipo: "ocorrencias", total } : { tipo: "nunca" },
            }),
        },
        createdAt: "",
        updatedAt: "",
    };
}

beforeEach(() => { ops.length = 0; });

describe("excluir ocorrência", () => {
    it("só este: grava exceção na série, não apaga a linha", async () => {
        await deleteOccurrence(serieSemanal(), d(2026, 10, 12), "este");
        expect(ops).toHaveLength(1);
        expect(ops[0].op).toBe("update");
        expect(ops[0].payload.metadata.recorrencia.excecoes).toEqual(["2026-10-12"]);
        expect(ops[0].filtros).toContainEqual(["eq", "id", "serie-1"]);
    });

    it("este e os futuros no meio: série termina na véspera", async () => {
        await deleteOccurrence(serieSemanal(), d(2026, 10, 19), "futuros");
        expect(ops[0].op).toBe("update");
        expect(ops[0].payload.metadata.recorrencia.fim).toEqual({ tipo: "data", data: "2026-10-18" });
    });

    it("este e os futuros no primeiro dia: apaga a série", async () => {
        await deleteOccurrence(serieSemanal(), d(2026, 10, 5), "futuros");
        expect(ops).toHaveLength(1);
        expect(ops[0].op).toBe("delete");
    });
});

describe("editar ocorrência", () => {
    it("só este: cria avulsa no dia e tira o dia da série", async () => {
        const t = serieSemanal();
        await saveOccurrence(t, d(2026, 10, 12), "este", {
            userId: "u1",
            title: "Pauta especial",
            dueDate: d(2026, 10, 12, 15).toISOString(),
            type: "conteudo",
            recurrence: "weekly",
            metadata: { ...t.metadata },
        }, false);
        const [criar, atualizar] = ops;
        expect(criar.op).toBe("upsert");
        expect(criar.payload.id).toBeUndefined();
        expect(criar.payload.recurrence).toBe("none");
        expect(criar.payload.title).toBe("Pauta especial");
        expect(criar.payload.metadata.recorrencia).toBeUndefined();
        expect(criar.payload.metadata.serieOrigemId).toBe("serie-1");
        expect(atualizar.op).toBe("update");
        expect(atualizar.payload.metadata.recorrencia.excecoes).toEqual(["2026-10-12"]);
    });

    it("este e os futuros com 'após 10': nova série herda as 7 que sobram", async () => {
        const t = serieSemanal(10);
        await saveOccurrence(t, d(2026, 10, 26), "futuros", {
            userId: "u1",
            title: "Pauta nova",
            dueDate: d(2026, 10, 26, 10).toISOString(),
            type: "conteudo",
            recurrence: "weekly",
            metadata: { ...t.metadata },
        }, false);
        const criar = ops.find((o) => o.op === "upsert")!;
        const atualizar = ops.find((o) => o.op === "update")!;
        expect(criar.payload.id).toBeUndefined();
        expect(criar.payload.metadata.recorrencia.fim).toEqual({ tipo: "ocorrencias", total: 7 });
        expect(atualizar.payload.metadata.recorrencia.fim).toEqual({ tipo: "ocorrencias", total: 3 });

        // Somando as duas partes: 10 ocorrências, sem buraco nem repetição.
        const antiga = { ...t, metadata: atualizar.payload.metadata };
        const nova = { dueDate: criar.payload.due_date, recurrence: "weekly", metadata: criar.payload.metadata };
        const todas = [
            ...ocorrenciasEntre(antiga, d(2026, 1, 1), d(2027, 12, 31)),
            ...ocorrenciasEntre(nova, d(2026, 1, 1), d(2027, 12, 31)),
        ].map(chaveDia);
        expect(todas).toHaveLength(10);
        expect(new Set(todas).size).toBe(10);
    });

    it("este e os futuros no primeiro dia: atualiza a própria série", async () => {
        const t = serieSemanal();
        await saveOccurrence(t, d(2026, 10, 5), "futuros", {
            userId: "u1",
            title: "Renomeada",
            dueDate: d(2026, 10, 5).toISOString(),
            type: "conteudo",
            recurrence: "weekly",
            metadata: { ...t.metadata },
        }, false);
        expect(ops).toHaveLength(1);
        expect(ops[0].op).toBe("upsert");
        expect(ops[0].payload.id).toBe("serie-1");
        expect(ops[0].payload.title).toBe("Renomeada");
    });
});
