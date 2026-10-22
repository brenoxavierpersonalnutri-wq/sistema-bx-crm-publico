import {
  formatarMs,
  formatarTaxa,
  velocidadeDaVariacao,
  type MetricaDaVariacao,
} from "@/lib/pageMetrics";

const corDoNivel = { bom: "text-emerald-400", medio: "text-yellow-400", ruim: "text-red-400" } as const;

/**
 * Velocidade da variação medida de visitante real (beacon), p75.
 * Antes chamava a API do PageSpeed do Google sem chave, direto do navegador:
 * sem chave toda chamada cai na cota compartilhada do Google (429) e a
 * coluna mostrava "erro" em todas as variações.
 */
export function VelocidadeCell({ metrica }: { metrica?: MetricaDaVariacao }) {
  const v = velocidadeDaVariacao(metrica);
  if (!v) {
    return (
      <div>
        <span className="text-xs text-muted-foreground">—</span>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5">sem medição</div>
      </div>
    );
  }
  return (
    <div title={v.fonte === "lcp" ? "LCP p75 dos visitantes (beacon)" : "Tempo até a variação aparecer, p75 (beacon)"}>
      <div className={`font-bold ${corDoNivel[v.nivel]}`}>{formatarMs(v.ms)}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {v.fonte === "lcp" ? "LCP" : "aparecer"} p75 · {v.n}
      </div>
    </div>
  );
}

export function ConnectRateCell({ metrica }: { metrica?: MetricaDaVariacao }) {
  // Sem medição do beacon (página sem beacon, ou nenhum clique ainda carregou).
  if (!metrica || metrica.loaded === 0) {
    return (
      <div>
        <span className="text-xs text-muted-foreground">—</span>
        <div className="text-[10px] text-muted-foreground/70 mt-0.5">sem beacon</div>
      </div>
    );
  }
  const t = metrica.connectRate;
  const color = t == null ? "text-muted-foreground" : t >= 0.8 ? "text-emerald-400" : t >= 0.6 ? "text-yellow-400" : "text-red-400";
  return (
    <div>
      <div className={`font-bold ${color}`}>{formatarTaxa(t)}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {metrica.loaded}/{metrica.clicks} · {formatarMs(metrica.render.p50 ?? metrica.renderDoc.p50)}
      </div>
    </div>
  );
}
