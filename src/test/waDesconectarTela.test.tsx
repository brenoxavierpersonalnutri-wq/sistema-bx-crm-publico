// "Desconectar" em /crm/conexoes (21/10/2026): botão só para admin/liberação Comercial e número OpenWA conectado,
// diálogo com nome e número, POST {acao:"desconectar"} na whatsapp-qr, cartão volta para "desconectado / aguardando
// QR" com Conectar, erro em texto legível. Mais a lógica pura da função (permissão, crm_numeros, textos).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/crmAutomacoes", () => {
  const lista = [
    { id: "11111111-1111-4111-8111-111111111111", chave: "closer", apelido: "Pessoal Breno", telefone: "5531988887777", tipo: "openwa", sessao_openwa: "closer", ativo: true, ordem: 10 },
    { id: "22222222-2222-4222-8222-222222222222", chave: "comercial-fit-2", apelido: "Comercial Fit 2", telefone: "5531999998888", tipo: "openwa", sessao_openwa: "comercial-fit-2", ativo: true, ordem: 20 },
    { id: "33333333-3333-4333-8333-333333333333", chave: "oficial-full-funnel", apelido: "Oficial (Full Funnel)", telefone: "553170000102", tipo: "oficial", sessao_openwa: null, ativo: true, ordem: 50 },
  ];
  const from = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => Promise.resolve({ data: lista, error: null });
    return q;
  };
  return { db: { from, rpc: vi.fn() } };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tk" } } }) } },
}));
const rede = vi.hoisted(() => ({
  chamadas: [] as { url: string; init?: RequestInit }[],
  desconectar: { status: 200, corpo: { provider: "openwa", sessao: "comercial-fit-2", desconectado: true, connected: false, state: "initializing" } as Record<string, unknown> },
}));
vi.mock("@/lib/fetchComLimite", () => ({
  buscarComLimite: (url: string, init?: RequestInit) => {
    rede.chamadas.push({ url, init });
    if (init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify(rede.desconectar.corpo), { status: rede.desconectar.status }));
    }
    const sessao = new URL(url).searchParams.get("sessao");
    return Promise.resolve(new Response(JSON.stringify({ provider: "openwa", sessao, connected: true, state: "ready", phone: null, qr: null }), { status: 200 }));
  },
}));
const auth = vi.hoisted(() => ({ isAdmin: true, allowedModules: [] as string[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
const toasts = vi.hoisted(() => ({ fn: null as null | ReturnType<typeof vi.fn> }));
vi.mock("@/hooks/use-toast", () => {
  const toast = vi.fn();
  toasts.fn = toast;
  return { useToast: () => ({ toast }), toast };
});
vi.mock("@/components/crm/central/CanalInstagram", () => ({ CanalInstagram: () => null }));
vi.mock("@/components/crm/conexoes/HistoricoCompleto", () => ({ HistoricoCompleto: () => null }));
vi.mock("@/lib/crm/fonteConversas", () => ({ fonteSupabase: {}, trazerConversasRecentes: vi.fn(), trazerConversasAoConectar: vi.fn() }));

import ConexoesCRM from "@/pages/crm/ConexoesCRM";
import { interpretarStatusNumero } from "@/lib/crm/central";
import { podeVerDesconectar, statusDepoisDeDesconectar, textoErroDesconexao } from "@/lib/crm/desconectarNumero";
import {
  mensagemErroDesconectar, numeroParaDesconectar, podeDesconectar, resultadoDesconectar, statusErroDesconectar,
} from "../../supabase/functions/_shared/desconectarWa";

const tela = () => render(<QueryClientProvider client={new QueryClient()}><ConexoesCRM /></QueryClientProvider>);
const cartao = (nome: string) => screen.getAllByTestId("cartao-conexao").find((c) => c.textContent?.includes(nome))!;

beforeEach(() => {
  rede.chamadas.length = 0;
  rede.desconectar = { status: 200, corpo: { provider: "openwa", sessao: "comercial-fit-2", desconectado: true, connected: false, state: "initializing" } };
  auth.isAdmin = true;
  auth.allowedModules = [];
  toasts.fn?.mockClear();
});

describe("tela Conexões: Desconectar", () => {
  it("admin: botão nos números OpenWA conectados, nunca no oficial", async () => {
    tela();
    await waitFor(() => expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado"));
    expect(within(cartao("Comercial Fit 2")).getByRole("button", { name: /Desconectar/ })).toBeInTheDocument();
    expect(within(cartao("Pessoal Breno")).getByRole("button", { name: /Desconectar/ })).toBeInTheDocument();
    expect(within(cartao("Oficial")).queryByRole("button", { name: /Desconectar/ })).toBeNull();
  });

  it("confirma com nome e número, chama POST desconectar e o cartão volta com Conectar", async () => {
    tela();
    await waitFor(() => expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado"));
    fireEvent.click(within(cartao("Comercial Fit 2")).getByRole("button", { name: /Desconectar/ }));
    const dialogo = await screen.findByTestId("confirmar-desconexao");
    expect(within(dialogo).getByText("Desconectar Comercial Fit 2?")).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("(31) 99999-8888");
    expect(dialogo).toHaveTextContent("O WhatsApp desse número para de receber e enviar pelo CRM até conectar de novo.");
    expect(rede.chamadas.some((c) => c.init?.method === "POST")).toBe(false);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(screen.queryByTestId("confirmar-desconexao")).toBeNull());
    const post = rede.chamadas.filter((c) => c.init?.method === "POST");
    expect(post).toHaveLength(1);
    expect(post[0].url).toMatch(/\/functions\/v1\/whatsapp-qr$/);
    expect(JSON.parse(String(post[0].init?.body))).toEqual({ acao: "desconectar", sessao: "comercial-fit-2" });

    const c = cartao("Comercial Fit 2");
    expect(c.dataset.estado).toBe("qr");
    expect(c).toHaveTextContent("desconectado / aguardando QR");
    expect(within(c).getByRole("button", { name: /Conectar/ })).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: /Desconectar/ })).toBeNull();
    expect(toasts.fn).toHaveBeenCalledWith(expect.objectContaining({ title: "Comercial Fit 2 desconectado" }));
  });

  it("cancelar não chama nada", async () => {
    tela();
    await waitFor(() => expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado"));
    fireEvent.click(within(cartao("Comercial Fit 2")).getByRole("button", { name: /Desconectar/ }));
    fireEvent.click(within(await screen.findByTestId("confirmar-desconexao")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByTestId("confirmar-desconexao")).toBeNull());
    expect(rede.chamadas.some((c) => c.init?.method === "POST")).toBe(false);
    expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado");
  });

  it("erro da função aparece em texto legível", async () => {
    rede.desconectar = { status: 429, corpo: { provider: "openwa", error: "Muitas tentativas de desconectar agora. Tente de novo em 40 s." } };
    tela();
    await waitFor(() => expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado"));
    fireEvent.click(within(cartao("Comercial Fit 2")).getByRole("button", { name: /Desconectar/ }));
    fireEvent.click(within(await screen.findByTestId("confirmar-desconexao")).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(toasts.fn).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não desconectou Comercial Fit 2",
      description: "Muitas tentativas de desconectar agora. Tente de novo em 40 s.",
      variant: "destructive",
    })));
  });

  it("aprovado sem admin e sem liberação Comercial: não vê o botão; com Comercial vê", async () => {
    auth.isAdmin = false;
    const { unmount } = tela();
    await waitFor(() => expect(cartao("Comercial Fit 2").dataset.estado).toBe("conectado"));
    expect(screen.queryByRole("button", { name: /Desconectar/ })).toBeNull();
    unmount();
    auth.allowedModules = ["comercial"];
    tela();
    await waitFor(() => expect(within(cartao("Comercial Fit 2")).getByRole("button", { name: /Desconectar/ })).toBeInTheDocument());
  });
});

describe("regras puras", () => {
  it("front: podeVerDesconectar, status depois, textos de erro", () => {
    const fit = { tipo: "openwa" as const, ativo: true, sessao_openwa: "comercial-fit-2" };
    expect(podeVerDesconectar(fit, true, { isAdmin: true, modulos: [] })).toBe(true);
    expect(podeVerDesconectar(fit, false, { isAdmin: true, modulos: [] })).toBe(false);
    expect(podeVerDesconectar(fit, true, { isAdmin: false, modulos: [] })).toBe(false);
    expect(podeVerDesconectar(fit, true, { isAdmin: false, modulos: ["comercial"] })).toBe(true);
    expect(podeVerDesconectar({ tipo: "oficial", ativo: true, sessao_openwa: null }, true, { isAdmin: true, modulos: [] })).toBe(false);
    expect(statusDepoisDeDesconectar({ state: "qr_ready", aviso: null }, "x")).toMatchObject({ estado: "qr", rotulo: "desconectado / aguardando QR" });
    expect(statusDepoisDeDesconectar({ state: "disconnected", aviso: "a" }, null)).toMatchObject({ estado: "desconectado", aviso: "a" });
    expect(textoErroDesconexao(403, { error: "Unauthorized" })).toMatch(/permissão/);
    expect(textoErroDesconexao(404, null)).toMatch(/não foi publicada/);
    expect(textoErroDesconexao(409, { error: "texto da função" })).toBe("texto da função");
    expect(interpretarStatusNumero({ tipo: "openwa", sessao_openwa: "closer", ativo: true }, { state: "qr_ready" }).rotulo)
      .toBe("desconectado / aguardando QR");
  });

  it("função: permissão = aprovado E (admin ou Comercial)", () => {
    expect(podeDesconectar(true, true)).toBe(true);
    expect(podeDesconectar(true, false)).toBe(false);
    expect(podeDesconectar(false, true)).toBe(false);
    expect(podeDesconectar(true, null)).toBe(false);
  });

  it("função: só sessão de número OpenWA cadastrado; oficial recusado", () => {
    const numeros = [
      { apelido: "Fit", tipo: "openwa", sessao_openwa: "comercial-fit-2" },
      { apelido: "Oficial", tipo: "oficial", sessao_openwa: null },
      { apelido: "Raro", tipo: "oficial", sessao_openwa: "sessao-oficial" },
    ];
    expect(numeroParaDesconectar("Comercial-Fit-2", numeros)).toMatchObject({ sessao: "comercial-fit-2" });
    expect(numeroParaDesconectar("nao-existe", numeros)).toMatchObject({ status: 404 });
    expect(numeroParaDesconectar("sessao-oficial", numeros)).toMatchObject({ status: 400 });
    expect(numeroParaDesconectar("../x", numeros)).toMatchObject({ status: 400 });
    expect(numeroParaDesconectar(undefined, numeros)).toMatchObject({ status: 400 });
  });

  it("função: resultado e erros do proxy", () => {
    expect(resultadoDesconectar({ desconectado: true, reiniciada: true, status: "qr_ready" })).toEqual({ desconectado: true, state: "qr_ready", aviso: null });
    expect(resultadoDesconectar({ desconectado: true, reiniciada: true, status: "ready" }).state).toBe("initializing");
    expect(resultadoDesconectar({ desconectado: true, reiniciada: false, aviso: "x" })).toEqual({ desconectado: true, state: "disconnected", aviso: "x" });
    expect(mensagemErroDesconectar(404, { error: "não existe" })).toMatch(/falta aplicar a atualização do proxy/);
    expect(mensagemErroDesconectar(429, { retryAfter: 40 })).toMatch(/40 s/);
    expect(mensagemErroDesconectar(409, { error: "A sessão não está ligada no servidor: o número já estava desconectado." })).toMatch(/já estava/);
    expect(mensagemErroDesconectar(502, { error: "openwa" })).toMatch(/não respondeu/);
    expect(mensagemErroDesconectar(401, { error: "não autorizado" })).toMatch(/assinatura/);
    expect(statusErroDesconectar(409)).toBe(409);
    expect(statusErroDesconectar(504)).toBe(502);
  });
});
