// Lista de /crm/conversas paginada pelo servidor (21/10/2026): 60 por vez, cache na hora, delta em vez de
// recarga completa, contadores do banco, busca no servidor e volta ao modo antigo quando a RPC não existe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { filtrarConversas, montarConversas, type ContatoCRM, type MensagemCRM } from "@/lib/crm/conversas";
import { useConversas } from "@/hooks/useConversas";
import type { EventosFonte, FonteConversas, PedidoPagina } from "@/lib/crm/fonteConversas";
import {
  avancarPagina,
  chaveConsulta,
  CONSULTA_PADRAO,
  cursorDe,
  dentroDaFronteira,
  lerCacheLista,
  proximoDesde,
  salvarCacheLista,
  sementeDoCache,
  type LinhaLista,
} from "@/lib/crm/listaPaginada";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";

const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
});

const NUM = "11111111-1111-4111-8111-111111111111";
const contato = (i: number, extra: Partial<ContatoCRM> = {}): ContatoCRM => ({
  id: `c${i}`, phone: `55319${String(i).padStart(8, "0")}`, numero_id: NUM, name: `Pessoa ${i}`, stage: "leads", tags: [],
  updated_at: "2026-10-01T10:00:00Z", ...extra,
});
const hora = (i: number) => new Date(Date.UTC(2026, 9, 21, 12, 0, 0) - i * 60_000).toISOString();
const msg = (c: ContatoCRM, i: number, extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
  id: `m${i}`, contact_phone: c.phone, numero_id: c.numero_id, body: `texto ${i}`, created_at: hora(i), direction: "inbound",
  sender_type: "lead", status: null, ...extra,
});
const linha = (i: number, extra: Partial<LinhaLista> = {}): LinhaLista => {
  const c = contato(i);
  return { contato: c, ultima: msg(c, i), nao_lidas: 0, ordem_em: hora(i), consultado_em: "2026-10-21T12:00:00.000Z", ...extra };
};
/** 200 conversas no "banco", da mais nova para a mais velha. */
const BANCO = Array.from({ length: 200 }, (_, i) => linha(i));

function fonteFalsa(opcoes: { semRpc?: boolean; pagina?: (p: PedidoPagina) => Promise<LinhaLista[] | null> } = {}) {
  let eventos: EventosFonte | null = null;
  const paginaConversas = vi.fn(opcoes.pagina ?? (async (p: PedidoPagina) => {
    if (opcoes.semRpc) return null;
    if (p.desde) return [];
    if (p.chaves) return BANCO.filter((l) => p.chaves!.includes(`${l.contato.numero_id}|${l.contato.phone}`));
    let lista = BANCO;
    const q = p.consulta?.busca.trim().toLowerCase();
    if (q) lista = lista.filter((l) => l.contato.name.toLowerCase().includes(q) || (l.ultima?.body ?? "").includes(q));
    if (p.cursor) {
      const i = lista.findIndex((l) => l.contato.id === p.cursor!.id);
      lista = lista.slice(i + 1);
    }
    return lista.slice(0, p.limite ?? 60);
  }));
  const f = {
    usuarioId: async () => "u1",
    listarNumeros: async () => [],
    listarContatos: vi.fn(async () => BANCO.map((l) => l.contato)),
    mensagensRecentes: vi.fn(async () => [] as MensagemCRM[]),
    mensagensDoContato: async () => [],
    paginaConversas,
    contadoresConversas: vi.fn(async () => ({ naoLidas: 7, semConversa: 3, porDepartamento: {}, tags: ["vip"], etapas: ["leads"] })),
    assinar: (e: EventosFonte) => { eventos = e; return () => undefined; },
    enviarTexto: vi.fn(), enviarMidia: vi.fn(), importarHistorico: async () => 0, atualizarContato: async () => undefined,
  } as unknown as FonteConversas;
  return { f, paginaConversas, emitir: () => eventos! };
}

beforeEach(() => memoria.clear());

