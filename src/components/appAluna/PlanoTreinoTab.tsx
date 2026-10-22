import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Lock, Rocket, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  fetchFases, fetchPlanoAtivo, fetchPlanoFases, atribuirFases, ajustarLiberacaoFase,
} from "@/lib/appAluna/store";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toISOString().slice(0, 10);

const formatarData = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  });

export function PlanoTreinoTab({ alunaId }: { alunaId: string }) {
  const qc = useQueryClient();
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [dataInicio, setDataInicio] = useState(hoje());
  const [intervalo, setIntervalo] = useState(30);

  const { data: fases = [] } = useQuery({
    queryKey: ["treino-fases"],
    queryFn: () => fetchFases(),
  });

  const { data: plano } = useQuery({
    queryKey: ["plano-ativo", alunaId],
    queryFn: () => fetchPlanoAtivo(alunaId),
  });

  const { data: planoFases = [] } = useQuery({
    queryKey: ["plano-fases", plano?.id],
    queryFn: () => (plano ? fetchPlanoFases(plano.id) : Promise.resolve([])),
    enabled: !!plano,
  });

  const atribuir = useMutation({
    mutationFn: () => atribuirFases({
      alunaId,
      faseIds: selecionadas,
      dataInicio,
      intervaloDias: intervalo,
      nome: `Protocolo ${selecionadas.length} fases`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plano-ativo", alunaId] });
      qc.invalidateQueries({ queryKey: ["plano-fases"] });
      setSelecionadas([]);
      toast.success("Plano atribuído. As fases abrem sozinhas na data marcada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ajustar = useMutation({
    mutationFn: ({ id, data }: { id: string; data: string }) => ajustarLiberacaoFase(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plano-fases"] });
      toast.success("Data de liberação atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Prévia do cronograma antes de confirmar
  const previsao = useMemo(() => {
    return selecionadas.map((id, i) => {
      const d = new Date(`${dataInicio}T12:00:00`);
      d.setDate(d.getDate() + i * intervalo);
      return { fase: fases.find((f) => f.id === id), data: d.toISOString().slice(0, 10) };
    });
  }, [selecionadas, dataInicio, intervalo, fases]);

  const alternar = (id: string) =>
    setSelecionadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  return (
    <div className="space-y-6">
      {plano && planoFases.length > 0 && (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">{plano.nome}</h3>
                <p className="text-sm text-muted-foreground">
                  Começou em {formatarData(plano.dataInicio)} · uma fase a cada {plano.intervaloDias} dias
                </p>
              </div>
              <Badge variant="secondary">{planoFases.length} fases</Badge>
            </div>

            <ol className="space-y-2">
              {planoFases.map((pf) => {
                const liberada = pf.dataLiberacao <= hoje();
                return (
                  <li
                    key={pf.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-lg border p-3",
                      liberada ? "border-border bg-card" : "border-dashed border-border/70 bg-muted/30",
                    )}
                  >
                    <span className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      liberada ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}>
                      {liberada ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {pf.ordem}. {pf.fase?.nome ?? "Fase"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {liberada ? "Liberada em" : "Abre em"} {formatarData(pf.dataLiberacao)}
                      </p>
                    </div>
                    <Input
                      type="date"
                      aria-label={`Data de liberação da fase ${pf.ordem}`}
                      className="h-8 w-40 text-xs"
                      value={pf.dataLiberacao}
                      onChange={(e) => ajustar.mutate({ id: pf.id, data: e.target.value })}
                    />
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">
              {plano ? "Atribuir um novo plano" : "Montar o plano da aluna"}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Marque as fases na ordem em que ela deve recebê-las. A primeira abre na
            data de início; as outras vão abrindo sozinhas, uma por período.
            {plano && " O plano atual será arquivado."}
          </p>

          {fases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma fase criada ainda — monte as fases na aba “Fases de treino”.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fases.map((f) => {
                const idx = selecionadas.indexOf(f.id);
                return (
                  <label
                    key={f.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                      idx >= 0 ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <Checkbox checked={idx >= 0} onCheckedChange={() => alternar(f.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.nome}</p>
                      <p className="text-xs text-muted-foreground">{f.duracaoSemanas} semanas</p>
                    </div>
                    {idx >= 0 && (
                      <Badge className="shrink-0">{idx + 1}º</Badge>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plano-inicio">Data de início</Label>
              <Input
                id="plano-inicio" type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plano-intervalo">Dias entre uma fase e outra</Label>
              <Input
                id="plano-intervalo" type="number" min={1}
                value={intervalo}
                onChange={(e) => setIntervalo(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">30 = uma fase nova por mês.</p>
            </div>
          </div>

          {previsao.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> Como vai ficar
              </p>
              <ul className="space-y-1 text-xs">
                {previsao.map((p, i) => (
                  <li key={p.fase?.id ?? i} className="flex justify-between gap-3">
                    <span className="truncate">{i + 1}. {p.fase?.nome}</span>
                    <span className="shrink-0 text-muted-foreground">{formatarData(p.data)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={selecionadas.length === 0 || atribuir.isPending}
            onClick={() => atribuir.mutate()}
          >
            <Rocket className="h-4 w-4" />
            {atribuir.isPending
              ? "Atribuindo…"
              : `Atribuir ${selecionadas.length || ""} ${selecionadas.length === 1 ? "fase" : "fases"}`.trim()}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
