import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rotatorApi, type RotatorLink } from "@/lib/rotatorApi";
import { formatarMs, formatarTaxa, type MetricaDaVariacao, type Resumo } from "@/lib/pageMetrics";

// Conexão e velocidade por variação, medidas de visitante real pelo beacon
// das páginas (hoje só as /desafio/vN mandam beacon). Regras em lib/pageMetrics.

function corDaTaxa(t: number | null) {
  if (t == null) return "text-muted-foreground";
  if (t >= 0.8) return "text-emerald-400";
  if (t >= 0.6) return "text-yellow-400";
  return "text-red-400";
}

function corDoTempo(ms: number | null, bom: number, ruim: number) {
  if (ms == null) return "text-muted-foreground";
  if (ms <= bom) return "text-emerald-400";
  if (ms <= ruim) return "text-yellow-400";
  return "text-red-400";
}

function CelulaTempo({ r, bom, ruim }: { r: Resumo; bom: number; ruim: number }) {
  return (
    <div className="text-right">
      <div className={`font-semibold ${corDoTempo(r.p50, bom, ruim)}`}>{formatarMs(r.p50)}</div>
      <div className="text-[10px] text-muted-foreground">
        p75 {formatarMs(r.p75)} · n={r.n}
      </div>
    </div>
  );
}

function caminho(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function PageSpeedTab() {
  const [rotators, setRotators] = useState<RotatorLink[]>([]);
  const [selId, setSelId] = useState<string>("");
  const [linhas, setLinhas] = useState<MetricaDaVariacao[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    rotatorApi
      .getAll()
      .then((lista) => {
        setRotators(lista);
        const padrao = lista.find((r) => r.slug === "desafio") ?? lista[0];
        if (padrao) setSelId(padrao.id);
      })
      .catch((e) => setErro(e?.message || "Erro ao carregar rotadores"));
  }, []);

  const carregar = useCallback(async (id: string) => {
    if (!id) return;
    setCarregando(true);
    setErro("");
    try {
      setLinhas(await rotatorApi.getPageMetrics(id));
    } catch (e: unknown) {
      setLinhas(null);
      setErro(e instanceof Error ? e.message : (e as { message?: string })?.message || "Erro ao carregar métricas");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(selId);
  }, [selId, carregar]);

  const totalCliques = (linhas ?? []).reduce((s, l) => s + l.clicks, 0);
  const totalCarregou = (linhas ?? []).reduce((s, l) => s + l.loaded, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" /> Conexão e velocidade por variação
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Medido de visitante real. Conexão = cliques do rotador em que a página da variação chegou a aparecer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            className="h-9 rounded-lg border border-border bg-secondary px-3 text-sm text-foreground"
            aria-label="Rotador"
          >
            {rotators.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (/r/{r.slug})
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => carregar(selId)} disabled={carregando || !selId}>
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {linhas && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variação</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Carregou</TableHead>
                <TableHead className="text-right">Conexão</TableHead>
                <TableHead className="text-right">Clique até aparecer</TableHead>
                <TableHead className="text-right">LCP</TableHead>
                <TableHead className="text-right">TTFB</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    Este rotador não tem destinos.
                  </TableCell>
                </TableRow>
              )}
              {linhas.map((l) => (
                <TableRow key={l.destination_id}>
                  <TableCell>
                    <div className="font-semibold">{l.label || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{caminho(l.url)}</div>
                  </TableCell>
                  <TableCell className="text-right">{l.clicks}</TableCell>
                  <TableCell className="text-right">{l.loaded}</TableCell>
                  <TableCell className={`text-right font-bold ${corDaTaxa(l.connectRate)}`}>{formatarTaxa(l.connectRate)}</TableCell>
                  <TableCell>
                    <CelulaTempo r={l.render} bom={2500} ruim={4000} />
                    {l.renderDoc.n > 0 && (
                      <div className="text-[10px] text-muted-foreground text-right">
                        direto: {formatarMs(l.renderDoc.p50)} (n={l.renderDoc.n})
                      </div>
                    )}
                  </TableCell>
                  <TableCell><CelulaTempo r={l.lcp} bom={2500} ruim={4000} /></TableCell>
                  <TableCell><CelulaTempo r={l.ttfb} bom={800} ruim={1800} /></TableCell>
                </TableRow>
              ))}
              {linhas.length > 0 && (
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{totalCliques}</TableCell>
                  <TableCell className="text-right font-semibold">{totalCarregou}</TableCell>
                  <TableCell className={`text-right font-bold ${corDaTaxa(totalCliques ? totalCarregou / totalCliques : null)}`}>
                    {formatarTaxa(totalCliques ? totalCarregou / totalCliques : null)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        Mediana em destaque, p75 embaixo, n = medições. "Clique até aparecer" conta da abertura do /r/ (clique no
        anúncio) até a variação ser pintada; "direto" é quem abriu a página da variação sem passar pelo /r/ (TTFB só
        existe nesse caso). Aba aberta em segundo plano conta na conexão, mas não no tempo. LCP é do maior elemento pintado (Safari não informa). TTFB é a
        primeira resposta do servidor. Cada clique entra uma vez, mesmo com recarga. Só páginas com o beacon entram
        aqui (hoje: /desafio/v1 a v5).
      </p>
    </div>
  );
}
