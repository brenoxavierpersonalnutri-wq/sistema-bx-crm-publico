// Conversa por NÚMERO do WhatsApp (17/10/2026): 4 sessões do OpenWA no mesmo webhook.
// - openwa-webhook identifica a sessão (sessionId assinado, ?sessao= na URL, telefone do próprio número);
// - o mesmo cliente falando com 2 números = 2 conversas (chave número + telefone);
// - a tela filtra por número, mostra o selo e o chat responde pelo número da conversa.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  identificarNumeroDoEvento, type NumeroWebhook,
} from "../../supabase/functions/_shared/numerosWa";
import { interpretarEventoOpenwa, sessionIdDoEnvelope } from "../../supabase/functions/_shared/openwa";
import {
  chaveConversa, contatoDaSelecao, filtrarConversas, indexarResumos, leituraDe, montarConversas,
  type ContatoCRM, type Conversa, type MensagemCRM, type NumeroConversa,
} from "@/lib/crm/conversas";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";
import type { EventosFonte, FonteConversas } from "@/lib/crm/fonteConversas";
import CRM from "@/pages/CRM";

const CLOSER = "11111111-1111-4111-8111-111111111111";
const FIT2 = "22222222-2222-4222-8222-222222222222";
const SUPORTE = "33333333-3333-4333-8333-333333333333";

const numerosBanco = (extra: Partial<Record<string, Partial<NumeroWebhook>>> = {}): NumeroWebhook[] => [
  { id: CLOSER, chave: "closer", tipo: "openwa", sessao_openwa: "closer", telefone: "5531990000001", openwa_session_id: null, ...extra.closer },
  { id: FIT2, chave: "comercial-fit-2", tipo: "openwa", sessao_openwa: "comercial-fit-2", telefone: null, openwa_session_id: null, ...extra.fit2 },
  { id: SUPORTE, chave: "suporte-consultoria-1", tipo: "openwa", sessao_openwa: "suporte-consultoria-1", telefone: "5531988887777", openwa_session_id: null, ...extra.suporte },
  { id: "44444444-4444-4444-8444-444444444444", chave: "oficial", tipo: "oficial", sessao_openwa: null, telefone: "553170000102", openwa_session_id: null },
];
const SID_CLOSER = "aaaaaaaa-0000-4000-8000-000000000001";
const SID_FIT2 = "aaaaaaaa-0000-4000-8000-000000000002";
const SID_SUPORTE = "aaaaaaaa-0000-4000-8000-000000000003";

