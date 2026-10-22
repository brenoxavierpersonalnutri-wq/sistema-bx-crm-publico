import { useMemo, useState } from "react";
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths,
    addDays,
    subDays,
    parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    CheckCircle2,
    Clock,
    AlertCircle,
    MoreVertical,
    Trash2,
    Check,
    DollarSign,
    Repeat,
    MessageCircle,
    Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateConsultation } from "@/hooks/useConsultations";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CollaboratorTask, TASK_TYPE_COLORS, TASK_TYPE_LABELS, TaskType } from "@/lib/taskTypes";
import { chaveDia, ehRecorrente, ocorrenciaConcluida, ocorrenciasEntre, type Escopo } from "@/lib/recorrencia";
import { EscopoRecorrenciaDialog } from "./EscopoRecorrenciaDialog";
import { LinkFichaAluna } from "./LinkFichaAluna";

type ViewType = "month" | "week" | "day";

// Uma tarefa recorrente é uma linha só no banco; aqui ela vira N ocorrências
// dentro do período visível (regra completa em lib/recorrencia.ts: intervalo,
// término por data/quantidade, exceções de "só este evento", mês sem dia 31).
interface Ocorrencia {
    task: CollaboratorTask;
    dia: Date;
}

function expandirPeriodo(tasks: CollaboratorTask[], de: Date, ate: Date): Map<string, Ocorrencia[]> {
    const porDia = new Map<string, Ocorrencia[]>();
    for (const task of tasks) {
        for (const dia of ocorrenciasEntre(task, de, ate)) {
            const k = chaveDia(dia);
            const lista = porDia.get(k) ?? [];
            lista.push({ task, dia });
            porDia.set(k, lista);
        }
    }
    for (const lista of porDia.values()) {
        lista.sort((x, y) => x.dia.getTime() - y.dia.getTime());
    }
    return porDia;
}

