import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GravadorAudioPasso } from "@/components/crm/GravadorAudioPasso";
import { montarInsercao } from "@/lib/crm/roteirosChat";
import type { SessaoGravacao } from "@/lib/crm/gravadorVoz";

const sessao = () => ({
  nivel: vi.fn(() => 0.4),
  parar: vi.fn(async () => new Blob([new Uint8Array([79, 103, 103, 83])], { type: "audio/ogg" })),
  cancelar: vi.fn(),
}) satisfies SessaoGravacao;

describe("GravadorAudioPasso", () => {
  it("grava, para, ouve e usa o áudio (.ogg)", async () => {
    const s = sessao();
    const iniciar = vi.fn(async () => s);
    const onUsar = vi.fn(async (_f: File) => true);
    render(<GravadorAudioPasso onUsar={onUsar} iniciar={iniciar} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await waitFor(() => expect(screen.getByTestId("gravador-passo-ativo")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Parar/ }));
    await waitFor(() => expect(screen.getByTestId("gravador-passo-previa")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Usar este áudio/ }));
    await waitFor(() => expect(onUsar).toHaveBeenCalledTimes(1));
    expect(onUsar.mock.calls[0][0].name).toMatch(/\.ogg$/);
    expect(onUsar.mock.calls[0][0].type).toBe("audio/ogg");
    await waitFor(() => expect(screen.getByRole("button", { name: /Gravar áudio/ })).toBeTruthy());
  });

  it("descartar na prévia solta tudo e volta ao início; regravar começa outra sessão", async () => {
    const iniciar = vi.fn(async () => sessao());
    render(<GravadorAudioPasso onUsar={async () => true} iniciar={iniciar} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await waitFor(() => screen.getByTestId("gravador-passo-ativo"));
    fireEvent.click(screen.getByRole("button", { name: /Parar/ }));
    await waitFor(() => screen.getByTestId("gravador-passo-previa"));
    fireEvent.click(screen.getByRole("button", { name: /Regravar/ }));
    await waitFor(() => expect(iniciar).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /Descartar gravação/ }));
    expect(screen.getByRole("button", { name: /Gravar áudio/ })).toBeTruthy();
  });

  it("falha no upload mantém a prévia para tentar de novo", async () => {
    const onUsar = vi.fn(async () => false);
    render(<GravadorAudioPasso onUsar={onUsar} iniciar={async () => sessao()} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await waitFor(() => screen.getByTestId("gravador-passo-ativo"));
    fireEvent.click(screen.getByRole("button", { name: /Parar/ }));
    await waitFor(() => screen.getByTestId("gravador-passo-previa"));
    fireEvent.click(screen.getByRole("button", { name: /Usar este áudio/ }));
    await waitFor(() => expect(onUsar).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Usar este áudio/ })).toBeTruthy());
  });

  it("microfone negado avisa e volta ao botão", async () => {
    const onAviso = vi.fn();
    const { ErroMicrofone } = await import("@/lib/crm/gravadorVoz");
    render(<GravadorAudioPasso onUsar={async () => true} onAviso={onAviso}
      iniciar={async () => { throw new ErroMicrofone("negado", "x"); }} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await waitFor(() => expect(onAviso).toHaveBeenCalledWith(expect.stringContaining("bloqueou o microfone")));
  });
});

describe("roteiro com áudio no chat", () => {
  const passo = (media_url: string, file_name: string) => ({
    id: "p1", roteiro_id: "r", ordem: 1, tipo: "audio" as const, rotulo: "a", conteudo: "", media_url, file_name,
  });
  it("OGG vira nota de voz (voz: true); mp3 segue como arquivo", () => {
    const ogg = montarInsercao([passo("https://x.co/a.ogg?t=1", "audio-1.ogg")], {});
    expect(ogg.anexos[0].voz).toBe(true);
    const mp3 = montarInsercao([passo("https://x.co/a.mp3", "a.mp3")], {});
    expect(mp3.anexos[0].voz).toBeUndefined();
  });
});
