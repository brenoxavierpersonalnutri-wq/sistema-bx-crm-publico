import { useMemo } from "react";
import {
    format,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    getDay,
    startOfWeek,
    endOfWeek
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Consultation } from "@/types/consultation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MonthlyCalendarProps {
    consultations: Consultation[];
    currentDate: Date;
}

export function MonthlyCalendar({ consultations, currentDate }: MonthlyCalendarProps) {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    const days = eachDayOfInterval({
        start: calendarStart,
        end: calendarEnd,
    });

    const statsByDay = useMemo(() => {
        const stats: Record<string, { count: number; attended: number; noShow: number; converted: number }> = {};

        consultations.forEach((c) => {
            if (!stats[c.date]) {
                stats[c.date] = { count: 0, attended: 0, noShow: 0, converted: 0 };
            }
            stats[c.date].count++;
            if (c.attended === true) stats[c.date].attended++;
            if (c.attended === false) stats[c.date].noShow++;
            if (c.converted === true) stats[c.date].converted++;
        });

        return stats;
    }, [consultations]);

    const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="pb-3 text-center">
                <CardTitle className="text-lg font-display">Resumo Diário</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((day) => (
                        <div key={day} className="text-center text-[10px] uppercase font-bold text-muted-foreground py-2">
                            {day}
                        </div>
                    ))}
                    {days.map((day, i) => {
                        const dateStr = format(day, "yyyy-MM-dd");
                        const isCurrentMonth = isSameMonth(day, monthStart);
                        const dayStats = statsByDay[dateStr] || { count: 0, attended: 0, noShow: 0, converted: 0 };
                        const noShowRate = dayStats.count > 0 ? Math.round((dayStats.noShow / dayStats.count) * 100) : 0;

                        const isSaturday = getDay(day) === 6;
                        const targets = isSaturday
                            ? { agend: 5, feitas: 4, conv: 2 }
                            : { agend: 10, feitas: 8, conv: 3 };

                        return (
                            <div
                                key={i}
                                className={cn(
                                    "min-h-[90px] p-1 border border-border/40 rounded-md flex flex-col gap-1",
                                    !isCurrentMonth && "opacity-20 bg-muted/20"
                                )}
                            >
                                <span className="text-[10px] font-medium ml-1">
                                    {format(day, "d")}
                                </span>

                                {dayStats.count > 0 && (
                                    <div className="flex flex-col gap-0.5 mt-auto">
                                        <div className={cn(
                                            "text-[9px] px-1 rounded flex justify-between",
                                            dayStats.count > targets.agend ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                        )}>
                                            <span>Agend:</span>
                                            <span className="font-bold">{dayStats.count}</span>
                                        </div>
                                        <div className={cn(
                                            "text-[9px] px-1 rounded flex justify-between",
                                            dayStats.attended > targets.feitas ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                        )}>
                                            <span>Feitas:</span>
                                            <span className="font-bold">{dayStats.attended}</span>
                                        </div>
                                        <div className={cn(
                                            "text-[9px] px-1 rounded flex justify-between",
                                            dayStats.converted > targets.conv ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                        )}>
                                            <span>Conv:</span>
                                            <span className="font-bold">{dayStats.converted}</span>
                                        </div>
                                        {dayStats.noShow > 0 && (
                                            <div className="bg-muted text-muted-foreground text-[8px] px-1 rounded flex justify-between mt-0.5">
                                                <span>No-Show:</span>
                                                <span className="font-bold">{noShowRate}%</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
