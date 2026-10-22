// "Entrar com número de telefone" (código de pareamento de 8 caracteres) em /crm/conexoes, 19/10/2026:
// rota pairing-code do proxy da VPS, regras da whatsapp-qr {acao:"codigo"}, máscara/validade no front e
// as duas abas do modal Conectar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/crmAutomacoes", () => {
  const lista = [
    { id: "11111111-1111-4111-8111-111111111111", chave: "closer", apelido: "Closer", telefone: null, tipo: "openwa", sessao_openwa: "closer", ativo: true, ordem: 10 },
    { id: "22222222-2222-4222-8222-222222222222", chave: "suporte-consultoria-1", apelido: "Suporte Consultoria", telefone: null, tipo: "openwa", sessao_openwa: "suporte-consultoria-1", ativo: true, ordem: 30 },
  ];
  const from = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => Promise.resolve({ data: lista, error: null });
    return q;
  };
  return { db: { from, rpc: vi.fn() } };
});
const sessaoLogin = vi.hoisted(() => ({ atual: null as null | { access_token: string } }));
const urlsChamadas = vi.hoisted(() => [] as string[]);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: sessaoLogin.atual } }) } },
}));
vi.mock("@/lib/fetchComLimite", () => ({
  buscarComLimite: (url: string) => {
    urlsChamadas.push(url);
    const corpo = { provider: "openwa", sessao: "suporte-consultoria-1", connected: false, state: "qr_ready", phone: null, qr: url.includes("action=qr") ? "data:image/png;base64,AAAA" : null };
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }));
  },
}));
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }), toast }; });
vi.mock("@/components/crm/central/CanalInstagram", () => ({ CanalInstagram: () => null }));
vi.mock("@/components/crm/conexoes/HistoricoCompleto", () => ({ HistoricoCompleto: () => null }));
vi.mock("@/lib/crm/fonteConversas", () => ({ fonteSupabase: {}, trazerConversasRecentes: vi.fn(), trazerConversasAoConectar: vi.fn() }));

import {
  ROTAS_SO_COM_SESSAO, codigoPareamento, LimitadorPareamento, LIMITE_PAREAMENTO_HORA, montarPedidoOpenwa, ROTAS, separarSessao,
} from "../../infra/wa-proxy/lib.mjs";
import {
  codigoPareamentoValido, mensagemErroCodigo, sessaoDoPedidoDeCodigo, sessaoQueJaTemOTelefone, telefonePareamento, telefoneWhatsapp as telefoneWhatsappEdge,
  VALIDADE_CODIGO_SEGUNDOS,
} from "../../supabase/functions/_shared/codigoPareamentoWa";
import {
  exibirTelefone, formatarCodigo, formatarRestante, mascararLocal, normalizarLocal, separarTelefoneBR, telefoneCompleto,
  telefoneWhatsapp,
} from "@/lib/crm/codigoPareamento";
import { VALIDADE_PADRAO_S } from "@/lib/crm/pedirCodigoPareamento";
import { PainelCodigo } from "@/components/crm/conexoes/PainelCodigo";
import type { PedirCodigo } from "@/lib/crm/pedirCodigoPareamento";
import ConexoesCRM from "@/pages/crm/ConexoesCRM";

