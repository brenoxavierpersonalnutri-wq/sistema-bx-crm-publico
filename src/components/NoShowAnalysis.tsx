import { useMemo } from "react";
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    isSameDay,
    parseISO,
} from "date-fns";
import { Consultation } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, AlertCircle } from "lucide-react";

interface NoShowAnalysisProps {
    consultations: Consultation[];
    currentDate: Date;
}

export function NoShowAnalysis({ consultations, currentDate }: NoShowAnalysisProps) {
    const stats = useMemo(() => {
        const today = new Date();
        const todayStr = format(today, "yyyy-MM-dd");

        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });

        const calculateNoShow = (list: Consultation[]) => {
            if (list.length === 0) return 0;
            const noShow = list.filter(c => c.attended === false).length;
            return (noShow / list.length) * 100;
        };

        // Monthly
        const monthlyNoShow = calculateNoShow(consultations);

        // Weekly
        const weeklyConsultations = consultations.filter(c => {
            const cDate = parseISO(c.date);
            return cDate >= weekStart && cDate <= weekEnd;
        });
        const weeklyNoShow = calculateNoShow(weeklyConsultations);

        // Daily (If today is in the current month view, use today. Else use the last day of the month with data)
        let dailyConsultations = consultations.filter(c => c.date === todayStr);
        if (dailyConsultations.length === 0 && consultations.length > 0) {
            // Fallback to the most recent day in the consultations list for this month
            const lastDate = consultations[0].date;
            dailyConsultations = consultations.filter(c => c.date === lastDate);
        }
        const dailyNoShow = calculateNoShow(dailyConsultations);

        return {
            daily: Math.round(dailyNoShow * 10) / 10,
            weekly: Math.round(weeklyNoShow * 10) / 10,
            monthly: Math.round(monthlyNoShow * 10) / 10,
        };
    }, [consultations, currentDate]);

    const MetricCard = ({ title, value, label }: { title: string; value: number; label: string }) => {
        const isHealthy = value < 15;
        return (
            <Card className="border-none shadow-sm flex-1">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-baseline gap-2">
                        <span className={cn(
                            "text-3xl font-bold",
                            isHealthy ? "text-success" : "text-destructive"
                        )}>
                            {value}%
                        </span>
                        <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <div className="mt-4 h-1 w-full bg-muted rounded-full overflow-hidden">
                        <div
                            className={cn("h-full transition-all duration-500", isHealthy ? "bg-success" : "bg-destructive")}
                            style={{ width: `${Math.min(value, 100)}%` }}
                        />
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                        Meta: <span className="font-semibold">{isHealthy ? "< 15% (Atingida)" : "< 15% (Não Atingida)"}</span>
                    </p>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-display font-semibold px-1">Análise de No-Show</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard title="Diário" value={stats.daily} label="Hoje" />
                <MetricCard title="Semanal" value={stats.weekly} label="Semana Atual" />
                <MetricCard title="Mensal" value={stats.monthly} label="Mês Fechado" />
            </div>
        </div>
    );
}
