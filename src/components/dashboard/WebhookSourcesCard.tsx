import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Webhook, AlertCircle, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivacy } from "@/hooks/usePrivacy";

interface Props {
  /** Lista de meses no escopo, no formato "Abr/26" */
  monthsInScope: string[];
  /** Faturamento total (vindo do monthly_data) para mostrar a diferença "Outros" */
  totalFaturamento: number;
}

interface SourceRow {
  source: string;
  count: number;
  total: number;
}

interface ManualEntry {
  id: string;
  source: string;
  value: number;
  created_at: string;
  month: string;
}

const MONTH_TO_IDX: Record<string, number> = {
  Jan: 0, Fev: 1, Mar: 2, Abr: 3, Mai: 4, Jun: 5,
  Jul: 6, Ago: 7, Set: 8, Out: 9, Nov: 10, Dez: 11,
};

const IDX_TO_MONTH: Record<number, string> = {
  0: "Jan", 1: "Fev", 2: "Mar", 3: "Abr", 4: "Mai", 5: "Jun",
  6: "Jul", 7: "Ago", 8: "Set", 9: "Out", 10: "Nov", 11: "Dez",
};

const MONTH_OPTIONS = [
  "Jan/26","Fev/26","Mar/26","Abr/26","Mai/26","Jun/26",
  "Jul/26","Ago/26","Set/26","Out/26","Nov/26","Dez/26",
];

function monthToDate(m: string): Date {
  const [mo, yr] = m.split("/");
  return new Date(2000 + parseInt(yr), MONTH_TO_IDX[mo] ?? 0, 1);
}

function dateToMonthLabel(iso: string): string {
  const d = new Date(iso);
  return `${IDX_TO_MONTH[d.getMonth()]}/${d.getFullYear().toString().slice(2)}`;
}

function monthsToDateRange(months: string[]): { from: string; to: string } | null {
  if (!months.length) return null;
  const dates = months.map(monthToDate);
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  const to = new Date(max.getFullYear(), max.getMonth() + 1, 1);
  return { from: min.toISOString(), to: to.toISOString() };
}

const KNOWN_SOURCES = ["PAGTRUST", "PAGTRUST_2", "PAGTRUST_3", "HOTMART", "KIWIFY", "MANUAL"];
const MANUAL_FLAG_EMAIL = "manual_entry@dashboard.local";

