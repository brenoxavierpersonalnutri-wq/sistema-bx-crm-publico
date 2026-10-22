// Conversa sob demanda (18/10/2026): abrir conversa vazia busca as últimas no WhatsApp; carregar mais pede a
// página anterior lá quando o banco acaba; mídia importada só com metadado baixa ao clicar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import {
  useMensagensConversa, esquecerBuscasWhatsApp, buscaNoWhatsApp, limiteDaProximaPagina, TAMANHO_PAGINA,
} from "@/hooks/useMensagensConversa";
import { contaComoNaoLida, contarNaoLidas, midiaSobDemanda, type MensagemCRM } from "@/lib/crm/conversas";
import { MidiaMensagem } from "@/components/crm/conversas/MidiaMensagem";
import { zerarFilaAudio } from "@/lib/crm/filaAudio";
import { resumoTrazerConversas, type FonteConversas } from "@/lib/crm/fonteConversas";

const TEL = "5531999990001";
const msg = (i: number, extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
  id: `m${i}`, contact_phone: TEL, body: `msg ${i}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  direction: "inbound", sender_type: "lead", message_id: `false_${TEL}@c.us_${i}`, ...extra,
});

/** Banco fictício: o WhatsApp tem `noWhatsApp` mensagens; importar grava as `limite` mais recentes. */
function fonteFicticia(noBanco: number, noWhatsApp: number) {
  const todas = Array.from({ length: noWhatsApp }, (_, i) => msg(i));
  let banco = todas.slice(noWhatsApp - noBanco);
  const importarHistorico = vi.fn(async (_p: string, _n?: string | null, o?: { limite?: number }) => {
    const antes = banco.length;
    const ids = new Set(banco.map((m) => m.id));
    const novas = todas.slice(Math.max(0, noWhatsApp - (o?.limite ?? 300))).filter((m) => !ids.has(m.id));
    banco = [...novas, ...banco].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return banco.length - antes;
  });
  const mensagensDoContato = vi.fn(async (_p: string, limite: number, antesDe?: string) => {
    const lista = antesDe ? banco.filter((m) => m.created_at < antesDe) : banco;
    return lista.slice(-limite).reverse();
  });
  const fonte = { importarHistorico, mensagensDoContato } as unknown as FonteConversas;
  return { fonte, importarHistorico, mensagensDoContato };
}
const ouvir = () => () => undefined;

beforeEach(() => { esquecerBuscasWhatsApp(); zerarFilaAudio(); });

describe("conversa sob demanda", () => {
  it("abrir conversa vazia busca as últimas 50 no WhatsApp e mostra", async () => {
    const f = fonteFicticia(0, 120);
    const { result } = renderHook(() => useMensagensConversa(f.fonte, TEL, ouvir, null));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(TAMANHO_PAGINA));
    expect(f.importarHistorico).toHaveBeenCalledWith(TEL, null, { limite: TAMANHO_PAGINA, semMidia: true });
    expect(result.current.mensagens.at(-1)?.body).toBe("msg 119");
    expect(result.current.temMais).toBe(true);
  });
  it("carregar mais: banco acabou -> pede a página anterior ao WhatsApp", async () => {
    const f = fonteFicticia(0, 120);
    const { result } = renderHook(() => useMensagensConversa(f.fonte, TEL, ouvir, null));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(50));
    await act(async () => { await result.current.carregarAntigas(); });
    expect(f.importarHistorico).toHaveBeenLastCalledWith(TEL, null, { limite: 100, semMidia: true });
    expect(result.current.mensagens).toHaveLength(100);
    expect(result.current.mensagens[0].body).toBe("msg 20");
  });
  it("conversa já cheia no banco não vai ao WhatsApp ao abrir", async () => {
    const f = fonteFicticia(80, 80);
    const { result } = renderHook(() => useMensagensConversa(f.fonte, TEL, ouvir, null));
    await waitFor(() => expect(result.current.mensagens).toHaveLength(50));
    expect(f.importarHistorico).not.toHaveBeenCalled();
  });
  it("WhatsApp sem mais nada: para de pedir (esgotada)", async () => {
    const f = fonteFicticia(3, 3);
    const { result } = renderHook(() => useMensagensConversa(f.fonte, TEL, ouvir, null));
    await waitFor(() => expect(f.importarHistorico).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.temMais).toBe(false));
  });
  it("Instagram e chave inválida não vão ao WhatsApp", () => {
    expect(buscaNoWhatsApp("ig:123")).toBe(false);
    expect(buscaNoWhatsApp("120363000000000101@g.us")).toBe(true);
    expect(buscaNoWhatsApp(TEL)).toBe(true);
    expect(limiteDaProximaPagina(1990)).toBe(2000);
  });
});

describe("não lidas e mídia sob demanda", () => {
  it("mensagem importada não conta como não lida", () => {
    const lida = "2026-09-01T00:00:00.000Z";
    expect(contaComoNaoLida(msg(1, { importada: true }))).toBe(false);
    expect(contarNaoLidas([msg(1, { importada: true }), msg(2)], lida)).toBe(1);
  });
  it("midiaSobDemanda: tipo sem arquivo e sem fila", () => {
    expect(midiaSobDemanda(msg(1, { media_type: "image" }))).toBe(true);
    expect(midiaSobDemanda(msg(1, { media_type: "image", media_status: "pendente" }))).toBe(false);
    expect(midiaSobDemanda(msg(1, { media_type: "image", media_path: "x/y.jpg" }))).toBe(false);
    expect(midiaSobDemanda(msg(1))).toBe(false);
  });
  it("botão Baixar mídia busca na hora e mostra a imagem", async () => {
    const baixar = vi.fn(async () => "https://x.supabase.co/storage/v1/object/sign/whatsapp-media/a.jpg?token=t");
    render(<MidiaMensagem msg={msg(1, { media_type: "image", mime_type: "image/jpeg", body: "[foto]" })} baixarMidia={baixar} />);
    fireEvent.click(screen.getByTestId("baixar-midia"));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("a.jpg")));
    expect(baixar).toHaveBeenCalledTimes(1);
  });
  it("WhatsApp não entregou: avisa indisponível", async () => {
    render(<MidiaMensagem msg={msg(1, { media_type: "audio" })} baixarMidia={async () => null} />);
    fireEvent.click(screen.getByTestId("baixar-midia"));
    await waitFor(() => expect(screen.getByText(/mídia indisponível/)).toBeInTheDocument());
  });
  it("resumo da importação: aviso de modo lento e parcial", () => {
    expect(resumoTrazerConversas({ chats: 80, imported: 900, modo: "rapido" })).toEqual({ chats: 80, imported: 900, fotos: 0 });
    expect(resumoTrazerConversas({ chats: 30, imported: 10, modo: "lento" }).aviso).toMatch(/modo lento/);
    expect(resumoTrazerConversas({ chats: 50, imported: 10, parcial: true }).aviso).toMatch(/rode de novo/);
  });
});
