// Barra de layouts do estúdio: um botão por layout, o ativo marcado, o pendente avisa em vez de trocar.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BarraLayouts, OPCOES_LAYOUT } from "@/components/lives/estudio/BarraLayouts";
import { LAYOUTS } from "@/lib/lives/layout";

describe("BarraLayouts", () => {
  it("mostra todos os layouts da cena e marca o atual", () => {
    render(<BarraLayouts valor="grade" onEscolher={() => undefined} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(OPCOES_LAYOUT.length);
    for (const l of LAYOUTS) expect(screen.getByRole("radio", { name: l.label })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grade" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "1 pessoa" })).toHaveAttribute("aria-checked", "false");
  });

  it("clicar num layout chama onEscolher com a chave", () => {
    const onEscolher = vi.fn();
    render(<BarraLayouts valor="grade" onEscolher={onEscolher} />);
    fireEvent.click(screen.getByRole("radio", { name: "Tela + pessoa" }));
    expect(onEscolher).toHaveBeenCalledWith("tela-pip");
  });

  it("os 5 layouts aparecem e todos trocam (inclusive Tela cheia, que antes era pendente)", () => {
    const onEscolher = vi.fn();
    render(<BarraLayouts valor="solo" onEscolher={onEscolher} />);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["1 pessoa", "2 lado a lado", "Grade", "Tela + pessoa", "Só tela"]);
    fireEvent.click(screen.getByRole("radio", { name: "Só tela" }));
    expect(onEscolher).toHaveBeenCalledWith("tela-cheia");
  });

  it("layout marcado como pendente (opção customizada) não troca: chama onPendente", () => {
    const onEscolher = vi.fn();
    const onPendente = vi.fn();
    render(<BarraLayouts valor="solo" onEscolher={onEscolher} onPendente={onPendente} opcoes={[{ key: "x", label: "X", pendente: "em breve" }]} />);
    fireEvent.click(screen.getByRole("radio", { name: "X" }));
    expect(onEscolher).not.toHaveBeenCalled();
    expect(onPendente).toHaveBeenCalledTimes(1);
  });

  it("a miniatura desenha os blocos do próprio calcularCena", () => {
    render(<BarraLayouts valor="grade" onEscolher={() => undefined} />);
    const grade = screen.getByRole("radio", { name: "Grade" });
    expect(grade.querySelectorAll("[data-bloco]").length).toBe(4);
    const lado = screen.getByRole("radio", { name: "2 lado a lado" });
    expect(lado.querySelectorAll("[data-bloco]").length).toBe(2);
    const pip = screen.getByRole("radio", { name: "Tela + pessoa" });
    expect(pip.querySelectorAll('[data-bloco="tela"]').length).toBe(1);
    expect(pip.querySelectorAll('[data-bloco="camera"]').length).toBe(1);
    const solo = screen.getByRole("radio", { name: "1 pessoa" });
    expect(solo.querySelectorAll('[data-bloco="camera"]').length).toBe(1);
    expect(solo.querySelectorAll('[data-bloco="tela"]').length).toBe(0);
    const cheia = screen.getByRole("radio", { name: "Só tela" });
    expect(cheia.querySelectorAll('[data-bloco="tela"]').length).toBe(1);
    expect(cheia.querySelectorAll('[data-bloco="camera"]').length).toBe(0);
  });

  it("desabilitada, nenhum botão responde", () => {
    const onEscolher = vi.fn();
    render(<BarraLayouts valor="grade" onEscolher={onEscolher} desabilitado />);
    fireEvent.click(screen.getByRole("radio", { name: "1 pessoa" }));
    expect(onEscolher).not.toHaveBeenCalled();
  });
});
