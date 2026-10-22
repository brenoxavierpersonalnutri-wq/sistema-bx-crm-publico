import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GravadorVoz, CLIQUE_FANTASMA_MS, SEGURAR_MS, DESLIZAR_CANCELA_PX } from "@/components/crm/conversas/GravadorVoz";
import { BarraDigitacao } from "@/components/crm/conversas/BarraDigitacao";
import {
  ErroMicrofone, formatarTempoGravacao, mensagemErroMicrofone, motivoDoErroGetUserMedia, nomeNotaDeVoz,
  type SessaoGravacao,
} from "@/lib/crm/gravadorVoz";

// jsdom não tem PointerEvent: sem isto o fireEvent.pointer* chega sem clientX/button.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventFalso extends MouseEvent {
    pointerId: number;
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventFalso;
}

function sessaoFalsa() {
  const s = {
    nivel: vi.fn(() => 0.5),
    parar: vi.fn(async () => new Blob([new Uint8Array([79, 103, 103, 83])], { type: "audio/ogg" })),
    cancelar: vi.fn(),
  } satisfies SessaoGravacao;
  return s;
}

const mic = () => screen.getByRole("button", { name: "Gravar áudio" });
// O "clique fantasma" (soltar do clique que iniciou) é ignorado: avança o relógio antes de clicar.
const depoisDoFantasma = () => new Promise((r) => setTimeout(r, CLIQUE_FANTASMA_MS + 20));

async function comecarPorClique(iniciar: () => Promise<SessaoGravacao>) {
  fireEvent.pointerDown(mic(), { button: 0, clientX: 300 });
  fireEvent.pointerUp(window, { clientX: 300 });
  await waitFor(() => expect(screen.getByTestId("gravador-ativo")).toBeTruthy());
  expect(iniciar).toHaveBeenCalledTimes(1);
}

afterEach(() => vi.useRealTimers());

describe("GravadorVoz", () => {
  it("clique: grava, mostra tempo e onda; lixeira cancela e solta o microfone", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => true);
    render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    expect(screen.getByRole("timer").textContent).toBe("0:00");
    expect(screen.getByTestId("gravador-onda")).toBeTruthy();
    await waitFor(() => expect(s.nivel).toHaveBeenCalled());

    await act(depoisDoFantasma);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar gravação" }));
    expect(s.cancelar).toHaveBeenCalledTimes(1);
    expect(onEnviar).not.toHaveBeenCalled();
    expect(mic()).toBeTruthy();
  });

  it("enviar: para, gera .ogg (audio/ogg) e chama onEnviar; volta ao microfone", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => true);
    render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    await act(depoisDoFantasma);
    fireEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));
    await waitFor(() => expect(onEnviar).toHaveBeenCalledTimes(1));
    const arquivo = onEnviar.mock.calls[0][0] as File;
    expect(arquivo.type).toBe("audio/ogg");
    expect(arquivo.name).toMatch(/^audio-\d{8}-\d{6}\.ogg$/);
    expect(s.parar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mic()).toBeTruthy());
  });

  it("clique fantasma logo após começar não envia nem para", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => true);
    render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    fireEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));
    expect(s.parar).not.toHaveBeenCalled();
    expect(onEnviar).not.toHaveBeenCalled();
    expect(screen.getByTestId("gravador-ativo").dataset.estado).toBe("gravando");
  });

  it("parar e ouvir: abre a prévia; descartar não envia; enviar da prévia envia", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => true);
    render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    await act(depoisDoFantasma);
    fireEvent.click(screen.getByRole("button", { name: "Parar e ouvir" }));
    await waitFor(() => expect(screen.getByTestId("gravador-ativo").dataset.estado).toBe("previa"));
    expect(screen.queryByRole("timer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));
    await waitFor(() => expect(onEnviar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mic()).toBeTruthy());
  });

  it("envio que falha deixa a nota na prévia para tentar de novo", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => false);
    render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    await act(depoisDoFantasma);
    fireEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));
    await waitFor(() => expect(screen.getByTestId("gravador-ativo").dataset.estado).toBe("previa"));
    expect(screen.getByRole("button", { name: "Descartar áudio" })).toBeTruthy();
  });

  it("segurar e soltar envia; arrastar para a esquerda cancela", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviar = vi.fn(async (_arquivo: File) => true);
    const { unmount } = render(<GravadorVoz onEnviar={onEnviar} iniciar={iniciar} />);
    fireEvent.pointerDown(mic(), { button: 0, clientX: 300 });
    await waitFor(() => expect(screen.getByTestId("gravador-ativo")).toBeTruthy());
    await act(() => new Promise((r) => setTimeout(r, SEGURAR_MS + 30)));
    fireEvent.pointerUp(window, { clientX: 300 });
    await waitFor(() => expect(onEnviar).toHaveBeenCalledTimes(1));
    unmount();

    const s2 = sessaoFalsa();
    const iniciar2 = vi.fn(async () => s2);
    const onEnviar2 = vi.fn(async () => true);
    render(<GravadorVoz onEnviar={onEnviar2} iniciar={iniciar2} />);
    fireEvent.pointerDown(mic(), { button: 0, clientX: 300 });
    await waitFor(() => expect(screen.getByTestId("gravador-ativo")).toBeTruthy());
    fireEvent.pointerMove(window, { clientX: 300 - DESLIZAR_CANCELA_PX - 5 });
    await waitFor(() => expect(s2.cancelar).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(window, { clientX: 100 });
    expect(onEnviar2).not.toHaveBeenCalled();
    expect(mic()).toBeTruthy();
  });

  it("microfone negado: aviso claro e volta ao estado inicial", async () => {
    const onAviso = vi.fn();
    const iniciar = vi.fn(async () => { throw new ErroMicrofone("negado", "x"); });
    render(<GravadorVoz onEnviar={vi.fn()} onAviso={onAviso} iniciar={iniciar} />);
    fireEvent.pointerDown(mic(), { button: 0, clientX: 10 });
    await waitFor(() => expect(onAviso).toHaveBeenCalledTimes(1));
    expect(onAviso.mock.calls[0][0]).toMatch(/bloqueou o microfone/);
    expect(mic()).toBeTruthy();
  });

  it("desmontar no meio da gravação solta o microfone", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const { unmount } = render(<GravadorVoz onEnviar={vi.fn()} iniciar={iniciar} />);
    await comecarPorClique(iniciar);
    unmount();
    expect(s.cancelar).toHaveBeenCalledTimes(1);
  });
});

