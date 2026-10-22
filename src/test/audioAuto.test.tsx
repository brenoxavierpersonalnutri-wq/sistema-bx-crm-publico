// Áudio automático (20/10/2026): fila de 2, só o que aparece na tela, erro volta o botão.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MidiaMensagem } from "@/components/crm/conversas/MidiaMensagem";
import { baixarNaFila, zerarFilaAudio } from "@/lib/crm/filaAudio";
import { audioSobDemanda, type MensagemCRM } from "@/lib/crm/conversas";

const msg = (i: number, extra: Partial<MensagemCRM> = {}): MensagemCRM => ({
  id: `m${i}`, contact_phone: "5531999990001", body: "[áudio]", created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  direction: "inbound", sender_type: "lead", message_id: `false_x_${i}`, media_type: "ptt", ...extra,
});

let observadores: Array<(v: boolean) => void> = [];
beforeEach(() => {
  zerarFilaAudio();
  observadores = [];
  class IO {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      observadores.push((v) => this.cb([{ isIntersecting: v } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", IO);
});
afterEach(() => vi.unstubAllGlobals());

describe("áudio automático", () => {
  it("audioSobDemanda reconhece ptt/audio sem arquivo", () => {
    expect(audioSobDemanda(msg(1))).toBe(true);
    expect(audioSobDemanda(msg(1, { media_type: "image" }))).toBe(false);
    expect(audioSobDemanda(msg(1, { media_path: "a/b.ogg" }))).toBe(false);
  });

  it("fila: no máximo 2 ao mesmo tempo e reaproveita o já baixado", async () => {
    let ativos = 0, pico = 0;
    const soltar: Array<() => void> = [];
    const rodar = (id: string) => baixarNaFila(id, () => new Promise<string>((ok) => {
      ativos++; pico = Math.max(pico, ativos);
      soltar.push(() => { ativos--; ok(`url-${id}`); });
    }));
    const ps = ["a", "b", "c", "d"].map(rodar);
    await Promise.resolve();
    expect(soltar.length).toBe(2);
    soltar[0](); await ps[0];
    await waitFor(() => expect(soltar.length).toBe(3));
    soltar[1](); soltar[2](); await waitFor(() => expect(soltar.length).toBe(4)); soltar[3]();
    expect(await Promise.all(ps)).toEqual(["url-a", "url-b", "url-c", "url-d"]);
    expect(pico).toBe(2);
    const de_novo = vi.fn(async () => "outra");
    expect(await baixarNaFila("a", de_novo)).toBe("url-a");
    expect(de_novo).not.toHaveBeenCalled();
  });

  it("só baixa quando aparece na tela e mostra o player", async () => {
    const baixar = vi.fn(async () => "https://x/a.ogg?token=t");
    const { container } = render(<MidiaMensagem msg={msg(1)} baixarMidia={baixar} autoBaixarAudio />);
    expect(baixar).not.toHaveBeenCalled();
    act(() => observadores[0](true));
    await waitFor(() => expect(container.querySelector("audio")).toHaveAttribute("src", "https://x/a.ogg?token=t"));
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it("fora da janela (autoBaixarAudio falso) nunca baixa sozinho", () => {
    const baixar = vi.fn(async () => "u");
    render(<MidiaMensagem msg={msg(1)} baixarMidia={baixar} autoBaixarAudio={false} />);
    expect(observadores.length).toBe(0);
    expect(baixar).not.toHaveBeenCalled();
    expect(screen.getByTestId("baixar-midia")).toBeInTheDocument();
  });

  it("erro: volta o botão com a mensagem e não tenta de novo sozinho", async () => {
    const baixar = vi.fn(async () => { throw new Error("proxy 429"); });
    render(<MidiaMensagem msg={msg(2)} baixarMidia={baixar} autoBaixarAudio />);
    act(() => observadores[0](true));
    await waitFor(() => expect(screen.getByTestId("erro-midia")).toHaveTextContent("proxy 429"));
    expect(screen.getByTestId("baixar-midia")).not.toBeDisabled();
    act(() => observadores[0](false)); act(() => observadores[0](true));
    expect(baixar).toHaveBeenCalledTimes(1);
  });
});
