import { useMemo, useState } from "react";
import {
    format,
    isToday,
    parseISO,
    startOfDay,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    isWithinInterval,
    isBefore,
    subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
    CheckCircle2,
    Circle,
    AlertTriangle,
    Calendar as CalendarIcon,
    Target,
    Repeat,
    Plus,
    ChevronDown,
    ChevronUp,
    XCircle,
    MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTasks } from "@/hooks/useTasks";
import {
    CollaboratorTask,
    TASK_TYPE_LABELS,
    TASK_TYPE_COLORS,
} from "@/lib/taskTypes";
import { ehRecorrente, ocorrenciaConcluida, ocorrenciasEntre } from "@/lib/recorrencia";
import { LinkFichaAluna } from "./LinkFichaAluna";

interface ChecklistProps {
    userId?: string;
    onAddTask?: (date: Date) => void;
    /** `dia` = a ocorrência clicada (numa série, não é o dueDate). */
    onEditTask?: (task: CollaboratorTask, dia?: Date) => void;
}

interface BucketTask {
    task: CollaboratorTask;
    occurrenceDate: Date;
    isCompleted: boolean;
    isOverdue: boolean;
}

// Quantos itens cada seção mostra antes do "Mostrar mais".
// Limita ruído visual quando o time tem 100+ tarefas no mês.
const ITEMS_LIMIT = 10;

// Janela das Atrasadas: foco no que ainda é acionável.
// Liberações/Reavaliações de mais de N dias atrás geralmente são alunas que
// cancelaram ou casos já resolvidos por outro caminho — não polui a lista
// principal. Saem da view de Atrasadas mas continuam no banco.
const ATRASADAS_JANELA_DIAS = 30;

