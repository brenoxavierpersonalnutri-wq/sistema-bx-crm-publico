import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CalendarWithShortcuts } from "@/components/ui/calendar-with-shortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, CalendarIcon, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ExpenseRow {
  id?: string;
  name: string;
  value: string;
  date?: Date;
  recurring: boolean;
  saved?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  month: string;
  category: "ferramentas" | "colaboradores" | "imposto";
  title: string;
  onTotalChanged: () => void;
  faturamento?: number;
}

function emptyRow(): ExpenseRow {
  return { name: "", value: "", recurring: false, saved: false };
}

export function ExpenseItemsDialog({ open, onClose, month, category, title, onTotalChanged, faturamento }: Props) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchItems = async () => {
    const { data, error } = await supabase
      .from("expense_items")
      .select("*")
      .eq("month", month)
      .eq("category", category)
      .order("created_at", { ascending: true });

    if (!error && data) {
      const existing: ExpenseRow[] = data.map((r: any) => ({
        id: r.id,
        name: r.name,
        value: String(Number(r.value)),
        date: r.date ? new Date(r.date + "T00:00:00") : undefined,
        recurring: r.recurring || false,
        saved: true,
      }));

      // Always fetch recurring items from other months to see if we missed any
      const { data: recurringItems } = await supabase
        .from("expense_items")
        .select("*")
        .eq("category", category)
        .eq("recurring", true)
        .neq("month", month);

      if (recurringItems && recurringItems.length > 0) {
        const uniqueRecurring = new Map<string, ExpenseRow>();
        for (const r of recurringItems as any[]) {
          // Only add if it doesn't already exist in the current month's items
          if (!existing.some(e => e.name.toLowerCase() === r.name.toLowerCase())) {
            uniqueRecurring.set(r.name, {
              name: r.name,
              value: String(Number(r.value)),
              recurring: true,
              saved: false,
            });
          }
        }
        existing.push(...uniqueRecurring.values());
      }

      while (existing.length < 5) {
        existing.push(emptyRow());
      }
      setRows(existing);
    } else {
      setRows(Array.from({ length: 5 }, emptyRow));
    }
  };

  useEffect(() => {
    if (open) fetchItems();
  }, [open, month, category]);

  const total = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);

  const updateRow = (index: number, field: keyof ExpenseRow, val: any) => {
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, [field]: val, saved: false } : r));
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const removeRow = async (index: number) => {
    const row = rows[index];
    if (row.id) {
      await supabase.from("expense_items").delete().eq("id", row.id);
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
    await updateMonthlyTotal();
  };

  const saveAll = async () => {
    setLoading(true);
    try {
      for (const row of rows) {
        if (!row.name.trim() || !row.value) continue;
        const payload = {
          month,
          category,
          name: row.name.trim(),
          value: parseFloat(row.value) || 0,
          date: row.date ? format(row.date, "yyyy-MM-dd") : null,
          recurring: row.recurring,
        };

        if (row.id) {
          await supabase.from("expense_items").update(payload).eq("id", row.id);
        } else {
          await supabase.from("expense_items").insert(payload);
        }
      }
      await updateMonthlyTotal();
      toast({ title: "Salvo com sucesso!" });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const updateMonthlyTotal = async () => {
    const { data } = await supabase
      .from("expense_items")
      .select("value")
      .eq("month", month)
      .eq("category", category);

    const newTotal = (data || []).reduce((s, r: any) => s + Number(r.value), 0);
    
    if (category === "imposto") {
      const percent = faturamento && faturamento > 0 ? (newTotal / faturamento) * 100 : 0;
      await supabase.from("monthly_data").update({ imposto_percent: percent } as any).eq("month", month);
    } else {
      const field = category === "ferramentas" ? "ferramentas" : "colaboradores";
      await supabase.from("monthly_data").update({ [field]: newTotal } as any).eq("month", month);
    }
    onTotalChanged();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display">{title} — {month}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 overflow-y-auto flex-1 pr-1">
          <div className="grid grid-cols-[1fr_110px_120px_60px_36px] gap-2 text-xs text-muted-foreground font-medium px-1">
            <span>Nome</span>
            <span>Valor (R$)</span>
            <span>Data</span>
            <span>Mensal</span>
            <span></span>
          </div>

          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_120px_60px_36px] gap-2 items-center">
              <Input
                placeholder="Ex: Semrush"
                value={row.name}
                onChange={(e) => updateRow(i, "name", e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                type="number"
                placeholder="0,00"
                value={row.value}
                onChange={(e) => updateRow(i, "value", e.target.value)}
                className="h-9 text-sm"
                min={0}
                step={0.01}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-9 justify-start text-left font-normal text-xs", !row.date && "text-muted-foreground")}
                  >
                    <CalendarIcon className="h-3 w-3 mr-1" />
                    {row.date ? format(row.date, "dd/MM/yy") : "Data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarWithShortcuts
                    selected={row.date}
                    onSelect={(d) => updateRow(i, "date", d)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex justify-center">
                <Checkbox
                  checked={row.recurring}
                  onCheckedChange={(checked) => updateRow(i, "recurring", !!checked)}
                />
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar linha
          </Button>
          <span className="text-lg font-display font-bold text-foreground">
            Total: {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={saveAll} disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            {loading ? "Salvando..." : "Salvar tudo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
