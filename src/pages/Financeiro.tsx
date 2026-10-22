import { useState, useEffect, useCallback } from "react";
import { MonthlyData, getTotals, getExpenseBreakdown } from "@/data/dashboardData";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { RevenueExpenseChart } from "@/components/dashboard/RevenueExpenseChart";
import { ExpenseBreakdownChart } from "@/components/dashboard/ExpenseBreakdownChart";
import { ExpenseDetailCards } from "@/components/dashboard/ExpenseDetailCards";
import { MonthlyTable } from "@/components/dashboard/MonthlyTable";
import { EditMonthDialog } from "@/components/dashboard/EditMonthDialog";
import { ExpenseItemsDialog } from "@/components/dashboard/ExpenseItemsDialog";
import { FinanceDrillDialog } from "@/components/dashboard/FinanceDrillDialog";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Settings2 } from "lucide-react";
import { DateRange } from "react-day-picker";
import { metaApi } from "@/lib/metaApi";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";
import { WebhookSourcesCard } from "@/components/dashboard/WebhookSourcesCard";
import { GatewayWebhooksDialog } from "@/components/dashboard/GatewayWebhooksDialog";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const STORAGE_KEY_IDS = "metaAdAccountIds";
const STORAGE_KEY_LEGACY = "metaAdAccountId";

function loadMetaAccountIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_IDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    }
  } catch (_) {}
  const legacy = localStorage.getItem(STORAGE_KEY_LEGACY);
  return legacy ? [legacy] : [];
}

function saveMetaAccountIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY_IDS, JSON.stringify(ids));
  if (ids[0]) localStorage.setItem(STORAGE_KEY_LEGACY, ids[0]);
}

function monthLabel(d: Date): string {
  return format(d, "MMM/yy", { locale: ptBR })
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(".", "");
}

function mapRow(row: any): MonthlyData {
  return {
    month: row.month,
    faturamento: Number(row.faturamento) || 0,
    comissao: Number(row.comissao) || 0,
    trafego: Number(row.trafego) || 0,
    campanhaMeta: Number(row.campanha_meta) || 0,
    ferramentas: Number(row.ferramentas) || 0,
    colaboradores: Number(row.colaboradores) || 0,
    impostoPercent: Number(row.imposto_percent) || 0,
    whatsappCost: Number(row.whatsapp_cost) || 0,
    whatsappMessagesSent: Number(row.whatsapp_messages_sent) || 0,
    whatsappMessagesReceived: Number(row.whatsapp_messages_received) || 0,
  };
}

const MONTH_ORDER = [
  "Jan/26", "Fev/26", "Mar/26", "Abr/26", "Mai/26", "Jun/26",
  "Jul/26", "Ago/26", "Set/26", "Out/26", "Nov/26", "Dez/26",
];