describe("BarraDigitacao + nota de voz", () => {
  it("gravando esconde o campo; enviar manda anexo de áudio com voz=true e sem legenda", async () => {
    const s = sessaoFalsa();
    const iniciar = vi.fn(async () => s);
    const onEnviarAnexo = vi.fn(async () => true);
    render(
      <BarraDigitacao enviando={false} anexando={false} onEnviar={vi.fn(async () => true)} onEnviarAnexo={onEnviarAnexo} iniciarGravacao={iniciar} />,
    );
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toBeTruthy();
    await comecarPorClique(iniciar);
    expect(screen.queryByRole("textbox", { name: "Mensagem" })).toBeNull();
    await act(depoisDoFantasma);
    fireEvent.click(screen.getByRole("button", { name: "Enviar áudio" }));
    await waitFor(() => expect(onEnviarAnexo).toHaveBeenCalledTimes(1));
    const [anexo, legenda] = onEnviarAnexo.mock.calls[0] as unknown as [{ tipo: string; voz: boolean; arquivo: File }, string];
    expect(anexo).toMatchObject({ tipo: "audio", voz: true });
    expect(anexo.arquivo.type).toBe("audio/ogg");
    expect(legenda).toBe("");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Mensagem" })).toBeTruthy());
  });

  it("com texto digitado o microfone dá lugar ao Enviar", () => {
    render(<BarraDigitacao enviando={false} anexando={false} onEnviar={vi.fn(async () => true)} onEnviarAnexo={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem" }), { target: { value: "oi" } });
    expect(screen.queryByRole("button", { name: "Gravar áudio" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
  });
});

describe("gravadorVoz (funções puras)", () => {
  it("tempo, nome, motivos e mensagens", () => {
    expect(formatarTempoGravacao(0)).toBe("0:00");
    expect(formatarTempoGravacao(65_400)).toBe("1:05");
    expect(nomeNotaDeVoz(new Date(2026, 9, 17, 9, 5, 3))).toBe("audio-20261017-090503.ogg");
    expect(motivoDoErroGetUserMedia({ name: "NotAllowedError" })).toBe("negado");
    expect(motivoDoErroGetUserMedia({ name: "NotFoundError" })).toBe("sem-microfone");
    expect(motivoDoErroGetUserMedia(new Error("x"))).toBe("outro");
    expect(mensagemErroMicrofone(new ErroMicrofone("sem-suporte", ""))).toMatch(/não grava áudio/);
    expect(mensagemErroMicrofone(new Error("x"))).toMatch(/Não foi possível/);
  });
});