describe("proxy: rota pairing-code", () => {
  const sid = "uuid-fit2";
  it("é rota fechada, aceita sessão e vira POST /sessions/{id}/pairing-code só com o telefone", () => {
    expect(ROTAS).toContain("pairing-code");
    expect(separarSessao("pairing-code", { sessao: "comercial-fit-2", phone: "5531999998888" }, new Set(["comercial-fit-2"])))
      .toEqual({ corpo: { phone: "5531999998888" }, sessao: "comercial-fit-2" });
    expect(separarSessao("pairing-code", { sessao: "outra", phone: "5531999998888" }, new Set(["comercial-fit-2"])).erro)
      .toBe("sessao não permitida");
    expect(montarPedidoOpenwa("pairing-code", { phone: "5531999998888" }, sid)).toEqual({
      metodo: "POST", caminho: "/sessions/uuid-fit2/pairing-code", corpo: { phoneNumber: "5531999998888" }, pareamento: true,
    });
  });
  it("recusa telefone ruim e campo a mais", () => {
    expect(montarPedidoOpenwa("pairing-code", {}, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("pairing-code", { phone: "+55 31 99999-8888" }, sid).erro).toBe("phone");
    expect(montarPedidoOpenwa("pairing-code", { phone: "123" }, sid).erro).toBe("phone");
    expect(montarPedidoOpenwa("pairing-code", { phone: "5531999998888", text: "oi" }, sid).erro).toBe("campos");
    expect(montarPedidoOpenwa("pairing-code", { phone: "5531999998888", phoneNumber: "1" }, sid).erro).toBe("corpo inválido");
  });
  it("só deixa passar código de 8 letras/números", () => {
    expect(codigoPareamento({ pairingCode: "abcd1234", status: "qr_ready" })).toBe("ABCD1234");
    expect(codigoPareamento({ pairingCode: "ABCD-1234" })).toBe("ABCD1234");
    expect(codigoPareamento({ pairingCode: "ABC123" })).toBeNull();
    expect(codigoPareamento({ pairingCode: "<script>1" })).toBeNull();
    expect(codigoPareamento({})).toBeNull();
  });
  it("limita 3 por minuto e 15 por hora, por sessão", () => {
    const l = new LimitadorPareamento();
    const t0 = 1_000_000_000;
    expect([1, 2, 3].map((i) => l.reservar("fit2", t0 + i).ok)).toEqual([true, true, true]);
    const r = l.reservar("fit2", t0 + 10);
    expect(r).toMatchObject({ ok: false, motivo: "limite de códigos por minuto" });
    expect(r.retryAfter).toBeGreaterThanOrEqual(59);
    expect(l.reservar("closer", t0 + 10).ok).toBe(true); // outra sessão não é afetada
    expect(l.reservar(null, t0 + 10).ok).toBe(true);
    let t = t0 + 61_000;
    let ok = 3;
    while (ok < LIMITE_PAREAMENTO_HORA) { if (l.reservar("fit2", t).ok) ok++; t += 21_000; }
    expect(l.reservar("fit2", t + 61_000)).toMatchObject({ ok: false, motivo: "limite de códigos por hora" });
    expect(l.reservar("fit2", t0 + 3_600_000 + 61_000 + 100_000).ok).toBe(true);
  });
});

describe("whatsapp-qr: regras do código", () => {
  it("telefone: só dígitos com DDI; Brasil com 12 ou 13", () => {
    expect(telefonePareamento("+55 (31) 99999-8888")).toBe("5531999998888");
    expect(telefonePareamento("553133334444")).toBe("553133334444");
    expect(telefonePareamento("55319999988")).toBeNull();
    expect(telefonePareamento("55319999988881")).toBeNull();
    expect(telefonePareamento("14155550123")).toBe("14155550123");
    expect(telefonePareamento("31999998888")).toBe("31999998888"); // sem DDI vira "outro país"; o front fixa o 55
    expect(telefonePareamento(null)).toBeNull();
    expect(telefonePareamento("abc")).toBeNull();
  });
  it("código válido", () => {
    expect(codigoPareamentoValido("WXYZ9876")).toBe("WXYZ9876");
    expect(codigoPareamentoValido("wxyz-9876")).toBe("WXYZ9876");
    expect(codigoPareamentoValido("WXYZ98")).toBeNull();
    expect(codigoPareamentoValido(undefined)).toBeNull();
  });
  it("recusa telefone já conectado em OUTRA sessão; a própria sessão não conta", () => {
    const numeros = [
      { telefone: "5531999998888", sessao_openwa: "closer" },
      { telefone: null, sessao_openwa: "comercial-fit-2" },
    ];
    expect(sessaoQueJaTemOTelefone("5531999998888", "comercial-fit-2", numeros)).toBe("closer");
    expect(sessaoQueJaTemOTelefone("5531999998888", "closer", numeros)).toBeNull();
    expect(sessaoQueJaTemOTelefone("5531911112222", "comercial-fit-2", numeros)).toBeNull();
    // o OpenWA grava DDD 31 sem o 9: o mesmo celular digitado com o 9 também é reconhecido
    expect(sessaoQueJaTemOTelefone("5531999998888", "comercial-fit-2", [{ telefone: "553199998888", sessao_openwa: "closer" }])).toBe("closer");
  });
  it("número no formato da conta do WhatsApp (o código é amarrado a ele); front e função concordam", () => {
    const casos: [string, string][] = [
      ["5531999998888", "553199998888"], // DDD 31+: sem o 9 (como closer/comercial-fit-2 estão no OpenWA)
      ["553199998888", "553199998888"],
      ["5562981234567", "556281234567"],
      ["5511999998888", "5511999998888"], // DDD 11-28: com o 9
      ["551199998888", "5511999998888"],
      ["5521987654321", "5521987654321"],
      ["553133334444", "553133334444"], // fixo
      ["551133334444", "551133334444"],
      ["14155550123", "14155550123"], // outro país
    ];
    for (const [entrada, esperado] of casos) {
      expect(telefoneWhatsappEdge(entrada)).toBe(esperado);
      expect(telefoneWhatsapp(entrada)).toBe(esperado);
    }
    expect(exibirTelefone("553199998888")).toBe("+55 (31) 9999-8888");
    expect(exibirTelefone("5511999998888")).toBe("+55 (11) 99999-8888");
    expect(exibirTelefone("14155550123")).toBe("+14155550123");
  });
  it("sessão obrigatória e nunca a padrão (sem ela o proxy cai no closer: código no número errado)", () => {
    expect(sessaoDoPedidoDeCodigo(undefined, "closer")).toMatchObject({ status: 400 });
    expect(sessaoDoPedidoDeCodigo("  ", "closer")).toMatchObject({ status: 400 });
    expect(sessaoDoPedidoDeCodigo(42, "closer")).toMatchObject({ status: 400 });
    expect(sessaoDoPedidoDeCodigo("closer", "closer")).toMatchObject({ status: 409 });
    expect(sessaoDoPedidoDeCodigo("Closer ", "closer")).toMatchObject({ status: 409 });
    expect(sessaoDoPedidoDeCodigo("suporte-consultoria-1", "closer")).toEqual({ sessao: "suporte-consultoria-1" });
    expect(ROTAS_SO_COM_SESSAO.has("pairing-code")).toBe(true);
    expect(ROTAS_SO_COM_SESSAO.has("qr")).toBe(false);
  });
  it("validade curta e igual nos dois lados (o código do whatsapp-web.js morre cedo)", () => {
    expect(VALIDADE_CODIGO_SEGUNDOS).toBe(60);
    expect(VALIDADE_PADRAO_S).toBe(VALIDADE_CODIGO_SEGUNDOS);
  });
  it("erros viram mensagem em português", () => {
    expect(mensagemErroCodigo(404, { error: "não existe" })).toMatch(/atualização do proxy/);
    expect(mensagemErroCodigo(429, { error: "limite de códigos por minuto" })).toMatch(/Muitos códigos pedidos.*Tente de novo em 60 s/);
    expect(mensagemErroCodigo(409, { error: "openwa", status: 409 })).toMatch(/não está esperando pareamento/);
    expect(mensagemErroCodigo(400, { error: "phone" })).toMatch(/Número inválido/);
    expect(mensagemErroCodigo(502, { error: "openwa", status: 503 })).toMatch(/recarregando/);
    expect(mensagemErroCodigo(503, { error: "sessão sem chave no proxy" })).toMatch(/não está liberada/);
    expect(mensagemErroCodigo(500, null)).toMatch(/Não consegui gerar/);
  });
});

describe("front: máscara e formato", () => {
  it("máscara BR e outros países", () => {
    expect(mascararLocal("55", "31999998888")).toBe("(31) 99999-8888");
    expect(mascararLocal("55", "3133334444")).toBe("(31) 3333-4444");
    expect(mascararLocal("55", "319")).toBe("(31) 9");
    expect(mascararLocal("55", "3")).toBe("(3");
    expect(mascararLocal("55", "")).toBe("");
    expect(normalizarLocal("55", "(31) 99999-88889999")).toBe("31999998888");
    expect(mascararLocal("1", "4155550123")).toBe("4155550123");
  });
  it("telefone completo só quando válido", () => {
    expect(telefoneCompleto("55", "31999998888")).toBe("5531999998888");
    expect(telefoneCompleto("55", "3133334444")).toBe("553133334444");
    expect(telefoneCompleto("55", "319999")).toBeNull();
    expect(telefoneCompleto("55", "01999998888")).toBeNull();
    expect(telefoneCompleto("", "31999998888")).toBeNull();
    expect(telefoneCompleto("1", "4155550123")).toBe("14155550123");
  });
  it("pré-preenche pelo telefone gravado, formata código e tempo", () => {
    expect(separarTelefoneBR("5531999998888")).toEqual({ ddi: "55", local: "31999998888" });
    expect(separarTelefoneBR(null)).toEqual({ ddi: "55", local: "" });
    expect(formatarCodigo("abcd1234")).toBe("ABCD-1234");
    expect(formatarRestante(180)).toBe("3:00");
    expect(formatarRestante(65)).toBe("1:05");
    expect(formatarRestante(-3)).toBe("0:00");
  });
});

describe("PainelCodigo", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("gera, mostra o código grande, copia, conta a validade e expira", async () => {
    const pedir = vi.fn<PedirCodigo>().mockResolvedValue({ ok: true, status: 200, corpo: { codigo: "ABCD1234", validadeSegundos: 5 } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PainelCodigo sessao="comercial-fit-2" pedirCodigo={pedir} />);
    const botao = screen.getByRole("button", { name: /Gerar código/ });
    expect(screen.getByLabelText("Código do país")).toHaveValue("55");
    expect(botao).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número com DDD"), { target: { value: "31 99999 8888" } });
    expect(screen.getByLabelText("Número com DDD")).toHaveValue("(31) 99999-8888");
    expect(botao).toBeEnabled();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => { fireEvent.click(botao); });
    expect(pedir).toHaveBeenCalledWith("comercial-fit-2", "553199998888"); // DDD 31: sem o 9
    expect(await screen.findByTestId("codigo-grande")).toHaveTextContent("ABCD-1234");
    expect(screen.getByTestId("validade")).toHaveTextContent("0:05");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copiar/ })); });
    expect(writeText).toHaveBeenCalledWith("ABCD1234");
    expect(screen.getByRole("button", { name: /Copiado/ })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(screen.getByTestId("validade")).toHaveTextContent(/expirou/);
    expect(screen.getByRole("button", { name: /Copiar|Copiado/ })).toBeDisabled();
    pedir.mockResolvedValueOnce({ ok: true, status: 200, corpo: { codigo: "WXYZ9876", validadeSegundos: 180 } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Gerar outro/ })); });
    expect(screen.getByTestId("codigo-grande")).toHaveTextContent("WXYZ-9876");
    expect(screen.getByTestId("validade")).toHaveTextContent("1:00"); // função antiga dizendo 180: teto de 60 s
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("mostra o erro da função e não troca de tela; Enter duplo faz um pedido só", async () => {
    let soltar: (v: Awaited<ReturnType<PedirCodigo>>) => void = () => undefined;
    const pedir = vi.fn<PedirCodigo>().mockImplementation(() => new Promise((r) => { soltar = r; }));
    render(<PainelCodigo sessao="closer" telefoneSugerido="5531999998888" pedirCodigo={pedir} />);
    const campo = screen.getByLabelText("Número com DDD");
    expect(campo).toHaveValue("(31) 99999-8888");
    const form = screen.getByTestId("form-codigo");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(pedir).toHaveBeenCalledTimes(1);
    await act(async () => { soltar({ ok: false, status: 409, corpo: { error: "Este telefone já está conectado em outro número do CRM (sessão x)." } }); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/já está conectado em outro número/);
    expect(screen.queryByTestId("codigo-grande")).toBeNull();
  });

  it("mostra o número que vai ao WhatsApp antes de gerar e o que a função usou depois; clique duplo = um pedido", async () => {
    const pedir = vi.fn<PedirCodigo>().mockResolvedValue({ ok: true, status: 200, corpo: { codigo: "ABCD1234", telefone: "553199998888", validadeSegundos: 60 } });
    render(<PainelCodigo sessao="suporte-consultoria-1" pedirCodigo={pedir} />);
    fireEvent.change(screen.getByLabelText("Número com DDD"), { target: { value: "31 99999 8888" } });
    expect(screen.getByTestId("numero-para-whatsapp")).toHaveTextContent("+55 (31) 9999-8888");
    expect(screen.getByTestId("numero-para-whatsapp")).toHaveTextContent(/sem o 9/);
    const botao = screen.getByRole("button", { name: /Gerar código/ });
    await act(async () => { fireEvent.click(botao); fireEvent.click(botao); });
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("codigo-grande")).toHaveTextContent("ABCD-1234");
    expect(screen.getByTestId("numero-do-codigo")).toHaveTextContent("+55 (31) 9999-8888");
    expect(screen.getByTestId("validade")).toHaveTextContent(/Digite agora.*1:00/);
    expect(screen.getByTestId("se-recusar")).toHaveTextContent(/Não foi possível conectar.*Gerar outro.*QR code/);
  });

  it("DDD 11 não perde o 9", () => {
    render(<PainelCodigo sessao="closer" pedirCodigo={vi.fn<PedirCodigo>()} />);
    fireEvent.change(screen.getByLabelText("Número com DDD"), { target: { value: "11 99999 8888" } });
    expect(screen.getByTestId("numero-para-whatsapp")).toHaveTextContent("+55 (11) 99999-8888");
    expect(screen.getByTestId("numero-para-whatsapp")).not.toHaveTextContent(/sem o 9/);
  });
});

