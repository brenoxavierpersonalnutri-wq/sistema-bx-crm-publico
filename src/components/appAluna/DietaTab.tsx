import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Trash2, Download, Plus } from "lucide-react";
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
import { toast } from "sonner";
import {
  fetchDietas, upsertDieta, removerDieta, uploadDietaPdf, urlAssinadaDieta,
} from "@/lib/appAluna/store";
import type { AlunaDieta, TipoDieta } from "@/lib/appAluna/types";

const hoje = () => new Date().toISOString().slice(0, 10);

const formatarData = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export function DietaTab({ alunaId }: { alunaId: string }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Partial<AlunaDieta> | null>(null);

  const { data: dietas = [], isLoading } = useQuery({
    queryKey: ["dietas", alunaId],
    queryFn: () => fetchDietas(alunaId),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => removerDieta(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dietas", alunaId] });
      toast.success("Dieta removida");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = async (d: AlunaDieta) => {
    if (!d.arquivoPath) return;
    try {
      const url = await urlAssinadaDieta(d.arquivoPath);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Plano alimentar</h3>
          <p className="text-sm text-muted-foreground">
            Sobe o PDF ou cola o texto — a aluna lê direto no app.
          </p>
        </div>
        <Button
          className="gap-2 shrink-0"
          onClick={() => setEditando({ alunaId, titulo: "Plano alimentar", tipo: "pdf", vigenciaInicio: hoje(), ativo: true })}
        >
          <Plus className="h-4 w-4" /> Nova dieta
        </Button>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : dietas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma dieta enviada ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {dietas.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{d.titulo}</p>
                  {d.ativo
                    ? <Badge variant="secondary" className="text-[10px]">Ativa</Badge>
                    : <Badge variant="outline" className="text-[10px]">Inativa</Badge>}
                  <Badge variant="outline" className="text-[10px] uppercase">{d.tipo}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  A partir de {formatarData(d.vigenciaInicio)}
                  {d.vigenciaFim && ` até ${formatarData(d.vigenciaFim)}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {d.arquivoPath && (
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Baixar PDF" onClick={() => baixar(d)}>
                    <Download className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Editar dieta" onClick={() => setEditando(d)}>
                  <FileText className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                  aria-label="Excluir dieta"
                  onClick={() => apagar.mutate(d.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando && (
        <DietaDialog
          key={editando.id ?? "nova"}
          alunaId={alunaId}
          valor={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            qc.invalidateQueries({ queryKey: ["dietas", alunaId] });
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function DietaDialog({
  alunaId, valor, onFechar, onSalvo,
}: {
  alunaId: string;
  valor: Partial<AlunaDieta>;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState<Partial<AlunaDieta>>(valor);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const salvar = async () => {
    if (!form.titulo?.trim()) return toast.error("Dê um título à dieta");
    if (form.tipo === "texto" && !form.conteudo?.trim()) {
      return toast.error("Cole o conteúdo da dieta");
    }
    if (form.tipo === "pdf" && !arquivo && !form.arquivoPath) {
      return toast.error("Escolha o arquivo PDF");
    }

    setEnviando(true);
    try {
      let arquivoPath = form.arquivoPath ?? null;
      let arquivoNome = form.arquivoNome ?? null;

      if (form.tipo === "pdf" && arquivo) {
        const up = await uploadDietaPdf(alunaId, arquivo);
        arquivoPath = up.path;
        arquivoNome = up.nome;
      }

      await upsertDieta({ ...form, alunaId, arquivoPath, arquivoNome } as Partial<AlunaDieta> & { alunaId: string });
      toast.success("Dieta salva");
      onSalvo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar dieta" : "Nova dieta"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="d-titulo">Título</Label>
            <Input
              id="d-titulo"
              value={form.titulo ?? ""}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Plano alimentar — Agosto"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Formato</Label>
              <Select
                value={form.tipo ?? "pdf"}
                onValueChange={(v) => setForm({ ...form, tipo: v as TipoDieta })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">Arquivo PDF</SelectItem>
                  <SelectItem value="texto">Texto no app</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-ini">Vigência a partir de</Label>
              <Input
                id="d-ini" type="date"
                value={form.vigenciaInicio ?? hoje()}
                onChange={(e) => setForm({ ...form, vigenciaInicio: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-fim">Até (opcional)</Label>
              <Input
                id="d-fim" type="date"
                value={form.vigenciaFim ?? ""}
                onChange={(e) => setForm({ ...form, vigenciaFim: e.target.value || null })}
              />
            </div>
          </div>

          {form.tipo === "pdf" ? (
            <div className="space-y-2">
              <Label>Arquivo</Label>
              <input
                ref={inputRef} type="file" accept="application/pdf" className="sr-only"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" className="w-full gap-2" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {arquivo?.name ?? form.arquivoNome ?? "Escolher PDF"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Até 20 MB. O arquivo fica privado — só ela e o time acessam.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="d-conteudo">Conteúdo da dieta</Label>
              <Textarea
                id="d-conteudo" rows={12} className="font-mono text-xs"
                value={form.conteudo ?? ""}
                onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
                placeholder="Cole aqui a dieta em texto corrido."
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="d-obs">Observação</Label>
            <Textarea
              id="d-obs" rows={2}
              value={form.observacao ?? ""}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={enviando}>
            {enviando ? "Enviando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
