import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Aba Resultados: URL da variação é link (nova aba) e, com a otimização
// ligada, aparece a coluna com peso, probabilidade de ser a melhor e status.

const ROTADOR = "r-otim";
vi.mock("@/lib/metaApi", () => ({ metaApi: { getCampaigns: vi.fn(async () => ({ success: true, data: [] })) } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

const base = { id: ROTADOR, slug: "desafio", name: "Desafio", created_at: "2026-10-12T12:00:00Z" };
let rotador: Record<string, unknown> = {};
const updateOtimizacao = vi.fn(async () => undefined);
const linha = {
  destination_id: "d1", label: "v1", url: "https://equipe.brenoxavier.com.br/desafio/v1?x=1", weight: 9000,
  clicks: 1000, checkouts: 80, purchases: 60, revenue: 1020, avg_ticket: 17, conversion_rate: 6, checkout_rate: 8,
};

vi.mock("@/lib/rotatorApi", () => ({
  rotatorApi: {
    getAll: vi.fn(async () => [rotador]),
    getOne: vi.fn(async () => ({ ...rotador, otim_ativa: true })),
    getDestinations: vi.fn(async () => [{
      id: "d1", rotator_id: ROTADOR, url: linha.url, label: "v1", weight: 9000, created_at: "", peso_manual: 20,
      otim_peso: "0.9", otim_prob_melhor: "0.991", otim_status: "campeã com 99%",
    }]),
    getPageMetrics: vi.fn(async () => []),
    getVendasSemVersao: vi.fn(async () => []),
    updateOtimizacao: (...a: unknown[]) => updateOtimizacao(...(a as [])),
    recalcularOtimizacao: vi.fn(async () => ({})),
    getRedirectUrl: (s: string) => `https://equipe.brenoxavier.com.br/r/${s}`,
    getTrackingPixelSnippet: () => "",
    getTotalStats: vi.fn(async () => ({
      stats: [linha],
      totals: { clicks: 1000, checkouts: 80, checkout_rate: 8, purchases: 60, revenue: 1020, avg_ticket: 17, conversion_rate: 6,
        purchases_atribuidas: 60, revenue_atribuida: 1020, sem_versao: { purchases: 0, revenue: 0, ignoradas: 0 } },
    })),
  },
}));

import Rotator from "@/pages/Rotator";

afterEach(() => { cleanup(); updateOtimizacao.mockClear(); });

const abrir = () =>
  render(
    <MemoryRouter initialEntries={[`/rotator?id=${ROTADOR}`]}>
      <Rotator />
    </MemoryRouter>,
  );

describe("aba Resultados com otimização", () => {
  it("URL da variação abre em nova aba", async () => {
    rotador = { ...base, otim_ativa: false, otim_min_visitas: 100, otim_min_compras: 10, otim_piso: 0.05, otim_teto: 0.8 };
    const { container } = abrir();
    await waitFor(() => expect(container.querySelector(`a[href="${linha.url}"]`)).not.toBeNull());
    const a = container.querySelector(`a[href="${linha.url}"]`)!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector('[data-testid="otim-celula"]')).toBeNull();
  });

  it("ligada: coluna com peso, prob. e status; o interruptor grava os parâmetros", async () => {
    rotador = { ...base, otim_ativa: true, otim_fase: "campea", otim_min_visitas: 100, otim_min_compras: 10, otim_piso: "0.05", otim_teto: "0.80" };
    const { container } = abrir();
    await waitFor(() => expect(container.querySelector('[data-testid="otim-celula"]')?.textContent).toContain("90,0%"));
    const cel = container.querySelector('[data-testid="otim-celula"]')!.textContent!;
    expect(cel).toContain("melhor: 99,1%");
    expect(cel).toContain("campeã com 99%");

    fireEvent.click(screen.getByRole("switch", { name: "Otimização automática" }));
    await waitFor(() => expect(updateOtimizacao).toHaveBeenCalledWith(ROTADOR, {
      otim_ativa: false, otim_min_visitas: 100, otim_min_compras: 10, otim_piso: 0.05, otim_teto: 0.8,
    }));
  });

  it("sem a migration: avisa e não quebra", async () => {
    rotador = { ...base };
    abrir();
    await waitFor(() => expect(screen.getByText(/falta rodar a migration 20261016180000/)).toBeTruthy());
  });
});
