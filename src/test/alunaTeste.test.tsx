import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// Aluna de teste: criar, selo, apagar só a de teste, recusa na aluna real e
// fora das métricas. Sem banco: o client do Supabase é um dublê que registra
// o que foi pedido. A regra de verdade (recusar aluna real) está no SQL e é
// testada em supabase/tests/aluna-teste; aqui é a tela.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const auth = vi.hoisted(() => ({ isAdmin: true, modulos: [] as string[] }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    isAdmin: auth.isAdmin,
    allowedModules: auth.modulos,
    signOut: vi.fn(),
  }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
// toast estável: a tela usa ele como dependência do carregar (função nova a cada render = laço).
const toastAntigo = vi.hoisted(() => ({ toast: () => {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => toastAntigo }));

// O que não interessa aqui vira nada.
vi.mock("@/components/tasks/TaskCalendar", () => ({ TaskCalendar: () => null }));
vi.mock("@/components/tasks/TaskDialog", () => ({ TaskDialog: () => null }));
vi.mock("@/hooks/useTasks", () => ({ useTasks: () => ({ data: [] }) }));
vi.mock("@/components/UserProfileHeader", () => ({ UserProfileHeader: () => null }));
vi.mock("@/components/alunas/AlunaForm", () => ({ AlunaForm: () => null }));
vi.mock("@/components/alunas/AlunaImportSheet", () => ({ AlunaImportSheet: () => null }));
vi.mock("@/components/shared/SignalReminderUnified", () => ({ SignalReminderUnified: () => null }));
vi.mock("@/components/alunas/AnamnesePainel", () => ({ AnamnesePainel: () => null }));
vi.mock("@/components/alunas/FeedbacksPainel", () => ({ FeedbacksPainel: () => null }));

const hoje = new Date();
const daqui3Meses = new Date(hoje.getFullYear(), hoje.getMonth() + 3, hoje.getDate()).toISOString().slice(0, 10);
const linha = (o: Record<string, unknown>) => ({
  programa: "menos_gordura",
  data_compra: hoje.toISOString().slice(0, 10),
  duracao_plano: "3",
  data_vencimento: daqui3Meses,
  forma_pagamento: "pix",
  pago: true,
  status: "ativa",
  ...o,
});

const banco = vi.hoisted(() => ({
  alunas: [] as Record<string, unknown>[],
  rpc: [] as { nome: string; args: unknown }[],
  rpcResposta: {} as Record<string, { data: unknown; error: unknown }>,
  storage: [] as { bucket: string; op: string; arg: unknown }[],
  apagadas: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    let id: unknown = null;
    let apagar = false;
    const q: any = {
      select: () => q,
      delete: () => {
        apagar = true;
        return q;
      },
      eq: (col: string, v: unknown) => {
        if (col === "id") id = v;
        if (apagar && tabela === "alunas") banco.apagadas.push(v);
        return q;
      },
      in: () => q,
      or: () => q,
      order: () => q,
      maybeSingle: () => {
        const r = banco.alunas.find((a) => a.id === id) ?? null;
        return Promise.resolve({ data: r, error: null });
      },
      then: (r: any) =>
        Promise.resolve({ data: tabela === "alunas" ? banco.alunas : [], error: null }).then(r),
    };
    return q;
  };
  return {
    supabase: {
      from: (tabela: string) => consulta(tabela),
      rpc: (nome: string, args?: unknown) => {
        banco.rpc.push({ nome, args });
        return Promise.resolve(banco.rpcResposta[nome] ?? { data: null, error: { message: "rpc sem resposta" } });
      },
      storage: {
        from: (bucket: string) => ({
          list: (pasta: string) => {
            banco.storage.push({ bucket, op: "list", arg: pasta });
            return Promise.resolve({ data: bucket === "dietas" ? [{ name: "a.pdf" }] : [], error: null });
          },
          remove: (caminhos: string[]) => {
            banco.storage.push({ bucket, op: "remove", arg: caminhos });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      },
    },
  };
});

const { fetchAlunas } = await import("@/lib/alunaStore");
const { semAlunasTeste, ehTelefoneDeTeste, semFeedbacksDeTeste, podeGerirAlunaTeste, apagarAlunaTeste } =
  await import("@/lib/alunaTeste");
const { default: Alunas } = await import("@/pages/Alunas");
const { default: AlunaFicha } = await import("@/pages/AlunaFicha");

const REAL = linha({ id: "real-1", nome_completo: "Maria Real", telefone: "(31) 99000-0107", is_teste: false });
const TESTE = linha({
  id: "teste-1",
  nome_completo: "TESTE – Treinamento 14/10/2026 15:30",
  telefone: "(00) 90000-1234",
  is_teste: true,
});

function Onde() {
  const l = useLocation();
  return <div data-testid="onde">{l.pathname}</div>;
}

function montar(caminho: string, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
    <TooltipProvider>
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/alunas" element={<><Alunas /><Onde /></>} />
        <Route path="/alunas/ficha/:id" element={<><AlunaFicha /><Onde /></>} />
      </Routes>
    </MemoryRouter>
    </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.isAdmin = true;
  auth.modulos = [];
  banco.alunas = [REAL, TESTE];
  banco.rpc = [];
  banco.rpcResposta = {};
  banco.storage = [];
  banco.apagadas = [];
  toasts.success.mockClear();
  toasts.error.mockClear();
});

describe("regras puras", () => {
  it("fetchAlunas lê a marca is_teste", async () => {
    const alunas = await fetchAlunas();
    expect(alunas.find((a) => a.id === "teste-1")?.isTeste).toBe(true);
    expect(alunas.find((a) => a.id === "real-1")?.isTeste).toBeFalsy();
  });

  it("semAlunasTeste deixa só as reais", async () => {
    const alunas = await fetchAlunas();
    expect(semAlunasTeste(alunas).map((a) => a.id)).toEqual(["real-1"]);
  });

  it("telefone de teste é só o de DDD 00", () => {
    expect(ehTelefoneDeTeste("(00) 90000-1234")).toBe(true);
    expect(ehTelefoneDeTeste("5500900001234")).toBe(true);
    expect(ehTelefoneDeTeste("(31) 99000-0107")).toBe(false);
    expect(ehTelefoneDeTeste("00351912345678")).toBe(false); // 00 internacional, não é DDD
    expect(ehTelefoneDeTeste("")).toBe(false);
    expect(ehTelefoneDeTeste(null)).toBe(false);
  });

  it("feedbacks da aluna de teste saem das métricas (por aluna_id e por telefone)", () => {
    const fb = [
      { id: "f1", aluna_id: "real-1", telefone: "31990000107" },
      { id: "f2", aluna_id: "teste-1", telefone: "31990000107" },
      { id: "f3", aluna_id: null, telefone: "(00) 90000-1234" },
      { id: "f4", aluna_id: null, telefone: "31988887777" },
    ];
    const alunas = [{ id: "real-1" }, { id: "teste-1", isTeste: true }];
    expect(semFeedbacksDeTeste(fb, alunas).map((f) => f.id)).toEqual(["f1", "f4"]);
  });

  it("quem pode: admin ou módulo alunas", () => {
    expect(podeGerirAlunaTeste(true, [])).toBe(true);
    expect(podeGerirAlunaTeste(false, ["alunas"])).toBe(true);
    expect(podeGerirAlunaTeste(false, ["comercial"])).toBe(false);
  });

  it("apagar: se o banco recusa (aluna real), nada sai do storage", async () => {
    banco.rpcResposta.apagar_aluna_teste = {
      data: null,
      error: { message: "Recusado: essa aluna é real, não é de teste. Nada foi apagado.", code: "42501" },
    };
    await expect(apagarAlunaTeste("real-1")).rejects.toMatchObject({ code: "42501" });
    expect(banco.storage).toEqual([]);
  });
});

describe("Gestão de Alunas", () => {
  it("cartões do topo não contam a aluna de teste", async () => {
    montar("/alunas");
    const cartao = (await screen.findByText("Alunas Individuais")).parentElement!;
    expect(within(cartao).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Pagamentos em Dia").parentElement!).toHaveTextContent("1");
  });

  it("lista do cadastro mostra a de teste com o selo e sem o Excluir comum", async () => {
    montar("/alunas");
    fireEvent.click(await screen.findByRole("button", { name: /Mostrar todas/ }));
    const nome = await screen.findByText(/TESTE – Treinamento/);
    const card = nome.closest(".p-4") as HTMLElement;
    expect(within(card).getByText("Teste")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Apagar aluna de teste/ })).toBeInTheDocument();
    const real = screen.getByText("Maria Real").closest(".p-4") as HTMLElement;
    expect(within(real).queryByText("Teste")).toBeNull();
    expect(within(real).queryByRole("button", { name: /Apagar aluna de teste/ })).toBeNull();

    // Menu de ações: a de teste não tem o "Excluir" comum (que deixaria anamnese/feedback/agenda para trás).
    const abrirMenu = (c: HTMLElement) => {
      const gatilho = within(c).getAllByRole("button").at(-1)!;
      fireEvent.keyDown(gatilho, { key: "Enter" });
    };
    abrirMenu(card);
    expect(await screen.findByRole("menuitem", { name: /Editar/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Excluir/ })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Editar/ })).toBeNull());
    abrirMenu(real);
    expect(await screen.findByRole("menuitem", { name: /Excluir/ })).toBeInTheDocument();
  });

  it("Excluir comum (aluna real) também marca a agenda e as listas como velhas", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    qc.setQueryData(["tasks", "u1"], []);
    qc.setQueryData(["admin-colaboradores-tasks"], []);
    montar("/alunas", qc);
    fireEvent.click(await screen.findByRole("button", { name: /Mostrar todas/ }));
    const real = (await screen.findByText("Maria Real")).closest(".p-4") as HTMLElement;
    fireEvent.keyDown(within(real).getAllByRole("button").at(-1)!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excluir/ }));
    await waitFor(() => expect(banco.apagadas).toEqual(["real-1"]));
    await waitFor(() => expect(qc.getQueryState(["tasks", "u1"])?.isInvalidated).toBe(true));
    expect(qc.getQueryState(["admin-colaboradores-tasks"])?.isInvalidated).toBe(true);
  });

  it("botão Criar aluna de teste: admin vê, cria pela RPC e abre a ficha", async () => {
    banco.rpcResposta.criar_aluna_teste = {
      data: { id: "teste-1", nome: "TESTE – Treinamento 14/10/2026 15:30", telefone: "(00) 90000-1234" },
      error: null,
    };
    montar("/alunas");
    fireEvent.click(await screen.findByRole("button", { name: /Criar aluna de teste/ }));
    await waitFor(() => expect(screen.getByTestId("onde")).toHaveTextContent("/alunas/ficha/teste-1"));
    expect(banco.rpc).toEqual([{ nome: "criar_aluna_teste", args: undefined }]);
  });

  it("quem tem o módulo alunas também vê; quem não tem, não", async () => {
    auth.isAdmin = false;
    auth.modulos = ["alunas"];
    const { unmount } = montar("/alunas");
    expect(await screen.findByRole("button", { name: /Criar aluna de teste/ })).toBeInTheDocument();
    unmount();

    auth.modulos = ["comercial"];
    montar("/alunas");
    await screen.findByText("Alunas Individuais");
    expect(screen.queryByRole("button", { name: /Criar aluna de teste/ })).toBeNull();
  });
});

