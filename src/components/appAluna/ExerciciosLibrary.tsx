import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, Youtube } from "lucide-react";
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
import { fetchExercicios, upsertExercicio, removerExercicio } from "@/lib/appAluna/store";
import {
  GRUPOS_MUSCULARES, NIVEIS, parseYoutubeId, type Exercicio, type GrupoMuscular, type Nivel,
} from "@/lib/appAluna/types";
import { YoutubePlayer } from "./YoutubePlayer";

const VAZIO: Partial<Exercicio> = {
  nome: "", grupoMuscular: "pernas", nivel: "todos", tags: [], ativo: true,
};

export function ExerciciosLibrary() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [grupoFiltro, setGrupoFiltro] = useState<string>("todos");
  const [editando, setEditando] = useState<Partial<Exercicio> | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState<Exercicio | null>(null);

  const { data: exercicios = [], isLoading } = useQuery({
    queryKey: ["exercicios"],
    queryFn: () => fetchExercicios(),
  });

  const salvar = useMutation({
    mutationFn: (ex: Partial<Exercicio> & { nome: string }) => upsertExercicio(ex),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exercicios"] });
      setEditando(null);
      toast.success("Exercício salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: (id: string) => removerExercicio(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exercicios"] });
      setConfirmarRemocao(null);
      toast.success("Exercício arquivado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return exercicios.filter((e) => {
      const casaBusca = !termo
        || e.nome.toLowerCase().includes(termo)
        || (e.equipamento ?? "").toLowerCase().includes(termo);
      const casaGrupo = grupoFiltro === "todos" || e.grupoMuscular === grupoFiltro;
      return casaBusca && casaGrupo;
    });
  }, [exercicios, busca, grupoFiltro]);

  const semVideo = exercicios.filter((e) => !e.youtubeId).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar exercício ou equipamento"
            className="pl-9"
          />
        </div>
        <Select value={grupoFiltro} onValueChange={setGrupoFiltro}>
          <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os grupos</SelectItem>
            {GRUPOS_MUSCULARES.map((g) => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setEditando({ ...VAZIO })} className="gap-2">
          <Plus className="h-4 w-4" /> Novo exercício
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{exercicios.length} exercícios na biblioteca</span>
        {semVideo > 0 && (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
            <Youtube className="h-3 w-3" /> {semVideo} sem vídeo
          </Badge>
        )}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nenhum exercício encontrado. Cadastre o primeiro para montar as fases.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtrados.map((ex) => (
            <Card key={ex.id} className="group overflow-hidden">
              <YoutubePlayer youtubeId={ex.youtubeId} titulo={ex.nome} className="rounded-none" />
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-tight">{ex.nome}</h3>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      aria-label={`Editar ${ex.nome}`}
                      onClick={() => setEditando(ex)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      aria-label={`Arquivar ${ex.nome}`}
                      onClick={() => setConfirmarRemocao(ex)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {GRUPOS_MUSCULARES.find((g) => g.value === ex.grupoMuscular)?.label ?? ex.grupoMuscular}
                  </Badge>
                  {ex.equipamento && (
                    <Badge variant="outline" className="text-[10px]">{ex.equipamento}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editando && (
        <ExercicioDialog
          key={editando.id ?? "novo"}
          valor={editando}
          onFechar={() => setEditando(null)}
          onSalvar={(ex) => salvar.mutate(ex)}
          salvando={salvar.isPending}
        />
      )}

      <AlertDialog open={!!confirmarRemocao} onOpenChange={(o) => !o && setConfirmarRemocao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{confirmarRemocao?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele some da biblioteca, mas continua aparecendo nas fases antigas
              que já o usam — nenhum treino já entregue é quebrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmarRemocao && remover.mutate(confirmarRemocao.id)}>
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExercicioDialog({
  valor, onFechar, onSalvar, salvando,
}: {
  valor: Partial<Exercicio>;
  onFechar: () => void;
  onSalvar: (ex: Partial<Exercicio> & { nome: string }) => void;
  salvando: boolean;
}) {
  // O `key` no ponto de uso remonta o componente a cada exercício aberto,
  // então este estado inicial já basta — sem sincronizar prop com state.
  const [form, setForm] = useState<Partial<Exercicio>>(valor);

  const previewId = parseYoutubeId(form.youtubeUrl);

  const submeter = () => {
    if (!form.nome?.trim()) {
      toast.error("Dê um nome ao exercício");
      return;
    }
    if (form.youtubeUrl?.trim() && !previewId) {
      toast.error("Não reconheci esse link do YouTube. Cole a URL completa do vídeo.");
      return;
    }
    onSalvar({ ...form, nome: form.nome.trim() } as Partial<Exercicio> & { nome: string });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar exercício" : "Novo exercício"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ex-nome">Nome</Label>
            <Input
              id="ex-nome"
              value={form.nome ?? ""}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Agachamento livre"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Grupo muscular</Label>
              <Select
                value={form.grupoMuscular ?? "pernas"}
                onValueChange={(v) => setForm({ ...form, grupoMuscular: v as GrupoMuscular })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRUPOS_MUSCULARES.map((g) => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ex-equip">Equipamento</Label>
              <Input
                id="ex-equip"
                value={form.equipamento ?? ""}
                onChange={(e) => setForm({ ...form, equipamento: e.target.value })}
                placeholder="Barra, halter, máquina…"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ex-yt">Link do vídeo no YouTube</Label>
            <Input
              id="ex-yt"
              value={form.youtubeUrl ?? ""}
              onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
              placeholder="https://youtube.com/watch?v=…"
            />
            <p className="text-xs text-muted-foreground">
              Aceita link normal, youtu.be, /shorts e /embed.
            </p>
            {previewId && (
              <div className="pt-2">
                <YoutubePlayer youtubeId={previewId} titulo={form.nome} />
              </div>
            )}
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

          <div className="space-y-2">
            <Label htmlFor="ex-inst">Instruções de execução</Label>
            <Textarea
              id="ex-inst"
              rows={3}
              value={form.instrucoes ?? ""}
              onChange={(e) => setForm({ ...form, instrucoes: e.target.value })}
              placeholder="O que a aluna precisa saber para executar certo."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
