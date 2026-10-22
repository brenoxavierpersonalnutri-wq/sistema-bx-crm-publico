// =============================================================
// Métricas por variação do rotador, a partir do beacon das páginas
// (tabela page_beacons, lida pela view rotator_page_beacons).
//
//  - Taxa de conexão = cliques cujo cm_click chegou a mandar 'view' na
//    variação ÷ cliques do rotador naquela variação. Cada clique conta uma
//    vez, mesmo que a pessoa recarregue a página.
//  - Velocidade: mediana (p50) e p75 de render_ms, ttfb_ms (linha 'view') e
//    lcp_ms (linha 'vitals'), usando só a primeira medição de cada clique.
//    render_ms não mistura caminhos: nav='spa' conta do clique no /r/ até a
//    variação pintar (render); nav='doc' conta do carregamento da própria
//    variação (renderDoc). TTFB só existe no 'doc'.
// Percentil com interpolação linear (igual ao percentile_cont do Postgres).
// =============================================================

export type BeaconDoRotador = {
  destination_id: string;
  cm_click: string;
  kind: "view" | "vitals" | string;
  ttfb_ms: number | null;
  render_ms: number | null;
  lcp_ms: number | null;
  created_at: string;
  nav?: string | null;
};

export type Resumo = { p50: number | null; p75: number | null; n: number };

export type MetricaDaVariacao = {
  destination_id: string;
  label: string;
  url: string;
  clicks: number;
  loaded: number;
  /** 0..1; null quando ainda não há clique. */
  connectRate: number | null;
  /** Clique no /r/ até a variação aparecer (nav='spa'). */
  render: Resumo;
  /** Variação carregada como documento próprio (nav='doc'). */
  renderDoc: Resumo;
  ttfb: Resumo;
  lcp: Resumo;
};

/** Percentil p (0..1) com interpolação linear. Lista vazia → null. */
export function percentil(valores: number[], p: number): number | null {
  const v = valores.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (v.length === 1) return v[0];
  const pos = Math.min(Math.max(p, 0), 1) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function resumir(valores: Array<number | null | undefined>): Resumo {
  const v = valores.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return { p50: percentil(v, 0.5), p75: percentil(v, 0.75), n: v.length };
}

/** Primeira linha de cada (cm_click, kind), pela ordem de chegada. */
export function primeiraPorClique(beacons: BeaconDoRotador[], kind: string): BeaconDoRotador[] {
  const ordenados = beacons
    .filter((b) => b.kind === kind && b.cm_click)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const vistos = new Set<string>();
  const out: BeaconDoRotador[] = [];
  for (const b of ordenados) {
    if (vistos.has(b.cm_click)) continue;
    vistos.add(b.cm_click);
    out.push(b);
  }
  return out;
}

export function calcularMetricasPorVariacao(
  destinos: Array<{ id: string; label: string; url: string }>,
  cliquesPorDestino: Record<string, number>,
  beacons: BeaconDoRotador[],
): MetricaDaVariacao[] {
  const views = primeiraPorClique(beacons, "view");
  const vitals = primeiraPorClique(beacons, "vitals");

  return destinos.map((d) => {
    const clicks = Math.max(0, cliquesPorDestino[d.id] ?? 0);
    const v = views.filter((b) => b.destination_id === d.id);
    const vt = vitals.filter((b) => b.destination_id === d.id);
    // Conexão não passa de 100%: um clique sem linha em rotator_clicks não entra aqui
    // (a view já faz o join), e beacon chegando antes da contagem é cortado no teto.
    const loaded = Math.min(v.length, clicks);
    return {
      destination_id: d.id,
      label: d.label,
      url: d.url,
      clicks,
      loaded,
      connectRate: clicks > 0 ? loaded / clicks : null,
      render: resumir(v.filter((b) => b.nav === "spa").map((b) => b.render_ms)),
      renderDoc: resumir(v.filter((b) => b.nav !== "spa").map((b) => b.render_ms)),
      ttfb: resumir(v.map((b) => b.ttfb_ms)),
      lcp: resumir(vt.map((b) => b.lcp_ms)),
    };
  });
}

/** 1234 → "1,2 s"; 480 → "480 ms"; null → "—". */
export function formatarMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** 0.873 → "87,3%"; null → "—". */
export function formatarTaxa(t: number | null): string {
  if (t == null) return "—";
  return `${(t * 100).toFixed(1).replace(".", ",")}%`;
}

export type Velocidade = {
  ms: number;
  /** 'lcp' = LCP do visitante; 'render' = tempo até a variação aparecer. */
  fonte: "lcp" | "render";
  n: number;
  nivel: "bom" | "medio" | "ruim";
};

/** Régua do Core Web Vitals pro LCP (avaliado no p75): ≤2,5 s bom, ≤4 s médio. */
export function nivelDeVelocidade(ms: number): Velocidade["nivel"] {
  return ms <= 2500 ? "bom" : ms <= 4000 ? "medio" : "ruim";
}

/**
 * Velocidade da variação medida de visitante real (beacon), p75.
 * LCP quando o navegador mede; senão o tempo até a variação aparecer
 * (caminho do /r/ primeiro, depois o documento próprio). Sem medição → null.
 */
export function velocidadeDaVariacao(metrica?: MetricaDaVariacao): Velocidade | null {
  if (!metrica) return null;
  const candidatos: Array<[Velocidade["fonte"], Resumo]> = [
    ["lcp", metrica.lcp],
    ["render", metrica.render],
    ["render", metrica.renderDoc],
  ];
  for (const [fonte, r] of candidatos) {
    const ms = r.p75 ?? r.p50;
    if (r.n > 0 && ms != null) return { ms, fonte, n: r.n, nivel: nivelDeVelocidade(ms) };
  }
  return null;
}
