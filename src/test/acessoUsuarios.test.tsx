import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// "Quem tem acesso": dono travado, admin altera os outros, não-admin não altera.
// Sem banco: o client do Supabase é um dublê que registra o que foi pedido.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const DONO = "dono-1";
const ADMIN = "adm-2";
const OUTRA = "pessoa-3";

const auth = vi.hoisted(() => ({ id: "adm-2", isAdmin: true }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: auth.id }, isAdmin: auth.isAdmin, allowedModules: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const chamadas = vi.hoisted(() => ({ escritas: [] as { tabela: string; op: string; arg?: unknown }[] }));

vi.mock("@/integrations/supabase/client", () => {
  const dados: Record<string, unknown[]> = {
    profiles: [
      { id: "dono-1", full_name: "Breno" },
      { id: "adm-2", full_name: "Admin Dois" },
      { id: "pessoa-3", full_name: "Pessoa Três" },
    ],
    user_modules: [
      { user_id: "dono-1", module: "agenda-alunas" },
      { user_id: "dono-1", module: "comercial" },
      { user_id: "adm-2", module: "comercial" },
    ],
    user_roles: [
      { user_id: "dono-1", role: "admin" },
      { user_id: "adm-2", role: "admin" },
    ],
  };
  const consulta = (tabela: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      then: (r: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(r),
    };
    return q;
  };
  const escrita = (tabela: string, op: string, arg?: unknown) => {
    chamadas.escritas.push({ tabela, op, arg });
    const q: any = {
      eq: () => q,
      in: () => q,
      then: (r: any) => Promise.resolve({ data: null, error: null }).then(r),
    };
    return q;
  };
  return {
    supabase: {
      from: (tabela: string) => ({
        select: () => consulta(tabela),
        insert: (arg: unknown) => escrita(tabela, "insert", arg),
        delete: () => escrita(tabela, "delete"),
      }),
      rpc: (nome: string) =>
        Promise.resolve(nome === "dono_do_sistema" ? { data: "dono-1", error: null } : { data: null, error: { message: "?" } }),
    },
  };
});

const { AgendaAccessManager } = await import("@/components/tasks/AgendaAccessManager");
const { podeAlterarAcesso, linhaTravada } = await import("@/lib/acessoUsuarios");

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgendaAccessManager />
    </QueryClientProvider>,
  );
}

const chave = (coluna: string, nome: string) => screen.getByRole("switch", { name: `${coluna} para ${nome}` });

describe("regras de quem altera acesso", () => {
  const admin = { euId: ADMIN, euAdmin: true, donoId: DONO };

  it("dono: linha travada, nenhuma chave alterável, nem por outro admin", () => {
    expect(linhaTravada(DONO, admin)).toBe(true);
    for (const campo of ["reavaliacoes", "conteudo", "comercial", "admin"] as const) {
      expect(podeAlterarAcesso(DONO, campo, admin).pode).toBe(false);
    }
  });

  it("admin altera as quatro chaves de outra pessoa", () => {
    for (const campo of ["reavaliacoes", "conteudo", "comercial", "admin"] as const) {
      expect(podeAlterarAcesso(OUTRA, campo, admin)).toEqual({ pode: true });
    }
  });

  it("admin não tira o próprio admin, mas mexe nos próprios módulos", () => {
    expect(podeAlterarAcesso(ADMIN, "admin", admin).pode).toBe(false);
    expect(podeAlterarAcesso(ADMIN, "comercial", admin).pode).toBe(true);
  });

  it("quem não é admin não altera nada", () => {
    const comum = { euId: OUTRA, euAdmin: false, donoId: DONO };
    for (const campo of ["reavaliacoes", "conteudo", "comercial", "admin"] as const) {
      expect(podeAlterarAcesso(ADMIN, campo, comum).pode).toBe(false);
      expect(podeAlterarAcesso(OUTRA, campo, comum).pode).toBe(false);
    }
  });

  it("sem saber o dono (SQL não rodou), nada trava por ser dono", () => {
    expect(linhaTravada(DONO, { donoId: null })).toBe(false);
    expect(podeAlterarAcesso(DONO, "comercial", { ...admin, donoId: null }).pode).toBe(true);
  });
});

describe("tela Quem tem acesso", () => {
  beforeEach(() => {
    chamadas.escritas.length = 0;
    auth.id = ADMIN;
    auth.isAdmin = true;
  });

  it("mostra a coluna Comercial com o estado de cada pessoa", async () => {
    montar();
    expect(await screen.findByText("Comercial")).toBeInTheDocument();
    await screen.findByText("Pessoa Três");
    expect(chave("Comercial", "Breno")).toBeChecked();
    expect(chave("Comercial", "Admin Dois")).toBeChecked();
    expect(chave("Comercial", "Pessoa Três")).not.toBeChecked();
  });

  it("linha do dono travada: as quatro chaves desabilitadas e clicar não grava", async () => {
    montar();
    await screen.findByText("Breno");
    await waitFor(() => expect(chave("Comercial", "Breno")).toBeDisabled());
    for (const c of ["Reavaliações", "Conteúdo", "Comercial", "Admin"]) {
      expect(chave(c, "Breno")).toBeDisabled();
      fireEvent.click(chave(c, "Breno"));
    }
    expect(screen.getByLabelText("Dono do sistema: acesso travado")).toBeInTheDocument();
    expect(chamadas.escritas).toEqual([]);
  });

  it("admin liga Comercial de outra pessoa (insere comercial em user_modules)", async () => {
    montar();
    await screen.findByText("Pessoa Três");
    await waitFor(() => expect(chave("Comercial", "Breno")).toBeDisabled());
    const sw = chave("Comercial", "Pessoa Três");
    expect(sw).toBeEnabled();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(chamadas.escritas).toContainEqual({
        tabela: "user_modules",
        op: "insert",
        arg: { user_id: OUTRA, module: "comercial" },
      }),
    );
  });

  it("admin desliga Admin de outro admin; o próprio Admin fica travado", async () => {
    auth.id = OUTRA; // a pessoa logada é um terceiro admin
    montar();
    await screen.findByText("Admin Dois");
    await waitFor(() => expect(chave("Admin", "Breno")).toBeDisabled());
    expect(chave("Admin", "Pessoa Três")).toBeDisabled(); // ela mesma
    fireEvent.click(chave("Admin", "Admin Dois"));
    await waitFor(() =>
      expect(chamadas.escritas).toContainEqual({ tabela: "user_roles", op: "insert", arg: { user_id: ADMIN, role: "user" } }),
    );
  });

  it("quem não é admin não vê chave nenhuma", () => {
    auth.id = OUTRA;
    auth.isAdmin = false;
    montar();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByText("Quem tem acesso")).not.toBeInTheDocument();
  });
});
