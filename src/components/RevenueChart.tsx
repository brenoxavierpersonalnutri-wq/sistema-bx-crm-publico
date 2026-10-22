import { useMemo, useState } from "react";
import { Consultation } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Target } from "lucide-react";
import {
  startOfDay,
  endOfDay,
  format,
  isWithinInterval,
  parseISO,
  isSameDay
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { getRevenueComposition } from "@/lib/revenueUtils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface RevenueChartProps {
  consultations: Consultation[];
  externalDateRange?: DateRange;
  hideDatePicker?: boolean;
}

const DAILY_GOAL = 2805;

export function RevenueChart({ consultations, externalDateRange, hideDatePicker }: RevenueChartProps) {
  const [internalDateRange, setInternalDateRange] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Use external date range if provided, otherwise fallback to internal
  const activeDateRange = externalDateRange || internalDateRange;

  const { totalRevenue, totalGoal, rangeLabel, revenueDetails } = useMemo(() => {
    if (!activeDateRange?.from) return { totalRevenue: 0, totalGoal: DAILY_GOAL, rangeLabel: "Selecione um período", revenueDetails: [] as Array<{ id: string; clientName: string; date: string; paymentMethod: string | null; gross: number; net: number; label: string; signalValue: number; replacedSignal: boolean; }> };

    const start = startOfDay(activeDateRange.from);
    const end = endOfDay(activeDateRange.to || activeDateRange.from);

    let weekdays = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) weekdays++;
      current.setDate(current.getDate() + 1);
    }
    
    // Check if it's a full month (e.g. 1st to 28-31st)
    const isFullMonth = start.getDate() === 1 && end.getDate() === new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    
    let goal = weekdays * DAILY_GOAL;
    if (isFullMonth) {
      goal = 56100;
    }

    // Format label for display
    let label = "";
    if (activeDateRange.to && !isSameDay(activeDateRange.from, activeDateRange.to)) {
      label = `${format(start, "dd/MM")} - ${format(activeDateRange.to, "dd/MM/yy")}`;
    } else {
      label = format(start, "dd 'de' MMMM", { locale: ptBR });
    }

    const matched = consultations.filter((c) => {
      const hasValue = (c.converted && c.ticketValue) || (c.gaveSignal && (c.signalValue || 0) > 0);
      if (!hasValue) return false;
      const consultDate = parseISO(c.date);
      return isWithinInterval(consultDate, { start, end });
    });

    const revenueDetails = matched
      .map((consultation) => {
        const composition = getRevenueComposition(consultation);
        return {
          id: consultation.id,
          clientName: consultation.clientName,
          date: consultation.date,
          paymentMethod: consultation.paymentMethod,
          gross: composition.gross,
          net: composition.net,
          label: composition.label,
          signalValue: consultation.signalValue || 0,
          replacedSignal: composition.replacesSignal,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName));

    const revenue = revenueDetails.reduce((sum, item) => sum + item.net, 0);

    return { totalRevenue: revenue, totalGoal: goal, rangeLabel: label, revenueDetails };
  }, [consultations, activeDateRange]);

  const percentage = totalGoal > 0 ? Math.round((totalRevenue / totalGoal) * 100) : 0;
  const remaining = Math.max(0, totalGoal - totalRevenue);


  return (
    <Card className="border-none shadow-md overflow-hidden h-full bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-4 border-b border-border/40 bg-muted/30">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-success/15 rounded-xl border border-success/20 shadow-sm">
              <DollarSign className="h-5 w-5 text-success" />
            </div>
            <div>
              <CardTitle className="font-display text-lg font-bold tracking-tight">Faturamento vs Meta</CardTitle>
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-black opacity-70">Desempenho Comercial</p>
            </div>
          </div>

          {!hideDatePicker && (
            <DateRangePicker
              value={activeDateRange}
              onChange={(range) => setInternalDateRange(range)}
              align="end"
              numberOfMonths={1}
              showClear
              size="default"
              triggerClassName="h-10 rounded-xl bg-background border-border/60 hover:bg-muted/50 hover:border-primary/30 shadow-sm font-bold"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6 px-6 pb-6">
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Target className="h-3 w-3" /> Progresso da Meta
              </span>
              <span className="text-sm font-black text-success">{percentage}%</span>
            </div>
            <div className="relative w-full h-9 bg-muted/50 rounded-xl overflow-hidden border border-border shadow-inner group">
              <div
                className="h-full bg-gradient-to-r from-success/80 to-success rounded-r-xl transition-all duration-1000 ease-out flex items-center justify-end pr-4 shadow-lg shadow-success/10 relative"
                style={{ width: `${Math.min(percentage, 100)}%` }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.1)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.1)_75%,transparent_75%,transparent)] bg-[length:20px_20px] opacity-20 animate-[move-bg_2s_linear_infinite]" />
                {percentage >= 15 && (
                  <span className="text-sm font-black text-white drop-shadow-md z-1">
                    {percentage}%
                  </span>
                )}
              </div>
              {percentage < 15 && (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-muted-foreground">
                  {percentage}%
                </span>
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
                <span className="text-[9px] font-black uppercase tracking-[0.4em]">
                  Meta Final: {totalGoal.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="flex flex-col items-start p-4 rounded-2xl bg-success/5 border border-success/10 hover:bg-success/10 transition-all hover:scale-[1.02] shadow-sm shadow-success/5 text-left"
            >
              <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-2 opacity-60">Faturado (líquido)</p>
              <p className="text-2xl font-black text-success leading-tight">
                R$ {totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-muted-foreground mt-2">Clique para ver a composição</p>
            </button>

            <div className="flex flex-col p-4 rounded-2xl bg-muted/40 border border-border hover:bg-muted/60 transition-all hover:scale-[1.02] cursor-default shadow-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-2 opacity-60">Meta</p>
              <p className="text-2xl font-black leading-tight text-foreground/90">
                R$ {totalGoal.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
              </p>
            </div>
            <div className="flex flex-col p-4 rounded-2xl bg-orange-500/5 border border-orange-500/10 hover:bg-orange-500/10 transition-all hover:scale-[1.02] cursor-default shadow-sm shadow-orange-500/5">
              <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-2 opacity-60">Faltante</p>
              <p className="text-2xl font-black text-orange-600 leading-tight">
                R$ {remaining.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Composição do faturamento líquido</DialogTitle>
            <DialogDescription>
              {rangeLabel} • {revenueDetails.length} {revenueDetails.length === 1 ? "registro" : "registros"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Total líquido</p>
              <p className="text-2xl font-black text-success">R$ {totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Regra do sinal</p>
              <p className="text-sm font-medium text-foreground">Se quitou o restante, entra só o valor cheio líquido.</p>
            </div>
          </div>

          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-3">
              {revenueDetails.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                  Nenhum faturamento encontrado nesse período.
                </div>
              ) : (
                revenueDetails.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-foreground">{item.clientName}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(parseISO(item.date), "dd/MM/yyyy")} • {item.label}
                          {item.paymentMethod ? ` • ${item.paymentMethod}` : ""}
                        </p>
                        {item.replacedSignal && item.signalValue > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Sinal anterior de R$ {item.signalValue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })} não é somado separado.
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">Líquido</p>
                        <p className="text-lg font-black text-success">R$ {item.net.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Bruto considerado</span>
                      <span className="font-semibold text-foreground">R$ {item.gross.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <style>{`
        @keyframes move-bg {
          0% { background-position: 0 0; }
          100% { background-position: 40px 0; }
        }
      `}</style>
    </Card>
  );
}