export function TaskCalendar({
    userId: externalUserId,
    onEditTask,
    onCreateForDate,
}: {
    userId?: string;
    /** `dia` = a ocorrência clicada (numa série, não é o dueDate). */
    onEditTask?: (task: CollaboratorTask, dia?: Date) => void;
    /** Clique num dia (ou no botão "Adicionar tarefa") — abre o diálogo de nova tarefa naquela data. */
    onCreateForDate?: (date: Date) => void;
}) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<ViewType>("month");
    const { user, isAdmin } = useAuth();
    const effectiveUserId = externalUserId || user?.id;
    const { data: tasks = [], updateStatus, deleteTask } = useTasks(effectiveUserId);

    const nextDate = () => {
        if (view === "month") setCurrentDate(addMonths(currentDate, 1));
        else if (view === "week") setCurrentDate(addDays(currentDate, 7));
        else setCurrentDate(addDays(currentDate, 1));
    };

    const prevDate = () => {
        if (view === "month") setCurrentDate(subMonths(currentDate, 1));
        else if (view === "week") setCurrentDate(subDays(currentDate, 7));
        else setCurrentDate(subDays(currentDate, 1));
    };

    // Período visível da visão atual, expandido uma vez só.
    const [periodoDe, periodoAte] = useMemo(() => {
        if (view === "month") return [startOfWeek(startOfMonth(currentDate)), endOfWeek(endOfMonth(currentDate))];
        if (view === "week") return [startOfWeek(currentDate), endOfWeek(currentDate)];
        return [currentDate, currentDate];
    }, [view, currentDate]);
    const porDia = useMemo(() => expandirPeriodo(tasks, periodoDe, periodoAte), [tasks, periodoDe, periodoAte]);
    const getDayTasks = (date: Date): Ocorrencia[] => porDia.get(chaveDia(date)) ?? [];

    // Legenda: só as camadas que aparecem no período.
    const tiposVisiveis = useMemo(() => {
        const set = new Set<TaskType>();
        for (const lista of porDia.values()) for (const o of lista) set.add(o.task.type);
        return (Object.keys(TASK_TYPE_LABELS) as TaskType[]).filter((t) => set.has(t));
    }, [porDia]);

    // Novo item às 9:00 — horário de trabalho do time. O usuário troca no diálogo.
    const criarEm = (day: Date) => {
        if (!onCreateForDate) return;
        const d = new Date(day);
        d.setHours(9, 0, 0, 0);
        onCreateForDate(d);
    };

    const renderMonthView = () => {
        const start = startOfWeek(startOfMonth(currentDate));
        const end = endOfWeek(endOfMonth(currentDate));
        const days = eachDayOfInterval({ start, end });

        return (
            <div className="grid grid-cols-7 gap-px bg-muted overflow-hidden rounded-lg border border-border">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                    <div key={d} className="bg-background py-2 text-center text-xs font-semibold text-muted-foreground border-b border-border">
                        {d}
                    </div>
                ))}
                {days.map((day) => {
                    const dayTasks = getDayTasks(day);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isToday = isSameDay(day, new Date());

                    return (
                        <div
                            key={day.toISOString()}
                            className={cn(
                                "bg-background min-h-[100px] p-2 transition-colors",
                                !isCurrentMonth && "bg-muted/30 text-muted-foreground",
                                isToday && "bg-primary/5",
                                onCreateForDate && "cursor-pointer hover:bg-muted/40"
                            )}
                            onClick={() => criarEm(day)}
                            onContextMenu={(e) => {
                                if (!onCreateForDate) return;
                                e.preventDefault();
                                criarEm(day);
                            }}
                            title={onCreateForDate ? "Clique pra adicionar uma tarefa neste dia" : undefined}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className={cn(
                                    "text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full",
                                    isToday && "bg-primary text-primary-foreground font-bold"
                                )}>
                                    {format(day, "d")}
                                </span>
                            </div>
                            <div className="space-y-1">
                                {dayTasks.slice(0, 3).map(({ task, dia }) => (
                                    <TaskItem key={`${task.id}-${chaveDia(dia)}`} task={task} dia={dia} compact onEdit={onEditTask} />
                                ))}
                                {dayTasks.length > 3 && (
                                    <div className="text-[10px] text-muted-foreground pl-1 font-medium">
                                        + {dayTasks.length - 3} mais...
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderWeekView = () => {
        const start = startOfWeek(currentDate);
        const end = endOfWeek(currentDate);
        const days = eachDayOfInterval({ start, end });

        return (
            <div className="grid grid-cols-7 gap-4">
                {days.map((day) => {
                    const dayTasks = getDayTasks(day);
                    const isToday = isSameDay(day, new Date());

                    return (
                        <div
                            key={day.toISOString()}
                            className="space-y-4"
                            onContextMenu={(e) => {
                                if (!onCreateForDate) return;
                                e.preventDefault();
                                criarEm(day);
                            }}
                        >
                            <div className={cn(
                                "text-center p-2 rounded-lg border transition-all",
                                isToday ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 border-border",
                                onCreateForDate && "cursor-pointer hover:border-primary/40"
                            )}
                            onClick={() => criarEm(day)}
                            title={onCreateForDate ? "Clique pra adicionar uma tarefa neste dia" : undefined}>
                                <div className="text-xs uppercase font-bold opacity-80">{format(day, "EEE", { locale: ptBR })}</div>
                                <div className="text-2xl font-bold">{format(day, "d")}</div>
                            </div>
                            <div className="space-y-2">
                                {dayTasks.map(({ task, dia }) => (
                                    <TaskItem key={`${task.id}-${chaveDia(dia)}`} task={task} dia={dia} onEdit={onEditTask} />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderDayView = () => {
        const dayTasks = getDayTasks(currentDate);
        return (
            <div className="max-w-2xl mx-auto space-y-2">
                <div className="text-center mb-2">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{format(currentDate, "EEEE", { locale: ptBR })}</div>
                    <div className="text-2xl font-bold">{format(currentDate, "d 'de' MMMM", { locale: ptBR })}</div>
                </div>
                {dayTasks.length === 0 ? (
                    <div className="text-center py-6 border-2 border-dashed border-muted rounded-2xl text-muted-foreground text-xs">
                        Sem tarefas para este dia.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {dayTasks.map(({ task, dia }) => (
                            <TaskItem key={`${task.id}-${chaveDia(dia)}`} task={task} dia={dia} full onEdit={onEditTask} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => setCurrentDate(new Date())} title="Hoje">
                        <CalendarIcon className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center border rounded-md">
                        <Button variant="ghost" size="icon" onClick={prevDate} className="h-9 w-9 rounded-r-none">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="px-4 font-semibold min-w-[140px] text-center">
                            {format(currentDate, view === "month" ? "MMMM yyyy" : "d 'de' MMM", { locale: ptBR })}
                        </div>
                        <Button variant="ghost" size="icon" onClick={nextDate} className="h-9 w-9 rounded-l-none">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                {onCreateForDate && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                        onClick={() => criarEm(view === "month" && isSameMonth(new Date(), currentDate) ? new Date() : currentDate)}
                    >
                        <Plus className="h-4 w-4" />
                        Adicionar tarefa
                    </Button>
                )}
                <div className="flex bg-muted p-1 rounded-lg">
                    {(["month", "week", "day"] as ViewType[]).map((v) => (
                        <Button
                            key={v}
                            variant={view === v ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setView(v)}
                            className="text-xs h-7 px-3"
                        >
                            {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
                        </Button>
                    ))}
                </div>
                </div>
            </div>

            {tiposVisiveis.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {tiposVisiveis.map((t) => (
                        <span key={t} className="flex items-center gap-1.5">
                            <span className={cn("h-2 w-2 rounded-full", TYPE_CONFIG[t]?.color ?? TASK_TYPE_COLORS[t])} />
                            {TYPE_CONFIG[t]?.label ?? TASK_TYPE_LABELS[t]}
                        </span>
                    ))}
                </div>
            )}

            <div className="min-h-[200px]">
                {view === "month" && renderMonthView()}
                {view === "week" && renderWeekView()}
                {view === "day" && renderDayView()}
            </div>
        </div>
    );
}

// Cor e rótulo por camada. Reavaliação usa o vermelho de alerta na agenda.
const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
    liberacao: { color: "bg-blue-500", label: "Liberação" },
    reavaliacao: { color: "bg-destructive", label: "Reavaliação" },
    manual: { color: "bg-purple-500", label: "Tarefa" },
    meta: { color: TASK_TYPE_COLORS.meta, label: TASK_TYPE_LABELS.meta },
    residuo: { color: "bg-emerald-500", label: "Cobrar Restante" },
    conteudo: { color: TASK_TYPE_COLORS.conteudo, label: TASK_TYPE_LABELS.conteudo },
    aviso: { color: TASK_TYPE_COLORS.aviso, label: TASK_TYPE_LABELS.aviso },
    outro: { color: "bg-gray-500", label: "Outro" },
};

function TaskItem({ task, dia, compact, full, onEdit }: { task: CollaboratorTask; dia: Date; compact?: boolean; full?: boolean; onEdit?: (task: CollaboratorTask, dia?: Date) => void }) {
    const { updateStatus, updateOutcome, setOccurrenceDone, deleteOccurrenceAsync } = useTasks();
    const updateConsultation = useUpdateConsultation();
    const { isAdmin, user } = useAuth();
    const [perguntaExcluir, setPerguntaExcluir] = useState(false);
    const isRecurring = ehRecorrente(task);
    // Numa série, cada ocorrência é concluída sozinha.
    const isCompleted = ocorrenciaConcluida(task, dia);
    const outcome = task.metadata?.outcome as "fez" | "nao_fez" | "aguardando_resposta" | undefined;
    const isReavaliacao = task.type === "reavaliacao";
    const isWaiting = isReavaliacao && outcome === "aguardando_resposta";
    const config = TYPE_CONFIG[task.type] || TYPE_CONFIG.outro;
    const hora = task.metadata?.diaInteiro ? "Dia inteiro" : format(parseISO(task.dueDate), "HH:mm");
    const podeExcluir = isAdmin || (task.userId === user?.id && ["manual", "meta", "conteudo"].includes(task.type));

    const alternarConcluida = () => {
        if (isRecurring) {
            setOccurrenceDone({ task, dia, concluida: !isCompleted });
            return;
        }
        const newStatus = isCompleted ? "pending" : "completed";
        if (isReavaliacao) updateOutcome({ id: task.id, outcome: isCompleted ? null : "fez" });
        else updateStatus({ id: task.id, status: newStatus });

        if (task.metadata?.type === "residuo" && task.metadata?.consultationId) {
            updateConsultation.mutate({
                id: task.metadata.consultationId,
                signalResiduePaid: newStatus === "completed"
            });
        }
    };

    const excluir = (escopo: Escopo) => {
        deleteOccurrenceAsync({ task, dia, escopo }).catch(() => { /* toast no onError */ });
    };

    if (compact) {
        return (
            <div
                className={cn(
                    "px-1.5 py-1 text-[10px] rounded border flex items-start gap-1 cursor-pointer transition-opacity hover:bg-muted/50",
                    isWaiting
                        ? "bg-chart-tools/10 border-chart-tools/40 text-chart-tools"
                        : isCompleted
                        ? "bg-success/10 border-success/40 text-success line-through"
                        : isReavaliacao
                        ? "bg-destructive/10 border-destructive/40 text-destructive"
                        : "bg-background"
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(task, dia);
                }}
                onContextMenu={(e) => e.stopPropagation()}
                title={`${task.title}${isRecurring ? ' (repete)' : ''}`}
            >
                <div className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-1", config.color)} />
                <span className="flex-1 break-words leading-tight whitespace-normal">{task.title}</span>
                {isRecurring && <Repeat className="h-2.5 w-2.5 shrink-0 mt-0.5 text-muted-foreground" />}
            </div>
        );
    }

    return (
        <div className={cn(
            "p-3 rounded-xl border bg-card transition-all flex items-start gap-3",
            isWaiting
                ? "bg-chart-tools/10 border-chart-tools/40"
                : isCompleted
                ? "bg-success/10 border-success/40"
                : isReavaliacao
                ? "bg-destructive/10 border-destructive/40 shadow-sm"
                : "shadow-sm hover:shadow-md border-border"
        )}>
            <Button
                size="icon"
                variant={isCompleted ? "secondary" : "outline"}
                className={cn("h-8 w-8 rounded-full shrink-0", !isCompleted && "hover:border-success hover:text-success")}
                onClick={alternarConcluida}
            >
                {isCompleted ? <CheckCircle2 className="h-5 w-5 text-success" /> : isWaiting ? <MessageCircle className="h-4 w-4 text-chart-tools" /> : task.type === "residuo" ? <DollarSign className="h-4 w-4 text-emerald-500" /> : <div className="h-4 w-4" />}
            </Button>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <Badge variant="outline" className={cn("text-[10px] uppercase font-bold px-1.5 py-0 h-4 border-none text-white", config.color)}>
                        {config.label}
                    </Badge>
                    <span className={cn("text-xs text-muted-foreground", !isCompleted && "text-primary flex items-center gap-1")}>
                        <Clock className="h-3 w-3" />
                        {hora}
                    </span>
                    {isRecurring && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1" title="Tarefa recorrente">
                            <Repeat className="h-3 w-3" />
                        </span>
                    )}
                </div>
                <h4 className={cn("font-semibold text-sm truncate", isCompleted && "line-through")}>{task.title}</h4>
                {full && task.description && (
                    <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                )}
                <LinkFichaAluna task={task} className="mt-1" />
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={alternarConcluida}>
                        <Check className="mr-2 h-4 w-4" />
                        {isCompleted ? "Marcar pendente" : "Marcar concluída"}
                    </DropdownMenuItem>
                    {isReavaliacao && !isCompleted && (
                        <DropdownMenuItem onClick={() => updateOutcome({ id: task.id, outcome: isWaiting ? null : "aguardando_resposta" })}>
                            <MessageCircle className="mr-2 h-4 w-4 text-chart-tools" />
                            {isWaiting ? "Voltar para pendente" : "Aguardando resposta"}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onEdit?.(task, dia)}>
                        <AlertCircle className="mr-2 h-4 w-4" />
                        Editar
                    </DropdownMenuItem>
                    {podeExcluir && (
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => {
                            if (isRecurring) setPerguntaExcluir(true);
                            else if (window.confirm("Excluir esta tarefa?")) excluir("este");
                        }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <EscopoRecorrenciaDialog
                acao={perguntaExcluir ? "excluir" : null}
                onCancelar={() => setPerguntaExcluir(false)}
                onEscolher={(escopo) => {
                    setPerguntaExcluir(false);
                    excluir(escopo);
                }}
            />
        </div>
    );
}