describe("de qual número veio o webhook", () => {
  it("lê o sessionId do envelope (v0.24.0) e o telefone do próprio número no evento", () => {
    const recebida = {
      event: "message.received", sessionId: SID_FIT2, timestamp: "2026-10-17T15:00:00Z",
      data: { id: "false_5531977776666@c.us_ABC", from: "5531977776666@c.us", to: "5531990000002@c.us", chatId: "5531977776666@c.us", body: "oi", type: "text", timestamp: 1760713200 },
    };
    expect(sessionIdDoEnvelope(recebida)).toBe(SID_FIT2);
    expect(sessionIdDoEnvelope({ sessionId: "x y" })).toBeNull();
    const ev = interpretarEventoOpenwa(recebida);
    expect(ev.tipo === "mensagem" && ev.telefoneProprio).toBe("5531990000002");
    const enviada = interpretarEventoOpenwa({
      event: "message.sent", sessionId: SID_FIT2,
      data: { id: "true_5531977776666@c.us_DEF", from: "5531990000002@c.us", to: "5531977776666@c.us", body: "olá", type: "text", fromMe: true },
    });
    expect(enviada.tipo === "mensagem" && enviada.telefone).toBe("5531977776666");
    expect(enviada.tipo === "mensagem" && enviada.telefoneProprio).toBe("5531990000002");
  });

  it("sessionId já vinculado manda, mesmo com ?sessao= de outro número na URL", () => {
    const r = identificarNumeroDoEvento(numerosBanco({ fit2: { openwa_session_id: SID_FIT2 } }), {
      sessionId: SID_FIT2, sessaoUrl: "closer", telefoneProprio: null,
    });
    expect("numero" in r && r.numero.id).toBe(FIT2);
    expect("numero" in r && r.por).toBe("session_id");
    expect("numero" in r && r.vincular).toBe(false);
  });

  it("primeira mensagem de um número: ?sessao= da URL identifica e pede para vincular o sessionId", () => {
    const r = identificarNumeroDoEvento(numerosBanco(), { sessionId: SID_FIT2, sessaoUrl: "comercial-fit-2", telefoneProprio: null });
    expect("numero" in r && [r.numero.id, r.por, r.vincular]).toEqual([FIT2, "url", true]);
  });

  it("sem URL: o telefone do próprio número (com ou sem o 9) identifica e vincula", () => {
    const r = identificarNumeroDoEvento(numerosBanco(), { sessionId: SID_SUPORTE, sessaoUrl: null, telefoneProprio: "553188887777" });
    expect("numero" in r && [r.numero.id, r.por, r.vincular]).toEqual([SUPORTE, "telefone", true]);
    // número oficial nunca é escolhido (não tem sessão no OpenWA)
    const o = identificarNumeroDoEvento(numerosBanco({ closer: { openwa_session_id: SID_CLOSER } }), {
      sessionId: "bbbbbbbb-0000-4000-8000-000000000009", sessaoUrl: null, telefoneProprio: "553170000102",
    });
    expect("erro" in o).toBe(true);
  });

  it("sem sessionId (OpenWA antigo/teste) cai no closer; sessão nova sem pista só cai no closer enquanto ele não tem id", () => {
    const semId = identificarNumeroDoEvento(numerosBanco(), { sessionId: null, sessaoUrl: null, telefoneProprio: null });
    expect("numero" in semId && [semId.numero.id, semId.por, semId.vincular]).toEqual([CLOSER, "padrao", false]);
    const legado = identificarNumeroDoEvento(numerosBanco(), { sessionId: SID_CLOSER, sessaoUrl: null, telefoneProprio: null });
    expect("numero" in legado && [legado.numero.id, legado.vincular]).toEqual([CLOSER, false]);
    // closer já vinculado a outro id: mensagem de sessão desconhecida NÃO entra na caixa do closer
    const misturaria = identificarNumeroDoEvento(numerosBanco({ closer: { openwa_session_id: SID_CLOSER } }), {
      sessionId: SID_FIT2, sessaoUrl: null, telefoneProprio: null,
    });
    expect("erro" in misturaria && misturaria.erro).toMatch(/desconhecida/);
  });

  it("sessão recriada (id novo) com ?sessao= certo: identifica e revincula", () => {
    const r = identificarNumeroDoEvento(numerosBanco({ fit2: { openwa_session_id: SID_FIT2 } }), {
      sessionId: "cccccccc-0000-4000-8000-000000000002", sessaoUrl: "comercial-fit-2", telefoneProprio: null,
    });
    expect("numero" in r && [r.numero.id, r.vincular]).toEqual([FIT2, true]);
  });
});

// ------------------------------------------------------------------ lista e chat

const AGORA = new Date("2026-10-17T15:00:00Z");
const NUMEROS: NumeroConversa[] = [
  { id: CLOSER, chave: "closer", apelido: "Closer", telefone: "5531990000001" },
  { id: FIT2, chave: "comercial-fit-2", apelido: "Comercial Fit 2", telefone: "5531990000002" },
];
const TEL = "5531977776666";
const contato = (id: string, numero: string, extra: Partial<ContatoCRM> = {}): ContatoCRM => ({
  id, phone: TEL, numero_id: numero, name: "Fernanda", stage: "leads", tags: [], updated_at: "2026-10-01T10:00:00Z", ...extra,
});
let seq = 0;
const msg = (numero: string, quando: string, body: string, dir: "inbound" | "outbound" = "inbound"): MensagemCRM => ({
  id: `m${++seq}`, contact_phone: TEL, numero_id: numero, body, created_at: quando, direction: dir, sender_type: dir === "inbound" ? "lead" : "human", status: null,
});

