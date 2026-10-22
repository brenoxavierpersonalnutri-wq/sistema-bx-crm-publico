// Chat rápido no celular (21/10/2026): abre com o que já tem (cache da aba ou prévia da lista) sem spinner,
// a mídia assinada chega depois sem bloquear, a lista monta em lotes e a mescla não é mais O(n²).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useMensagensConversa, esquecerBuscasWhatsApp } from "@/hooks/useMensagensConversa";
import { mesclarMensagens, montarConversas, type ContatoCRM, type MensagemCRM } from "@/lib/crm/conversas";
import type { FonteConversas } from "@/lib/crm/fonteConversas";
import { ListaConversas, PASSO_LISTA } from "@/components/crm/conversas/ListaConversas";

const TEL = "5531988887777";
const msg = (i: number, extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
  id: `m${i}`, contact_phone: TEL, body: `msg ${i}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  direction: "inbound", sender_type: "lead", message_id: `wa_${i}`, ...extra,
});
const ouvir = () => () => undefined;

beforeEach(() => { esquecerBuscasWhatsApp(); });

describe("chat abre na hora", () => {
  it("prévia da lista aparece antes da página do banco, sem spinner", async () => {
    let soltar: (v: MensagemCRM[]) => void = () => undefined;
    const banco = Array.from({ length: 60 }, (_, i) => msg(i)).reverse().slice(0, 50);
    const mensagensDoContato = vi.fn(() => new Promise<MensagemCRM[]>((r) => { soltar = r; }));
    const fonte = { mensagensDoContato, importarHistorico: vi.fn(async () => 0) } as unknown as FonteConversas;
    const previa = vi.fn(() => [msg(58), msg(59)]);
    const { result } = renderHook(() => useMensagensConversa(fonte, TEL, ouvir, null, previa));
    expect(result.current.mensagens.map((m) => m.id)).toEqual(["m58", "m59"]);
    expect(result.current.carregando).toBe(false);
    await act(async () => { soltar(banco); });
    await waitFor(() => expect(result.current.mensagens).toHaveLength(50));
    expect(result.current.temMais).toBe(true);
  });

  it("com a prévia na tela, carregar antigas espera a primeira página (não vai ao banco nem ao WhatsApp antes)", async () => {
    let soltar: (v: MensagemCRM[]) => void = () => undefined;
    const mensagensDoContato = vi.fn(() => new Promise<MensagemCRM[]>((r) => { soltar = r; }));
    const importarHistorico = vi.fn(async () => 0);
    const fonte = { mensagensDoContato, importarHistorico } as unknown as FonteConversas;
    const { result } = renderHook(() => useMensagensConversa(fonte, TEL, ouvir, null, () => [msg(58), msg(59)]));
    let veio = true;
    await act(async () => { veio = await result.current.carregarAntigas(); });
    expect(veio).toBe(false);
    expect(mensagensDoContato).toHaveBeenCalledTimes(1);
    expect(importarHistorico).not.toHaveBeenCalled();
    await act(async () => { soltar(Array.from({ length: 50 }, (_, i) => msg(i + 10)).reverse()); });
    await waitFor(() => expect(result.current.mensagens).toHaveLength(50));
  });

  it("voltar à conversa usa o cache da aba (mostra já, atualiza por trás)", async () => {
    const banco = Array.from({ length: 50 }, (_, i) => msg(i)).reverse();
    const mensagensDoContato = vi.fn(async (p: string) => (p === TEL ? banco : []));
    const fonte = { mensagensDoContato, importarHistorico: vi.fn(async () => 0) } as unknown as FonteConversas;
    const { result, rerender } = renderHook(({ tel }) => useMensagensConversa(fonte, tel, ouvir, null), {
      initialProps: { tel: TEL as string | null },
    });
    await waitFor(() => expect(result.current.mensagens).toHaveLength(50));
    rerender({ tel: "5531900000000" });
    await waitFor(() => expect(mensagensDoContato).toHaveBeenCalledTimes(2));
    // a outra conversa não herdou as mensagens desta (nem gravou as desta no cache dela)
    await waitFor(() => expect(result.current.mensagens).toHaveLength(0));
    let segura: (v: MensagemCRM[]) => void = () => undefined;
    mensagensDoContato.mockImplementationOnce(() => new Promise((r) => { segura = r; }));
    rerender({ tel: TEL });
    expect(result.current.mensagens).toHaveLength(50);
    expect(result.current.carregando).toBe(false);
    await act(async () => { segura([msg(99), ...banco]); });
    await waitFor(() => expect(result.current.mensagens.at(-1)?.id).toBe("m99"));
  });

  it("link assinado que chega depois entra na mensagem que já está na tela", async () => {
    const ouvintes = new Set<(m: MensagemCRM[]) => void>();
    const semLink = msg(1, { media_type: "image", media_path: "x/1.jpg", media_url: null });
    const fonte = {
      mensagensDoContato: vi.fn(async () => [semLink]),
      importarHistorico: vi.fn(async () => 0),
      ouvirMidiasAssinadas: (fn: (m: MensagemCRM[]) => void) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    } as unknown as FonteConversas;
    const { result } = renderHook(() => useMensagensConversa(fonte, TEL, ouvir, null));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(1));
    act(() => { ouvintes.forEach((fn) => fn([{ ...semLink, media_url: "https://x/assinado" }, msg(7, { contact_phone: "outro" })])); });
    expect(result.current.mensagens).toHaveLength(1);
    expect(result.current.mensagens[0].media_url).toBe("https://x/assinado");
  });
});

describe("mesclarMensagens", () => {
  it("troca a duplicata pelo message_id e não perde o link assinado na releitura", () => {
    const a = msg(1, { id: "tmp", message_id: "wa_1" });
    const b = msg(1, { id: "real", message_id: "wa_1" });
    expect(mesclarMensagens([a], [b]).map((m) => m.id)).toEqual(["real"]);
    const assinada = msg(2, { media_path: "p.jpg", media_url: "https://link" });
    const relida = msg(2, { media_path: "p.jpg", media_url: null });
    expect(mesclarMensagens([assinada], [relida])[0].media_url).toBe("https://link");
  });
  it("2000 + 2000 mensagens mesclam rápido", () => {
    const um = Array.from({ length: 2000 }, (_, i) => msg(i));
    const dois = Array.from({ length: 2000 }, (_, i) => msg(i + 1000));
    const t = performance.now();
    expect(mesclarMensagens(um, dois)).toHaveLength(3000);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("lista em lotes", () => {
  it(`monta ${PASSO_LISTA} por vez e "Mostrar mais" traz o próximo lote`, () => {
    const contatos: ContatoCRM[] = Array.from({ length: 150 }, (_, i) => ({
      id: `c${i}`, phone: `55319000${String(i).padStart(5, "0")}`, name: `Pessoa ${i}`, stage: "novo",
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    } as ContatoCRM));
    const lista = montarConversas(contatos, [], {}, null);
    render(<ListaConversas conversas={lista} selecionado={null} onSelecionar={() => {}} />);
    expect(screen.getAllByTestId("item-conversa")).toHaveLength(PASSO_LISTA);
    fireEvent.click(screen.getByText("Mostrar mais conversas"));
    expect(screen.getAllByTestId("item-conversa")).toHaveLength(PASSO_LISTA * 2);
    // a busca continua olhando a lista inteira
    fireEvent.change(screen.getByPlaceholderText(/Pesquisar/i), { target: { value: "Pessoa 149" } });
    expect(screen.getAllByTestId("item-conversa")).toHaveLength(1);
  });
});
