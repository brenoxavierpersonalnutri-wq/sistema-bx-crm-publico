import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Consultation } from "@/types/consultation";

// Os cards fazem duas consultas extras ao banco (agendamentos do dia e
// qualificadas sem agendar); aqui só interessa a cor, então o banco devolve vazio.
vi.mock("@/integrations/supabase/client", () => {
  const vazio = { data: [], count: 0, error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "gte", "lte", "not", "neq", "eq"]) q[m] = () => q;
  q.then = (r: (v: typeof vazio) => unknown) => Promise.resolve(vazio).then(r);
  return { supabase: { from: () => q } };
});
vi.mock("@/hooks/usePrivacy", () => ({ usePrivacy: () => ({ formatMoney: (v: number) => `R$ ${v}` }) }));

import { StatsCards } from "@/components/StatsCards";

let seq = 0;
const consulta = (extra: Partial<Consultation> = {}): Consultation =>
  ({ id: `c${++seq}`, clientName: "T", clientPhone: "", date: "2026-10-14", status: "agendado", ...extra }) as Consultation;

function renderCards(lista: Consultation[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <StatsCards consultations={lista} hasDateFilter />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const card = (label: string) => document.querySelector(`[data-card="${label}"]`) as HTMLElement;

describe("cor nos cards de Vendas", () => {
  it("Feitas 11% das agendadas → vermelho; Confirmadas 21% do total → laranja (o caso do print)", () => {
    // 100 consultas: 21 confirmadas, 11 feitas, nenhuma desqualificada.
    const lista = Array.from({ length: 100 }, (_, i) =>
      consulta({ callConfirmed: i < 21 ? true : undefined, attended: i < 11 ? true : undefined }),
    );
    renderCards(lista);
    const feitas = within(card("Consultas Feitas")).getByText("11% das agendadas");
    expect(feitas).toHaveAttribute("data-sinal", "vermelho");
    // O 52% "das confirmadas" continua neutro: a regra é sobre as agendadas.
    expect(within(card("Consultas Feitas")).getByText("52%").getAttribute("data-sinal")).toBeNull();
    const conf = within(card("Call Confirmadas")).getByText("21%");
    expect(conf).toHaveAttribute("data-sinal", "laranja");
    expect(card("Call Confirmadas").className).toContain("border-orange-500/40");
    // Card sem regra continua sem borda.
    expect(card("Convertidas").className).toContain("border-none");
  });

  it("Feitas 30% → ouro; Confirmadas 65% → ouro", () => {
    const lista = Array.from({ length: 20 }, (_, i) =>
      consulta({ callConfirmed: i < 13 ? true : undefined, attended: i < 6 ? true : undefined }),
    );
    renderCards(lista);
    expect(within(card("Consultas Feitas")).getByText("30% das agendadas")).toHaveAttribute("data-sinal", "ouro");
    expect(within(card("Call Confirmadas")).getByText("65%")).toHaveAttribute("data-sinal", "ouro");
    expect(screen.getByText("Consultas Feitas")).toBeInTheDocument();
  });

  it("referência da meta escrita embaixo da pílula, só nos dois cards com cor", () => {
    renderCards(Array.from({ length: 10 }, () => consulta()));
    expect(within(card("Consultas Feitas")).getByText("Meta: 20 a 25%")).toBeInTheDocument();
    expect(within(card("Consultas Feitas")).getByText("Ouro: > 25%")).toBeInTheDocument();
    expect(within(card("Call Confirmadas")).getByText("Meta: 40 a 60%")).toBeInTheDocument();
    expect(within(card("Call Confirmadas")).getByText("Ouro: > 60%")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-referencia]")).toHaveLength(2);
    expect(card("Consultas no Período").querySelector("[data-referencia]")).toBeNull();
  });
});
