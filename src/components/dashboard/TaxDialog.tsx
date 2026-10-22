import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
  month: string;
  currentPercent: number;
  faturamento: number;
  onSaved: () => void;
}

export function TaxDialog({ open, onClose, month, currentPercent, faturamento, onSaved }: Props) {
  const [percent, setPercent] = useState(String(currentPercent));
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const pct = parseFloat(percent) || 0;
  const calculatedValue = faturamento * pct / 100;

  const save = async () => {
    setLoading(true);
    const { error } = await supabase
      .from("monthly_data")
      .update({ imposto_percent: pct } as any)
      .eq("month", month);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Imposto salvo!" });
      onSaved();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Imposto — {month}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Faturamento do mês</Label>
            <p className="text-lg font-display font-bold text-foreground">
              {faturamento.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Porcentagem do imposto (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="Ex: 6"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Valor estimado do imposto</Label>
            <p className="text-lg font-display font-bold text-destructive">
              {calculatedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            {loading ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
