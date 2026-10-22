import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Filter,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
  Power,
  Sparkles,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { CreateFunnelDialog } from "@/components/funnels/CreateFunnelDialog";
import { funnelsApi, type Funnel, type FunnelWithChildren } from "@/lib/funnelsApi";

interface Props {
  onChange?: (funnels: FunnelWithChildren[]) => void;
}

export function CustomFunnelsSection({ onChange }: Props) {
  const { toast } = useToast();
  const [funnels, setFunnels] = useState<FunnelWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Funnel | null>(null);
  const [parentForSubFunnel, setParentForSubFunnel] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Funnel | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await funnelsApi.getAllNested();
      setFunnels(data);
      setTableMissing(false);
      onChange?.(data);
      // Auto-expand funis com sub-funis
      setExpanded(new Set(data.filter((f) => f.children.length > 0).map((f) => f.id)));
    } catch (err: any) {
      const msg = err?.message?.toLowerCase() || "";
      if (msg.includes("relation") && msg.includes("does not exist")) {
        setTableMissing(true);
      } else if (msg.includes("column") && msg.includes("does not exist")) {
        setTableMissing(true);
      } else {
        toast({
          title: "Erro ao carregar funis",
          description: err?.message || "Tente novamente.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [toast, onChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = () => {
    setEditing(null);
    setParentForSubFunnel(null);
    setDialogOpen(true);
  };

  const handleAddSubFunnel = (parentId: string) => {
    setEditing(null);
    setParentForSubFunnel(parentId);
    setDialogOpen(true);
  };

  const handleEdit = (funnel: Funnel) => {
    setEditing(funnel);
    setParentForSubFunnel(null);
    setDialogOpen(true);
  };

  const handleSaved = () => {
    load();
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleActive = async (funnel: Funnel) => {
    try {
      await funnelsApi.update(funnel.id, { active: !funnel.active });
      await load();
      toast({
        title: !funnel.active ? "Funil ativado" : "Funil pausado",
        description: `"${funnel.name}" agora está ${!funnel.active ? "ativo" : "pausado"}.`,
      });
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await funnelsApi.delete(pendingDelete.id);
      await load();
      toast({
        title: "Funil excluído",
        description: `"${pendingDelete.name}" foi removido (e seus sub-funis se houver).`,
      });
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err?.message, variant: "destructive" });
    } finally {
      setPendingDelete(null);
    }
  };

  const copyTrackedUrl = async (funnel: Funnel) => {
    const url = funnel.tracked_url || funnel.destination_url;
    if (!url) {
      toast({
        title: "Sem URL configurada",
        description: "Esse funil não tem link com tracking.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado", description: "Link com UTMs na área de transferência." });
    } catch {
      toast({ title: "Erro ao copiar", variant: "destructive" });
    }
  };

  const renderUtmChips = (funnel: Funnel, compact: boolean = false) => {
    const chips = [
      funnel.utm_source && { label: "src", value: funnel.utm_source },
      funnel.utm_medium && { label: "med", value: funnel.utm_medium },
      funnel.utm_campaign && { label: "camp", value: funnel.utm_campaign },
      funnel.utm_content && { label: "cnt", value: funnel.utm_content },
    ].filter(Boolean) as { label: string; value: string }[];

    if (chips.length === 0) return null;

    return (
      <div className="flex items-center gap-1 flex-wrap">
        {chips.map((chip, i) => (
          <Badge
            key={i}
            variant="outline"
            className={`font-mono ${compact ? "text-[10px] px-1.5 py-0" : "text-[11px]"}`}
          >
            <span className="text-muted-foreground mr-0.5">{chip.label}:</span>
            {chip.value}
          </Badge>
        ))}
      </div>
    );
  };

  if (tableMissing) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-4 px-5 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Funis personalizados ainda não habilitados</p>
            <p className="text-muted-foreground">
              Para liberar a criação de funis aqui, aplique as migrations SQL no Supabase
              (arquivos em <code className="text-xs bg-background rounded px-1.5 py-0.5">supabase/migrations/</code>{" "}
              com prefixo <code className="text-xs bg-background rounded px-1.5 py-0.5">202605181...</code>).
              Depois, recarregue a página.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            Meus funis personalizados
          </h2>
          <p className="text-xs text-muted-foreground">
            Cole o link com UTMs prontas. Crie sub-funis pra variações (ex: collab por influencer).
          </p>
        </div>
        <Button onClick={handleCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Criar funil
        </Button>
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Carregando funis...
          </CardContent>
        </Card>
      ) : funnels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <Filter className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">Nenhum funil personalizado ainda</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Clica em "Criar funil" e cola o link com UTMs prontas. Se quiser variações
                (collab influencer 1, collab influencer 2, etc.), adiciona como sub-funis.
              </p>
            </div>
            <Button onClick={handleCreate} size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Criar primeiro funil
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {funnels.map((funnel) => {
            const isExpanded = expanded.has(funnel.id);
            const hasChildren = funnel.children.length > 0;

            return (
              <Card key={funnel.id} className={!funnel.active ? "opacity-60" : ""}>
                <CardContent className="p-4 space-y-2.5">
                  {/* Funil pai */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {hasChildren && (
                          <button
                            onClick={() => toggleExpand(funnel.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={isExpanded ? "Recolher" : "Expandir"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        <h3 className="font-semibold text-base truncate">{funnel.name}</h3>
                        {hasChildren && (
                          <Badge variant="secondary" className="text-[10px]">
                            {funnel.children.length} sub-fun{funnel.children.length > 1 ? "is" : "il"}
                          </Badge>
                        )}
                        {!funnel.active && (
                          <Badge variant="secondary" className="text-[10px]">
                            Pausado
                          </Badge>
                        )}
                      </div>
                      {renderUtmChips(funnel)}
                      {funnel.notes && (
                        <p className="text-xs text-muted-foreground italic">{funnel.notes}</p>
                      )}
                    </div>
                  </div>

                  {funnel.tracked_url && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <code className="text-[11px] break-all flex-1 bg-muted/50 rounded px-2 py-1.5">
                        {funnel.tracked_url}
                      </code>
                    </div>
                  )}

                  <div className="flex items-center gap-1 pt-1 border-t flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyTrackedUrl(funnel)}
                      className="h-7 gap-1 text-xs"
                      title="Copiar link"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </Button>
                    {funnel.tracked_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(funnel.tracked_url!, "_blank", "noopener")}
                        className="h-7 w-7 p-0"
                        title="Abrir em nova aba"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAddSubFunnel(funnel.id)}
                      className="h-7 gap-1 text-xs"
                      title="Adicionar sub-funil"
                    >
                      <Plus className="h-3 w-3" />
                      Sub-funil
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(funnel)}
                      className="h-7 w-7 p-0"
                      title={funnel.active ? "Pausar" : "Ativar"}
                    >
                      <Power className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(funnel)}
                      className="h-7 w-7 p-0"
                      title="Editar"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(funnel)}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      title="Excluir"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Sub-funis */}
                  {hasChildren && isExpanded && (
                    <div className="pt-2 pl-4 border-l-2 border-muted space-y-2">
                      {funnel.children.map((child) => (
                        <div
                          key={child.id}
                          className={`rounded-md border bg-muted/20 p-2.5 space-y-1.5 ${
                            !child.active ? "opacity-60" : ""
                          }`}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm truncate">{child.name}</span>
                            {!child.active && (
                              <Badge variant="secondary" className="text-[9px]">
                                Pausado
                              </Badge>
                            )}
                          </div>
                          {renderUtmChips(child, true)}
                          {child.tracked_url && (
                            <code className="text-[10px] block break-all bg-background rounded px-1.5 py-1">
                              {child.tracked_url}
                            </code>
                          )}
                          <div className="flex items-center gap-1 pt-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyTrackedUrl(child)}
                              className="h-6 gap-1 text-[10px]"
                            >
                              <Copy className="h-2.5 w-2.5" />
                              Copiar
                            </Button>
                            {child.tracked_url && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(child.tracked_url!, "_blank", "noopener")}
                                className="h-6 w-6 p-0"
                                title="Abrir em nova aba"
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Button>
                            )}
                            <div className="flex-1" />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(child)}
                              className="h-6 w-6 p-0"
                              title={child.active ? "Pausar" : "Ativar"}
                            >
                              <Power className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(child)}
                              className="h-6 w-6 p-0"
                              title="Editar"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingDelete(child)}
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              title="Excluir"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateFunnelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialFunnel={editing}
        parentId={parentForSubFunnel}
        onSaved={handleSaved}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funil?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{pendingDelete?.name}</strong>?
              {pendingDelete && !pendingDelete.parent_id && (
                <> Os sub-funis dele serão excluídos juntos.</>
              )}{" "}
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