describe("o mesmo cliente em dois números = duas conversas", () => {
  const cs = [contato("c1", CLOSER), contato("c2", FIT2)];
  const ms = [msg(CLOSER, "2026-10-17T10:00:00Z", "pelo closer"), msg(FIT2, "2026-10-17T12:00:00Z", "pelo fit")];

  it("cada conversa tem a sua última mensagem, ordem e não lidas", () => {
    const lista = montarConversas(cs, ms, {}, "2026-10-17T09:00:00Z");
    expect(lista.map((c) => [c.contato.id, c.ultima?.body, c.naoLidas])).toEqual([["c2", "pelo fit", 1], ["c1", "pelo closer", 1]]);
    expect(chaveConversa(cs[0])).toBe(`${CLOSER}|${TEL}`);
    expect(chaveConversa({ phone: "ig:123" })).toBe("ig:123");
  });

  it("leitura nova é por conversa; a antiga (só telefone) ainda vale", () => {
    const lidaFit = montarConversas(cs, ms, { [`${FIT2}|${TEL}`]: "2026-10-17T12:00:00Z" }, "2026-10-17T09:00:00Z");
    expect(lidaFit.find((c) => c.contato.id === "c2")?.naoLidas).toBe(0);
    expect(lidaFit.find((c) => c.contato.id === "c1")?.naoLidas).toBe(1);
    expect(leituraDe({ [TEL]: "2026-10-17T11:00:00Z" }, cs[0])).toBe("2026-10-17T11:00:00Z");
  });

  it("resumo do banco casa por número + telefone", () => {
    const idx = indexarResumos([
      { contact_phone: TEL, numero_id: FIT2, ultima: msg(FIT2, "2026-10-17T13:00:00Z", "resumo fit"), nao_lidas: 3 },
    ], () => true);
    const lista = montarConversas(cs, [], {}, "2026-10-17T09:00:00Z", idx);
    expect(lista[0].contato.id).toBe("c2");
    expect(lista[0].naoLidas).toBe(3);
    expect(lista.find((c) => c.contato.id === "c1")?.semConversa).toBe(true);
  });

  it("filtro por número e seleção pela chave (link antigo só com telefone abre a primeira)", () => {
    const lista = montarConversas(cs, ms, {}, null);
    expect(filtrarConversas(lista, "", "tudo", FIT2).map((c) => c.contato.id)).toEqual(["c2"]);
    expect(filtrarConversas(lista, "", "tudo", null)).toHaveLength(2);
    expect(contatoDaSelecao(cs, `${FIT2}|${TEL}`)?.id).toBe("c2");
    expect(contatoDaSelecao(cs, TEL)?.id).toBe("c1");
  });
});