describe("Ficha", () => {
  it("aluna de teste: selo, aviso e Apagar; apaga pela RPC, limpa o storage e volta pra lista", async () => {
    banco.rpcResposta.apagar_aluna_teste = {
      data: { aluna: 1, anamneses: 1, feedbacks: 2, tarefas: 3 },
      error: null,
    };
    montar("/alunas/ficha/teste-1");
    expect(await screen.findByText("Aluna de teste, para treinar o time")).toBeInTheDocument();
    expect(screen.getByText("Teste")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /90000-1234/ })).toBeNull(); // sem WhatsApp pro número fictício

    fireEvent.click(screen.getByRole("button", { name: /Apagar aluna de teste/ }));
    expect(banco.rpc).toEqual([]); // só a confirmação abriu
    fireEvent.click(await screen.findByRole("button", { name: /Apagar de vez/ }));

    await waitFor(() => expect(screen.getByTestId("onde")).toHaveTextContent(/^\/alunas$/));
    expect(banco.rpc).toEqual([{ nome: "apagar_aluna_teste", args: { _aluna: "teste-1" } }]);
    expect(banco.storage).toContainEqual({ bucket: "dietas", op: "remove", arg: ["teste-1/a.pdf"] });
    expect(toasts.success).toHaveBeenCalled();
  });

  it("aluna real: sem selo e sem botão de apagar", async () => {
    montar("/alunas/ficha/real-1");
    expect(await screen.findByText("Maria Real")).toBeInTheDocument();
    expect(screen.queryByText("Teste")).toBeNull();
    expect(screen.queryByRole("button", { name: /Apagar aluna de teste/ })).toBeNull();
    expect(screen.queryByText("Aluna de teste, para treinar o time")).toBeNull();
  });

  it("se o banco recusar, mostra o motivo e fica na ficha", async () => {
    banco.rpcResposta.apagar_aluna_teste = {
      data: null,
      error: { message: "Recusado: essa aluna é real, não é de teste. Nada foi apagado.", code: "42501" },
    };
    montar("/alunas/ficha/teste-1");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar aluna de teste/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Apagar de vez/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Recusado")));
    expect(screen.getByTestId("onde")).toHaveTextContent("/alunas/ficha/teste-1");
    expect(banco.storage).toEqual([]);
  });
});
