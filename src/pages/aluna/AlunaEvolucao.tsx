import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CalendarCheck, Loader2, TrendingUp, Lock, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import { fetchLogs, fetchFeedbacks, fetchMeuTreinoAtual } from "@/lib/appAluna/store";
import { cn } from "@/lib/utils";

const formatarCurta = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function AlunaEvolucao() {
  const { perfil } = useAlunaAuth();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["meus-logs", perfil?.alunaId],
    queryFn: () => (perfil ? fetchLogs(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  const { data: feedbacks = [] } = useQuery({
    queryKey: ["meus-feedbacks", perfil?.alunaId],
    queryFn: () => (perfil ? fetchFeedbacks(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  const { data: treino } = useQuery({
    queryKey: ["meu-treino"],
    queryFn: fetchMeuTreinoAtual,
  });

  const serieDePeso = useMemo(
    () =>
      feedbacks
        .filter((f) => f.peso != null)
        .map((f) => ({ data: formatarCurta(f.dataReferencia), peso: Number(f.peso) }))
        .reverse(),
    [feedbacks],
  );

  const treinosNoMes = useMemo(() => {
    const limite = new Date();
    limite.setDate(limite.getDate() - 30);
    return logs.filter((l) => new Date(`${l.data}T12:00:00`) >= limite).length;
  }, [logs]);

  const variacao = serieDePeso.length >= 2
    ? serieDePeso[serieDePeso.length - 1].peso - serieDePeso[0].peso
    : null;

  if (isLoading) {
    return (
      <AlunaShell titulo="Evolução">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AlunaShell>
    );
  }

  return (
    <AlunaShell titulo="Evolução">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/5 bg-card/60 p-4">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <CalendarCheck className="h-3 w-3" /> Treinos em 30 dias
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{treinosNoMes}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-card/60 p-4">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Variação de peso
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {variacao == null
                ? "—"
                : `${variacao > 0 ? "+" : ""}${variacao.toFixed(1)} kg`}
            </p>
          </div>
        </div>

        {serieDePeso.length >= 2 && (
          <section className="rounded-2xl border border-white/5 bg-card/60 p-4">
            <h2 className="mb-4 text-sm font-semibold">Peso ao longo do tempo</h2>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieDePeso} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="data" tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    domain={["dataMin - 1", "dataMax + 1"]}
                    tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v} kg`, "Peso"]}
                  />
                  <Line
                    type="monotone" dataKey="peso"
                    stroke="hsl(var(--accent))" strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--accent))" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {treino?.fases && treino.fases.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Suas fases</h2>
            <ol className="space-y-2">
              {treino.fases.map((pf, i) => {
                const atual = i === treino.fases.length - 1;
                return (
                  <li
                    key={pf.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3",
                      atual ? "border-accent/30 bg-accent/[0.06]" : "border-white/5 bg-card/40",
                    )}
                  >
                    <span className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                      atual ? "bg-accent/15 text-accent" : "bg-white/5 text-muted-foreground",
                    )}>
                      {atual ? pf.ordem : <Check className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{pf.fase?.nome ?? `Fase ${pf.ordem}`}</p>
                      <p className="text-xs text-muted-foreground">
                        Liberada em {formatarCurta(pf.dataLiberacao)}
                      </p>
                    </div>
                    {atual && <Badge className="shrink-0 text-[10px]">atual</Badge>}
                  </li>
                );
              })}
              <li className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm text-muted-foreground">
                  Próxima fase abre na data programada
                </p>
              </li>
            </ol>
          </section>
        )}

        {logs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Últimos treinos</h2>
            <ul className="space-y-1.5">
              {logs.slice(0, 12).map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-card/40 px-4 py-2.5"
                >
                  <span className="text-sm">{formatarCurta(l.data)}</span>
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <Check className="h-3.5 w-3.5" /> concluído
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AlunaShell>
  );
}