describe("tela: seletor de número e selo", () => {
  const conv = (c: ContatoCRM, ordem: string): Conversa => ({ contato: c, ultima: null, naoLidas: 0, ordem, semConversa: false });
  const conversas = [conv(contato("c2", FIT2), "2026-10-17T12:00:00Z"), conv(contato("c1", CLOSER), "2026-10-17T10:00:00Z")];

  it("com 2+ números: seletor 'Todos os números', selo em cada conversa e filtro", () => {
    const aoFiltrar = vi.fn();
    const { rerender } = render(
      <ListaConversas conversas={conversas} selecionado={null} onSelecionar={() => undefined} agora={AGORA}
        numeros={NUMEROS} numeroFiltro={null} onNumeroFiltro={aoFiltrar} />,
    );
    const seletor = screen.getByTestId("seletor-numero") as HTMLSelectElement;
    expect([...seletor.options].map((o) => o.textContent)).toEqual(["Todos os números", "Closer", "Comercial Fit 2"]);
    expect(screen.getAllByTestId("selo-numero").map((s) => s.textContent)).toEqual(["Comercial Fit 2", "Closer"]);
    fireEvent.change(seletor, { target: { value: FIT2 } });
    expect(aoFiltrar).toHaveBeenCalledWith(FIT2);
    rerender(
      <ListaConversas conversas={conversas} selecionado={null} onSelecionar={() => undefined} agora={AGORA}
        numeros={NUMEROS} numeroFiltro={FIT2} onNumeroFiltro={aoFiltrar} />,
    );
    const itens = screen.getAllByTestId("item-conversa");
    expect(itens).toHaveLength(1);
    expect(itens[0].getAttribute("data-numero")).toBe(FIT2);
    // número escolhido: o selo some (redundante)
    expect(screen.queryByTestId("selo-numero")).toBeNull();
  });

  it("com 1 número só: sem seletor e sem selo (tela como antes)", () => {
    render(<ListaConversas conversas={conversas} selecionado={null} onSelecionar={() => undefined} agora={AGORA} numeros={NUMEROS.slice(0, 1)} />);
    expect(screen.queryByTestId("seletor-numero")).toBeNull();
    expect(screen.queryByTestId("selo-numero")).toBeNull();
  });
});

describe("chat responde pelo número da conversa", () => {
  function fonteFalsa() {
    const contatos = [contato("c1", CLOSER), contato("c2", FIT2)];
    const msgs = [msg(CLOSER, "2026-10-17T10:00:00Z", "pelo closer"), msg(FIT2, "2026-10-17T12:00:00Z", "pelo fit")];
    const ouvintes = new Set<EventosFonte>();
    const enviarTexto = vi.fn(async () => undefined);
    const mensagensDoContato = vi.fn(async (phone: string, limite: number, _antes?: string, numeroId?: string | null) =>
      msgs.filter((m) => m.contact_phone === phone && (!numeroId || m.numero_id === numeroId)).slice(0, limite));
    const fonte: FonteConversas = {
      usuarioId: async () => "teste",
      listarNumeros: async () => NUMEROS,
      listarContatos: async () => contatos,
      mensagensRecentes: async () => msgs,
      mensagensDoContato,
      assinar: (e) => { ouvintes.add(e); return () => ouvintes.delete(e); },
      enviarTexto,
      enviarMidia: async () => undefined,
      importarHistorico: async () => 0,
      atualizarContato: async () => undefined,
    };
    return { fonte, enviarTexto, mensagensDoContato, ouvintes };
  }

  it("abre a conversa do Fit 2, mostra 'Respondendo pelo Comercial Fit 2' e envia com o numero_id dele", async () => {
    const { fonte, enviarTexto, mensagensDoContato } = fonteFalsa();
    render(<MemoryRouter initialEntries={["/crm/conversas"]}><CRM fonte={fonte} agora={AGORA} abrirInicial={`${FIT2}|${TEL}`} resolverGrupos={false} /></MemoryRouter>);
    const cab = await screen.findByTestId("numero-da-conversa");
    expect(cab.textContent).toBe("Respondendo pelo Comercial Fit 2 (+55 31 99000-0002)");
    await waitFor(() => expect(mensagensDoContato).toHaveBeenCalledWith(TEL, expect.any(Number), undefined, FIT2));
    const conversa = screen.getByRole("region", { name: "Conversa" });
    await within(conversa).findByText("pelo fit");
    expect(within(conversa).queryByText("pelo closer")).toBeNull();
    const caixa = within(conversa).getByRole("textbox");
    fireEvent.change(caixa, { target: { value: "oi Fernanda" } });
    await act(async () => { fireEvent.keyDown(caixa, { key: "Enter" }); });
    await waitFor(() => expect(enviarTexto).toHaveBeenCalledWith(TEL, "oi Fernanda", FIT2));
  });
});