describe("/crm/conexoes: modal com as abas QR code | Número de telefone", () => {
  beforeEach(() => { vi.useRealTimers(); });
  it("troca de aba sem perder o número e chama a whatsapp-qr de verdade", async () => {
    sessaoLogin.atual = { access_token: "t" }; // status lido (sessão extra precisa do eco de `sessao`)
    render(<QueryClientProvider client={new QueryClient()}><ConexoesCRM /></QueryClientProvider>);
    const cartao = (await screen.findByText("Suporte Consultoria")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(cartao).getByRole("button", { name: /Conectar/ })).toBeEnabled());
    fireEvent.click(within(cartao).getByRole("button", { name: /Conectar/ }));
    const dialogo = await screen.findByRole("dialog");
    const abaQr = within(dialogo).getByRole("tab", { name: /QR code/ });
    const abaTel = within(dialogo).getByRole("tab", { name: /Número de telefone/ });
    expect(abaQr).toHaveAttribute("aria-selected", "true");
    expect(within(dialogo).getByTestId("form-codigo").closest("[role=tabpanel]")).toHaveClass("hidden");
    fireEvent.click(abaTel);
    expect(abaTel).toHaveAttribute("aria-selected", "true");
    expect(within(dialogo).getByText(/Conectar com número de telefone/)).toBeInTheDocument();
    const painel = within(dialogo).getByTestId("form-codigo").closest("[role=tabpanel]") as HTMLElement;
    expect(painel).toHaveClass("flex");
    fireEvent.change(within(painel).getByLabelText("Número com DDD"), { target: { value: "31999998888" } });
    fireEvent.click(abaQr);
    fireEvent.click(abaTel);
    expect(within(painel).getByLabelText("Número com DDD")).toHaveValue("(31) 99999-8888");
    sessaoLogin.atual = null;
    await act(async () => { fireEvent.click(within(painel).getByRole("button", { name: /Gerar código/ })); });
    // sem login no teste: a chamada real devolve 401 e a mensagem aparece no painel
    expect(await within(painel).findByRole("alert")).toHaveTextContent(/Sessão expirada/);
  });

  it("sessão padrão (closer): só QR, sem a aba Número de telefone", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ConexoesCRM /></QueryClientProvider>);
    const cartao = (await screen.findByText("Closer")).closest("article") as HTMLElement;
    await waitFor(() => expect(within(cartao).getByRole("button", { name: /Conectar/ })).toBeEnabled());
    fireEvent.click(within(cartao).getByRole("button", { name: /Conectar/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByRole("tab", { name: /Número de telefone/ })).toBeNull();
    expect(within(dialogo).queryByTestId("form-codigo")).toBeNull();
  });

  it("na aba do código o ciclo só lê o status (não busca QR); volta a buscar QR na aba QR", async () => {
    sessaoLogin.atual = { access_token: "t" };
    try {
      render(<QueryClientProvider client={new QueryClient()}><ConexoesCRM /></QueryClientProvider>);
      const cartao = (await screen.findByText("Suporte Consultoria")).closest("article") as HTMLElement;
      await waitFor(() => expect(within(cartao).getByRole("button", { name: /Conectar/ })).toBeEnabled());
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fireEvent.click(within(cartao).getByRole("button", { name: /Conectar/ }));
      const dialogo = await screen.findByRole("dialog");
      await waitFor(() => expect(urlsChamadas.some((u) => u.includes("action=qr"))).toBe(true));
      fireEvent.click(within(dialogo).getByRole("tab", { name: /Número de telefone/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
      urlsChamadas.length = 0;
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      const doModal = urlsChamadas.filter((u) => u.includes("sessao=suporte-consultoria-1"));
      expect(doModal.length).toBeGreaterThan(0);
      expect(doModal.every((u) => u.includes("action=status"))).toBe(true);
      fireEvent.click(within(dialogo).getByRole("tab", { name: /QR code/ }));
      urlsChamadas.length = 0;
      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
      expect(urlsChamadas.some((u) => u.includes("action=qr"))).toBe(true);
    } finally {
      sessaoLogin.atual = null;
      vi.useRealTimers();
    }
  });
});
