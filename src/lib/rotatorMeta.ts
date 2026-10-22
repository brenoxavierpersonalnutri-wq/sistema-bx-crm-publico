// =============================================================
// Investimento do Meta ligado a um projeto do Link Master (rotador).
//
// Cada projeto pode guardar em rotator_links.meta_config a conta de
// anúncios e quais campanhas mandam tráfego para o /r/:slug:
//   { "ad_account_id": "act_…", "campaign_ids": ["…"],
//     "campaign_name_contains": "split /r/desafio", "since": "2026-10-12" }
// Campanha entra se o id estiver na lista OU se o nome contiver o trecho
// (assim uma "— Cópia" nova da campanha entra sozinha).
//
// Os números vêm da edge function meta-ads que já está publicada
// (action "campaigns", insights por campanha no período). Nada de função
// nova: o filtro e a soma acontecem aqui no navegador.
//
// As variações dividem os mesmos anúncios, então investimento, ROAS e CPA
// são do teste inteiro, não por variação.
// =============================================================
import { metaApi, type MetaCampaign } from "@/lib/metaApi";

export interface RotatorMetaConfig {
  ad_account_id: string;
  campaign_ids?: string[];
  campaign_name_contains?: string;
  /** Primeiro dia do período (YYYY-MM-DD). Sem ele, vale o dia em que o projeto foi criado. */
  since?: string;
}

export interface RotatorMetaTotais {
  campanhas: Array<{ id: string; name: string; status: string; spend: number }>;
  spend: number;
  /** Soma do alcance de cada campanha: a mesma pessoa vista por duas campanhas conta duas vezes. */
  reach: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  /** Cliques no link ÷ impressões (cai para cliques totais se a conta não mandar link_click). */
  ctr: number;
  cpc: number;
  purchases_meta: number;
  dateFrom: string;
  dateTo: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida o JSON vindo do banco; qualquer coisa fora do formato vira null (card mostra "—"). */
export function lerMetaConfig(raw: unknown): RotatorMetaConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const conta = typeof r.ad_account_id === "string" ? r.ad_account_id.trim() : "";
  if (!/^(act_)?\d+$/.test(conta)) return null;

  const ids = Array.isArray(r.campaign_ids)
    ? r.campaign_ids.map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x))
    : [];
  const trecho = typeof r.campaign_name_contains === "string" ? r.campaign_name_contains.trim() : "";
  if (ids.length === 0 && !trecho) return null;

  const since = typeof r.since === "string" && DIA.test(r.since) ? r.since : undefined;
  return {
    ad_account_id: conta.startsWith("act_") ? conta : `act_${conta}`,
    ...(ids.length ? { campaign_ids: ids } : {}),
    ...(trecho ? { campaign_name_contains: trecho } : {}),
    ...(since ? { since } : {}),
  };
}

export function campanhaDoProjeto(c: Pick<MetaCampaign, "id" | "name">, cfg: RotatorMetaConfig): boolean {
  if (cfg.campaign_ids?.includes(String(c.id))) return true;
  const trecho = cfg.campaign_name_contains?.toLowerCase();
  return !!trecho && (c.name || "").toLowerCase().includes(trecho);
}

/** Data no fuso de São Paulo (o mesmo da conta), YYYY-MM-DD. */
export function diaSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function periodoDoProjeto(cfg: RotatorMetaConfig, criadoEm: string | undefined, agora: Date = new Date()) {
  const dateTo = diaSaoPaulo(agora);
  let dateFrom = cfg.since ?? (criadoEm ? diaSaoPaulo(new Date(criadoEm)) : dateTo);
  if (dateFrom > dateTo) dateFrom = dateTo;
  return { dateFrom, dateTo };
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const acao = (actions: Array<{ action_type: string; value: string }> | undefined, tipo: string) =>
  num(actions?.find((a) => a.action_type === tipo)?.value);

export function somarCampanhas(
  campanhas: MetaCampaign[],
  cfg: RotatorMetaConfig,
  periodo: { dateFrom: string; dateTo: string },
): RotatorMetaTotais {
  const escolhidas = campanhas.filter((c) => campanhaDoProjeto(c, cfg));
  const t: RotatorMetaTotais = {
    campanhas: [],
    spend: 0,
    reach: 0,
    impressions: 0,
    clicks: 0,
    link_clicks: 0,
    ctr: 0,
    cpc: 0,
    purchases_meta: 0,
    ...periodo,
  };
  for (const c of escolhidas) {
    const i = c.insights?.data?.[0];
    const spend = num(i?.spend);
    t.campanhas.push({ id: c.id, name: c.name, status: c.status, spend });
    if (!i) continue;
    t.spend += spend;
    t.reach += num(i.reach);
    t.impressions += num(i.impressions);
    t.clicks += num(i.clicks);
    t.link_clicks += acao(i.actions, "link_click");
    const compra = acao(i.actions, "omni_purchase") || acao(i.actions, "offsite_conversion.fb_pixel_purchase") || acao(i.actions, "purchase");
    t.purchases_meta += compra;
  }
  const cliques = t.link_clicks > 0 ? t.link_clicks : t.clicks;
  t.ctr = t.impressions > 0 ? (cliques / t.impressions) * 100 : 0;
  t.cpc = cliques > 0 ? t.spend / cliques : 0;
  return t;
}

/** ROAS = receita ÷ investimento; CPA = investimento ÷ compras. null quando não dá para calcular. */
export function roasECpa(spend: number, receita: number, compras: number) {
  return {
    roas: spend > 0 ? receita / spend : null,
    cpa: spend > 0 && compras > 0 ? spend / compras : null,
  };
}

export async function buscarMetaDoProjeto(rotator: {
  meta_config?: unknown;
  created_at?: string;
}): Promise<RotatorMetaTotais | null> {
  const cfg = lerMetaConfig(rotator.meta_config);
  if (!cfg) return null;
  const periodo = periodoDoProjeto(cfg, rotator.created_at);
  const res = await metaApi.getCampaigns(cfg.ad_account_id, periodo.dateFrom, periodo.dateTo);
  if (!res.success || !res.data) throw new Error(res.error || "Meta sem resposta");
  return somarCampanhas(res.data, cfg, periodo);
}

export const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
