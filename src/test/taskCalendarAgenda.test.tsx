import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Smoke de tela do calendário: série quinzenal com exceção aparece nos dias
// certos, a camada Conteúdo entra na legenda e clicar num dia abre "nova tarefa".

vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => ({ user: { id: "u1" }, isAdmin: false, allowedModules: ["agenda-conteudo"] }),
}));

const { metaDaRegra } = await import("@/lib/recorrencia");

// Série começa no primeiro dia útil do mês atual, pra cair na visão de mês aberta.
const hoje = new Date();
const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 10, 0);
const excecao = new Date(inicio.getFullYear(), inicio.getMonth(), 15, 10, 0);

const serie = {
    id: "s1",
    userId: "u1",
    createdBy: null,
    title: "Pauta quinzenal",
    description: null,
    dueDate: inicio.toISOString(),
    status: "pending",
    type: "conteudo",
    recurrence: "weekly",
    metadata: {
        recorrencia: { ...metaDaRegra({ freq: "weekly", intervalo: 2, fim: { tipo: "nunca" } }), excecoes: [
            `${excecao.getFullYear()}-${String(excecao.getMonth() + 1).padStart(2, "0")}-15`,
        ] },
    },
    createdAt: "",
    updatedAt: "",
};

vi.mock("@/hooks/useTasks", () => ({
    useTasks: () => ({
        data: [serie],
        updateStatus: vi.fn(),
        updateOutcome: vi.fn(),
        deleteTask: vi.fn(),
        setOccurrenceDone: vi.fn(),
        deleteOccurrenceAsync: vi.fn(),
    }),
}));

vi.mock("@/hooks/useConsultations", () => ({ useUpdateConsultation: () => ({ mutate: vi.fn() }) }));

const { TaskCalendar } = await import("@/components/tasks/TaskCalendar");

describe("agenda (visão Mês)", () => {
    it("mostra as ocorrências da série quinzenal menos a exceção, com legenda Conteúdo", () => {
        const onCreate = vi.fn();
        const onEdit = vi.fn();
        const qc = new QueryClient();
        render(
            <QueryClientProvider client={qc}>
                <TaskCalendar userId="u1" onCreateForDate={onCreate} onEditTask={onEdit} />
            </QueryClientProvider>,
        );

        // Dias 1, 15 e 29 seriam as ocorrências; 15 é exceção. A grade vai no
        // máximo 6 dias além do fim do mês, então a seguinte (dia 43) não aparece.
        const itens = screen.getAllByTitle("Pauta quinzenal (repete)");
        const diasNoMes = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0).getDate();
        const esperadas = diasNoMes >= 29 ? 2 : 1;
        expect(itens).toHaveLength(esperadas); // sem a exceção seriam esperadas + 1
        expect(screen.getByText("Conteúdo")).toBeInTheDocument();

        // Clicar no item abre a edição com o dia da ocorrência (não o dueDate).
        fireEvent.click(itens[itens.length - 1]);
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect((onEdit.mock.calls[0][1] as Date).getDate()).toBe(esperadas === 2 ? 29 : 1);
        expect(onCreate).not.toHaveBeenCalled();

        // Botão "Adicionar tarefa" abre o formulário.
        fireEvent.click(screen.getByRole("button", { name: /Adicionar tarefa/ }));
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect((onCreate.mock.calls[0][0] as Date).getHours()).toBe(9);
    });

    it("clicar num dia vazio abre nova tarefa naquele dia às 9:00", () => {
        const onCreate = vi.fn();
        const qc = new QueryClient();
        render(
            <QueryClientProvider client={qc}>
                <TaskCalendar userId="u1" onCreateForDate={onCreate} />
            </QueryClientProvider>,
        );
        const cell = screen.getAllByTitle("Clique pra adicionar uma tarefa neste dia")[10];
        fireEvent.click(cell);
        expect(onCreate).toHaveBeenCalledTimes(1);
        const dia = onCreate.mock.calls[0][0] as Date;
        expect(dia.getHours()).toBe(9);
        expect(dia.getMinutes()).toBe(0);
    });
});
