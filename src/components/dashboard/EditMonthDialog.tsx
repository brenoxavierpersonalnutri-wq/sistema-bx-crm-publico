import { useState } from "react";
import { MonthlyData } from "@/data/dashboardData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Props {
  data: MonthlyData;
  open: boolean;
  onClose: () => void;
  onSave: (updated: MonthlyData) => void;
}

export function EditMonthDialog({ data, open, onClose, onSave }: Props) {
  const [form, setForm] = useState<MonthlyData>(data);

  const handleOpen = () => setForm(data);

  const campanhaMeta = Math.round(form.trafego * 0.1383 * 100) / 100;

  const fields: { key: keyof Omit<MonthlyData, "month">; label: string }[] = [
    { key: "faturamento", label: "Faturamento" },
    { key: "trafego", label: "Gastos - Tráfego" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); else handleOpen(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{data.month}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {fields.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">{label}</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form[key] || ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))
                }
                placeholder="R$ 0,00"
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">13,83% Meta (calculado automaticamente)</Label>
            <Input
              type="number"
              value={campanhaMeta}
              readOnly
              disabled
              className="bg-muted"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Ferramentas e Colaboradores: edite clicando nos cards do dashboard (selecione um mês primeiro).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => { onSave(form); onClose(); }}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
