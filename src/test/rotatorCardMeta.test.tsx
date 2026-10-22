import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// O card do Link Master mostrava 0 / R$ 0,00 / 0% fixos no JSX. Agora lê as
// campanhas ligadas em rotator_links.meta_config pela edge function meta-ads
// (action "campaigns", já publicada) e a conversão do próprio rotador.

const getCampaigns = vi.fn();
vi.mock("@/lib/metaApi", () => ({ metaApi: { getCampaigns: (...a: unknown[]) => getCampaigns(...a) } }));

const rotators = [
  {
    id: "d3fbebfd-89c5-4d00-9a0f-ca0d13ec18c4",
    slug: "desafio",
    name: "Desafio Magra e Definida (5 promessas)",
    created_at: "2026-10-12T12:00:00Z",
    meta_config: {
      ad_account_id: "act_000000000000001",
      campaign_ids: ["120000000000000001", "120000000000000002"],
      since: "2026-10-12",
    },
  },
  { id: "outro", slug: "implementacao", name: "Implementação", created_at: "2026-07-13T12:00:00Z", meta_config: null },
];

vi.mock("@/lib/rotatorApi", () => ({
  rotatorApi: {
    getAll: vi.fn(async () => rotators),
    getTotalStats: vi.fn(async (id: string) => ({
      stats: [],
      totals: id === "outro" ? { conversion_rate: 0 } : { conversion_rate: 4.25 },
    })),
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// O cartão da implementação (outro banco) também entra na lista; aqui fica sem rede.
vi.mock("@/lib/implementacaoTeste", async (orig) => ({
  ...(await orig<typeof import("@/lib/implementacaoTeste")>()),
  buscarTesteImplementacao: vi.fn(async () => []),
}));

import { RotatorTab } from "@/components/pagetest/RotatorTab";

const ins = (spend: string, reach: string, impressions: string, link: string) => ({
  insights: { data: [{ spend, reach, impressions, clicks: "1", ctr: "0", cpc: "0", actions: [{ action_type: "link_click", value: link }] }] },
});

afterEach(() => { cleanup(); getCampaigns.mockReset(); });

const card = async (nome: string) => {
  const titulo = await screen.findByText(nome);
  return titulo.closest("div.group") as HTMLElement;
};

describe("card do Link Master", () => {
  it("mostra investimento, alcance e CTR das campanhas ligadas e a conversão do rotador", async () => {
    getCampaigns.mockResolvedValue({
      success: true,
      data: [
        { id: "120000000000000001", name: "[DMD] split /r/desafio", status: "ACTIVE", ...ins("139.27", "6000", "8571", "164") },
        { id: "120000000000000002", name: "[DMD] split /r/desafio — Cópia", status: "ACTIVE", ...ins("7.79", "500", "601", "8") },
        { id: "1", name: "[DMD] antiga", status: "PAUSED", ...ins("1000", "99999", "100000", "5000") },
      ],
    });
    render(<MemoryRouter><RotatorTab /></MemoryRouter>);
    const c = within(await card("Desafio Magra e Definida (5 promessas)"));
    await waitFor(() => expect(c.getByText("R$ 147,06")).toBeTruthy());
    expect(c.getByText("6.500")).toBeTruthy();
    expect(c.getByText("1,88%")).toBeTruthy(); // 172 ÷ 9172
    expect(c.getByText("4,3%")).toBeTruthy();
    expect(getCampaigns).toHaveBeenCalledTimes(1);
    expect(getCampaigns.mock.calls[0][0]).toBe("act_000000000000001");
  });

  it("projeto sem campanha ligada mostra traço, não zero falso", async () => {
    getCampaigns.mockResolvedValue({ success: true, data: [] });
    render(<MemoryRouter><RotatorTab /></MemoryRouter>);
    const el = await card("Implementação");
    await waitFor(() => expect(el.querySelector('[data-metric="conversao"]')?.textContent).toBe("0,0%"));
    expect(el.querySelector('[data-metric="investimento"]')?.textContent).toBe("—");
    expect(el.querySelector('[data-metric="alcance"]')?.textContent).toBe("—");
    expect(el.querySelector('[data-metric="ctr"]')?.textContent).toBe("—");
  });

  it("erro do Meta aparece como erro", async () => {
    getCampaigns.mockResolvedValue({ success: false, error: "Rate limit - aguarde alguns minutos" });
    render(<MemoryRouter><RotatorTab /></MemoryRouter>);
    const el = await card("Desafio Magra e Definida (5 promessas)");
    await waitFor(() => expect(el.querySelector('[data-metric="investimento"]')?.textContent).toBe("erro"));
  });
});
