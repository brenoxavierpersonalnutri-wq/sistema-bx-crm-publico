// Fila dos bastidores: quem está no palco aparece marcado; o botão sobe ou desce do palco.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilaBastidores, type PessoaFila } from "@/components/lives/estudio/FilaBastidores";

const PESSOAS: PessoaFila[] = [
  { identity: "prod", nome: "Ana Souza", noPalco: true, papel: "produtor", voce: true },
  { identity: "conv", nome: "Carlos Lima", noPalco: false, micDesligado: true },
  { identity: "tela", nome: "Júlia Martins", noPalco: true, temTela: true },
];

describe("FilaBastidores", () => {
  it("lista todo mundo com nome, marca quem está no palco e identifica você", () => {
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={() => undefined} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const prod = within(screen.getByTestId("fila-prod"));
    expect(prod.getByText("No palco")).toBeInTheDocument();
    expect(prod.getByText("Ana Souza (você)")).toBeInTheDocument();
    expect(within(screen.getByTestId("fila-conv")).queryByText("No palco")).toBeNull();
    expect(within(screen.getByTestId("fila-conv")).getByLabelText("microfone desligado")).toBeInTheDocument();
    expect(within(screen.getByTestId("fila-tela")).getByLabelText("compartilhando tela")).toBeInTheDocument();
  });

  it("bastidores: 'Colocar no palco' chama onAlternar(identity, true)", () => {
    const onAlternar = vi.fn();
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={onAlternar} />);
    fireEvent.click(within(screen.getByTestId("fila-conv")).getByRole("button", { name: /Colocar no palco/ }));
    expect(onAlternar).toHaveBeenCalledWith("conv", true);
  });

  it("palco: 'Tirar do palco' chama onAlternar(identity, false)", () => {
    const onAlternar = vi.fn();
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={onAlternar} />);
    fireEvent.click(within(screen.getByTestId("fila-tela")).getByRole("button", { name: /^Tirar do palco$/ }));
    expect(onAlternar).toHaveBeenCalledWith("tela", false);
  });

  it("tirar da sala existe para convidados, nunca para o produtor", () => {
    const onRemover = vi.fn();
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={() => undefined} onRemover={onRemover} />);
    expect(within(screen.getByTestId("fila-prod")).queryByRole("button", { name: /da sala/ })).toBeNull();
    fireEvent.click(within(screen.getByTestId("fila-conv")).getByRole("button", { name: "Tirar Carlos Lima da sala" }));
    expect(onRemover).toHaveBeenCalledWith("conv");
  });

  it("enquanto a troca está em andamento o botão daquela pessoa fica desabilitado", () => {
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={() => undefined} ocupado="conv" />);
    expect(within(screen.getByTestId("fila-conv")).getByRole("button", { name: /Colocar no palco/ })).toBeDisabled();
    expect(within(screen.getByTestId("fila-tela")).getByRole("button", { name: /^Tirar do palco$/ })).toBeEnabled();
  });

  it("sem ninguém, mostra o convite para chamar gente", () => {
    render(<FilaBastidores pessoas={[]} onAlternar={() => undefined} />);
    expect(screen.getByText(/Convide alguém pelo link/)).toBeInTheDocument();
  });
});
