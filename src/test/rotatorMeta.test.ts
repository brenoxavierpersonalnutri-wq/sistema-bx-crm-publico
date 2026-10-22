import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MetaCampaign } from "@/lib/metaApi";

const getCampaigns = vi.fn();
vi.mock("@/lib/metaApi", () => ({ metaApi: { getCampaigns: (...a: unknown[]) => getCampaigns(...a) } }));

import {
  buscarMetaDoProjeto,
  campanhaDoProjeto,
  lerMetaConfig,
  periodoDoProjeto,
  roasECpa,
  somarCampanhas,
} from "@/lib/rotatorMeta";

// Formato real da action "campaigns" da edge function meta-ads.
const campanha = (id: string, name: string, ins: Record<string, unknown> | null, status = "ACTIVE") =>
  ({ id, name, status, objective: "OUTCOME_SALES", ...(ins ? { insights: { data: [ins] } } : {}) }) as unknown as MetaCampaign;

const camps = [
  campanha("120000000000000001", "[DMD] Reativação top10 - split /r/desafio - 12/10", {
    impressions: "8571", clicks: "256", spend: "139.27", reach: "6000", ctr: "2.98", cpc: "0.54", frequency: "1.4",
    actions: [
      { action_type: "link_click", value: "164" },
      { action_type: "omni_purchase", value: "6" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "6" },
    ],
  }),
  campanha("120000000000000002", "[DMD] Reativação top10 - split /r/desafio - 12/10 — Cópia", {
    impressions: "601", clicks: "14", spend: "7.79", reach: "500", ctr: "2.3", cpc: "0.55", frequency: "1.2",
    actions: [
      { action_type: "link_click", value: "8" },
      { action_type: "omni_purchase", value: "1" },
    ],
  }),
  campanha("120249026792260262", "[DMD] [02] 10-07-26 - R$27.98", null, "PAUSED"),
  campanha("999", "[OUTRO] campanha que não é do teste", { impressions: "1000", clicks: "50", spend: "500", reach: "900" }),
];

const cfgDesafio = {
  ad_account_id: "act_000000000000001",
  campaign_ids: ["120000000000000001", "120000000000000002"],
  campaign_name_contains: "split /r/desafio",
  since: "2026-10-12",
};

describe("lerMetaConfig", () => {
  it("aceita a config do desafio e normaliza a conta", () => {
    expect(lerMetaConfig({ ...cfgDesafio, ad_account_id: "000000000000001" })).toEqual(cfgDesafio);
  });
  it("recusa o que não dá para usar", () => {
    expect(lerMetaConfig(null)).toBeNull();
    expect(lerMetaConfig({})).toBeNull();
    expect(lerMetaConfig({ ad_account_id: "act_1" })).toBeNull(); // sem campanha nem trecho
    expect(lerMetaConfig({ ad_account_id: "conta x", campaign_ids: ["1"] })).toBeNull();
  });
  it("descarta id torto e data torta sem derrubar o resto", () => {
    expect(lerMetaConfig({ ad_account_id: "act_1", campaign_ids: ["12", "abc", ""], since: "12/10/2026" })).toEqual({
      ad_account_id: "act_1",
      campaign_ids: ["12"],
    });
  });
});

describe("campanhaDoProjeto", () => {
  it("casa por id ou por trecho do nome (ignora caixa)", () => {
    expect(campanhaDoProjeto({ id: "120000000000000001", name: "x" }, { ad_account_id: "act_1", campaign_ids: ["120000000000000001"] })).toBe(true);
    expect(campanhaDoProjeto({ id: "1", name: "[DMD] SPLIT /R/DESAFIO — Cópia 2" }, { ad_account_id: "act_1", campaign_name_contains: "split /r/desafio" })).toBe(true);
    expect(campanhaDoProjeto({ id: "1", name: "[DMD] antiga" }, cfgDesafio)).toBe(false);
  });
});

