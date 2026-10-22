import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShoppingBag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ProgramOption,
  fetchAllPrograms,
  addCustomProgram,
  archiveCustomProgram,
} from "@/data/programs";
import { supabase } from "@/integrations/supabase/client";
import {
  ProgramType,
  PlanDuration,
  PROGRAM_LABELS,
  DURATION_LABELS,
} from "@/lib/alunaTypes";

/**
 * Upsert: tenta UPDATE; se não achou linha no DB (programa padrão ainda
 * não persistido), faz INSERT para garantir que existe antes de editar/arquivar.
 */
async function upsertProgram(
  opt: ProgramOption,
  updates: Partial<Omit<ProgramOption, "value">>
): Promise<void> {
  const payload = {
    label: updates.label ?? opt.label,
    price: updates.price ?? opt.price,
    programa: updates.programa ?? opt.programa,
    duracao: updates.duracao ?? opt.duracao,
  };

  const { data: updated, error: updateErr } = await supabase
    .from("custom_programs")
    .update(payload)
    .eq("value", opt.value)
    .select("value");

  if (updateErr) throw updateErr;
  if (updated && updated.length > 0) return; // atualizado com sucesso

  // Programa padrão ainda não no DB — INSERT
  const { error: insertErr } = await supabase
    .from("custom_programs")
    .insert({ value: opt.value, ...payload });

  if (insertErr && (insertErr as any).code !== "23505") throw insertErr;
}

export function ProgramsManager() {
  const { toast } = useToast();
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingArchive, setPendingArchive] = useState<ProgramOption | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramOption | null>(null);
  const [saving, setSaving] = useState(false);

  // Form
  const [formLabel, setFormLabel] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formType, setFormType] = useState<ProgramType>("consultoria_slim");
  const [formDuration, setFormDuration] = useState<PlanDuration>("1");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllPrograms();
      setPrograms(data);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar programas",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormLabel("");
    setFormPrice("");
    setFormType("consultoria_slim");
    setFormDuration("1");
    setDialogOpen(true);
  };

  const openEdit = (prog: ProgramOption) => {
    setEditing(prog);
    setFormLabel(prog.label);
    setFormPrice(String(prog.price));
    setFormType(prog.programa);
    setFormDuration(prog.duracao);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formLabel.trim()) {
      toast({ title: "Informe o nome do programa", variant: "destructive" });
      return;
    }
    const price = Number(formPrice);
    if (!formPrice || isNaN(price) || price < 0) {
      toast({ title: "Informe um preço válido", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await upsertProgram(editing, {
          label: formLabel.trim(),
          price,
          programa: formType,
          duracao: formDuration,
        });
        toast({ title: "Programa atualizado" });
      } else {
        await addCustomProgram({
          label: formLabel.trim(),
          price,
          programa: formType,
          duracao: formDuration,
        });
        toast({ title: "Programa criado" });
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast({
        title: "Erro ao salvar",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!pendingArchive) return;
    try {
      // Garante que o programa existe no DB antes de arquivar
      await upsertProgram(pendingArchive, {});
      await archiveCustomProgram(pendingArchive.value);
      setPrograms((prev) => prev.filter((p) => p.value !== pendingArchive.value));
      toast({
        title: "Programa arquivado",
        description: "Não aparecerá em novas vendas. Histórico das alunas mantido.",
      });
    } catch (err: any) {
      toast({
        title: "Erro ao arquivar",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setPendingArchive(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Programas de venda
          </h2>
          <p className="text-xs text-muted-foreground">
            Gerencie os programas que aparecem para seleção ao registrar uma venda.
          </p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Novo programa
        </Button>
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Carregando programas...
          </CardContent>
        </Card>
      ) : programs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <ShoppingBag className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">Nenhum programa cadastrado</p>
              <p className="text-xs text-muted-foreground">
                Crie os programas que você vende (nome, preço, duração).
              </p>
            </div>
            <Button onClick={openCreate} size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Criar primeiro programa
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {programs.map((prog) => (
            <Card key={prog.value}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{prog.label}</span>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      R$ {prog.price.toLocaleString("pt-BR")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {PROGRAM_LABELS[prog.programa] ?? prog.programa}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {DURATION_LABELS[prog.duracao] ?? `${prog.duracao}m`}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(prog)}
                    className="h-8 w-8 p-0"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingArchive(prog)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    title="Arquivar (remove da lista de vendas, mantém histórico)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Dialog criar / editar ─────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar programa" : "Novo programa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="prog-label">Nome</Label>
              <Input
                id="prog-label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Ex: MGMD 12M"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prog-price">Preço (R$)</Label>
              <Input
                id="prog-price"
                type="number"
                min={0}
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                placeholder="997"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={formType}
                  onValueChange={(v) => setFormType(v as ProgramType)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PROGRAM_LABELS) as [ProgramType, string][]).map(
                      ([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">
                          {v}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Duração</Label>
                <Select
                  value={formDuration}
                  onValueChange={(v) => setFormDuration(v as PlanDuration)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(DURATION_LABELS) as [PlanDuration, string][]).map(
                      ([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">
                          {v}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full"
            >
              {saving
                ? "Salvando..."
                : editing
                ? "Salvar alterações"
                : "Criar programa"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm arquivar ─────────────────────────────────────── */}
      <AlertDialog
        open={!!pendingArchive}
        onOpenChange={(o) => !o && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar programa?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pendingArchive?.label}</strong> não aparecerá mais na lista de
              novas vendas. O histórico das alunas que já compraram será mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
