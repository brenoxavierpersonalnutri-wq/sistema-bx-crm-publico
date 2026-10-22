// Renomear o número do WhatsApp em /crm/conexoes (18/10/2026): lápis no cartão, campo no modal do QR,
// só o apelido muda (nunca a sessão do OpenWA) e Conversas relê os números na hora.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const updates: { tabela: string; valores: Record<string, unknown>; id?: unknown }[] = [];
let lista: Record<string, unknown>[] = [];

vi.mock("@/lib/crmAutomacoes", () => {
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    let valores: Record<string, unknown> | null = null;
    q.select = () => q;
    q.order = () => Promise.resolve({ data: lista, error: null });
    q.update = (v: Record<string, unknown>) => { valores = v; return q; };
    q.eq = (_c: string, id: unknown) => {
      if (valores) updates.push({ tabela, valores, id });
      return { select: () => Promise.resolve({ data: [{ id, apelido: valores?.apelido }], error: null }) };
    };
    return q;
  };
  return { db: { from, rpc: (...a: unknown[]) => rpc(...a) } };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));
// toast estável, como o real (função de módulo): o ciclo do QR depende dele
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }), toast }; });
vi.mock("@/components/crm/central/CanalInstagram", () => ({ CanalInstagram: () => null }));
vi.mock("@/components/crm/conexoes/HistoricoCompleto", () => ({ HistoricoCompleto: () => null }));
vi.mock("@/lib/crm/fonteConversas", () => ({ fonteSupabase: {}, trazerConversasRecentes: vi.fn(), trazerConversasAoConectar: vi.fn() }));

import {
  EVENTO_NUMEROS_ALTERADOS, normalizarNomeNumero, renomearNumero, rpcAusente, validarNomeNumero,
} from "@/lib/crm/renomearNumero";
import ConexoesCRM from "@/pages/crm/ConexoesCRM";
import { useConversas } from "@/hooks/useConversas";
import type { FonteConversas } from "@/lib/crm/fonteConversas";

const CLOSER = "11111111-1111-4111-8111-111111111111";
const FIT2 = "22222222-2222-4222-8222-222222222222";
const NUMEROS = [
  { id: "11111111-1111-4111-8111-111111111111", chave: "closer", apelido: "Closer", telefone: null, tipo: "openwa", sessao_openwa: "closer", ativo: true, ordem: 10 },
  { id: FIT2, chave: "comercial-fit-2", apelido: "Comercial Fit 2", telefone: null, tipo: "openwa", sessao_openwa: "comercial-fit-2", ativo: true, ordem: 20 },
];

beforeEach(() => {
  rpc.mockReset();
  updates.length = 0;
  lista = NUMEROS.map((n) => ({ ...n }));
});

describe("regras do nome", () => {
  it("normaliza espaços e valida 2-40 e repetido sem diferenciar maiúscula", () => {
    expect(normalizarNomeNumero("  Vendas   Fit ")).toBe("Vendas Fit");
    expect(validarNomeNumero(" x ", NUMEROS, FIT2)).toMatch(/pelo menos 2/);
    expect(validarNomeNumero("a".repeat(41), NUMEROS, FIT2)).toMatch(/no máximo 40/);
    expect(validarNomeNumero("a".repeat(40), NUMEROS, FIT2)).toBeNull();
    expect(validarNomeNumero("closer", NUMEROS, FIT2)).toMatch(/Já existe/);
    expect(validarNomeNumero("COMERCIAL fit 2", NUMEROS, FIT2)).toBeNull(); // o próprio número
  });
  it("reconhece RPC ausente (migration não rodada)", () => {
    expect(rpcAusente({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(rpcAusente({ code: "42883" })).toBe(true);
    expect(rpcAusente({ code: "23505", message: "Já existe" })).toBe(false);
  });
});

describe("renomearNumero", () => {
  it("usa a RPC com o nome normalizado", async () => {
    rpc.mockResolvedValue({ data: [{ id: FIT2, apelido: "Vendas Fit" }], error: null });
    await expect(renomearNumero(FIT2, "  Vendas  Fit ")).resolves.toBe("Vendas Fit");
    expect(rpc).toHaveBeenCalledWith("crm_numero_renomear", { p_id: FIT2, p_nome: "Vendas Fit" });
    expect(updates).toHaveLength(0);
  });
  it("sem a RPC no banco, grava SÓ o apelido (nunca a sessão)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_numero_renomear" } });
    await expect(renomearNumero(FIT2, "Vendas Fit")).resolves.toBe("Vendas Fit");
    expect(updates).toEqual([{ tabela: "crm_numeros", valores: { apelido: "Vendas Fit" }, id: FIT2 }]);
  });
  it("erro do banco vira mensagem em português", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(renomearNumero(FIT2, "Vendas Fit")).rejects.toThrow("Sem permissão para renomear números.");
  });
});

function renderTela() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><ConexoesCRM /></QueryClientProvider>);
}
async function cartaoDe(nome: string) {
  const el = await screen.findByText(nome);
  return el.closest("article") as HTMLElement;
}

