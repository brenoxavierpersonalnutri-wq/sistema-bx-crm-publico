// Gráfico diário de cliques, entradas e saídas (RPC grupos_serie_diaria). Sem a migração, avisa e não desenha.
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/grupos";
import { baixarCsv, desdeDe, paraCsv, serieCompleta, type Periodo } from "@/lib/painelGrupos";

type Ponto = ReturnType<typeof serieCompleta>[number];
const SERIES = [
  { chave: "cliques", nome: "Cliques", cor: "#facc15" },
  { chave: "entradas", nome: "Entraram", cor: "#22c55e" },
  { chave: "saidas", nome: "Saíram", cor: "#f87171" },
] as const;

export function GraficoDiario({ campanhaId, periodo, mostrar = ["cliques", "entradas", "saidas"], titulo = "Métricas por dia" }: {
  campanhaId: string | null;
  periodo: Periodo;
  mostrar?: ("cliques" | "entradas" | "saidas")[];
  titulo?: string;
}) {
  const [pontos, setPontos] = useState<Ponto[] | null>(null);
  const [semRpc, setSemRpc] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await db.rpc("grupos_serie_diaria", { p_campanha: campanhaId, p_desde: desdeDe(periodo) });
      if (!vivo) return;
      if (error || !Array.isArray(data)) { setSemRpc(true); setPontos(null); return; }
      setSemRpc(false);
      setPontos(serieCompleta(data, periodo));
    })();
    return () => { vivo = false; };
  }, [campanhaId, periodo]);

  const series = SERIES.filter((s) => mostrar.includes(s.chave));
  const totais = Object.fromEntries(series.map((s) => [s.chave, (pontos ?? []).reduce((t, p) => t + p[s.chave], 0)]));

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium flex-1">{titulo}</p>
        {series.map((s) => (
          <span key={s.chave} className="text-xs text-muted-foreground"><span style={{ color: s.cor }}>●</span> {s.nome}: {(totais[s.chave] ?? 0).toLocaleString("pt-BR")}</span>
        ))}
        {pontos && (
          <Button size="sm" variant="ghost" onClick={() => baixarCsv(`grupos-por-dia-${periodo}d.csv`, paraCsv(["Dia", ...series.map((s) => s.nome)], pontos.map((p) => [p.dia, ...series.map((s) => p[s.chave])])))}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        )}
      </div>
      {semRpc && <p className="text-xs text-muted-foreground">Gráfico disponível depois da migração <code>20261110100000_grupos_painel_sendflow.sql</code>.</p>}
      {pontos && (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pontos} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s) => (
                <Area key={s.chave} type="monotone" dataKey={s.chave} name={s.nome} stroke={s.cor} fill={s.cor} fillOpacity={0.15} strokeWidth={2} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
