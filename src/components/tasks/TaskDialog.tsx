import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CalendarWithShortcuts } from "@/components/ui/calendar-with-shortcuts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { CollaboratorTask, TaskType, TASK_TYPE_COLORS } from "@/lib/taskTypes";
import { LinkFichaAluna } from "./LinkFichaAluna";
import {
    AGENDA_CONTEUDO_MODULE,
    podeCriarTipo,
    temCamadaConteudo,
} from "@/lib/agendaCamadas";
import {
    OPCOES_REPETIR,
    chaveDia,
    diaDaChave,
    ehRecorrente,
    excecoesDaTarefa,
    metaDaRegra,
    opcaoDaRegra,
    regraDaOpcao,
    regraDaTarefa,
    regrasIguais,
    resumoDaRegra,
    rotuloUnidade,
    semDadosDeSerie,
    type Escopo,
    type FimRecorrencia,
    type Frequencia,
    type OpcaoRepetir,
} from "@/lib/recorrencia";
import { EscopoRecorrenciaDialog } from "./EscopoRecorrenciaDialog";

interface TaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task?: CollaboratorTask;
    /** Data padrão pra nova tarefa (clique num dia do calendário ou "Adicionar tarefa"). */
    defaultDate?: Date;
    /** Ao editar uma série: o dia da ocorrência clicada. */
    occurrenceDate?: Date;
    /** Responsável pré-selecionado (a agenda que está sendo vista). */
    defaultUserId?: string;
}

// Camadas que o formulário cria. Reavaliação/liberação/cobrança são criadas
// pelo sistema, não aqui.
type Camada = "manual" | "meta" | "conteudo";
type FimTipo = FimRecorrencia["tipo"];

const HORA_PADRAO = "09:00";

function horaDe(d: Date): string {
    return format(d, "HH:mm");
}

function juntarDataHora(dia: Date, hora: string, diaInteiro: boolean): Date {
    const [h, m] = (diaInteiro ? "00:00" : hora || HORA_PADRAO).split(":").map(Number);
    return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h || 0, m || 0, 0, 0);
}

