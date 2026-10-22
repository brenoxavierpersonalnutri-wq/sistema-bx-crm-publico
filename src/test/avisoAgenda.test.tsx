import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { linkDaFicha, chaveDeduplicacao } from "@/lib/avisoAluna";
import { AGENDA_ALUNAS_MODULE, podeVerTarefa, tiposCompartilhados } from "@/lib/agendaCamadas";
import { TASK_TYPE_LABELS, type CollaboratorTask } from "@/lib/taskTypes";

const comoTarefa = (x: unknown) => x as CollaboratorTask;

// Aviso da aluna (anamnese/feedback enviados): quem cria é o gatilho no banco
// (supabase/migrations/20261014120000_aviso_anamnese_feedback.sql, testado em
// supabase/tests/aviso-agenda). Aqui: o front mostra, leva pra ficha e trata
// como "visto/feito", sem os botões de "aluna fez/não fez".

const ALUNA = "11111111-0000-0000-0000-000000000001";

const aviso = (over: Record<string, unknown> = {}) => ({
    id: "t-aviso-1",
    userId: "u1",
    createdBy: null,
    title: "Anamnese preenchida: Ana Teste",
    description: "Ela respondeu a anamnese.",
    dueDate: new Date().toISOString(),
    status: "pending",
    type: "aviso",
    recurrence: "none",
    metadata: {
        alunaId: ALUNA,
        alunaNome: "Ana Teste",
        origem: "anamnese",
        avisoChave: `anamnese:22222222-0000-0000-0000-000000000001`,
        link: `/alunas/ficha/${ALUNA}`,
    },
    createdAt: "",
    updatedAt: "",
    ...over,
});

describe("lib/avisoAluna", () => {
    it("monta o link da ficha só para aviso com aluna ligada", () => {
        expect(linkDaFicha(comoTarefa(aviso()))).toBe(`/alunas/ficha/${ALUNA}`);
        expect(linkDaFicha(comoTarefa({ type: "reavaliacao", metadata: { alunaId: ALUNA } }))).toBeNull();
        expect(linkDaFicha(comoTarefa({ type: "aviso", metadata: {} }))).toBeNull();
    });

    it("não vira link com id que não é uuid (o caminho nunca vem do metadata)", () => {
        expect(linkDaFicha(comoTarefa({ type: "aviso", metadata: { alunaId: "../../admin" } }))).toBeNull();
        expect(linkDaFicha(comoTarefa({ type: "aviso", metadata: { alunaId: "javascript:alert(1)//aaaaaaaaaaaaaaaaaaaa" } }))).toBeNull();
    });

    it("dois avisos da mesma aluna no mesmo dia não se fundem; reavaliação mantém a chave antiga", () => {
        const a = aviso();
        const b = aviso({ metadata: { ...aviso().metadata, origem: "feedback", avisoChave: "feedback:x" } });
        expect(chaveDeduplicacao(comoTarefa(a))).not.toBe(chaveDeduplicacao(comoTarefa(b)));
        const r = { type: "reavaliacao", metadata: { alunaId: ALUNA }, dueDate: "2026-10-14T12:00:00Z" };
        expect(chaveDeduplicacao(comoTarefa(r))).toBe(`reavaliacao:${ALUNA}:2026-10-14`);
    });
});

describe("camada Reavaliações enxerga os avisos", () => {
    const comCamada = { isAdmin: false, modulos: [AGENDA_ALUNAS_MODULE] };
    const semNada = { isAdmin: false, modulos: [] };
    it("aviso de outra pessoa aparece só para quem tem agenda-alunas", () => {
        expect(podeVerTarefa({ userId: "outra", type: "aviso" }, "eu", comCamada)).toBe(true);
        expect(podeVerTarefa({ userId: "outra", type: "aviso" }, "eu", semNada)).toBe(false);
        expect(podeVerTarefa({ userId: "eu", type: "aviso" }, "eu", semNada)).toBe(true);
        expect(tiposCompartilhados(comCamada)).toContain("aviso");
    });
    it("tem rótulo próprio", () => {
        expect(TASK_TYPE_LABELS.aviso).toBe("Aviso da aluna");
    });
});

const updateStatus = vi.fn();
const updateOutcome = vi.fn();
let tarefas: unknown[] = [aviso()];
vi.mock("@/hooks/useTasks", () => ({
    useTasks: () => ({
        data: tarefas,
        updateStatus,
        updateOutcome,
        setOccurrenceDone: vi.fn(),
        deleteOccurrenceAsync: vi.fn(),
    }),
}));

const { TaskChecklist } = await import("@/components/tasks/TaskChecklist");

describe("Minha Agenda (checklist) com aviso", () => {
    it("mostra o aviso com rótulo, link pra ficha e marca como visto sem 'fez/não fez'", () => {
        tarefas = [aviso()];
        const onEdit = vi.fn();
        render(
            <MemoryRouter>
                <TaskChecklist userId="u1" onEditTask={onEdit} />
            </MemoryRouter>,
        );
        const titulo = screen.getAllByText("Anamnese preenchida: Ana Teste")[0];
        const item = titulo.closest("div.group") as HTMLElement;
        expect(within(item).getByText("Aviso da aluna")).toBeTruthy();

        const link = within(item).getByRole("link", { name: /abrir ficha/i });
        expect(link.getAttribute("href")).toBe(`/alunas/ficha/${ALUNA}`);
        fireEvent.click(link);
        expect(onEdit).not.toHaveBeenCalled(); // o link não abre o diálogo junto

        expect(within(item).queryByTitle("Contatei mas a aluna NÃO FEZ")).toBeNull();
        fireEvent.click(within(item).getByTitle("Marcar como feita"));
        expect(updateStatus).toHaveBeenCalledWith({ id: "t-aviso-1", status: "completed" });
        expect(updateOutcome).not.toHaveBeenCalled();
    });

    it("aviso de ontem não visto continua em Atrasadas", () => {
        const ontem = new Date();
        ontem.setDate(ontem.getDate() - 1);
        tarefas = [aviso({ id: "t-ontem", title: "Feedback enviado: Bia", dueDate: ontem.toISOString() })];
        render(
            <MemoryRouter>
                <TaskChecklist userId="u1" />
            </MemoryRouter>,
        );
        expect(screen.getAllByText("Feedback enviado: Bia").length).toBeGreaterThan(0);
        // A seção só existe quando há item nela (TaskChecklist: buckets.atrasadas.length > 0).
        expect(screen.getByRole("heading", { name: "Atrasadas" })).toBeTruthy();
    });

    it("feedback de quem não está no cadastro aparece sem link", () => {
        const semAluna = aviso({ id: "t-sem", title: "Feedback enviado: Desconhecida",
            metadata: { origem: "feedback", avisoChave: "feedback:y", alunaNome: "Desconhecida" } });
        tarefas = [semAluna];
        render(
            <MemoryRouter>
                <TaskChecklist userId="u1" />
            </MemoryRouter>,
        );
        expect(screen.getAllByText("Feedback enviado: Desconhecida").length).toBeGreaterThan(0);
        expect(screen.queryByRole("link", { name: /abrir ficha/i })).toBeNull();
    });
});