export function TaskChecklist({ userId, onAddTask, onEditTask }: ChecklistProps) {
    const { data: tasks = [], updateStatus, updateOutcome, setOccurrenceDone } = useTasks(userId);

    // Qual seção está expandida ("mostrar mais" clicado).
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
    const isExpanded = (key: string) => expandedSections.has(key);
    const toggleSection = (key: string) =>
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const buckets = useMemo(() => {
        const now = new Date();
        const today = startOfDay(now);
        const weekStart = startOfWeek(now, { locale: ptBR });
        const weekEnd = endOfWeek(now, { locale: ptBR });
        const monthStart = startOfMonth(now);
        const monthEnd = endOfMonth(now);

        const hoje: BucketTask[] = [];
        const semana: BucketTask[] = [];
        const mes: BucketTask[] = [];
        const atrasadas: BucketTask[] = [];
        const metas: BucketTask[] = [];

        for (const t of tasks) {
            // Metas vão direto pra própria seção independente do prazo.
            if (t.type === "meta") {
                const orig = parseISO(t.dueDate);
                metas.push({
                    task: t,
                    occurrenceDate: orig,
                    isCompleted: t.status === "completed",
                    isOverdue: t.status !== "completed" && isBefore(orig, today),
                });
                continue;
            }

            // Expande recorrência (lib/recorrencia.ts) no mês corrente + a semana
            // corrente, que pode começar no mês anterior ou terminar no seguinte.
            const candidatas: Date[] = ehRecorrente(t)
                ? ocorrenciasEntre(
                      t,
                      weekStart < monthStart ? weekStart : monthStart,
                      weekEnd > monthEnd ? weekEnd : monthEnd,
                  )
                : [parseISO(t.dueDate)];

            for (const occ of candidatas) {
                // Numa série, cada ocorrência é concluída sozinha.
                const completed = ocorrenciaConcluida(t, occ);
                const overdue = !completed && isBefore(occ, today);
                const entry: BucketTask = {
                    task: t,
                    occurrenceDate: occ,
                    isCompleted: completed,
                    isOverdue: overdue,
                };

                if (overdue) atrasadas.push(entry);
                if (isToday(occ)) hoje.push(entry);
                if (isWithinInterval(occ, { start: weekStart, end: weekEnd })) {
                    semana.push(entry);
                }
                if (isWithinInterval(occ, { start: monthStart, end: monthEnd })) {
                    mes.push(entry);
                }
            }
        }

        const sortByDate = (a: BucketTask, b: BucketTask) =>
            a.occurrenceDate.getTime() - b.occurrenceDate.getTime();
        hoje.sort(sortByDate);
        semana.sort(sortByDate);
        mes.sort(sortByDate);
        atrasadas.sort(sortByDate);
        metas.sort(sortByDate);

        // Atrasadas: filtra pro time ver só o que ainda é acionável.
        // Regra: só reavaliação + liberação + aviso da aluna dentro da janela. Tarefas manuais
        // atrasadas continuam aparecendo nas seções de período (Hoje/Semana/Mês)
        // se a data ainda bate; só somem desta lista que era ruído visual.
        const limiteAntiga = subDays(today, ATRASADAS_JANELA_DIAS);
        const atrasadasFoco = atrasadas.filter((e) => {
            const tipo = e.task.type;
            if (tipo !== "reavaliacao" && tipo !== "liberacao" && tipo !== "aviso") return false;
            if (isBefore(e.occurrenceDate, limiteAntiga)) return false;
            return true;
        });
        const atrasadasEscondidas = atrasadas.length - atrasadasFoco.length;

        return { hoje, semana, mes, atrasadas: atrasadasFoco, atrasadasEscondidas, metas };
    }, [tasks]);

    const SectionHeader = ({
        icon: Icon,
        title,
        items,
        accent,
        onAdd,
    }: {
        icon: any;
        title: string;
        items: BucketTask[];
        accent?: string;
        onAdd?: () => void;
    }) => {
        const done = items.filter((i) => i.isCompleted).length;
        const total = items.length;
        const pct = total === 0 ? 0 : (done / total) * 100;
        return (
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", accent || "text-primary")} />
                    <h3 className="font-semibold text-sm">{title}</h3>
                    {total > 0 && (
                        <Badge variant="outline" className="text-[10px] h-5 tabular-nums">
                            {done}/{total}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {total > 0 && (
                        <div className="hidden sm:block w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full transition-all",
                                    pct === 100 ? "bg-success" : "bg-primary"
                                )}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    )}
                    {onAdd && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={onAdd}
                            title={`Adicionar em ${title.toLowerCase()}`}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    const Item = ({ entry }: { entry: BucketTask }) => {
        const { task, occurrenceDate, isCompleted, isOverdue } = entry;
        const color = TASK_TYPE_COLORS[task.type] ?? "bg-gray-500";
        const label = TASK_TYPE_LABELS[task.type] ?? "Tarefa";
        // outcome = resultado do contato do time com a aluna depois da cobrança.
        // 'fez' = aluna respondeu/enviou; 'nao_fez' = time contatou mas a aluna não fez.
        // Ambos contam como "tratado" (status=completed), mas separam pra métrica e visual.
        const outcome = (task.metadata as any)?.outcome as "fez" | "nao_fez" | "aguardando_resposta" | undefined;
        const isReavaliacao = task.type === "reavaliacao";
        // Série, Conteúdo e aviso da aluna não têm "aluna fez/não fez": é só visto/feito.
        const conclusaoSimples = ehRecorrente(task) || task.type === "conteudo" || task.type === "aviso";
        const marcar = (feito: boolean) => {
            if (ehRecorrente(task)) setOccurrenceDone({ task, dia: occurrenceDate, concluida: feito });
            else updateStatus({ id: task.id, status: feito ? "completed" : "pending" });
        };
        return (
            <div
                className={cn(
                    "group flex items-start gap-3 px-3 py-2 rounded-lg border transition-all cursor-pointer",
                    isReavaliacao && outcome === "aguardando_resposta"
                        ? "bg-chart-tools/10 border-chart-tools/40"
                        : isCompleted
                        ? outcome === "nao_fez"
                            ? "bg-destructive/5 border-destructive/30 opacity-70"
                            : "bg-success/5 border-success/30 opacity-70"
                        : isReavaliacao
                        ? "bg-destructive/10 border-destructive/40 hover:bg-destructive/15"
                        : isOverdue
                        ? "bg-destructive/5 border-destructive/30 hover:bg-destructive/10"
                        : "bg-background border-border hover:border-primary/40 hover:bg-muted/30"
                )}
                onClick={() => onEditTask?.(task, occurrenceDate)}
            >
                {conclusaoSimples ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            marcar(!isCompleted);
                        }}
                        className={cn(
                            "mt-0.5 shrink-0 transition-colors",
                            isCompleted ? "text-success" : "text-muted-foreground/40 hover:text-success"
                        )}
                        title={isCompleted ? "Desfazer (voltar pra pendente)" : "Marcar como feita"}
                    >
                        <CheckCircle2 className="h-5 w-5" />
                    </button>
                ) : isCompleted ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            // Desfaz: volta pra pending e remove outcome.
                            updateOutcome({ id: task.id, outcome: null });
                        }}
                        className="mt-0.5 shrink-0"
                        title="Desfazer (voltar pra pendente)"
                    >
                        {outcome === "nao_fez" ? (
                            <XCircle className="h-5 w-5 text-destructive" />
                        ) : (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                        )}
                    </button>
                ) : isReavaliacao ? (
                    <div className="flex items-center gap-1 mt-0.5 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateOutcome({ id: task.id, outcome: "fez" });
                            }}
                            className="h-7 w-7 text-muted-foreground hover:bg-success/10 hover:text-success"
                            title="Marcar como concluída"
                        >
                            <CheckCircle2 className="h-5 w-5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateOutcome({ id: task.id, outcome: outcome === "aguardando_resposta" ? null : "aguardando_resposta" });
                            }}
                            className={cn(
                                "h-7 w-7 hover:bg-chart-tools/10 hover:text-chart-tools",
                                outcome === "aguardando_resposta" ? "text-chart-tools" : "text-muted-foreground"
                            )}
                            title={outcome === "aguardando_resposta" ? "Voltar para pendente" : "Aguardando resposta"}
                        >
                            <MessageCircle className="h-5 w-5" />
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1 mt-0.5 shrink-0">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateOutcome({ id: task.id, outcome: "fez" });
                            }}
                            className="text-muted-foreground/40 hover:text-success transition-colors"
                            title="Contatei e a aluna FEZ"
                        >
                            <CheckCircle2 className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                updateOutcome({ id: task.id, outcome: "nao_fez" });
                            }}
                            className="text-muted-foreground/40 hover:text-destructive transition-colors"
                            title="Contatei mas a aluna NÃO FEZ"
                        >
                            <XCircle className="h-5 w-5" />
                        </button>
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", color)} />
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
                            {label}
                        </span>
                        {task.recurrence && task.recurrence !== "none" && (
                            <Repeat className="h-3 w-3 text-muted-foreground" />
                        )}
                    </div>
                    <div
                        className={cn(
                            "text-sm font-medium break-words",
                            isCompleted && "line-through"
                        )}
                    >
                        {task.title}
                    </div>
                    <div
                        className={cn(
                            "text-xs flex items-center gap-1 mt-0.5",
                            isOverdue ? "text-destructive" : "text-muted-foreground"
                        )}
                    >
                        {isOverdue && <AlertTriangle className="h-3 w-3" />}
                        <CalendarIcon className="h-3 w-3" />
                        {format(occurrenceDate, "dd/MM", { locale: ptBR })}
                        {" · "}
                        {task.metadata?.diaInteiro ? "Dia inteiro" : format(parseISO(task.dueDate), "HH:mm")}
                    </div>
                    <LinkFichaAluna task={task} className="mt-1" />
                </div>
            </div>
        );
    };

    const Empty = ({ label }: { label: string }) => (
        <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-muted rounded-lg">
            {label}
        </div>
    );

    const now = new Date();
    const today = startOfDay(now);
    const weekStart = startOfWeek(now, { locale: ptBR });
    const monthStart = startOfMonth(now);

    // Renderiza lista com cap em ITEMS_LIMIT + botão "Mostrar mais".
    const BucketList = ({
        items,
        sectionKey,
        emptyLabel,
    }: {
        items: BucketTask[];
        sectionKey: string;
        emptyLabel: string;
    }) => {
        if (items.length === 0) return <Empty label={emptyLabel} />;
        const expanded = isExpanded(sectionKey);
        const visible = expanded ? items : items.slice(0, ITEMS_LIMIT);
        const remaining = items.length - ITEMS_LIMIT;
        return (
            <>
                {visible.map((e) => (
                    <Item key={`${e.task.id}-${e.occurrenceDate.toISOString()}`} entry={e} />
                ))}
                {items.length > ITEMS_LIMIT && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1 h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                        onClick={() => toggleSection(sectionKey)}
                    >
                        {expanded ? (
                            <>
                                <ChevronUp className="h-3.5 w-3.5" />
                                Mostrar menos
                            </>
                        ) : (
                            <>
                                <ChevronDown className="h-3.5 w-3.5" />
                                Mostrar mais {remaining} {remaining === 1 ? "item" : "itens"}
                            </>
                        )}
                    </Button>
                )}
            </>
        );
    };

    return (
        <div className="space-y-6">
            {buckets.atrasadas.length > 0 && (
                <div className="bg-card border border-destructive/30 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            <h3 className="font-semibold text-sm">Atrasadas</h3>
                            <Badge variant="outline" className="text-[10px] h-5 tabular-nums">
                                0/{buckets.atrasadas.length}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success hover:text-white"
                                onClick={() => {
                                    const total = buckets.atrasadas.length;
                                    if (
                                        !confirm(
                                            `Marcar todas as ${total} atrasadas como contatei + aluna FEZ?\n\n` +
                                                `Use quando o time já contatou em massa e todas (ou quase todas) responderam. Cada item vai virar verde com ✓.`
                                        )
                                    )
                                        return;
                                    const ids = Array.from(
                                        new Set(buckets.atrasadas.map((e) => e.task.id))
                                    );
                                    for (const id of ids) {
                                        updateOutcome({ id, outcome: "fez" });
                                    }
                                }}
                                title="Marca tudo como: contatei e a aluna FEZ"
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Todas: FEZ
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-white"
                                onClick={() => {
                                    const total = buckets.atrasadas.length;
                                    if (
                                        !confirm(
                                            `Marcar todas as ${total} atrasadas como contatei + aluna NÃO FEZ?\n\n` +
                                                `Use quando a maioria parou de mandar foto e o caso já passou. Cada item vai virar vermelho com ✗. O atraso fica registrado pra métrica.`
                                        )
                                    )
                                        return;
                                    const ids = Array.from(
                                        new Set(buckets.atrasadas.map((e) => e.task.id))
                                    );
                                    for (const id of ids) {
                                        updateOutcome({ id, outcome: "nao_fez" });
                                    }
                                }}
                                title="Marca tudo como: contatei mas a aluna NÃO FEZ"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                Todas: NÃO FEZ
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <BucketList
                            items={buckets.atrasadas}
                            sectionKey="atrasadas"
                            emptyLabel="Nenhuma reavaliação ou liberação atrasada."
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-3 pt-2 border-t border-border/30 leading-relaxed">
                        <strong>Como usar:</strong> ✓ verde = time contatou e a aluna FEZ.
                        ✗ vermelho = time contatou e a aluna NÃO FEZ. Os 2 contam como tratado, mas
                        ficam separados pra métrica.
                        <br />
                        <strong>Importante:</strong> a data aqui é o prazo da reavaliação/liberação
                        (35 dias após as fotos da aluna), <strong>não</strong> a data de vencimento
                        do plano. Aluna com plano anual ativo pode ter reavaliação atrasada se parou
                        de mandar fotos.
                        {buckets.atrasadasEscondidas > 0 && (
                            <>
                                {" · "}
                                {buckets.atrasadasEscondidas}{" "}
                                {buckets.atrasadasEscondidas === 1
                                    ? "tarefa antiga escondida"
                                    : "tarefas antigas escondidas"}{" "}
                                (+{ATRASADAS_JANELA_DIAS}d ou outro tipo). Aparecem na aba Agenda.
                            </>
                        )}
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-xl p-4">
                    <SectionHeader
                        icon={CalendarIcon}
                        title="Hoje"
                        items={buckets.hoje}
                        onAdd={onAddTask ? () => onAddTask(today) : undefined}
                    />
                    <div className="space-y-2">
                        <BucketList
                            items={buckets.hoje}
                            sectionKey="hoje"
                            emptyLabel="Sem tarefas pra hoje."
                        />
                    </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-4">
                    <SectionHeader
                        icon={CalendarIcon}
                        title="Esta semana"
                        items={buckets.semana}
                        onAdd={onAddTask ? () => onAddTask(weekStart) : undefined}
                    />
                    <div className="space-y-2">
                        <BucketList
                            items={buckets.semana}
                            sectionKey="semana"
                            emptyLabel="Sem tarefas na semana."
                        />
                    </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-4">
                    <SectionHeader
                        icon={CalendarIcon}
                        title="Este mês"
                        items={buckets.mes}
                        onAdd={onAddTask ? () => onAddTask(monthStart) : undefined}
                    />
                    <div className="space-y-2">
                        <BucketList
                            items={buckets.mes}
                            sectionKey="mes"
                            emptyLabel="Sem tarefas no mês."
                        />
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
                <SectionHeader
                    icon={Target}
                    title="Metas"
                    items={buckets.metas}
                    accent="text-amber-500"
                    onAdd={onAddTask ? () => onAddTask(today) : undefined}
                />
                <div className="space-y-2">
                    {buckets.metas.length === 0 ? (
                        <Empty label="Sem metas ativas. Defina algo desafiador 🎯" />
                    ) : (
                        buckets.metas.map((e) => (
                            <Item key={`${e.task.id}-${e.occurrenceDate.toISOString()}`} entry={e} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