describe("periodoDoProjeto", () => {
  const agora = new Date("2026-10-13T15:00:00Z");
  it("usa o since e vai até hoje (São Paulo)", () => {
    expect(periodoDoProjeto(cfgDesafio, undefined, agora)).toEqual({ dateFrom: "2026-10-12", dateTo: "2026-10-13" });
  });
  it("sem since, começa no dia de criação do projeto no fuso de SP", () => {
    // 02:00Z do dia 12 ainda é dia 11 em São Paulo
    expect(periodoDoProjeto({ ad_account_id: "act_1", campaign_ids: ["1"] }, "2026-10-12T02:00:00Z", agora).dateFrom).toBe("2026-10-11");
  });
  it("nunca começa depois de hoje", () => {
    expect(periodoDoProjeto({ ...cfgDesafio, since: "2026-12-01" }, undefined, agora)).toEqual({ dateFrom: "2026-10-13", dateTo: "2026-10-13" });
  });
});

describe("somarCampanhas", () => {
  const t = somarCampanhas(camps, cfgDesafio, { dateFrom: "2026-10-12", dateTo: "2026-10-13" });
  it("soma só as campanhas do teste", () => {
    expect(t.campanhas.map((c) => c.id)).toEqual(["120000000000000001", "120000000000000002"]);
    expect(t.spend).toBeCloseTo(147.06, 2);
    expect(t.reach).toBe(6500);
    expect(t.impressions).toBe(9172);
    expect(t.link_clicks).toBe(172);
    expect(t.purchases_meta).toBe(7);
  });
  it("CTR e CPC pelos cliques no link", () => {
    expect(t.ctr).toBeCloseTo((172 / 9172) * 100, 6);
    expect(t.cpc).toBeCloseTo(147.06 / 172, 6);
  });
  it("sem link_click cai para cliques totais; sem campanha fica tudo zero", () => {
    const s = somarCampanhas([camps[3]], { ad_account_id: "act_1", campaign_ids: ["999"] }, { dateFrom: "a", dateTo: "b" });
    expect(s.ctr).toBeCloseTo(5, 6);
    const z = somarCampanhas(camps, { ad_account_id: "act_1", campaign_ids: ["nada"] }, { dateFrom: "a", dateTo: "b" });
    expect(z).toMatchObject({ spend: 0, reach: 0, ctr: 0, cpc: 0, campanhas: [] });
  });
});

describe("roasECpa", () => {
  it("calcula e devolve null quando não dá", () => {
    expect(roasECpa(100, 250, 5)).toEqual({ roas: 2.5, cpa: 20 });
    expect(roasECpa(0, 250, 5)).toEqual({ roas: null, cpa: null });
    expect(roasECpa(100, 0, 0)).toEqual({ roas: 0, cpa: null });
  });
});

describe("buscarMetaDoProjeto", () => {
  beforeEach(() => getCampaigns.mockReset());
  it("sem config não chama o Meta", async () => {
    expect(await buscarMetaDoProjeto({ meta_config: null })).toBeNull();
    expect(getCampaigns).not.toHaveBeenCalled();
  });
  it("chama a action campaigns da conta ligada, no período do projeto", async () => {
    getCampaigns.mockResolvedValue({ success: true, data: camps });
    const t = await buscarMetaDoProjeto({ meta_config: cfgDesafio, created_at: "2026-10-12T12:00:00Z" });
    expect(getCampaigns).toHaveBeenCalledWith("act_000000000000001", "2026-10-12", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(t?.spend).toBeCloseTo(147.06, 2);
  });
  it("erro do Meta vira exceção (o card mostra 'erro', não zero)", async () => {
    getCampaigns.mockResolvedValue({ success: false, error: "Rate limit - aguarde alguns minutos" });
    await expect(buscarMetaDoProjeto({ meta_config: cfgDesafio })).rejects.toThrow(/Rate limit/);
  });
});