export function TaskDialog({ open, onOpenChange, task, defaultDate, occurrenceDate, defaultUserId }: TaskDialogProps) {
    const { user, isAdmin, allowedModules } = useAuth();
    const acesso = useMemo(() => ({ isAdmin, modulos: allowedModules ?? [] }), [isAdmin, allowedModules]);
    const podeConteudo = temCamadaConteudo(acesso);

    const [selectedUser, setSelectedUser] = useState<string>("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [date, setDate] = useState<Date>();
    const [hora, setHora] = useState(HORA_PADRAO);
    const [diaInteiro, setDiaInteiro] = useState(false);
    const [camada, setCamada] = useState<Camada>("manual");
    const [repetir, setRepetir] = useState<OpcaoRepetir>("none");
    const [persFreq, setPersFreq] = useState<Frequencia>("weekly");
    const [persIntervalo, setPersIntervalo] = useState(1);
    const [fimTipo, setFimTipo] = useState<FimTipo>("nunca");
    const [fimData, setFimData] = useState<Date>();
    const [fimTotal, setFimTotal] = useState(10);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [fimCalendarOpen, setFimCalendarOpen] = useState(false);
    const [perguntaEscopo, setPerguntaEscopo] = useState<"salvar" | "excluir" | null>(null);

    const { upsertTaskAsync, saveOccurrenceAsync, deleteOccurrenceAsync } = useTasks();

    const tipoAutomatico = !!task && !["manual", "meta", "conteudo"].includes(task.type);
    const regraOriginal = task ? regraDaTarefa(task) : null;
    const serie = !!task && ehRecorrente(task);
    // Dia da ocorrência que está sendo editada (numa série, não é o dueDate).
    const diaOcorrencia = task ? (occurrenceDate ?? new Date(task.dueDate)) : undefined;

    useEffect(() => {
        if (!open) return;
        if (task) {
            const due = new Date(task.dueDate);
            const base = occurrenceDate ?? due;
            setSelectedUser(task.userId);
            setTitle(task.title);
            setDescription(task.description || "");
            setDate(new Date(base.getFullYear(), base.getMonth(), base.getDate()));
            setDiaInteiro(!!task.metadata?.diaInteiro);
            setHora(task.metadata?.diaInteiro ? HORA_PADRAO : horaDe(due));
            setCamada(task.type === "meta" ? "meta" : task.type === "conteudo" ? "conteudo" : "manual");
            const regra = regraDaTarefa(task);
            const op = opcaoDaRegra(regra);
            setRepetir(op);
            setPersFreq(regra?.freq ?? "weekly");
            setPersIntervalo(regra?.intervalo ?? 1);
            setFimTipo(regra?.fim.tipo ?? "nunca");
            setFimData(regra?.fim.tipo === "data" ? diaDaChave(regra.fim.data) : undefined);
            setFimTotal(regra?.fim.tipo === "ocorrencias" ? regra.fim.total : 10);
        } else {
            // Nova tarefa. Se veio defaultDate (clique num dia da agenda), já usa.
            setSelectedUser(defaultUserId || user?.id || "");
            setTitle("");
            setDescription("");
            setDate(defaultDate);
            const h = defaultDate ? horaDe(defaultDate) : HORA_PADRAO;
            setHora(h === "00:00" ? HORA_PADRAO : h);
            setDiaInteiro(false);
            setCamada("manual");
            setRepetir("none");
            setPersFreq("weekly");
            setPersIntervalo(1);
            setFimTipo("nunca");
            setFimData(undefined);
            setFimTotal(10);
        }
        setPerguntaEscopo(null);
    }, [task, open, defaultDate, occurrenceDate, defaultUserId, user?.id]);

    // Só quem pode ver a agenda dos outros (admin) escolhe o responsável.
    const podeEscolherResponsavel = isAdmin;

    const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
        queryKey: ["profiles-list"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name")
                .eq("approved", true)
                .order("full_name");
            if (error) throw error;
            return data;
        },
        enabled: open && podeEscolherResponsavel,
    });

    // Na camada de Conteúdo, o responsável tem que ter a liberação (ou ser
    // admin) — senão a tarefa fica invisível pra ele.
    const { data: comConteudo } = useQuery({
        queryKey: ["agenda-access-conteudo"],
        queryFn: async () => {
            const [m, r] = await Promise.all([
                supabase.from("user_modules").select("user_id").eq("module", AGENDA_CONTEUDO_MODULE),
                supabase.from("user_roles").select("user_id").eq("role", "admin"),
            ]);
            return new Set([...(m.data ?? []), ...(r.data ?? [])].map((x: any) => x.user_id as string));
        },
        enabled: open && podeEscolherResponsavel,
    });

    const responsaveis = camada === "conteudo" && comConteudo
        ? profiles.filter((p) => comConteudo.has(p.id))
        : profiles;

    const fimAtual: FimRecorrencia =
        fimTipo === "data" && fimData
            ? { tipo: "data", data: chaveDia(fimData) }
            : fimTipo === "ocorrencias"
            ? { tipo: "ocorrencias", total: Math.max(1, Math.floor(fimTotal) || 1) }
            : { tipo: "nunca" };
    const regraForm = regraDaOpcao(repetir, fimAtual, { freq: persFreq, intervalo: persIntervalo });

    const podeExcluir = !!task && (
        isAdmin ||
        (task.type === "conteudo" ? podeConteudo : task.userId === user?.id && !tipoAutomatico)
    );

    const valido = !!selectedUser && !!title.trim() && !!date && (fimTipo !== "data" || !!fimData);

    const montarNovo = (): Partial<CollaboratorTask> => {
        const effectiveType: TaskType = tipoAutomatico ? task!.type : camada;
        const baseMeta = task ? { ...task.metadata } : {};
        const meta: Record<string, any> = semDadosDeSerie(baseMeta);
        if (diaInteiro) meta.diaInteiro = true;
        else delete meta.diaInteiro;
        if (regraForm) {
            // Editando a série inteira sem mexer na regra: mantém as exceções.
            const exc = task && regrasIguais(regraOriginal, regraForm) ? excecoesDaTarefa(task) : [];
            meta.recorrencia = metaDaRegra(regraForm, exc);
            if (task && regrasIguais(regraOriginal, regraForm) && baseMeta.concluidas) {
                meta.concluidas = baseMeta.concluidas;
            }
        }
        return {
            id: task?.id,
            userId: selectedUser,
            title: title.trim(),
            description,
            dueDate: juntarDataHora(date!, hora, diaInteiro).toISOString(),
            status: task?.status || "pending",
            type: effectiveType,
            recurrence: regraForm?.freq ?? "none",
            metadata: meta,
        };
    };

    const fechar = () => {
        setPerguntaEscopo(null);
        onOpenChange(false);
    };

    const salvar = async (escopo?: Escopo) => {
        if (!valido) return;
        setIsSubmitting(true);
        try {
            const novo = montarNovo();
            if (task && serie && escopo && diaOcorrencia) {
                await saveOccurrenceAsync({
                    task,
                    dia: diaOcorrencia,
                    escopo,
                    novo,
                    regraAlterada: !regrasIguais(regraOriginal, regraForm),
                });
            } else {
                await upsertTaskAsync(novo);
            }
            fechar();
        } catch (err: any) {
            console.error("Task submission error:", err);
            // O toast de erro sai do onError da mutation.
        } finally {
            setIsSubmitting(false);
        }
    };

    const excluir = async (escopo?: Escopo) => {
        if (!task || !diaOcorrencia) return;
        setIsSubmitting(true);
        try {
            await deleteOccurrenceAsync({ task, dia: diaOcorrencia, escopo: escopo ?? "este" });
            fechar();
        } catch (err: any) {
            console.error("Task delete error:", err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!valido) return;
        if (task && serie) setPerguntaEscopo("salvar");
        else salvar();
    };

    const handleExcluir = () => {
        if (!task) return;
        if (serie) setPerguntaEscopo("excluir");
        else if (window.confirm("Excluir esta tarefa?")) excluir();
    };

    const camadasDisponiveis: { valor: Camada; rotulo: string }[] = [
        { valor: "manual", rotulo: "Tarefa" },
        { valor: "meta", rotulo: "Meta" },
        ...(podeConteudo || camada === "conteudo" ? [{ valor: "conteudo" as Camada, rotulo: "Conteúdo" }] : []),
    ];
    const camadaBloqueada = camada === "conteudo" && !podeCriarTipo("conteudo", acesso);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{task ? "Editar Tarefa" : "Adicionar Tarefa"}</DialogTitle>
                        {task && <LinkFichaAluna task={task} />}
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="title">Título</Label>
                            <Input
                                id="title"
                                placeholder="Ex: Gravar reels da semana"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                required
                            />
                        </div>

                        {!tipoAutomatico && (
                            <div className="space-y-2">
                                <Label>Camada</Label>
                                <Select value={camada} onValueChange={(v) => setCamada(v as Camada)} disabled={camadaBloqueada}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {camadasDisponiveis.map((c) => (
                                            <SelectItem key={c.valor} value={c.valor}>
                                                <span className="flex items-center gap-2">
                                                    <span className={cn("h-2 w-2 rounded-full", TASK_TYPE_COLORS[c.valor])} />
                                                    {c.rotulo}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {camada === "conteudo" && (
                                    <p className="text-[11px] text-muted-foreground">
                                        Aparece na agenda de quem tem a liberação de Conteúdo.
                                    </p>
                                )}
                            </div>
                        )}

                        {podeEscolherResponsavel && (
                            <div className="space-y-2">
                                <Label htmlFor="user">Responsável</Label>
                                <Select value={selectedUser} onValueChange={setSelectedUser}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={loadingProfiles ? "Carregando..." : "Selecionar..."} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {responsaveis.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.full_name || "Sem nome"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {camada === "conteudo" && !!selectedUser && comConteudo && !comConteudo.has(selectedUser) && (
                                    <p className="text-[11px] text-destructive">
                                        Essa pessoa não tem a liberação de Conteúdo e não vai ver a tarefa.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                            <div className="space-y-2">
                                <Label>Data</Label>
                                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !date && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {date ? format(date, "PPP", { locale: ptBR }) : "Selecionar data"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <CalendarWithShortcuts
                                            selected={date}
                                            onSelect={(d) => {
                                                setDate(d);
                                                setCalendarOpen(false);
                                            }}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hora">Hora</Label>
                                <Input
                                    id="hora"
                                    type="time"
                                    value={hora}
                                    onChange={(e) => setHora(e.target.value)}
                                    disabled={diaInteiro}
                                    className="w-[110px]"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Switch id="dia-inteiro" checked={diaInteiro} onCheckedChange={setDiaInteiro} />
                            <Label htmlFor="dia-inteiro" className="font-normal">Dia inteiro</Label>
                        </div>

                        <div className="space-y-2">
                            <Label>Repetir</Label>
                            <Select value={repetir} onValueChange={(v) => setRepetir(v as OpcaoRepetir)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {OPCOES_REPETIR.map((o) => (
                                        <SelectItem key={o.valor} value={o.valor}>
                                            {o.rotulo}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {repetir === "custom" && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">A cada</span>
                                <Input
                                    type="number"
                                    min={1}
                                    max={999}
                                    value={persIntervalo}
                                    onChange={(e) => setPersIntervalo(Math.max(1, Number(e.target.value) || 1))}
                                    className="w-[80px]"
                                    aria-label="Intervalo da repetição"
                                />
                                <Select value={persFreq} onValueChange={(v) => setPersFreq(v as Frequencia)}>
                                    <SelectTrigger className="w-[130px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(["daily", "weekly", "monthly", "yearly"] as Frequencia[]).map((f) => (
                                            <SelectItem key={f} value={f}>
                                                {rotuloUnidade(f, persIntervalo)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {repetir !== "none" && (
                            <div className="space-y-2">
                                <Label>Termina</Label>
                                <div className="flex items-center gap-2">
                                    <Select value={fimTipo} onValueChange={(v) => setFimTipo(v as FimTipo)}>
                                        <SelectTrigger className="w-[150px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="nunca">Nunca</SelectItem>
                                            <SelectItem value="data">Em data</SelectItem>
                                            <SelectItem value="ocorrencias">Após</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {fimTipo === "data" && (
                                        <Popover open={fimCalendarOpen} onOpenChange={setFimCalendarOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className={cn("flex-1 justify-start font-normal", !fimData && "text-muted-foreground")}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {fimData ? format(fimData, "dd/MM/yyyy") : "Selecionar"}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <CalendarWithShortcuts
                                                    selected={fimData}
                                                    onSelect={(d) => {
                                                        setFimData(d);
                                                        setFimCalendarOpen(false);
                                                    }}
                                                    disabled={date ? { before: date } : undefined}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                    {fimTipo === "ocorrencias" && (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                min={1}
                                                max={5000}
                                                value={fimTotal}
                                                onChange={(e) => setFimTotal(Math.max(1, Number(e.target.value) || 1))}
                                                className="w-[80px]"
                                                aria-label="Número de ocorrências"
                                            />
                                            <span className="text-sm text-muted-foreground">{fimTotal === 1 ? "vez" : "vezes"}</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-[11px] text-muted-foreground">{resumoDaRegra(regraForm)}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="description">Descrição (opcional)</Label>
                            <Textarea
                                id="description"
                                placeholder="Detalhes adicionais..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="resize-none"
                            />
                        </div>

                        <DialogFooter className="pt-2 gap-2 sm:gap-2">
                            {podeExcluir && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="border-destructive/40 text-destructive hover:bg-destructive/10 sm:mr-auto"
                                    onClick={handleExcluir}
                                    disabled={isSubmitting}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir
                                </Button>
                            )}
                            <Button type="submit" disabled={isSubmitting || !valido || camadaBloqueada} className={podeExcluir ? "" : "w-full"}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {task ? "Salvar" : "Adicionar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <EscopoRecorrenciaDialog
                acao={perguntaEscopo}
                onCancelar={() => setPerguntaEscopo(null)}
                onEscolher={(escopo) => {
                    const acao = perguntaEscopo;
                    setPerguntaEscopo(null);
                    if (acao === "excluir") excluir(escopo);
                    else salvar(escopo);
                }}
            />
        </>
    );
}