describe("regras da página", () => {
  it("cursor é a última linha; sem conversa vira -infinity", () => {
    expect(cursorDe([linha(0), linha(1)])).toEqual({ em: hora(1), id: "c1" });
    expect(cursorDe([linha(5, { ordem_em: null, ultima: null })])).toEqual({ em: "-infinity", id: "c5" });
    expect(cursorDe([])).toBeNull();
  });

  it("avancarPagina junta ids, guarda a fronteira e marca o fim", () => {
    const p1 = avancarPagina(undefined, BANCO.slice(0, 60), 60);
    expect(p1.ids.size).toBe(60);
    expect(p1.fim).toBe(false);
    expect(p1.fronteira).toBe(hora(59));
    const p2 = avancarPagina(p1, BANCO.slice(60, 70), 60);
    expect(p2.ids.size).toBe(70);
    expect(p2.fim).toBe(true);
    expect(p2.cursor).toEqual({ em: hora(69), id: "c69" });
  });

  it("dentroDaFronteira: confirmada passa; mais nova que a fronteira passa; mais velha espera a próxima página", () => {
    const pagina = avancarPagina(undefined, BANCO.slice(0, 60), 60);
    const conv = (i: number, ordem = hora(i)) => ({ contato: contato(i), ordem });
    expect(dentroDaFronteira(conv(10), pagina)).toBe(true);
    expect(dentroDaFronteira(conv(500, hora(-5)), pagina)).toBe(true); // chegou pelo Realtime, mais nova
    expect(dentroDaFronteira(conv(150), pagina)).toBe(false);
    expect(dentroDaFronteira(conv(151, ""), pagina)).toBe(false); // sem conversa
    expect(dentroDaFronteira(conv(150), { ...pagina, fim: true })).toBe(true);
    expect(dentroDaFronteira(conv(150), null)).toBe(true);
  });

  it("proximoDesde: hora do servidor menos 30 s, nunca volta para trás", () => {
    expect(proximoDesde([linha(0)], null)).toBe("2026-10-21T11:59:30.000Z");
    expect(proximoDesde([], "2026-10-21T11:00:00.000Z")).toBe("2026-10-21T11:00:00.000Z");
    expect(proximoDesde([linha(0, { consultado_em: "2026-10-21T10:00:00Z" })], "2026-10-21T11:00:00.000Z")).toBe("2026-10-21T11:00:00.000Z");
  });

  it("chaveConsulta normaliza a busca", () => {
    expect(chaveConsulta({ ...CONSULTA_PADRAO, busca: " Ana " })).toBe(chaveConsulta({ ...CONSULTA_PADRAO, busca: "ana" }));
    expect(chaveConsulta({ ...CONSULTA_PADRAO, filtro: "grupos" })).not.toBe(chaveConsulta(CONSULTA_PADRAO));
  });

  it("cache: grava as primeiras 60 por usuário, sem link assinado, e relê no formato do estado", () => {
    const convs = montarConversas(BANCO.map((l) => l.contato), BANCO.map((l) => l.ultima!), {}, null);
    convs[0] = { ...convs[0], ultima: { ...convs[0].ultima!, media_path: "a/b.jpg", media_url: "https://assinado" } };
    salvarCacheLista("u1", convs);
    const itens = lerCacheLista("u1");
    expect(itens).toHaveLength(60);
    expect(itens[0].ultima?.media_url).toBeNull();
    expect(lerCacheLista("u2")).toEqual([]);
    const s = sementeDoCache(itens);
    expect(s.contatos).toHaveLength(60);
    expect(s.resumos).toHaveLength(60);
  });

  it("cache corrompido não quebra", () => {
    window.localStorage.setItem("crm:conversas:lista:v1:u1", "{lixo");
    expect(lerCacheLista("u1")).toEqual([]);
  });

  it("filtrarConversas: o que casou no servidor passa no texto da busca, os outros filtros continuam valendo", () => {
    const convs = montarConversas([contato(1, { name: "Zé" }), contato(2, { name: "Outro", is_group: true })],
      [msg(contato(1), 1), msg(contato(2), 2)], {}, null);
    expect(filtrarConversas(convs, "jose", "tudo")).toHaveLength(0);
    const casou = () => true;
    expect(filtrarConversas(convs, "jose", "tudo", null, { casouNaBusca: casou })).toHaveLength(2);
    expect(filtrarConversas(convs, "jose", "grupos", null, { casouNaBusca: casou }).map((c) => c.contato.id)).toEqual(["c2"]);
  });
});

