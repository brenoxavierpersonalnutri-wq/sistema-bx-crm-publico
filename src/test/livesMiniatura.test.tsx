// Miniatura da live programada: botão próprio abre o seletor (input escondido), JPG/PNG até 2 MB passam direto,
// outros formatos viram JPEG, HEIC e não-imagem dão mensagem clara.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
import { toast } from "sonner";
import { caberEm, MAX_MINIATURA, prepararMiniatura } from "@/lib/lives/miniatura";
import { MiniaturaYt } from "@/components/lives/estudio/MiniaturaYt";

const arquivo = (nome: string, tipo: string, bytes: number) => new File([new Uint8Array(bytes)], nome, { type: tipo });

describe("prepararMiniatura", () => {
  it("JPG e PNG até 2 MB vão como estão", async () => {
    const f = arquivo("a.png", "image/png", 1000);
    expect(await prepararMiniatura(f)).toEqual({ ok: true, arquivo: f, convertida: false });
    expect((await prepararMiniatura(arquivo("a.jpg", "image/jpeg", MAX_MINIATURA))).ok).toBe(true);
  });
  it("não-imagem é recusada com mensagem clara", async () => {
    expect(await prepararMiniatura(arquivo("a.pdf", "application/pdf", 10))).toEqual({ ok: false, motivo: "Escolha uma imagem (JPG ou PNG)." });
  });
  it("HEIC que o navegador não abre: explica como exportar", async () => {
    const r = await prepararMiniatura(arquivo("IMG_1.HEIC", "image/heic", 10), async () => { throw new Error("decode"); });
    expect(r.ok === false && r.motivo).toMatch(/HEIC/);
  });
  it("cabe em 1280x720 mantendo a proporção", () => {
    expect(caberEm(4000, 2250)).toEqual({ l: 1280, a: 720 });
    expect(caberEm(1000, 1000)).toEqual({ l: 720, a: 720 });
    expect(caberEm(640, 360)).toEqual({ l: 640, a: 360 });
  });
});

describe("MiniaturaYt", () => {
  it("o botão dispara o input escondido e a escolha chega ao painel", async () => {
    const onChange = vi.fn();
    render(<MiniaturaYt valor={null} onChange={onChange} />);
    const input = screen.getByTestId("miniatura-arquivo") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/*");
    const clique = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Escolher imagem" }));
    expect(clique).toHaveBeenCalled();
    const f = arquivo("thumb.png", "image/png", 2048);
    fireEvent.change(input, { target: { files: [f] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(f));
  });
  it("mostra nome e tamanho da escolhida e deixa tirar", () => {
    const onChange = vi.fn();
    render(<MiniaturaYt valor={arquivo("capa.jpg", "image/jpeg", 300 * 1024)} onChange={onChange} />);
    expect(screen.getByText("capa.jpg")).toBeInTheDocument();
    expect(screen.getByText(/300 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Tirar miniatura"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it("arquivo recusado vira aviso, não some em silêncio", async () => {
    const onChange = vi.fn();
    render(<MiniaturaYt valor={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("miniatura-arquivo"), { target: { files: [arquivo("a.pdf", "application/pdf", 10)] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });
});
