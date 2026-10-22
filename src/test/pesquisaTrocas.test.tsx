import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const linhas = [
  {
    id: "1", criado_em: new Date().toISOString(), nota: 10,
    nao_achou: "trento", sugestao: null, modo: "alimento",
    alimentos: ["Arroz branco cozido 120g"], trocas: ["Batata inglesa cozida 280g"],
  },
  {
    id: "2", criado_em: new Date().toISOString(), nota: 6,
    nao_achou: "trento", sugestao: "queria ver a fibra", modo: "refeicao",
    alimentos: ["Arroz branco cozido 80g", "Feijão cozido 130g"], trocas: ["Batata doce cozida 200g"],
  },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: linhas, error: null }) }) }),
    }),
  },
}));

const { default: PesquisaTrocas } = await import("@/pages/PesquisaTrocas");

describe("painel da pesquisa de trocas", () => {
  it("mostra a média, o NPS e o que faltou na base", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PesquisaTrocas />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // espera a consulta chegar
    await waitFor(() => expect(document.body.textContent).toContain("queria ver a fibra"));
    // uma promotora (10) e uma detratora (6): NPS zero
    expect(document.body.textContent).toContain("promotoras");
    expect(document.body.textContent).toContain("detratoras");
    // o pedido repetido aparece agrupado
    const texto = document.body.textContent ?? "";
    // média de 10 e 6 = 8
    expect(texto).toContain("Nota média8");
    expect(texto).toContain("2×");
    expect(texto).toContain("trento");
    // a sugestão escrita aparece na lista
    expect(texto).toContain("queria ver a fibra");
    // e o alimento mais trocado, sem a gramagem
    expect(texto).toContain("Arroz branco cozido");
  });
});
