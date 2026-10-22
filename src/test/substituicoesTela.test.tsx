import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

const { default: Substituicoes } = await import("@/pages/Substituicoes");

function escolhe(nome: string) {
  const busca = screen.getByPlaceholderText("Escreve o alimento da tua dieta");
  fireEvent.focus(busca);
  fireEvent.change(busca, { target: { value: nome } });
  const opcao = screen.getAllByRole("option").find((o) => o.textContent?.startsWith(nome));
  if (!opcao) throw new Error(`sem opção ${nome}`);
  fireEvent.mouseDown(opcao);
}

describe("tela de substituição: quantidade digitada pela aluna", () => {
  it("o campo vem vazio, com placeholder e foco; nenhum chip marcado; troca só depois de digitar", () => {
    render(<Substituicoes />);
    escolhe("Laranja");

    const campo = screen.getByLabelText("Quantidade") as HTMLInputElement;
    expect(campo.value).toBe("");
    expect(campo.placeholder).toBe("quantos gramas estão no seu plano?");
    expect(document.activeElement).toBe(campo);

    // chips da lista continuam como atalho, nenhum marcado
    const chip140 = screen.getByRole("button", { name: "140 g" });
    expect(chip140.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "280 g" }).getAttribute("aria-pressed")).toBe("false");

    expect(screen.getByText("Digite a quantidade do seu plano para ver a troca.")).toBeTruthy();
    expect(screen.queryByText("Pode trocar por")).toBeNull();

    fireEvent.change(campo, { target: { value: "100" } });
    expect(screen.queryByText("Digite a quantidade do seu plano para ver a troca.")).toBeNull();
    expect(screen.getByText("Pode trocar por")).toBeTruthy();

    // escolhe maçã no TROCAR POR: aparece em gramas, nunca "0,5 unidades"
    const destino = screen.getByPlaceholderText("Escreve o que tu quer no lugar");
    fireEvent.focus(destino);
    fireEvent.change(destino, { target: { value: "Maça" } });
    const maca = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Maça"));
    fireEvent.mouseDown(maca!);
    const linha = screen.getByText((_, el) => el?.classList.contains("sub-linha-dieta") ?? false);
    expect(linha.textContent).toContain("Maça - 60 g");
    expect(linha.textContent).not.toMatch(/unidade/);
    const conta = within(linha.parentElement as HTMLElement).getByText(/de carboidrato/);
    expect(conta.textContent).toMatch(/^9,1g de carboidrato · 37 kcal/);

    // apagou a quantidade: volta a dica
    fireEvent.change(campo, { target: { value: "" } });
    expect(screen.getByText("Digite a quantidade do seu plano para ver a troca.")).toBeTruthy();

    // chip é atalho opcional
    fireEvent.click(chip140);
    expect(campo.value).toBe("140");
    expect(chip140.getAttribute("aria-pressed")).toBe("true");
  });
});
