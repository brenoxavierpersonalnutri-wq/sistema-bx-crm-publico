import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Copy, Trash2, Pencil, ChevronRight, Dumbbell, Timer, Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  fetchFases, fetchFaseCompleta, upsertFase, removerFase, duplicarFase,
  upsertDia, removerDia, upsertTreinoExercicio, removerTreinoExercicio,
  fetchExercicios,
} from "@/lib/appAluna/store";
import {
  METODOS_AVANCADOS, NIVEIS, type TreinoFase, type TreinoExercicio, type Nivel,
} from "@/lib/appAluna/types";
import { YoutubePlayer } from "./YoutubePlayer";

export function FasesManager() {
  const qc = useQueryClient();
  const [faseAberta, setFaseAberta] = useState<string | null>(null);
  const [editandoFase, setEditandoFase] = useState<Partial<TreinoFase> | null>(null);
  const [confirmar, setConfirmar] = useState<TreinoFase | null>(null);

  const { data: fases = [], isLoading } = useQuery({
    queryKey: ["treino-fases"],
    queryFn: () => fetchFases(),
  });

  const salvarFase = useMutation({
    mutationFn: (f: Partial<TreinoFase> & { nome: string }) => upsertFase(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treino-fases"] });
      setEditandoFase(null);
      toast.success("Fase salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicar = useMutation({
    mutationFn: (id: string) => duplicarFase(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treino-fases"] });
      toast.success("Fase duplicada com todos os treinos");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => removerFase(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treino-fases"] });
      setConfirmar(null);
      toast.success("Fase excluída");
    },
    onError: () => toast.error("Não dá para excluir: esta fase já está no plano de alguma aluna."),
  });

  if (faseAberta) {
    return <FaseEditor faseId={faseAberta} onVoltar={() => setFaseAberta(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fases de treino</h2>
          <p className="text-sm text-muted-foreground">
            Monte cada fase uma vez. Depois é só jogar a fila inteira na aluna —
            ela recebe uma fase nova por mês, automaticamente.
          </p>
        </div>
        <Button
          className="gap-2 sm:shrink-0"
          onClick={() => setEditandoFase({
            nome: `Fase ${fases.length + 1}`,
            ordem: fases.length + 1,
            duracaoSemanas: 4,
            nivel: "todos",
            ativo: true,
          })}
        >
          <Plus className="h-4 w-4" /> Nova fase
        </Button>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : fases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Dumbbell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma fase criada ainda. Crie a Fase 1 e depois use “Duplicar”
              para montar as seguintes sem redigitar tudo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fases.map((f) => (
            <Card key={f.id} className="group transition-shadow hover:shadow-md">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {f.ordem}
                      </Badge>
                      <h3 className="truncate text-sm font-semibold">{f.nome}</h3>
                    </div>
                    {f.objetivo && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.objetivo}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Timer className="h-3 w-3" /> {f.duracaoSemanas} sem
                  </span>
                  <span>{NIVEIS.find((n) => n.value === f.nivel)?.label}</span>
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => setFaseAberta(f.id)}>
                    Montar treinos <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8"
                    aria-label={`Editar dados da ${f.nome}`}
                    onClick={() => setEditandoFase(f)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8"
                    aria-label={`Duplicar ${f.nome}`}
                    disabled={duplicar.isPending}
                    onClick={() => duplicar.mutate(f.id)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                    aria-label={`Excluir ${f.nome}`}
                    onClick={() => setConfirmar(f)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editandoFase && (
        <FaseDialog
          key={editandoFase.id ?? "nova"}
          valor={editandoFase}
          onFechar={() => setEditandoFase(null)}
          onSalvar={(f) => salvarFase.mutate(f)}
          salvando={salvarFase.isPending}
        />
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{confirmar?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga a fase e todos os treinos dentro dela. Se alguma aluna já tiver
              essa fase no plano, a exclusão é recusada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmar && apagar.mutate(confirmar.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FaseDialog({
  valor, onFechar, onSalvar, salvando,
}: {
  valor: Partial<TreinoFase>;
  onFechar: () => void;
  onSalvar: (f: Partial<TreinoFase> & { nome: string }) => void;
  salvando: boolean;
}) {
  const [form, setForm] = useState<Partial<TreinoFase>>(valor);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar fase" : "Nova fase"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fase-nome">Nome</Label>
            <Input
              id="fase-nome"
              value={form.nome ?? ""}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Fase 1 — Adaptação"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="fase-ordem">Ordem</Label>
              <Input
                id="fase-ordem" type="number" min={1}
                value={form.ordem ?? 1}
                onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fase-sem">Semanas</Label>
              <Input
                id="fase-sem" type="number" min={1}
                value={form.duracaoSemanas ?? 4}
                onChange={(e) => setForm({ ...form, duracaoSemanas: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Nível</Label>
              <Select
                value={form.nivel ?? "todos"}
                onValueChange={(v) => setForm({ ...form, nivel: v as Nivel })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NIVEIS.map((n) => (
                    <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fase-obj">Objetivo da fase</Label>
            <Input
              id="fase-obj"
              value={form.objetivo ?? ""}
              onChange={(e) => setForm({ ...form, objetivo: e.target.value })}
              placeholder="Adaptação neuromuscular e técnica"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fase-desc">Observações internas</Label>
            <Textarea
              id="fase-desc" rows={3}
              value={form.descricao ?? ""}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={salvando}
            onClick={() => {
              if (!form.nome?.trim()) return toast.error("Dê um nome à fase");
              onSalvar({ ...form, nome: form.nome.trim() } as Partial<TreinoFase> & { nome: string });
            }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editor de uma fase: os dias de treino e a prescrição de cada exercício
// ---------------------------------------------------------------------------

function FaseEditor({ faseId, onVoltar }: { faseId: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [editandoPrescricao, setEditandoPrescricao] = useState<
    (Partial<TreinoExercicio> & { diaId: string }) | null
  >(null);

  const { data: fase, isLoading } = useQuery({
    queryKey: ["fase-completa", faseId],
    queryFn: () => fetchFaseCompleta(faseId),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["fase-completa", faseId] });

  const criarDia = useMutation({
    mutationFn: (nome: string) =>
      upsertDia({ faseId, nome, ordem: (fase?.dias.length ?? 0) + 1 }),
    onSuccess: () => { invalidar(); toast.success("Treino criado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirDia = useMutation({
    mutationFn: (id: string) => removerDia(id),
    onSuccess: () => { invalidar(); setDiaSelecionado(null); toast.success("Treino removido"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarPrescricao = useMutation({
    mutationFn: (te: Partial<TreinoExercicio> & { diaId: string; exercicioId: string }) =>
      upsertTreinoExercicio(te),
    onSuccess: () => { invalidar(); setEditandoPrescricao(null); toast.success("Exercício prescrito"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirPrescricao = useMutation({
    mutationFn: (id: string) => removerTreinoExercicio(id),
    onSuccess: () => { invalidar(); toast.success("Exercício removido do treino"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>;
  if (!fase) return <p className="py-12 text-center text-sm text-muted-foreground">Fase não encontrada.</p>;

  const diaAtivo = fase.dias.find((d) => d.id === diaSelecionado) ?? fase.dias[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 gap-1" onClick={onVoltar}>
            <ChevronRight className="h-4 w-4 rotate-180" /> Todas as fases
          </Button>
          <h2 className="truncate text-lg font-semibold">{fase.nome}</h2>
          {fase.objetivo && <p className="text-sm text-muted-foreground">{fase.objetivo}</p>}
        </div>
        <Button
          variant="outline" className="gap-2 sm:shrink-0"
          onClick={() => {
            const letra = String.fromCharCode(65 + (fase.dias.length % 26));
            criarDia.mutate(`Treino ${letra}`);
          }}
        >
          <Plus className="h-4 w-4" /> Novo treino
        </Button>
      </div>

      {fase.dias.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Adicione o primeiro treino desta fase (Treino A, Treino B…).
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {fase.dias.map((d) => (
              <Button
                key={d.id}
                size="sm"
                variant={diaAtivo?.id === d.id ? "default" : "outline"}
                onClick={() => setDiaSelecionado(d.id)}
              >
                {d.nome}
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {d.exercicios.length}
                </Badge>
              </Button>
            ))}
          </div>

          {diaAtivo && (
            <DiaEditor
              dia={diaAtivo}
              onAdicionar={() => setEditandoPrescricao({
                diaId: diaAtivo.id,
                ordem: diaAtivo.exercicios.length + 1,
                series: 3,
                repeticoes: "12",
              })}
              onEditar={(te) => setEditandoPrescricao({ ...te, diaId: diaAtivo.id })}
              onExcluir={(id) => excluirPrescricao.mutate(id)}
              onRenomear={(nome, foco) =>
                upsertDia({ id: diaAtivo.id, faseId, nome, foco, ordem: diaAtivo.ordem })
                  .then(invalidar)
                  .catch((e: Error) => toast.error(e.message))
              }
              onExcluirDia={() => excluirDia.mutate(diaAtivo.id)}
            />
          )}
        </>
      )}

      {editandoPrescricao && (
        <PrescricaoDialog
          key={editandoPrescricao.id ?? "nova"}
          valor={editandoPrescricao}
          onFechar={() => setEditandoPrescricao(null)}
          onSalvar={(te) => salvarPrescricao.mutate(te)}
          salvando={salvarPrescricao.isPending}
        />
      )}
    </div>
  );
}

function DiaEditor({
  dia, onAdicionar, onEditar, onExcluir, onRenomear, onExcluirDia,
}: {
  dia: { id: string; nome: string; foco?: string | null; exercicios: TreinoExercicio[] };
  onAdicionar: () => void;
  onEditar: (te: TreinoExercicio) => void;
  onExcluir: (id: string) => void;
  onRenomear: (nome: string, foco: string) => void;
  onExcluirDia: () => void;
}) {
  const [nome, setNome] = useState(dia.nome);
  const [foco, setFoco] = useState(dia.foco ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="dia-nome">Nome do treino</Label>
            <Input id="dia-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="dia-foco">Foco</Label>
            <Input
              id="dia-foco" value={foco}
              onChange={(e) => setFoco(e.target.value)}
              placeholder="Inferior · Glúteo e posterior"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={nome === dia.nome && foco === (dia.foco ?? "")}
              onClick={() => onRenomear(nome, foco)}
            >
              Salvar
            </Button>
            <Button
              size="icon" variant="ghost" className="text-destructive"
              aria-label={`Excluir ${dia.nome}`}
              onClick={onExcluirDia}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {dia.exercicios.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum exercício neste treino ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {dia.exercicios.map((te) => (
              <li
                key={te.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                {te.agrupamento && (
                  <Badge className="mt-0.5 shrink-0" variant="default">{te.agrupamento}</Badge>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{te.exercicio?.nome ?? "Exercício"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Repeat className="h-3 w-3" />{te.series} × {te.repeticoes}
                    </span>
                    {te.cadencia && <span>Cadência {te.cadencia}</span>}
                    {te.descansoSeg != null && <span>Descanso {te.descansoSeg}s</span>}
                    {te.metodoAvancado && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {te.metodoAvancado}
                      </Badge>
                    )}
                  </div>
                  {te.observacao && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{te.observacao}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    aria-label="Editar prescrição"
                    onClick={() => onEditar(te)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                    aria-label="Remover do treino"
                    onClick={() => onExcluir(te.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" className="w-full gap-2" onClick={onAdicionar}>
          <Plus className="h-4 w-4" /> Adicionar exercício
        </Button>
      </CardContent>
    </Card>
  );
}

function PrescricaoDialog({
  valor, onFechar, onSalvar, salvando,
}: {
  valor: Partial<TreinoExercicio> & { diaId: string };
  onFechar: () => void;
  onSalvar: (te: Partial<TreinoExercicio> & { diaId: string; exercicioId: string }) => void;
  salvando: boolean;
}) {
  const [form, setForm] = useState<Partial<TreinoExercicio> & { diaId: string }>(valor);
  const { data: exercicios = [] } = useQuery({
    queryKey: ["exercicios"],
    queryFn: () => fetchExercicios(),
  });

  const selecionado = exercicios.find((e) => e.id === form.exercicioId);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar prescrição" : "Adicionar exercício"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Exercício</Label>
            <Select
              value={form.exercicioId ?? ""}
              onValueChange={(v) => setForm({ ...form, exercicioId: v })}
            >
              <SelectTrigger><SelectValue placeholder="Escolha da biblioteca" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {exercicios.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selecionado && (
              <div className="pt-2">
                <YoutubePlayer youtubeId={selecionado.youtubeId} titulo={selecionado.nome} />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-series">Séries</Label>
              <Input
                id="p-series" type="number" min={1}
                value={form.series ?? 3}
                onChange={(e) => setForm({ ...form, series: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-reps">Repetições</Label>
              <Input
                id="p-reps"
                value={form.repeticoes ?? ""}
                onChange={(e) => setForm({ ...form, repeticoes: e.target.value })}
                placeholder="10-12 · 15 · até a falha"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-cad">Cadência</Label>
              <Input
                id="p-cad"
                value={form.cadencia ?? ""}
                onChange={(e) => setForm({ ...form, cadencia: e.target.value })}
                placeholder="3-0-1-0"
              />
              <p className="text-xs text-muted-foreground">
                Excêntrica · pausa embaixo · concêntrica · pausa em cima.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-desc">Descanso (segundos)</Label>
              <Input
                id="p-desc" type="number" min={0} step={15}
                value={form.descansoSeg ?? ""}
                onChange={(e) => setForm({
                  ...form,
                  descansoSeg: e.target.value === "" ? null : Number(e.target.value),
                })}
                placeholder="60"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Método avançado</Label>
              <Select
                value={form.metodoAvancado ?? "nenhum"}
                onValueChange={(v) => setForm({ ...form, metodoAvancado: v === "nenhum" ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Nenhum</SelectItem>
                  {METODOS_AVANCADOS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-grupo">Agrupamento</Label>
              <Input
                id="p-grupo" maxLength={2}
                value={form.agrupamento ?? ""}
                onChange={(e) => setForm({
                  ...form,
                  agrupamento: e.target.value.toUpperCase() || null,
                })}
                placeholder="A"
              />
              <p className="text-xs text-muted-foreground">
                Mesma letra = bi-set/tri-set. Deixe vazio para série isolada.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-carga">Carga sugerida</Label>
            <Input
              id="p-carga"
              value={form.cargaSugerida ?? ""}
              onChange={(e) => setForm({ ...form, cargaSugerida: e.target.value })}
              placeholder="20 kg · peso corporal · elástico médio"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-obs">Observação para a aluna</Label>
            <Textarea
              id="p-obs" rows={2}
              value={form.observacao ?? ""}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              placeholder="Direto e curto — o que ela precisa fazer."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={salvando}
            onClick={() => {
              if (!form.exercicioId) return toast.error("Escolha o exercício");
              if (!form.repeticoes?.trim()) return toast.error("Informe as repetições");
              onSalvar(form as Partial<TreinoExercicio> & { diaId: string; exercicioId: string });
            }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
