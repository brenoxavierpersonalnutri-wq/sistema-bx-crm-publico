import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  funnelsApi,
  parseTrackedUrl,
  isValidUrl,
  type Funnel,
} from "@/lib/funnelsApi";
import { Loader2, Plus, Trash2, Link as LinkIcon, Sparkles } from "lucide-react";

interface SubFunnelDraft {
  id: string;
  name: string;
  tracked_url: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFunnel?: Funnel | null;
  parentId?: string | null;
  onSaved?: (funnel: Funnel) => void;
}

const newSubFunnelDraft = (): SubFunnelDraft => ({
  id: Math.random().toString(36).slice(2, 10),
  name: "",
  tracked_url: "",
});

export function CreateFunnelDialog({
  open,
  onOpenChange,
  initialFunnel,
  parentId,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [trackedUrl, setTrackedUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [subFunnels, setSubFunnels] = useState<SubFunnelDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const isEdit = !!initialFunnel;
  const isSubFunnelMode = !isEdit && !!parentId;

  useEffect(() => {
    if (open) {
      if (initialFunnel) {
        setName(initialFunnel.name);
        setTrackedUrl(initialFunnel.tracked_url || initialFunnel.destination_url || "");
        setNotes(initialFunnel.notes || "");
        setSubFunnels([]);
      } else {
        setName("");
        setTrackedUrl("");
        setNotes("");
        setSubFunnels([]);
      }
    }
  }, [open, initialFunnel]);

  const parsed = useMemo(() => parseTrackedUrl(trackedUrl), [trackedUrl]);
  const utmChips = useMemo(() => {
    if (!parsed) return [];
    return [
      parsed.utm_source && { label: "source", value: parsed.utm_source },
      parsed.utm_medium && { label: "medium", value: parsed.utm_medium },
      parsed.utm_campaign && { label: "campaign", value: parsed.utm_campaign },
      parsed.utm_term && { label: "term", value: parsed.utm_term },
      parsed.utm_content && { label: "content", value: parsed.utm_content },
    ].filter(Boolean) as { label: string; value: string }[];
  }, [parsed]);

  const addSubFunnel = () => setSubFunnels((prev) => [...prev, newSubFunnelDraft()]);
  const updateSubFunnel = (id: string, key: "name" | "tracked_url", value: string) =>
    setSubFunnels((prev) =>
      prev.map((sf) => (sf.id === id ? { ...sf, [key]: value } : sf)),
    );
  const removeSubFunnel = (id: string) =>
    setSubFunnels((prev) => prev.filter((sf) => sf.id !== id));

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Dê um nome ao seu funil.",
        variant: "destructive",
      });
      return;
    }
    if (!trackedUrl.trim() || !isValidUrl(trackedUrl)) {
      toast({
        title: "Link inválido",
        description: "Cole um link completo com UTMs (ex: https://site.com/page?utm_source=...).",
        variant: "destructive",
      });
      return;
    }

    const validSubs = subFunnels.filter((sf) => sf.name.trim() && sf.tracked_url.trim());
    const invalidSub = validSubs.find((sf) => !isValidUrl(sf.tracked_url));
    if (invalidSub) {
      toast({
        title: "Link de sub-funil inválido",
        description: `O link do sub-funil "${invalidSub.name}" não é uma URL válida.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const saved =
        isEdit && initialFunnel
          ? await funnelsApi.update(initialFunnel.id, {
              name,
              tracked_url: trackedUrl,
              notes,
            })
          : await funnelsApi.create({
              name,
              tracked_url: trackedUrl,
              notes,
              parent_id: parentId || null,
            });

      // Criar sub-funis se for novo funil pai
      if (!isEdit && !isSubFunnelMode && validSubs.length > 0) {
        for (const sf of validSubs) {
          await funnelsApi.create({
            name: sf.name,
            tracked_url: sf.tracked_url,
            parent_id: saved.id,
          });
        }
      }

      toast({
        title: isEdit ? "Funil atualizado" : isSubFunnelMode ? "Sub-funil criado" : "Funil criado",
        description: validSubs.length > 0
          ? `"${saved.name}" + ${validSubs.length} sub-funil${validSubs.length > 1 ? "is" : ""} salvos.`
          : `"${saved.name}" foi salvo.`,
      });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Erro ao salvar funil",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit
    ? "Editar funil"
    : isSubFunnelMode
      ? "Adicionar sub-funil"
      : "Criar novo funil";

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Cole o link completo com as UTMs já prontas. Se não souber montar, joga a URL na
            IA (ChatGPT/Claude) que ela monta pra você.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="name">Nome do funil *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                isSubFunnelMode
                  ? "Ex: Collab Influencer 1, Collab Influencer 2..."
                  : "Ex: Webinar de Maio, Funil de Collab, Indicação..."
              }
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tracked_url">Link com UTMs *</Label>
            <Input
              id="tracked_url"
              value={trackedUrl}
              onChange={(e) => setTrackedUrl(e.target.value)}
              placeholder="https://equipe.brenoxavier.com.br/individual?utm_source=social_selling&utm_campaign=social_selling"
              className="font-mono text-sm"
              type="url"
            />
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
              <span>
                Cola o link inteiro com as UTMs. Não sabe montar? Pede pra IA:{" "}
                <em>"monta uma URL com UTMs pro funil X"</em>.
              </span>
            </p>
          </div>

          {parsed && utmChips.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <LinkIcon className="h-3.5 w-3.5" />
                UTMs detectadas no link
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {utmChips.map((chip, i) => (
                  <Badge key={i} variant="outline" className="font-mono text-[11px]">
                    <span className="text-muted-foreground mr-1">{chip.label}:</span>
                    {chip.value}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {parsed && utmChips.length === 0 && trackedUrl.trim() && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <strong className="text-amber-700">Link sem UTMs.</strong> Esse link funciona, mas
              sem UTMs o sistema não consegue rastrear de onde veio o lead. Recomendado adicionar.
            </div>
          )}

          {!isEdit && !isSubFunnelMode && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">Sub-funis (opcional)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Variações desse funil. Ex: Funil de Collab → "Influencer 1", "Influencer 2".
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSubFunnel}
                  className="gap-1.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Sub-funil
                </Button>
              </div>

              {subFunnels.length > 0 && (
                <div className="space-y-2">
                  {subFunnels.map((sf, idx) => (
                    <div
                      key={sf.id}
                      className="rounded-lg border bg-muted/30 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Sub-funil #{idx + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSubFunnel(sf.id)}
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={sf.name}
                        onChange={(e) => updateSubFunnel(sf.id, "name", e.target.value)}
                        placeholder="Nome do sub-funil"
                        className="h-9"
                      />
                      <Input
                        value={sf.tracked_url}
                        onChange={(e) => updateSubFunnel(sf.id, "tracked_url", e.target.value)}
                        placeholder="Link com UTMs"
                        className="h-9 font-mono text-xs"
                        type="url"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2 pt-2 border-t">
            <Label htmlFor="notes">Anotações (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Onde você vai usar esse funil, qual oferta, etc."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit
              ? "Salvar alterações"
              : isSubFunnelMode
                ? "Criar sub-funil"
                : "Criar funil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
