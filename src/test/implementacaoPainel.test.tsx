import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Cartão "Implementação (BG)" na lista do Link Master e a tela de leitura,
// com o fetch da RPC do outro banco simulado (nenhuma chamada de rede).

vi.mock("@/lib/rotatorApi", () => ({
  rotatorApi: { getAll: vi.fn(async () => []), getTotalStats: vi.fn(async () => ({ stats: [], totals: { conversion_rate: 0 } })) },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

import { RotatorTab } from "@/components/pagetest/RotatorTab";
import TesteImplementacao from "@/pages/TesteImplementacao";

const RPC = [
  { versao: "v1", pagina: "/v1", peso: 20, ordem: 1, visitas: 10, leads: 4, qualificados: 2, agendamentos: 1 },
  { versao: "v2", pagina: "/v2", peso: 20, ordem: 2, visitas: 4, leads: 1, qualificados: 1, agendamentos: 1 },
  { versao: "v3", pagina: "/implementacao/v3/", peso: 20, ordem: 3, visitas: 2, leads: 0, qualificados: 0, agendamentos: 0 },
  { versao: "v4", pagina: "/", peso: 20, ordem: 4, visitas: 0, leads: 0, qualificados: 0, agendamentos: 0 },
  { versao: "v5", pagina: "/v5", peso: 20, ordem: 5, visitas: 1, leads: 0, qualificados: 0, agendamentos: 0 },
];

const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...a: unknown[]) => fetchMock(...a));
const ok = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo });

afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe("cartão Implementação (BG) no Link Master", () => {
  it("aparece na lista mesmo sem projetos do equipe e mostra os totais", async () => {
    fetchMock.mockResolvedValue(ok(RPC));
    const { container } = render(<MemoryRouter><RotatorTab /></MemoryRouter>);
    await screen.findByText("Implementação (BG)");
    const card = container.querySelector('[data-card="implementacao"]') as HTMLElement;
    await waitFor(() => expect(card.querySelector('[data-metric="visitas"]')?.textContent).toBe("17"));
    expect(card.querySelector('[data-metric="leads"]')?.textContent).toBe("5 (29,4%)");
    expect(card.querySelector('[data-metric="qualificados"]')?.textContent).toBe("3 (17,6%)");
    expect(card.querySelector('[data-metric="agendamentos"]')?.textContent).toBe("2 (11,8%)");
    expect(String(fetchMock.mock.calls[0][0])).toContain("SEU_PROJECT_REF_3.supabase.co/rest/v1/rpc/implementacao_teste_publico");
  });

  it("sem o SQL no banco, o cartão diz o que falta em vez de zero", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: "PGRST202" }) });
    const { container } = render(<MemoryRouter><RotatorTab /></MemoryRouter>);
    await screen.findByText("Implementação (BG)");
    const card = container.querySelector('[data-card="implementacao"]') as HTMLElement;
    await waitFor(() => expect(card.querySelector('[data-metric="visitas"]')?.textContent).toBe("erro"));
    expect(within(card).getByText(/falta rodar o SQL/)).toBeTruthy();
  });
});

describe("tela /teste/implementacao", () => {
  it("lista as 5 versões, destaca a melhor e troca o período", async () => {
    fetchMock.mockResolvedValue(ok(RPC));
    const { container } = render(<MemoryRouter><TesteImplementacao /></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll("tr[data-versao]").length).toBe(5));
    const melhor = container.querySelector('tr[data-melhor="sim"]') as HTMLElement;
    expect(melhor.getAttribute("data-versao")).toBe("v2");
    expect(container.querySelector('[data-kpi="Agendamentos"]')?.textContent).toBe("2(11,8%)");
    const v1 = container.querySelector('tr[data-versao="v1"]') as HTMLElement;
    expect(within(v1).getByText("10")).toBeTruthy();
    expect(within(v1).getByText("40,0%")).toBeTruthy(); // 4 leads ÷ 10 visitas
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ p_slug: "implementacao", p_desde: null, p_ate: null });

    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 dias" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const corpo = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(corpo.p_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(corpo.p_ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sem o SQL no banco, mostra o aviso e o link do painel da implementação", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: "PGRST202" }) });
    const { container } = render(<MemoryRouter><TesteImplementacao /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('[data-estado="falta-sql"]')).toBeTruthy());
  });
});
