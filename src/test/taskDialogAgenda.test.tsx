import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Smoke de tela: o formulário da agenda monta, mostra os campos novos e
// respeita a liberação de Conteúdo. Sem banco: tudo mockado.

// jsdom não tem ResizeObserver (o Switch do Radix usa).
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as any;

const auth = vi.hoisted(() => ({ isAdmin: false, allowedModules: [] as string[] }));

vi.mock("@/hooks/useAuth", () => ({
    useAuth: () => ({ user: { id: "u1" }, isAdmin: auth.isAdmin, allowedModules: auth.allowedModules }),
}));

vi.mock("@/hooks/useTasks", () => ({
    useTasks: () => ({
        upsertTaskAsync: vi.fn(),
        saveOccurrenceAsync: vi.fn(),
        deleteOccurrenceAsync: vi.fn(),
    }),
}));

vi.mock("@/integrations/supabase/client", () => {
    const vazio: any = { eq: () => vazio, order: () => vazio, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
    return { supabase: { from: () => ({ select: () => vazio }) } };
});

const { TaskDialog } = await import("@/components/tasks/TaskDialog");
const { metaDaRegra } = await import("@/lib/recorrencia");

function montar(props: Partial<Parameters<typeof TaskDialog>[0]> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <TaskDialog open onOpenChange={() => {}} defaultDate={new Date(2026, 9, 14, 9, 0)} {...props} />
        </QueryClientProvider>,
    );
}

describe("formulário Adicionar tarefa", () => {
    it("mostra título, camada, data, hora, dia inteiro, repetir e descrição", () => {
        auth.isAdmin = false;
        auth.allowedModules = [];
        montar();
        expect(screen.getByText("Adicionar Tarefa")).toBeInTheDocument();
        expect(screen.getByLabelText("Título")).toBeInTheDocument();
        expect(screen.getByText("Camada")).toBeInTheDocument();
        expect(screen.getByLabelText("Hora")).toHaveValue("09:00");
        expect(screen.getByLabelText("Dia inteiro")).toBeInTheDocument();
        expect(screen.getByText("Repetir")).toBeInTheDocument();
        // Quem não é admin não escolhe responsável (não vê agenda dos outros).
        expect(screen.queryByText("Responsável")).not.toBeInTheDocument();
        // "Termina" só aparece quando repete.
        expect(screen.queryByText("Termina")).not.toBeInTheDocument();
    });

    it("admin escolhe o responsável", () => {
        auth.isAdmin = true;
        auth.allowedModules = [];
        montar();
        expect(screen.getByText("Responsável")).toBeInTheDocument();
    });

    it("editando uma série quinzenal com fim: mostra Termina e o resumo", () => {
        auth.isAdmin = false;
        auth.allowedModules = ["agenda-conteudo"];
        montar({
            task: {
                id: "s1",
                userId: "u1",
                createdBy: null,
                title: "Reunião de pauta",
                description: null,
                dueDate: new Date(2026, 9, 5, 10, 0).toISOString(),
                status: "pending",
                type: "conteudo",
                recurrence: "weekly",
                metadata: { recorrencia: metaDaRegra({ freq: "weekly", intervalo: 2, fim: { tipo: "ocorrencias", total: 6 } }) },
                createdAt: "",
                updatedAt: "",
            },
            occurrenceDate: new Date(2026, 9, 19, 10, 0),
        });
        expect(screen.getByText("Editar Tarefa")).toBeInTheDocument();
        expect(screen.getByText("Termina")).toBeInTheDocument();
        expect(screen.getByText("A cada 2 semanas, 6 vezes")).toBeInTheDocument();
        expect(screen.getByText(/Aparece na agenda de quem tem a liberação de Conteúdo/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Excluir/ })).toBeInTheDocument();
        expect(screen.getByLabelText("Hora")).toHaveValue("10:00");
    });
});
