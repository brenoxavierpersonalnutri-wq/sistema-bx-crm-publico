// Chave "Robô de IA ligado" por número (tela Agente IA). Bug de 19/10/2026: a confirmação era window.confirm e,
// com o diálogo nativo suprimido pelo Chrome, devolvia false sem abrir nada — o switch não mudava e nenhuma
// requisição saía. Agora a confirmação é um AlertDialog da própria página.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const FIT2 = "22222222-2222-2222-2222-222222222222";
const numeros = [
  { id: "11111111-1111-1111-1111-111111111111", apelido: "Closer", chave: "closer", tipo: "openwa", ativo: true, robo_ia_ligado: false },
  { id: FIT2, apelido: "Comercial Fit 2", chave: "comercial-fit-2", tipo: "openwa", ativo: true, robo_ia_ligado: false },
  { id: "33333333-3333-3333-3333-333333333333", apelido: "Oficial", chave: "oficial", tipo: "oficial", ativo: true, robo_ia_ligado: false },
];
const updates: { valores: unknown; filtro: [string, unknown] | null }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    let pendente: { valores: unknown; filtro: [string, unknown] | null } | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in", "not", "or", "is", "gte"]) q[m] = () => q;
    q.update = (valores: unknown) => { pendente = { valores, filtro: null }; return q; };
    q.eq = (col: string, val: unknown) => {
      if (pendente) {
        pendente.filtro = [col, val];
        updates.push(pendente);
        const alvo = numeros.find((n) => n.id === val);
        if (alvo) Object.assign(alvo, pendente.valores as object);
      }
      return q;
    };
    q.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: tabela === "crm_numeros" && !pendente ? numeros.map((n) => ({ ...n })) : [], error: null, count: 0 }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, rpc: vi.fn(), functions: { invoke: vi.fn() } } };
});

const { EstadoRoboIA } = await import("@/components/crm/ia/EstadoRoboIA");

describe("EstadoRoboIA: ligar o robô por número", () => {
  beforeEach(() => {
    updates.length = 0;
    for (const n of numeros) n.robo_ia_ligado = false;
  });

  it("não depende de window.confirm: abre o diálogo da página e só grava ao confirmar", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false); // Chrome com diálogo suprimido
    render(<EstadoRoboIA />);
    const chave = await screen.findByRole("switch", { name: "Robô de IA ligado no Comercial Fit 2" });
    expect(screen.getByText(/desligado em todos os números/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Oficial/ })).toBeNull();

    fireEvent.click(chave);
    expect(await screen.findByTestId("confirmar-ligar-robo")).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Ligar robô" }));
    await waitFor(() => expect(updates).toEqual([{ valores: { robo_ia_ligado: true }, filtro: ["id", FIT2] }]));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Robô de IA ligado no Comercial Fit 2" }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(screen.getByText("Robô de IA ligado em Comercial Fit 2")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Robô de IA ligado no Closer" }).getAttribute("aria-checked")).toBe("false");
    confirmSpy.mockRestore();
  });

  it("Cancelar não grava nada", async () => {
    render(<EstadoRoboIA />);
    fireEvent.click(await screen.findByRole("switch", { name: "Robô de IA ligado no Comercial Fit 2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByTestId("confirmar-ligar-robo")).toBeNull());
    expect(updates).toHaveLength(0);
    expect(screen.getByRole("switch", { name: "Robô de IA ligado no Comercial Fit 2" }).getAttribute("aria-checked")).toBe("false");
  });

  it("desligar não pede confirmação", async () => {
    numeros[1].robo_ia_ligado = true;
    render(<EstadoRoboIA />);
    const chave = await screen.findByRole("switch", { name: "Robô de IA ligado no Comercial Fit 2" });
    expect(chave.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chave);
    await waitFor(() => expect(updates).toEqual([{ valores: { robo_ia_ligado: false }, filtro: ["id", FIT2] }]));
    expect(screen.queryByTestId("confirmar-ligar-robo")).toBeNull();
  });
});
