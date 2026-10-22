import { Consultation, DailyStats } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DailyBreakdownProps {
  consultations: Consultation[];
}

function getDailyStats(consultations: Consultation[]): DailyStats[] {
  const map = new Map<string, DailyStats>();

  consultations.forEach((c) => {
    if (!map.has(c.date)) {
      map.set(c.date, { date: c.date, scheduled: 0, converted: 0, noShow: 0, notConverted: 0 });
    }
    const stats = map.get(c.date)!;
    stats.scheduled++;
    if (c.status === "convertido") stats.converted++;
    else if (c.status === "no-show") stats.noShow++;
    else stats.notConverted++;
  });

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export function DailyBreakdown({ consultations }: DailyBreakdownProps) {
  const dailyStats = getDailyStats(consultations);

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-lg">Resumo Diário</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dailyStats.map((day) => {
          const convRate = day.scheduled > 0 ? Math.round((day.converted / day.scheduled) * 100) : 0;
          return (
            <div
              key={day.date}
              className="flex items-center gap-4 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <div className="min-w-[80px]">
                <p className="text-sm font-semibold">
                  {format(parseISO(day.date), "dd MMM", { locale: ptBR })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(day.date), "EEEE", { locale: ptBR })}
                </p>
              </div>
              <div className="flex-1 grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold">{day.scheduled}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Agendadas</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-success">{day.converted}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Convertidas</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-noshow">{day.noShow}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">No-Show</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-warning">{day.notConverted}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Não Conv.</p>
                </div>
              </div>
              <div className="min-w-[60px] text-right">
                <p className="text-sm font-bold">{convRate}%</p>
                <p className="text-[10px] text-muted-foreground">conversão</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