export default function Financeiro() {
  const [data, setData] = useState<MonthlyData[]>([]);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const getCurrentMonthString = () => {
    return format(new Date(), "MMM/yy", { locale: ptBR })
      .replace(/^\w/, (c) => c.toUpperCase())
      .replace('.', '');
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthString());
  const [expenseDialog, setExpenseDialog] = useState<{ month: string; category: "ferramentas" | "colaboradores" | "imposto"; faturamento?: number } | null>(null);

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [drillType, setDrillType] = useState<"faturamento" | "gastos" | null>(null);
  const [metaAccountIds, setMetaAccountIds] = useState<string[]>(() => loadMetaAccountIds());
  const [metaConfigOpen, setMetaConfigOpen] = useState(false);
  const [gatewayWebhooksOpen, setGatewayWebhooksOpen] = useState(false);
  const [metaConfigInput, setMetaConfigInput] = useState<string>(() => loadMetaAccountIds().join(", "));
  const { toast } = useToast();

  const monthToDate = (monthStr: string): Date => {
    const monthMap: Record<string, number> = {
      "Jan": 0, "Fev": 1, "Mar": 2, "Abr": 3, "Mai": 4, "Jun": 5,
      "Jul": 6, "Ago": 7, "Set": 8, "Out": 9, "Nov": 10, "Dez": 11,
    };
    const [m, y] = monthStr.split("/");
    return new Date(2000 + parseInt(y), monthMap[m], 1);
  };

  const propagateRecurringExpenses = useCallback(async () => {
    // Get all recurring expense items
    const { data: recurringItems } = await supabase
      .from("expense_items")
      .select("*")
      .eq("recurring", true);

    if (!recurringItems || recurringItems.length === 0) return;

    // Group recurring items by name+category to find the source
    const recurringByKey = new Map<string, any>();
    for (const item of recurringItems as any[]) {
      const key = `${item.name.toLowerCase()}_${item.category}`;
      if (!recurringByKey.has(key)) {
        recurringByKey.set(key, item);
      }
    }

    // For each month in MONTH_ORDER, check if recurring items exist
    for (const month of MONTH_ORDER) {
      const { data: existingItems } = await supabase
        .from("expense_items")
        .select("name, category")
        .eq("month", month);

      const existingKeys = new Set(
        (existingItems || []).map((e: any) => `${e.name.toLowerCase()}_${e.category}`)
      );

      const toInsert: any[] = [];
      for (const [key, item] of recurringByKey) {
        if (!existingKeys.has(key)) {
          toInsert.push({
            month,
            category: item.category,
            name: item.name,
            value: Number(item.value),
            recurring: true,
          });
        }
      }

      if (toInsert.length > 0) {
        await supabase.from("expense_items").insert(toInsert);
        
        // Update monthly_data totals for this month
        for (const category of ["ferramentas", "colaboradores"] as const) {
          const { data: catItems } = await supabase
            .from("expense_items")
            .select("value")
            .eq("month", month)
            .eq("category", category);

          if (catItems && catItems.length > 0) {
            const total = catItems.reduce((s: number, r: any) => s + Number(r.value), 0);
            await supabase
              .from("monthly_data")
              .update({ [category]: total } as any)
              .eq("month", month);
          }
        }
      }
    }
  }, []);

  const fetchData = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from("monthly_data")
      .select("*");

    if (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
      return;
    }

    if (rows) {
      for (const row of rows as any[]) {
        const expected = Math.round(Number(row.trafego) * 0.1383 * 100) / 100;
        if (Number(row.trafego) > 0 && Math.abs(Number(row.campanha_meta) - expected) > 0.01) {
          await supabase
            .from("monthly_data")
            .update({ campanha_meta: expected } as any)
            .eq("month", row.month);
          row.campanha_meta = expected;
        }
      }

      const mapped = (rows as any[]).map(mapRow);
      mapped.sort((a, b) => MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month));
      setData(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      await propagateRecurringExpenses();
      await fetchData();
    };
    init();
    const handler = () => fetchData();
    window.addEventListener("refresh-finance", handler);
    return () => window.removeEventListener("refresh-finance", handler);
  }, [fetchData, propagateRecurringExpenses]);

  // Automated Meta Sync — multi-account, current month every 5 min + last 3 months on mount
  useEffect(() => {
    if (metaAccountIds.length === 0) return;

    const syncMonth = async (monthDate: Date) => {
      const start = format(startOfMonth(monthDate), "yyyy-MM-dd");
      const end = format(endOfMonth(monthDate), "yyyy-MM-dd");

      let totalSpend = 0;
      for (const accountId of metaAccountIds) {
        try {
          const res = await metaApi.getAccountInsights(accountId, start, end);
          if (res.success && res.data) {
            totalSpend += res.data.reduce(
              (acc, curr) => acc + (parseFloat(curr.spend) || 0),
              0
            );
          }
        } catch (err) {
          console.error(`Meta sync error for account ${accountId}:`, err);
        }
      }

      if (totalSpend <= 0) return;
      const formattedMonth = monthLabel(monthDate);
      const { error: upsertError } = await supabase
        .from("monthly_data")
        .upsert(
          {
            month: formattedMonth,
            trafego: totalSpend,
            campanha_meta: Math.round(totalSpend * 0.1383 * 100) / 100,
          } as any,
          { onConflict: "month" }
        );
      if (upsertError) {
        console.error(`Upsert error for ${formattedMonth}:`, upsertError);
      }
    };

    const syncCurrent = async () => {
      setSyncing(true);
      try {
        await syncMonth(new Date());
        fetchData();
      } finally {
        setSyncing(false);
      }
    };

    const syncBackfill = async () => {
      setSyncing(true);
      try {
        // Sincroniza últimos 3 meses (corrige meses passados retroativamente)
        const now = new Date();
        for (let i = 0; i <= 3; i++) {
          await syncMonth(subMonths(now, i));
        }
        fetchData();
      } finally {
        setSyncing(false);
      }
    };

    syncBackfill(); // run once on mount / when accounts change
    const interval = setInterval(syncCurrent, 300000);
    return () => clearInterval(interval);
  }, [fetchData, metaAccountIds.join(",")]);

  const handleSaveMetaAccounts = () => {
    const ids = metaConfigInput
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    saveMetaAccountIds(ids);
    setMetaAccountIds(ids);
    setMetaConfigOpen(false);
    toast({
      title: "Contas Meta salvas",
      description: `${ids.length} conta(s) serão sincronizadas.`,
    });
  };

  const handleSave = async (updated: MonthlyData) => {
    const campanhaMeta = updated.trafego * 0.1383;
    const { error } = await supabase
      .from("monthly_data")
      .update({
        faturamento: updated.faturamento,
        trafego: updated.trafego,
        campanha_meta: campanhaMeta,
        ferramentas: updated.ferramentas,
        colaboradores: updated.colaboradores,
      } as any)
      .eq("month", updated.month);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salvo com sucesso!" });
      fetchData();
    }
  };

  const filteredData = (() => {
    let result = selectedMonth === "all" ? data : data.filter(d => d.month === selectedMonth);
    if (dateRange?.from || dateRange?.to) {
      result = result.filter(d => {
        const mDate = monthToDate(d.month);
        const mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
        if (dateRange.from && mEnd < dateRange.from) return false;
        if (dateRange.to && mDate > dateRange.to) return false;
        return true;
      });
    }
    return result;
  })();
  const totals = getTotals(filteredData);
  const expenseBreakdown = getExpenseBreakdown(filteredData);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  const selectedMonthData = selectedMonth !== "all" ? data.find(d => d.month === selectedMonth) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <Link to="/">
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </Link>
                <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground tracking-tight">
                  Dashboard Financeiro
                </h1>
              </div>
              <p className="text-muted-foreground mt-1 ml-11">Visão geral de faturamento e gastos</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {syncing && (
                <div className="flex items-center gap-2 text-xs text-primary font-medium bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Sincronizando {metaAccountIds.length} conta(s) Meta...
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMetaConfigInput(metaAccountIds.join(", "));
                  setMetaConfigOpen(true);
                }}
              >
                <Settings2 className="h-4 w-4 mr-1.5" />
                Contas Meta ({metaAccountIds.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGatewayWebhooksOpen(true)}
              >
                <Settings2 className="h-4 w-4 mr-1.5" />
                Webhooks Gateway
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  toast({ title: "Propagando recorrentes..." });
                  await propagateRecurringExpenses();
                  await fetchData();
                  toast({ title: "Ferramentas/colaboradores recorrentes aplicados em todos os meses" });
                }}
              >
                <Settings2 className="h-4 w-4 mr-1.5" />
                Reaplicar recorrentes
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Selecione o mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {MONTH_ORDER.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DateRangeFilter
              dateRange={dateRange}
              onRangeChange={setDateRange}
              onClear={() => setDateRange(undefined)}
            />
          </div>
        </div>

        <div className="space-y-6">
          <SummaryCards
            faturamento={totals.totalFaturamento}
            comissao={totals.totalComissao}
            gastos={totals.totalGastos}
            lucro={totals.lucro}
            onClickFaturamento={() => setDrillType("faturamento")}
            onClickGastos={() => setDrillType("gastos")}
          />

          <ExpenseDetailCards
            trafego={totals.totalTrafego}
            campanha={totals.totalCampanha}
            ferramentas={totals.totalFerramentas}
            colaboradores={totals.totalColaboradores}
            imposto={totals.totalImposto}
            whatsappCost={totals.totalWhatsappCost}
            whatsappSent={totals.totalWhatsappSent}
            whatsappReceived={totals.totalWhatsappReceived}
            onClickFerramentas={() => {
              if (selectedMonth === "all") { toast({ title: "Selecione um mês primeiro" }); return; }
              setExpenseDialog({ month: selectedMonth, category: "ferramentas" });
            }}
            onClickColaboradores={() => {
              if (selectedMonth === "all") { toast({ title: "Selecione um mês primeiro" }); return; }
              setExpenseDialog({ month: selectedMonth, category: "colaboradores" });
            }}
            onClickImposto={() => {
              if (selectedMonth === "all" || !selectedMonthData) { toast({ title: "Selecione um mês primeiro" }); return; }
              setExpenseDialog({
                month: selectedMonth,
                category: "imposto",
                faturamento: selectedMonthData.faturamento,
              });
            }}
          />

          <WebhookSourcesCard
            monthsInScope={filteredData.map((d) => d.month)}
            totalFaturamento={totals.totalFaturamento}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RevenueExpenseChart data={filteredData} />
            <ExpenseBreakdownChart data={expenseBreakdown} />
          </div>

          <MonthlyTable data={filteredData} onEditMonth={(i) => {
            const monthName = filteredData[i].month;
            const realIndex = data.findIndex(d => d.month === monthName);
            setEditIndex(realIndex);
          }} />
        </div>
      </div>

      {editIndex !== null && (
        <EditMonthDialog
          data={data[editIndex]}
          open={editIndex !== null}
          onClose={() => setEditIndex(null)}
          onSave={handleSave}
        />
      )}

      {expenseDialog && (
        <ExpenseItemsDialog
          open={!!expenseDialog}
          onClose={() => setExpenseDialog(null)}
          month={expenseDialog.month}
          category={expenseDialog.category}
          title={
            expenseDialog.category === "ferramentas"
              ? "Ferramentas"
              : expenseDialog.category === "colaboradores"
                ? "Colaboradores"
                : "Imposto"
          }
          onTotalChanged={fetchData}
          faturamento={expenseDialog.faturamento}
        />
      )}

      <FinanceDrillDialog
        open={drillType !== null}
        onClose={() => setDrillType(null)}
        type={drillType}
        monthsInScope={filteredData.map(d => d.month)}
        data={filteredData}
      />

      <Dialog open={metaConfigOpen} onOpenChange={setMetaConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contas de Anúncio Meta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="meta-accounts">
              IDs das contas (separados por vírgula). Ex: <code>act_123, act_456</code>
            </Label>
            <Input
              id="meta-accounts"
              value={metaConfigInput}
              onChange={(e) => setMetaConfigInput(e.target.value)}
              placeholder="act_111, act_222, act_333"
            />
            <p className="text-xs text-muted-foreground">
              O gasto de todas as contas será somado e gravado em "Tráfego" do mês correspondente.
              A sincronização rebate os últimos 4 meses ao salvar e o mês atual a cada 5 minutos.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMetaConfigOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveMetaAccounts}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GatewayWebhooksDialog open={gatewayWebhooksOpen} onOpenChange={setGatewayWebhooksOpen} />
    </div>
  );
}
