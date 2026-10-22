import { format, parseISO, isToday, isBefore, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Circle, ClipboardList, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { CollaboratorTask, TASK_TYPE_LABELS, TASK_TYPE_COLORS } from "@/lib/taskTypes";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LinkFichaAluna } from "@/components/tasks/LinkFichaAluna";

export function TodayTasksCheckin() {
  const { user } = useAuth();
  const { data: tasks = [], updateStatus, isLoading } = useTasks(user?.id);

  const todayTasks = tasks.filter((t: CollaboratorTask) => {
    if (t.type === "meta") return false;
    try {
      const due = startOfDay(parseISO(t.dueDate));
      return isToday(due);
    } catch {
      return false;
    }
  });

  if (isLoading || todayTasks.length === 0) return null;

  const pending = todayTasks.filter((t: CollaboratorTask) => t.status === "pending");
  const done = todayTasks.filter((t: CollaboratorTask) => t.status === "completed");

  const handleToggle = (t: CollaboratorTask) => {
    updateStatus({ id: t.id, status: t.status === "completed" ? "pending" : "completed" });
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Check-in do Dia</h3>
            <span className="text-xs text-muted-foreground">
              {pending.length} pendente{pending.length !== 1 ? "s" : ""} · {done.length} concluída{done.length !== 1 ? "s" : ""}
            </span>
          </div>
          <Link to="/disponibilidade">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" />
              Veja as tarefas dos dias anteriores e posteriores
            </Button>
          </Link>
        </div>

        <div className="space-y-2">
          {todayTasks.map((t: CollaboratorTask) => {
            const isLate = isBefore(startOfDay(parseISO(t.dueDate)), startOfDay(new Date())) && t.status === "pending";
            return (
              <div
                key={t.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 border text-sm transition-colors",
                  t.status === "completed"
                    ? "bg-background/40 border-border/30 opacity-60"
                    : isLate
                    ? "bg-destructive/5 border-destructive/20"
                    : "bg-background border-border/40"
                )}
              >
                <button
                  onClick={() => handleToggle(t)}
                  className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                >
                  {t.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <span className={cn("font-medium", t.status === "completed" && "line-through text-muted-foreground")}>
                    {t.title}
                  </span>
                  {t.description && (
                    <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                  )}
                  <LinkFichaAluna task={t} />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isLate && t.status === "pending" && (
                    <span className="text-xs text-destructive font-medium">
                      {format(parseISO(t.dueDate), "dd/MM", { locale: ptBR })}
                    </span>
                  )}
                  <Badge
                    className={cn("text-xs text-white border-0", TASK_TYPE_COLORS[t.type])}
                  >
                    {TASK_TYPE_LABELS[t.type]}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
