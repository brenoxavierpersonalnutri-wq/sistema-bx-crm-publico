import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  carregarMarcadas,
  chaveConversa,
  filtrarConversas,
  montarConversas,
  salvarMarcada,
  type ContatoCRM,
  type MensagemCRM,
} from "@/lib/crm/conversas";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";

const AGORA = new Date(2026, 9, 21, 15, 0, 0);
const contato = (id: string, phone: string): ContatoCRM => ({
  id, phone, name: `Pessoa ${id}`, stage: "leads", tags: [], updated_at: "2026-10-01T08:00:00.000Z",
});
const msg = (phone: string): MensagemCRM => ({
  id: `m-${phone}`, contact_phone: phone, body: "oi", created_at: "2026-10-20T10:00:00.000Z", direction: "inbound", sender_type: "lead", status: null,
});
const LIDA = { "5511111": "2026-10-20T12:00:00.000Z" };
const BASE = "2026-10-01T00:00:00.000Z";

// O Node novo expõe um localStorage global vazio que esconde o do jsdom: usa um em memória.
const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
});

describe("marcar como não lida (localStorage)", () => {
  beforeEach(() => memoria.clear());

  it("grava, relê e desliga a marca por usuário", () => {
    salvarMarcada("u1", "a|1", true);
    salvarMarcada("u1", "b|2", true);
    expect([...carregarMarcadas("u1")].sort()).toEqual(["a|1", "b|2"]);
    expect(carregarMarcadas("u2").size).toBe(0);
    salvarMarcada("u1", "a|1", false);
    expect([...carregarMarcadas("u1")]).toEqual(["b|2"]);
  });

  it("storage corrompido não quebra", () => {
    window.localStorage.setItem("crm:conversas:marcadas-nao-lidas:u1", "{lixo");
    expect(carregarMarcadas("u1").size).toBe(0);
  });
});

describe("montarConversas com marca", () => {
  const c = contato("1", "5511111");
  const chave = chaveConversa(c);

  it("conversa lida e marcada: bolinha sem número (naoLidas 0) e entra em Não lidas", () => {
    const [conv] = montarConversas([c], [msg(c.phone)], LIDA, BASE, null, new Set([chave]));
    expect(conv.naoLidas).toBe(0);
    expect(conv.marcadaNaoLida).toBe(true);
    expect(filtrarConversas([conv], "", "nao-lidas")).toHaveLength(1);
  });

  it("sem marca nem mensagem nova: fica fora de Não lidas", () => {
    const [conv] = montarConversas([c], [msg(c.phone)], LIDA, BASE, null, new Set());
    expect(conv.marcadaNaoLida).toBe(false);
    expect(filtrarConversas([conv], "", "nao-lidas")).toHaveLength(0);
  });
});

describe("menu de contexto da lista", () => {
  // jsdom não tem DOMRect, que o Radix usa para posicionar o menu
  beforeEach(() => {
    const g = globalThis as unknown as { DOMRect?: unknown };
    if (!g.DOMRect) {
      g.DOMRect = class { static fromRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; } };
    }
  });
  const c = contato("1", "5511111");
  const chave = chaveConversa(c);
  const monta = (marcadas: string[], leituras = LIDA) => montarConversas([c], [msg(c.phone)], leituras, BASE, null, new Set(marcadas));

  it("botão direito em conversa lida oferece 'Marcar como não lida' e chama com a chave", () => {
    const naoLida = vi.fn();
    render(<ListaConversas conversas={monta([])} selecionado={null} onSelecionar={() => {}} agora={AGORA} onMarcarNaoLida={naoLida} onMarcarLida={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId("item-conversa"));
    expect(screen.queryByText("Marcar como lida")).toBeNull();
    fireEvent.click(screen.getByText("Marcar como não lida"));
    expect(naoLida).toHaveBeenCalledWith(chave);
  });

  it("conversa marcada mostra bolinha sem número, contador em Não lidas e oferece 'Marcar como lida'", () => {
    const lida = vi.fn();
    render(<ListaConversas conversas={monta([chave])} selecionado={null} onSelecionar={() => {}} agora={AGORA} onMarcarNaoLida={vi.fn()} onMarcarLida={lida} />);
    expect(screen.getByTestId("marcada-nao-lida")).toBeTruthy();
    expect(screen.queryByTestId("nao-lidas")).toBeNull();
    expect(screen.getByRole("tab", { name: "Não lidas 1" })).toBeTruthy();
    fireEvent.contextMenu(screen.getByTestId("item-conversa"));
    expect(screen.queryByText("Marcar como não lida")).toBeNull();
    fireEvent.click(screen.getByText("Marcar como lida"));
    expect(lida).toHaveBeenCalledWith(chave);
  });

  it("'Abrir em nova aba' abre /crm/conversas?abrir=<chave>", () => {
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ListaConversas conversas={monta([])} selecionado={null} onSelecionar={() => {}} agora={AGORA} onMarcarNaoLida={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId("item-conversa"));
    fireEvent.click(screen.getByText("Abrir em nova aba"));
    expect(abrir).toHaveBeenCalledWith(`${window.location.origin}/crm/conversas?abrir=${encodeURIComponent(chave)}`, "_blank", "noopener,noreferrer");
    abrir.mockRestore();
  });
});