export function WebhookSourcesCard({ monthsInScope, totalFaturamento }: Props) {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [manualOpen, setManualOpen] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [manualMonth, setManualMonth] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    const fetchSources = async () => {
      setLoading(true);
      const range = monthsToDateRange(monthsInScope);
      if (!range) {
        setRows([]);
        setManualEntries([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("sales_events")
        .select("id, source, value, created_at, customer_email")
        .gte("created_at", range.from)
        .lt("created_at", range.to);

      if (error) {
        console.error("WebhookSourcesCard error:", error);
        setRows([]);
        setManualEntries([]);
        setLoading(false);
        return;
      }

      const map = new Map<string, SourceRow>();
      const manuals: ManualEntry[] = [];
      for (const ev of (data || []) as any[]) {
        const src = String(ev.source || "DESCONHECIDO").toUpperCase();
        const cur = map.get(src) || { source: src, count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(ev.value) || 0;
        map.set(src, cur);

        if (ev.customer_email === MANUAL_FLAG_EMAIL) {
          manuals.push({
            id: ev.id,
            source: src,
            value: Number(ev.value) || 0,
            created_at: ev.created_at,
            month: dateToMonthLabel(ev.created_at),
          });
        }
      }
      for (const known of KNOWN_SOURCES) {
        if (!map.has(known)) map.set(known, { source: known, count: 0, total: 0 });
      }
      const arr = Array.from(map.values()).sort((a, b) => b.total - a.total);
      setRows(arr);
      setManualEntries(manuals.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setLoading(false);
    };
    fetchSources();
  }, [monthsInScope.join(","), reloadKey]);

  const openManual = (source: string) => {
    setManualOpen(source);
    setManualValue("");
    // Default: primeiro mês do escopo (que é o que o usuário está vendo no topo)
    setManualMonth(monthsInScope[0] || MONTH_OPTIONS[new Date().getMonth()]);
  };

  const saveManual = async () => {
    if (!manualOpen || !manualValue || !manualMonth) return;
    const value = parseFloat(manualValue.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    if (!MONTH_TO_IDX.hasOwnProperty(manualMonth.split("/")[0])) {
      toast({ title: "Mês inválido. Use Mai/26", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("approved", true)
        .limit(1)
        .single();
      if (!profile) throw new Error("Perfil não encontrado");

      // FIX: força created_at no 1º dia do mês selecionado (12:00 para evitar timezone shift)
      const target = monthToDate(manualMonth);
      const createdAt = new Date(target.getFullYear(), target.getMonth(), 1, 12, 0, 0).toISOString();

      const { error: insErr } = await supabase.from("sales_events").insert({
        profile_id: profile.id,
        source: manualOpen,
        value,
        customer_email: MANUAL_FLAG_EMAIL,
        created_at: createdAt,
      } as any);
      if (insErr) throw insErr;

      const { data: existing } = await supabase
        .from("monthly_data")
        .select("faturamento, comissao")
        .eq("month", manualMonth)
        .maybeSingle();
      if (existing) {
        await supabase.from("monthly_data").update({
          faturamento: Number(existing.faturamento || 0) + value,
          comissao: Number(existing.comissao || 0) + value,
          updated_at: new Date().toISOString(),
        }).eq("month", manualMonth);
      } else {
        await supabase.from("monthly_data").insert({
          month: manualMonth,
          faturamento: value,
          comissao: value,
        });
      }

      toast({ title: `Lançado em ${manualOpen} • ${manualMonth}` });
      setManualOpen(null);
      setReloadKey((k) => k + 1);
      // recarrega página financeiro inteira para refletir nos cards do topo
      setTimeout(() => window.dispatchEvent(new Event("refresh-finance")), 100);
    } catch (e: any) {
      toast({ title: "Erro ao lançar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteManual = async (entry: ManualEntry) => {
    if (!confirm(`Apagar lançamento manual de ${fmt(entry.value)} em ${entry.source} (${entry.month})?`)) return;
    try {
      const { error: delErr } = await supabase.from("sales_events").delete().eq("id", entry.id);
      if (delErr) throw delErr;

      const { data: existing } = await supabase
        .from("monthly_data")
        .select("faturamento, comissao")
        .eq("month", entry.month)
        .maybeSingle();
      if (existing) {
        await supabase.from("monthly_data").update({
          faturamento: Math.max(0, Number(existing.faturamento || 0) - entry.value),
          comissao: Math.max(0, Number(existing.comissao || 0) - entry.value),
          updated_at: new Date().toISOString(),
        }).eq("month", entry.month);
      }

      toast({ title: `Removido • ${entry.source} • ${entry.month}` });
      setReloadKey((k) => k + 1);
      setTimeout(() => window.dispatchEvent(new Event("refresh-finance")), 100);
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e.message, variant: "destructive" });
    }
  };

  const { formatMoney } = usePrivacy();
  const fmt = (v: number) => formatMoney(v);

  const totalWebhook = rows.reduce((s, r) => s + r.total, 0);
  const outros = Math.max(0, totalFaturamento - totalWebhook);
  const grandTotal = totalWebhook + outros;

  const manualBySource = manualEntries.reduce<Record<string, ManualEntry[]>>((acc, e) => {
    (acc[e.source] ||= []).push(e);
    return acc;
  }, {});

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" />
          <CardTitle className="font-display text-base">
            Webhooks de Faturamento
          </CardTitle>
        </div>
        <span className="text-xs text-muted-foreground">
          {monthsInScope.length === 1 ? monthsInScope[0] : `${monthsInScope.length} meses`}
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid items-center text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/50 pb-1.5" style={{ gridTemplateColumns: "4fr 2fr 3fr 3fr 1fr" }}>
              <div>Origem</div>
              <div className="text-right">Vendas</div>
              <div className="text-right">Bruto</div>
              <div className="text-right">% do bruto</div>
              <div className="text-right">+</div>
            </div>
            {rows.map((r) => {
              const pct = totalWebhook > 0 ? (r.total / totalWebhook) * 100 : 0;
              const isMute = r.count === 0;
              const manuals = manualBySource[r.source] || [];
              const isExpanded = expanded[r.source];
              return (
                <div key={r.source}>
                  <div
                    className={`grid items-center py-1.5 text-sm ${isMute ? "text-muted-foreground/60" : "text-foreground"}`}
                    style={{ gridTemplateColumns: "4fr 2fr 3fr 3fr 1fr" }}
                  >
                    <div className="font-medium flex items-center gap-1.5">
                      {manuals.length > 0 && (
                        <button
                          onClick={() => setExpanded((s) => ({ ...s, [r.source]: !s[r.source] }))}
                          className="hover:text-primary"
                          title={`${manuals.length} lançamento(s) manual(is)`}
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {r.source}
                      {manuals.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                          {manuals.length} manual
                        </span>
                      )}
                      {isMute && (
                        <span title="Nenhum evento recebido neste período">
                          <AlertCircle className="h-3 w-3 text-warning" />
                        </span>
                      )}
                    </div>
                    <div className="text-right tabular-nums">{r.count}</div>
                    <div className="text-right tabular-nums">
                      {r.count > 0 ? fmt(r.total) : "—"}
                    </div>
                    <div className="text-right tabular-nums text-muted-foreground">
                      {r.count > 0 ? `${pct.toFixed(1)}%` : "—"}
                    </div>
                    <div className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => openManual(r.source)}
                        title={`Lançar venda manual nesta conta (${r.source})`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && manuals.length > 0 && (
                    <div className="ml-6 mb-2 border-l-2 border-primary/20 pl-3 space-y-1">
                      {manuals.map((e) => (
                        <div key={e.id} className="flex items-center justify-between text-xs py-1">
                          <div className="text-muted-foreground">
                            <span className="font-medium text-foreground">{fmt(e.value)}</span>
                            <span className="ml-2">• {e.month}</span>
                            <span className="ml-2 text-[10px]">manual</span>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => deleteManual(e)}
                            title="Apagar este lançamento e subtrair do total"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="grid grid-cols-12 items-center pt-2 mt-1 border-t border-border/50 text-sm">
              <div className="col-span-4 text-muted-foreground italic">
                Outros (manual / sem webhook)
              </div>
              <div className="col-span-2 text-right text-muted-foreground">—</div>
              <div className="col-span-3 text-right tabular-nums text-muted-foreground">
                {fmt(outros)}
              </div>
              <div className="col-span-3 text-right text-muted-foreground">
                {grandTotal > 0 ? `${((outros / grandTotal) * 100).toFixed(1)}%` : "—"}
              </div>
            </div>

            <div className="grid grid-cols-12 items-center pt-2 mt-1 border-t border-border font-semibold text-sm">
              <div className="col-span-4">Total bruto consolidado</div>
              <div className="col-span-2 text-right" />
              <div className="col-span-3 text-right tabular-nums text-success">
                {fmt(grandTotal)}
              </div>
              <div className="col-span-3" />
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!manualOpen} onOpenChange={(o) => !o && setManualOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar venda manual — {manualOpen}</DialogTitle>
            <DialogDescription>
              Use para subir um valor que entrou nessa conta mas não foi puxado pelo webhook.
              O valor será somado em Faturamento e Comissão do mês escolhido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Mês de referência</Label>
              <Select value={manualMonth} onValueChange={setManualMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o mês" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor bruto (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="1500.00"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualOpen(null)}>Cancelar</Button>
            <Button onClick={saveManual} disabled={saving}>
              {saving ? "Lançando..." : "Lançar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