describe("useConversas paginado", () => {
  it("primeira carga: uma página de 60, sem baixar todos os contatos nem 2000 mensagens", async () => {
    const { f, paginaConversas } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(60));
    expect(paginaConversas).toHaveBeenCalledTimes(1);
    expect(paginaConversas.mock.calls[0][0]).toMatchObject({ limite: 60, cursor: null, consulta: CONSULTA_PADRAO });
    expect(f.listarContatos).not.toHaveBeenCalled();
    // em segundo plano, uma janela pequena (o chat abre na hora com ela), nunca as 2000
    await waitFor(() => expect(f.mensagensRecentes).toHaveBeenCalledWith(300));
    expect(result.current.conversas[0].contato.id).toBe("c0");
    expect(result.current.paginacao?.pagina?.fim).toBe(false);
  });

  it("carregar mais pede a próxima página pelo cursor da última linha", async () => {
    const { f, paginaConversas } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(60));
    act(() => result.current.paginacao!.onCarregarMais());
    await waitFor(() => expect(result.current.conversas).toHaveLength(120));
    expect(paginaConversas.mock.calls[1][0].cursor).toEqual({ em: hora(59), id: "c59" });
  });

  it("mostra a lista do cache na hora, antes do servidor responder; o servidor substitui", async () => {
    const convs = montarConversas(BANCO.slice(100, 110).map((l) => l.contato), BANCO.slice(100, 110).map((l) => l.ultima!), {}, null);
    salvarCacheLista("u1", convs);
    let responder: (l: LinhaLista[]) => void = () => undefined;
    const { f } = fonteFalsa({ pagina: (p) => (p.desde ? Promise.resolve([]) : new Promise((r) => { responder = r; })) });
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(10));
    expect(result.current.conversas[0].contato.id).toBe("c100");
    await act(async () => { responder(BANCO.slice(0, 60)); });
    await waitFor(() => expect(result.current.conversas[0].contato.id).toBe("c0"));
    // o que só existia no cache e o servidor não mandou sai (permissão revogada, conversa apagada...)
    expect(result.current.conversas.some((c) => c.contato.id === "c100")).toBe(false);
  });

  it("Realtime: mensagem nova pede só o delta (desde), nada de recarga completa", async () => {
    const { f, paginaConversas, emitir } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(60));
    act(() => emitir().onMensagem(msg(contato(150), 999, { created_at: "2026-10-21T13:00:00Z" }), "INSERT"));
    await waitFor(() => expect(paginaConversas.mock.calls.some(([p]) => p.desde)).toBe(true), { timeout: 3000 });
    const delta = paginaConversas.mock.calls.find(([p]) => p.desde)![0];
    expect(delta.desde).toBe("2026-10-21T11:59:30.000Z");
    expect(delta.consulta).toBeUndefined();
    expect(f.listarContatos).not.toHaveBeenCalled();
  });

  it("sem a RPC (migration não rodou): volta sozinho ao carregamento completo", async () => {
    const { f } = fonteFalsa({ semRpc: true });
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(200));
    expect(f.listarContatos).toHaveBeenCalled();
    expect(result.current.paginacao).toBeNull();
  });

  it("Kanban (paginada: false) carrega tudo, como antes", async () => {
    const { f, paginaConversas } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f));
    await waitFor(() => expect(result.current.conversas).toHaveLength(200));
    expect(paginaConversas).not.toHaveBeenCalled();
  });

  it("conversa do link ?abrir= fora da página: pede ao servidor pela chave", async () => {
    const { f, paginaConversas } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.conversas).toHaveLength(60));
    const alvo = BANCO[180].contato;
    await act(async () => { await result.current.garantirConversas([`${alvo.numero_id}|${alvo.phone}`]); });
    expect(paginaConversas.mock.calls.at(-1)![0].chaves).toEqual([`${alvo.numero_id}|${alvo.phone}`]);
    expect(result.current.contatos.some((c) => c.id === "c180")).toBe(true);
  });

  it("contadores das abas vêm da consulta leve", async () => {
    const { f } = fonteFalsa();
    const { result } = renderHook(() => useConversas(f, { paginada: true }));
    await waitFor(() => expect(result.current.paginacao?.contadores?.naoLidas).toBe(7));
  });
});

// telas com 60 itens: sob a suíte inteira em paralelo o jsdom passa dos 5 s padrão (a base já sofria disso)
const LENTO = { timeout: 20_000 };
const ESPERA = { timeout: 10_000 };

describe("ListaConversas com a paginação", () => {
  it("busca vai ao servidor (com espera de digitação) e o que casou lá aparece mesmo sem casar no aparelho", async () => {
    const { f, paginaConversas } = fonteFalsa();
    const Tela = () => {
      const c = useConversas(f, { paginada: true });
      return <ListaConversas conversas={c.conversas} selecionado={null} onSelecionar={() => undefined} carregando={c.carregando} paginacao={c.paginacao} />;
    };
    render(<Tela />);
    await waitFor(() => expect(screen.getAllByTestId("item-conversa").length).toBe(60), ESPERA);
    // contador "Não lidas" é o do banco, não o das 60 da tela
    await waitFor(() => expect(screen.getByRole("tab", { name: /Não lidas 7/ })).toBeInTheDocument(), ESPERA);
    fireEvent.change(screen.getByLabelText("Pesquisar conversas"), { target: { value: "texto 185" } });
    await waitFor(() => expect(paginaConversas.mock.calls.some(([p]) => p.consulta?.busca === "texto 185")).toBe(true), ESPERA);
    await waitFor(() => expect(screen.getAllByTestId("item-conversa").map((e) => e.getAttribute("data-phone"))).toEqual([BANCO[185].contato.phone]), ESPERA);
  }, LENTO);

  it("com mais páginas no servidor, o fim da lista oferece mais conversas", async () => {
    const { f } = fonteFalsa();
    const Tela = () => {
      const c = useConversas(f, { paginada: true });
      return <ListaConversas conversas={c.conversas} selecionado={null} onSelecionar={() => undefined} paginacao={c.paginacao} />;
    };
    render(<Tela />);
    await waitFor(() => expect(screen.getAllByTestId("item-conversa").length).toBe(60), ESPERA);
    expect(screen.getByTestId("lista-mais")).toBeInTheDocument();
  }, LENTO);
});
