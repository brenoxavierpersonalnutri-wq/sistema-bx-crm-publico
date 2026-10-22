import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChevronLeft, Clock, Dumbbell, Flame, Layers, Loader2, Repeat, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { AlunaShell } from "@/components/aluna/AlunaShell";
import { YoutubePlayer } from "@/components/appAluna/YoutubePlayer";
import { useAlunaAuth } from "@/hooks/useAlunaAuth";
import {
  fetchMeuTreinoAtual, fetchLogs, registrarTreino, desfazerTreino,
} from "@/lib/appAluna/store";
import type { TreinoExercicio } from "@/lib/appAluna/types";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toISOString().slice(0, 10);

export default function AlunaTreino() {
  const { perfil } = useAlunaAuth();
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["meu-treino"],
    queryFn: fetchMeuTreinoAtual,
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["meus-logs", perfil?.alunaId],
    queryFn: () => (perfil ? fetchLogs(perfil.alunaId) : Promise.resolve([])),
    enabled: !!perfil,
  });

  if (isLoading) {
    return (
      <AlunaShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AlunaShell>
    );
  }

  const fase = data?.faseAtual ?? null;

  if (!fase) {
    return (
      <AlunaShell>
        <div className="rounded-2xl border border-white/5 bg-card/60 p-8 text-center">
          <Dumbbell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">Treino a caminho</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua primeira fase ainda não foi liberada. Assim que ela abrir, aparece aqui.
          </p>
        </div>
      </AlunaShell>
    );
  }

  const dia = fase.dias.find((d) => d.id === diaAberto);
  if (dia) {
    return (
      <DiaDeTreino
        dia={dia}
        planoFaseId={data?.planoFaseAtualId ?? null}
        feitoHoje={logs.some((l) => l.diaId === dia.id && l.data === hoje())}
        onVoltar={() => setDiaAberto(null)}
      />
    );
  }

  const totalFases = data?.fases.length ?? 0;
  const feitosNaSemana = logs.filter((l) => {
    const d = new Date(`${l.data}T12:00:00`);
    const limite = new Date();
    limite.setDate(limite.getDate() - 7);
    return d >= limite;
  }).length;

  return (
    <AlunaShell>
      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/15 via-card to-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                Fase {totalFases} · em andamento
              </p>
              <h2 className="mt-1 font-display text-xl font-bold leading-tight">{fase.nome}</h2>
              {fase.objetivo && (
                <p className="mt-1 text-sm text-muted-foreground">{fase.objetivo}</p>
              )}
            </div>
            <Badge variant="outline" className="shrink-0 border-accent/30 text-accent">
              {fase.duracaoSemanas} sem
            </Badge>
          </div>

          <div className="mt-5 flex items-center gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Treinos</p>
              <p className="font-display text-lg font-bold tabular-nums">{fase.dias.length}</p>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Últimos 7 dias</p>
              <p className="font-display text-lg font-bold tabular-nums">{feitosNaSemana}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Seus treinos</h3>
          <ul className="space-y-2.5">
            {fase.dias.map((d) => {
              const feito = logs.some((l) => l.diaId === d.id && l.data === hoje());
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setDiaAberto(d.id)}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-colors",
                      feito
                        ? "border-emerald-500/25 bg-emerald-500/5"
                        : "border-white/5 bg-card/60 active:bg-card",
                    )}
                  >
                    <span className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      feito ? "bg-emerald-500/15 text-emerald-400" : "bg-accent/10 text-accent",
                    )}>
                      {feito ? <Check className="h-5 w-5" /> : <Dumbbell className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{d.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.foco ? `${d.foco} · ` : ""}{d.exercicios.length} exercícios
                      </p>
                    </div>
                    {feito && (
                      <Badge variant="outline" className="shrink-0 border-emerald-500/30 text-[10px] text-emerald-400">
                        feito hoje
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {totalFases > 1 && (
          <section className="rounded-2xl border border-white/5 bg-card/40 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Sua jornada</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Você já desbloqueou {totalFases} fases. A próxima abre sozinha na data
              programada pelo Breno.
            </p>
            <Progress value={100} className="mt-3 h-1.5" />
          </section>
        )}
      </div>
    </AlunaShell>
  );
}

// ---------------------------------------------------------------------------

function DiaDeTreino({
  dia, planoFaseId, feitoHoje, onVoltar,
}: {
  dia: { id: string; nome: string; foco?: string | null; exercicios: TreinoExercicio[] };
  planoFaseId: string | null;
  feitoHoje: boolean;
  onVoltar: () => void;
}) {
  const { perfil } = useAlunaAuth();
  const qc = useQueryClient();

  const marcar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error("Sessão expirada");
      if (feitoHoje) {
        await desfazerTreino(perfil.alunaId, dia.id, hoje());
      } else {
        await registrarTreino({ alunaId: perfil.alunaId, diaId: dia.id, planoFaseId });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meus-logs"] });
      toast.success(feitoHoje ? "Treino desmarcado" : "Treino concluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Exercícios com a mesma letra são bi-set/tri-set: mostram juntos.
  const blocos = useMemo(() => {
    const saida: { chave: string; agrupamento: string | null; itens: TreinoExercicio[] }[] = [];
    for (const ex of dia.exercicios) {
      const ultimo = saida[saida.length - 1];
      if (ex.agrupamento && ultimo?.agrupamento === ex.agrupamento) {
        ultimo.itens.push(ex);
      } else {
        saida.push({ chave: ex.id, agrupamento: ex.agrupamento ?? null, itens: [ex] });
      }
    }
    return saida;
  }, [dia.exercicios]);

  return (
    <AlunaShell titulo={dia.nome}>
      <div className="space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground" onClick={onVoltar}>
          <ChevronLeft className="h-4 w-4" /> Treinos da fase
        </Button>

        {dia.foco && (
          <p className="text-sm text-muted-foreground">{dia.foco}</p>
        )}

        <div className="space-y-4">
          {blocos.map((bloco, i) => (
            <div
              key={bloco.chave}
              className={cn(
                "space-y-3",
                bloco.itens.length > 1 &&
                  "rounded-2xl border border-accent/20 bg-accent/[0.03] p-3",
              )}
            >
              {bloco.itens.length > 1 && (
                <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
                  <Flame className="h-3.5 w-3.5" />
                  {bloco.itens.length === 2 ? "Bi-set" : "Tri-set"} {bloco.agrupamento} — sem descanso entre eles
                </p>
              )}
              {bloco.itens.map((ex) => (
                <CardExercicio key={ex.id} ex={ex} numero={i + 1} />
              ))}
            </div>
          ))}
        </div>

        <Button
          className={cn("w-full gap-2", feitoHoje && "bg-emerald-600 hover:bg-emerald-600/90")}
          disabled={marcar.isPending}
          onClick={() => marcar.mutate()}
        >
          <Check className="h-4 w-4" />
          {marcar.isPending
            ? "Salvando…"
            : feitoHoje
              ? "Treino concluído hoje — desfazer"
              : "Marcar treino como concluído"}
        </Button>
      </div>
    </AlunaShell>
  );
}

function CardExercicio({ ex, numero }: { ex: TreinoExercicio; numero: number }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/5 bg-card/60">
      <YoutubePlayer
        youtubeId={ex.exercicio?.youtubeId}
        titulo={ex.exercicio?.nome}
        className="rounded-none"
      />

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-[11px] font-bold tabular-nums text-muted-foreground">
            {numero}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-tight">{ex.exercicio?.nome ?? "Exercício"}</h3>
            {ex.exercicio?.equipamento && (
              <p className="text-xs text-muted-foreground">{ex.exercicio.equipamento}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metrica icone={Repeat} rotulo="Séries" valor={`${ex.series} × ${ex.repeticoes}`} />
          {ex.cadencia && <Metrica icone={Timer} rotulo="Cadência" valor={ex.cadencia} />}
          {ex.descansoSeg != null && (
            <Metrica icone={Clock} rotulo="Descanso" valor={`${ex.descansoSeg}s`} />
          )}
          {ex.cargaSugerida && <Metrica icone={Dumbbell} rotulo="Carga" valor={ex.cargaSugerida} />}
        </div>

        {ex.metodoAvancado && (
          <div className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.07] px-3 py-2">
            <Flame className="h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Método</p>
              <p className="text-sm font-semibold capitalize text-accent">{ex.metodoAvancado}</p>
            </div>
          </div>
        )}

        {ex.observacao && (
          <div className="rounded-xl border-l-2 border-white/15 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Observação</p>
            <p className="text-sm">{ex.observacao}</p>
          </div>
        )}

        {ex.exercicio?.instrucoes && (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
              Como executar
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {ex.exercicio.instrucoes}
            </p>
          </details>
        )}
      </div>
    </article>
  );
}

function Metrica({
  icone: Icone, rotulo, valor,
}: {
  icone: typeof Repeat;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icone className="h-3 w-3" /> {rotulo}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
