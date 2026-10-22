// =============================================================
// Resultados por variação do rotador (aba Resultados do Teste A/B).
//
//  - Visitas: cliques no /r/:slug que caíram na variação.
//  - Checkouts: cliques distintos com ao menos um evento 'checkout' (quem
//    clica três vezes no botão conta uma vez).
//  - Compras: cliques distintos com ao menos um 'purchase' (pixel manual ou
//    webhook da PagTrust com o marcador). Order bump que chega como pedido
//    separado soma na receita, mas não vira segunda compra.
//  - Receita: soma dos 'purchase', um por order_id (linha sem order_id conta
//    sozinha, como antes).
//  - Conversão = compras ÷ visitas. Checkout rate = checkouts ÷ visitas.
//  - Regra de conversão por URL (url_contains/url_equals) continua igual:
//    compra = clique com pageview casando a regra, sem receita.
// =============================================================
import type { ConversionRule, RotatorStats } from "@/lib/rotatorApi";

export type EventoDoRotador = {
  destination_id: string;
  click_id: string;
  event_type: string;
  value: number | string | null;
  page_url: string | null;
  order_id?: string | null;
};

export function casaRegra(pageUrl: string | null, rule: ConversionRule | null | undefined): boolean {
  if (!rule || rule.type === "pixel") return false;
  if (!pageUrl) return false;
  const needle = (rule.value || "").trim().toLowerCase();
  if (!needle) return false;
  const hay = pageUrl.toLowerCase();
  if (rule.type === "url_contains") return hay.includes(needle);
  if (rule.type === "url_equals") {
    try {
      const u = new URL(pageUrl);
      return (u.origin + u.pathname).toLowerCase() === needle;
    } catch {
      return hay === needle;
    }
  }
  return false;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function calcularResultadosPorVariacao(
  destinos: Array<{ id: string; label: string; url: string; weight: number }>,
  cliquesPorDestino: Record<string, number>,
  eventos: EventoDoRotador[],
  rule: ConversionRule | null | undefined,
): RotatorStats[] {
  const usarRegraDeUrl = !!rule && rule.type !== "pixel";

  return destinos.map((d) => {
    const clicks = Math.max(0, cliquesPorDestino[d.id] ?? 0);
    const ev = eventos.filter((e) => e.destination_id === d.id);

    const checkouts = new Set(ev.filter((e) => e.event_type === "checkout").map((e) => e.click_id)).size;

    let purchases: number;
    let revenue = 0;
    if (usarRegraDeUrl) {
      purchases = new Set(ev.filter((e) => e.event_type === "pageview" && casaRegra(e.page_url, rule)).map((e) => e.click_id)).size;
    } else {
      const compras = ev.filter((e) => e.event_type === "purchase");
      purchases = new Set(compras.map((e) => e.click_id)).size;
      const pedidos = new Set<string>();
      for (const c of compras) {
        if (c.order_id) {
          if (pedidos.has(c.order_id)) continue;
          pedidos.add(c.order_id);
        }
        revenue += numero(c.value);
      }
    }

    return {
      destination_id: d.id,
      label: d.label,
      url: d.url,
      weight: d.weight,
      clicks,
      checkouts,
      purchases,
      revenue,
      avg_ticket: purchases > 0 ? revenue / purchases : 0,
      conversion_rate: clicks > 0 ? (purchases / clicks) * 100 : 0,
      checkout_rate: clicks > 0 ? (checkouts / clicks) * 100 : 0,
    };
  });
}

/**
 * Variação vencedora até aqui: maior conversão (compras ÷ visitas); empate
 * vai para a de maior receita por visita. Sem nenhuma compra, null.
 */
export function melhorVariacao(stats: RotatorStats[]): string | null {
  let melhor: RotatorStats | null = null;
  for (const s of stats) {
    if (s.purchases <= 0) continue;
    if (!melhor) { melhor = s; continue; }
    const rpv = (x: RotatorStats) => (x.clicks > 0 ? x.revenue / x.clicks : 0);
    if (s.conversion_rate > melhor.conversion_rate || (s.conversion_rate === melhor.conversion_rate && rpv(s) > rpv(melhor))) {
      melhor = s;
    }
  }
  return melhor?.destination_id ?? null;
}

export function totaisDosResultados(stats: RotatorStats[]) {
  const clicks = stats.reduce((s, d) => s + d.clicks, 0);
  const checkouts = stats.reduce((s, d) => s + d.checkouts, 0);
  const purchases = stats.reduce((s, d) => s + d.purchases, 0);
  const revenue = stats.reduce((s, d) => s + d.revenue, 0);
  return {
    clicks,
    checkouts,
    purchases,
    revenue,
    avg_ticket: purchases > 0 ? revenue / purchases : 0,
    conversion_rate: clicks > 0 ? (purchases / clicks) * 100 : 0,
    checkout_rate: clicks > 0 ? (checkouts / clicks) * 100 : 0,
  };
}