describe("/crm/conexoes: lápis no nome do cartão", () => {
  it("edita inline, salva com Enter, atualiza o cartão e avisa Conversas", async () => {
    rpc.mockResolvedValue({ data: [{ id: FIT2, apelido: "Vendas Fit" }], error: null });
    const ouvinte = vi.fn();
    window.addEventListener(EVENTO_NUMEROS_ALTERADOS, ouvinte);
    renderTela();
    const cartao = await cartaoDe("Comercial Fit 2");
    fireEvent.click(within(cartao).getByRole("button", { name: /Editar nome de Comercial Fit 2/ }));
    const campo = within(cartao).getByRole("textbox", { name: "Nome do número" });
    expect(campo).toHaveValue("Comercial Fit 2");
    fireEvent.change(campo, { target: { value: "Vendas Fit" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await within(cartao).findByText("Vendas Fit");
    expect(rpc).toHaveBeenCalledWith("crm_numero_renomear", { p_id: FIT2, p_nome: "Vendas Fit" });
    expect(within(cartao).getByText(/sessão comercial-fit-2/)).toBeInTheDocument();
    expect(ouvinte).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENTO_NUMEROS_ALTERADOS, ouvinte);
  });

  it("cancelar volta o nome; repetido mostra erro e não chama o banco", async () => {
    renderTela();
    const cartao = await cartaoDe("Comercial Fit 2");
    fireEvent.click(within(cartao).getByRole("button", { name: /Editar nome/ }));
    fireEvent.change(within(cartao).getByRole("textbox"), { target: { value: "closer" } });
    fireEvent.click(within(cartao).getByRole("button", { name: "Salvar nome" }));
    expect(await within(cartao).findByRole("alert")).toHaveTextContent(/Já existe um número com o nome "closer"/);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(within(cartao).getByRole("button", { name: "Cancelar edição do nome" }));
    expect(within(cartao).getByText("Comercial Fit 2")).toBeInTheDocument();
    expect(within(cartao).queryByRole("textbox")).toBeNull();
  });

  it("erro do banco aparece no cartão e mantém a edição aberta", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: 'Já existe um número com o nome "Suporte".' } });
    renderTela();
    const cartao = await cartaoDe("Comercial Fit 2");
    fireEvent.click(within(cartao).getByRole("button", { name: /Editar nome/ }));
    fireEvent.change(within(cartao).getByRole("textbox"), { target: { value: "Suporte" } });
    fireEvent.click(within(cartao).getByRole("button", { name: "Salvar nome" }));
    expect(await within(cartao).findByRole("alert")).toHaveTextContent(/Já existe/);
    expect(within(cartao).getByRole("textbox")).toHaveValue("Suporte");
  });
});

describe("/crm/conexoes: modal do QR pede o nome do número", () => {
  // o closer é a sessão padrão: a única que a ponte atende sem eco da sessão, então o botão Conectar fica ativo
  it("campo pré-preenchido; salvar troca o título e o cartão", async () => {
    rpc.mockResolvedValue({ data: [{ id: CLOSER, apelido: "Closer Vendas" }], error: null });
    renderTela();
    const cartao = await cartaoDe("Closer");
    await waitFor(() => expect(within(cartao).getByRole("button", { name: /Conectar/ })).toBeEnabled());
    fireEvent.click(within(cartao).getByRole("button", { name: /Conectar/ }));
    const dialogo = await screen.findByRole("dialog");
    const campo = within(dialogo).getByLabelText("Nome deste número");
    expect(campo).toHaveValue("Closer");
    expect(within(dialogo).getByRole("button", { name: "Salvar nome" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "Closer Vendas" } });
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar nome" })); });
    await waitFor(() => expect(within(dialogo).getByRole("heading")).toHaveTextContent("Conectar Closer Vendas"));
    expect(rpc).toHaveBeenCalledWith("crm_numero_renomear", { p_id: CLOSER, p_nome: "Closer Vendas" });
    expect(within(cartao).getByText("Closer Vendas")).toBeInTheDocument();
  });
});

describe("Conversas relê os números quando um é renomeado", () => {
  it("o evento dispara nova leitura de listarNumeros", async () => {
    let nome = "Comercial Fit 2";
    const listarNumeros = vi.fn(async () => [{ id: FIT2, chave: "comercial-fit-2", apelido: nome, telefone: null, tipo: "openwa", ativo: true }]);
    const fonte = {
      listarContatos: async () => [], mensagensRecentes: async () => [], usuarioId: async () => "u1",
      assinar: () => () => undefined, listarNumeros,
    } as unknown as FonteConversas;
    const { result } = renderHook(() => useConversas(fonte));
    await waitFor(() => expect(result.current.numeros[0]?.apelido).toBe("Comercial Fit 2"));
    nome = "Vendas Fit";
    act(() => { window.dispatchEvent(new CustomEvent(EVENTO_NUMEROS_ALTERADOS)); });
    await waitFor(() => expect(result.current.numeros[0]?.apelido).toBe("Vendas Fit"));
  });
});
