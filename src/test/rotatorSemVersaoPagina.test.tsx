import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Página do teste /r/desafio: cards Conversões/Receita e ROAS/CPA do bloco do
// Meta passam a incluir as vendas sem versão; a tabela por variação não muda.

const ROTADOR = "d3fbebfd-89c5-4d00-9a0f-ca0d13ec18c4";
const getCampaigns = vi.fn();
vi.mock("@/lib/metaApi", () => ({ metaApi: { getCampaigns: (...a: unknown[]) => getCampaigns(...a) } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

const rotador = {
  id: ROTADOR,
  slug: "desafio",
  name: "Desafio Magra e Definida",
  created_at: "2026-10-12T12:00:00Z",
  meta_config: { ad_account_id: "act_000000000000001", campaign_ids: ["120000000000000001"], since: "2026-10-12" },
};
const linhaV3 = {
  destination_id: "d3", label: "v3", url: "https://equipe.brenoxavier.com.br/desafio/v3", weight: 10,
  clicks: 400, checkouts: 12, purchases: 1, revenue: 17, avg_ticket: 17, conversion_rate: 0.25, checkout_rate: 3,
};
const vendas = [
  { id: "s1", rotator_link_id: ROTADOR, order_id: "13372733", value: 17, sold_at: "2026-10-13T13:51:07Z", source: "pagtrust-manual", note: null, atribuida: false },
  { id: "s2", rotator_link_id: ROTADOR, order_id: "pagtrust-20261012-223527", value: 36.98, sold_at: "2026-10-13T01:35:27Z", source: "pagtrust-manual", note: null, atribuida: false },
  { id: "s3", rotator_link_id: ROTADOR, order_id: "13373083", value: 17, sold_at: "2026-10-13T15:25:00Z", source: "manual-painel", note: null, atribuida: true },
];
const addVendaSemVersao = vi.fn(async () => undefined);

vi.mock("@/lib/rotatorApi", () => ({
  rotatorApi: {
    getAll: vi.fn(async () => [rotador]),
    getDestinations: vi.fn(async () => []),
    getPageMetrics: vi.fn(async () => []),
    getVendasSemVersao: vi.fn(async () => vendas),
    addVendaSemVersao: (...a: unknown[]) => addVendaSemVersao(...(a as [])),
    removeVendaSemVersao: vi.fn(async () => undefined),
    getRedirectUrl: (s: string) => `https://equipe.brenoxavier.com.br/r/${s}`,
    getTrackingPixelSnippet: () => "",
    getTotalStats: vi.fn(async () => ({
      stats: [linhaV3],
      totals: {
        clicks: 400, checkouts: 12, checkout_rate: 3,
        purchases: 9, revenue: 172.98, avg_ticket: 19.22, conversion_rate: 2.25,
        purchases_atribuidas: 1, revenue_atribuida: 17,
        sem_versao: { purchases: 8, revenue: 155.98, ignoradas: 0 },
      },
    })),
  },
}));

import Rotator from "@/pages/Rotator";

afterEach(() => { cleanup(); getCampaigns.mockReset(); addVendaSemVersao.mockClear(); });

const abrir = () =>
  render(
    <MemoryRouter initialEntries={[`/rotator?id=${ROTADOR}`]}>
      <Rotator />
    </MemoryRouter>,
  );

describe("página do teste com vendas sem versão", () => {
  it("cards e ROAS/CPA usam o total; linha da v3 continua 1 compra / R$ 17", async () => {
    getCampaigns.mockResolvedValue({
      success: true,
      data: [{
        id: "120000000000000001", name: "[DMD] split /r/desafio", status: "ACTIVE",
        insights: { data: [{ spend: "150.00", reach: "6000", impressions: "8000", clicks: "200", ctr: "0", cpc: "0", actions: [{ action_type: "link_click", value: "160" }] }] },
      }],
    });
    const { container } = abrir();
    await waitFor(() => expect(container.querySelector('[data-kpi="Conversões"]')?.textContent).toContain("9"));
    expect(container.querySelector('[data-kpi="Receita"]')?.textContent).toBe("R$ 172,98");
    expect(container.querySelector('[data-kpi-hint="Conversões"]')?.textContent).toBe("inclui 8 vendas sem versão");
    expect(container.querySelector('[data-kpi-hint="Receita"]')?.textContent).toBe("inclui R$ 155,98 sem versão");

    await waitFor(() => expect(container.querySelector('[data-metric="ROAS"]')?.textContent).toBe("1,15x")); // 172,98 ÷ 150
    expect(container.querySelector('[data-metric="CPA"]')?.textContent).toBe("R$ 16,67"); // 150 ÷ 9

    const linha = screen.getByText("v3").closest("tr") as HTMLElement;
    expect(within(linha).getByText("R$ 17,00")).toBeTruthy();
  });

  it("aba Configurar lista as vendas sem versão e adiciona uma nova", async () => {
    getCampaigns.mockResolvedValue({ success: true, data: [] });
    const { container } = abrir();
    await screen.findByText("Desafio Magra e Definida");
    // Radix Tabs troca de aba no mousedown
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Configurar/ }), { button: 0 });
    const bloco = await waitFor(() => {
      const el = container.querySelector('[data-bloco="sem-versao"]') as HTMLElement | null;
      if (!el || !el.querySelector('[data-venda-sem-versao="13372733"]')) throw new Error("bloco ainda não carregou");
      return el;
    });
    const b = within(bloco);
    expect(b.getByText("R$ 36,98")).toBeTruthy();
    expect(b.getByText("já está numa variação (não soma)")).toBeTruthy();
    expect(b.getAllByText("soma no total")).toHaveLength(2);

    fireEvent.change(b.getByPlaceholderText(/Código do pedido/), { target: { value: " 13380000 " } });
    fireEvent.change(b.getByPlaceholderText(/Valor/), { target: { value: "17,00" } });
    fireEvent.change(bloco.querySelector('input[type="datetime-local"]') as HTMLInputElement, { target: { value: "2026-10-13T16:00:00" } });
    fireEvent.click(b.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(addVendaSemVersao).toHaveBeenCalledTimes(1));
    const [id, venda] = addVendaSemVersao.mock.calls[0] as unknown as [string, { order_id: string; value: number; sold_at: string }];
    expect(id).toBe(ROTADOR);
    expect(venda.order_id).toBe("13380000");
    expect(venda.value).toBe(17);
    expect(new Date(venda.sold_at).getTime()).toBe(new Date("2026-10-13T16:00:00").getTime());
  });
});
