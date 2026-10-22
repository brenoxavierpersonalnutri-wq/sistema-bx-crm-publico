import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Bug do E2E de 14/10/2026: apagar a aluna de teste voltava para /alunas, mas a
// agenda continuava mostrando o "Aviso da aluna" dela até recarregar a página.
// O app guarda o dado por 1 min (staleTime 60 s em App.tsx) e ninguém avisava
// o cache. Aqui o useTasks é o de verdade; só o banco é dublê.

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAdmin: auth.isAdmin, allowedModules: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

const banco = vi.hoisted(() => ({
  tarefas: [] as { id: string; title: string }[],
  buscas: 0,
}));

vi.mock("@/lib/taskStore", () => ({
  fetchTasks: async () => {
    banco.buscas += 1;
    return banco.tarefas.map((t) => ({ ...t }));
  },
  upsertTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskOutcome: vi.fn(),
  deleteTask: vi.fn(),
  setOccurrenceDone: vi.fn(),
  deleteOccurrence: vi.fn(),
  saveOccurrence: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome !== "apagar_aluna_teste") return Promise.resolve({ data: null, error: { message: "rpc inesperada" } });
      // O banco apaga a aluna e as tarefas dela.
      banco.tarefas = banco.tarefas.filter((t) => !t.title.includes("TESTE"));
      return Promise.resolve({ data: { aluna: 1, anamneses: 0, feedbacks: 1, tarefas: 1 }, error: null });
    },
    storage: {
      from: () => ({
        list: () => Promise.resolve({ data: [], error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  },
}));

const { useTasks } = await import("@/hooks/useTasks");
const { BotaoApagarAlunaTeste } = await import("@/components/alunas/AlunaTeste");
const { CHAVES_LIGADAS_A_ALUNA } = await import("@/lib/telasDaAluna");

function Agenda() {
  const { data: tarefas = [], isLoading } = useTasks("u1");
  const navigate = useNavigate();
  if (isLoading) return <p>carregando</p>;
  return (
    <div>
      <ul aria-label="agenda">
        {tarefas.map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
      <button onClick={() => navigate("/ficha")}>abrir ficha</button>
    </div>
  );
}

function Ficha() {
  const navigate = useNavigate();
  return (
    <BotaoApagarAlunaTeste
      aluna={{ id: "teste-1", nomeCompleto: "TESTE – Treinamento", isTeste: true }}
      onApagada={() => navigate("/agenda")}
    />
  );
}

// Igual ao App.tsx: dado fresco por 1 min.
const novoCliente = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } } });

function montar(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/agenda"]}>
        <Routes>
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/ficha" element={<Ficha />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.isAdmin = true;
  banco.buscas = 0;
  banco.tarefas = [
    { id: "t1", title: "Aviso da aluna: TESTE – Treinamento enviou o feedback" },
    { id: "t2", title: "Ligar para Maria" },
  ];
});

describe("apagar aluna de teste atualiza a agenda", () => {
  it("voltando da ficha, a agenda já não mostra a tarefa da aluna apagada (sem recarregar)", async () => {
    montar(novoCliente());
    expect(await screen.findByText(/Aviso da aluna: TESTE/)).toBeInTheDocument();
    expect(banco.buscas).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "abrir ficha" }));
    fireEvent.click(await screen.findByRole("button", { name: /Apagar aluna de teste/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Apagar de vez/ }));

    expect(await screen.findByText("Ligar para Maria")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Aviso da aluna: TESTE/)).toBeNull());
    expect(banco.buscas).toBe(2); // buscou de novo, dentro do minuto em que o cache seria "fresco"
  });

  it("marca como velhas a agenda, o check-in, o painel do time, as listas e os feedbacks", async () => {
    const qc = novoCliente();
    for (const k of CHAVES_LIGADAS_A_ALUNA) qc.setQueryData([...k, "x"], []);
    qc.setQueryData(["consultations"], []); // não tem a ver com aluna: fica intacta
    montar(qc);
    await screen.findByText(/Aviso da aluna: TESTE/);

    fireEvent.click(screen.getByRole("button", { name: "abrir ficha" }));
    fireEvent.click(await screen.findByRole("button", { name: /Apagar aluna de teste/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Apagar de vez/ }));
    await screen.findByText("Ligar para Maria");

    for (const k of CHAVES_LIGADAS_A_ALUNA) {
      expect(qc.getQueryState([...k, "x"])?.isInvalidated, k.join("/")).toBe(true);
    }
    expect(qc.getQueryState(["consultations"])?.isInvalidated).toBe(false);
    expect(CHAVES_LIGADAS_A_ALUNA.map((k) => k[0])).toEqual(
      expect.arrayContaining(["tasks", "admin-colaboradores-tasks", "alunas"]),
    );
  });

  it("se o banco recusar, o cache fica como estava", async () => {
    const qc = novoCliente();
    montar(qc);
    await screen.findByText(/Aviso da aluna: TESTE/);
    const { supabase } = await import("@/integrations/supabase/client");
    const rpcOriginal = supabase.rpc;
    (supabase as any).rpc = () =>
      Promise.resolve({ data: null, error: { message: "Recusado: essa aluna é real", code: "42501" } });
    try {
      fireEvent.click(screen.getByRole("button", { name: "abrir ficha" }));
      fireEvent.click(await screen.findByRole("button", { name: /Apagar aluna de teste/ }));
      fireEvent.click(await screen.findByRole("button", { name: /Apagar de vez/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /Apagar de vez/ })).not.toBeDisabled());
      expect(qc.getQueryState(["tasks", "u1"])?.isInvalidated).toBe(false);
    } finally {
      (supabase as any).rpc = rpcOriginal;
    }
  });
});
