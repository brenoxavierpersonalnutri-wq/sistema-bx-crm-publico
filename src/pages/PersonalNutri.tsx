import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAlunas, upsertAluna } from "@/lib/alunaStore";
import { Aluna, PROGRAM_LABELS } from "@/lib/alunaTypes";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BotaoBoasVindas } from "@/components/alunas/BotaoBoasVindas";
import { SeloTeste } from "@/components/alunas/AlunaTeste";
import { ehAlunaTeste, semAlunasTeste } from "@/lib/alunaTeste";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { format, isSameDay, parseISO, addDays, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ArrowLeft, Utensils, Camera, ClipboardCheck,
    Calendar as CalendarIcon, Save, RefreshCw, Bell, MessageSquare, ExternalLink, CheckCheck, Ban,
    ArrowUp, ArrowDown
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { linkPublico } from "@/lib/linkPublico";
import logoCouple from "@/assets/logo-couple.png";
import { cn } from "@/lib/utils";
import { upsertTask } from "@/lib/taskStore";
import { CalendarWithShortcuts } from "@/components/ui/calendar-with-shortcuts";
import { calculateDeliveryDueDate } from "@/lib/businessDaysUtils";
import { Input } from "@/components/ui/input";
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter";
import { DateRange } from "react-day-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface AlunaRowProps {
    aluna: Aluna;
    handleUpdateAluna: (aluna: Aluna, updates: Partial<Aluna>) => Promise<void>;
    toast: any;
}

/**
 * A reavaliação cai 35 dias depois das fotos. Enquanto o Breno não marca uma
 * data na mão, é essa conta que vale.
 */
function dataReavaliacao(aluna: Aluna): string | undefined {
    if (aluna.dataAvaliacao) return aluna.dataAvaliacao;
    if (!aluna.dataFotosAnamnese) return undefined;
    try {
        return format(addDays(parseISO(aluna.dataFotosAnamnese), 35), "yyyy-MM-dd");
    } catch {
        return undefined;
    }
}

function AlunaRow({ aluna, handleUpdateAluna, toast }: AlunaRowProps) {
    const [fotosOpen, setFotosOpen] = useState(false);

    const reavaliacao = dataReavaliacao(aluna);
    const reavaliacaoHoje = !!reavaliacao && isSameDay(parseISO(reavaliacao), new Date());

    const mandarWhatsApp = () => {
        const phone = aluna.telefone?.replace(/\D/g, "");
        if (!phone) {
            toast({ title: "Erro", description: "Telefone não cadastrado para esta aluna.", variant: "destructive" });
            return;
        }

        // A data da reavaliação também alimenta a agenda do time, então se ela
        // ainda era só a conta dos 35 dias, fica salva agora.
        if (!aluna.dataAvaliacao && reavaliacao) {
            void handleUpdateAluna(aluna, { dataAvaliacao: reavaliacao });
        }

        const dataReval = reavaliacao ? format(parseISO(reavaliacao), "dd/MM") : "(data)";
        const message = `🚀 Seu treino já está no app MFITPERSONAL!

📲 Baixe na loja do seu celular e acesse com o e-mail cadastrado.
➡️ Lá dentro já está tudo liberado pra você começar!

📑 As orientações completas (cardio, água, refeição livre e mais) estão no PDF que vou te enviar.

📸 Sua próxima reavaliação de fotos, vamos marcar na semana do dia ${dataReval} pode ser? 

ESSA SUA REAVALIAÇÃO É DE SUA RESPONSABILIDADE ENVIAR, COMBINADO? - Nesse formato do programa -GORDURA +DEFINIÇÃO, recomendo fazermos as reavaliações a cada 4-6 semanas, mas preciso que entenda que é da sua responsabilidade enviar as fotos. Pode enviar por aqui ou por email, o que preferir ❤️

⚡ Pontos-chave:
1️⃣ Cardio → escolha o que mais gosta (ou odeia menos 😅)..
2️⃣ Treino de Força → assista os vídeos, mande vídeos de execução para correção, o segredo está aqui.
3️⃣ Dieta → busque loucamente deixá-la gostosa, que nem pareça dieta. (A dieta está disponível em "Arquivos" dentro do aplicativo).

Para lista de substituição da dieta, usa a nossa tela de trocas (é montada com a minha própria tabela, vai ser prático e eficiente)
${linkPublico("/substituicoes")}

✨ VAMOS JUNTOS!!`;

        window.open(`https://api.whatsapp.com/send?phone=${phone.startsWith("55") ? phone : "55" + phone}&text=${encodeURIComponent(message)}`, "_blank");
    };

    return (
        <tr className="hover:bg-muted/30 transition-colors">
            <td className="px-4 py-4 min-w-[170px]">
                <Link
                    to={`/alunas/ficha/${aluna.id}`}
                    className="font-medium hover:text-primary hover:underline"
                    title="Ver tudo sobre essa aluna"
                >
                    {aluna.nomeCompleto}
                </Link>
                {ehAlunaTeste(aluna) && <SeloTeste className="ml-2 align-middle" />}
                <div className="text-xs text-muted-foreground">
                    {PROGRAM_LABELS[aluna.programa as keyof typeof PROGRAM_LABELS] ?? aluna.programa}
                </div>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center">
                    <Switch
                        checked={!!aluna.anamneseMfit}
                        onCheckedChange={(val) => handleUpdateAluna(aluna, { anamneseMfit: val })}
                    />
                </div>
            </td>

            <td className="px-4 py-4">
                <Popover open={fotosOpen} onOpenChange={setFotosOpen}>
                    <PopoverAnchor asChild>
                        <div className="flex flex-col items-center gap-1.5">
                            <Switch
                                checked={!!aluna.fotosAnamnese}
                                onCheckedChange={(val) => {
                                    if (val) {
                                        // Marcou que enviou: o calendário já abre pra confirmar o dia.
                                        handleUpdateAluna(aluna, { fotosAnamnese: true });
                                        setFotosOpen(true);
                                    } else {
                                        handleUpdateAluna(aluna, {
                                            fotosAnamnese: false,
                                            dataFotosAnamnese: undefined,
                                            dataAvaliacao: undefined
                                        });
                                    }
                                }}
                            />
                            {aluna.dataFotosAnamnese && (
                                <button
                                    type="button"
                                    onClick={() => setFotosOpen(true)}
                                    title="Trocar a data"
                                    className="inline-flex items-center gap-1 rounded-md border border-green-500/50 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-950/20"
                                >
                                    <Camera className="h-3 w-3" />
                                    {/* Com o ano: foto de maio do ano passado e de maio deste ano
                                        ficavam idênticas na tela, e a diferença é o que importa aqui. */}
                                    {format(parseISO(aluna.dataFotosAnamnese), "dd/MM/yy")}
                                </button>
                            )}
                        </div>
                    </PopoverAnchor>
                    <PopoverContent className="w-auto p-0" align="center">
                        <CalendarWithShortcuts
                            modifiers={{ today: new Date(0) }}
                            selected={aluna.dataFotosAnamnese ? parseISO(aluna.dataFotosAnamnese) : undefined}
                            onSelect={(date) => {
                                if (date) {
                                    handleUpdateAluna(aluna, {
                                        fotosAnamnese: true,
                                        dataFotosAnamnese: format(date, "yyyy-MM-dd"),
                                        dataAvaliacao: format(addDays(date, 35), "yyyy-MM-dd")
                                    });
                                } else {
                                    handleUpdateAluna(aluna, {
                                        dataFotosAnamnese: undefined,
                                        dataAvaliacao: undefined
                                    });
                                }
                                setFotosOpen(false);
                            }}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center">
                    <BotaoBoasVindas aluna={aluna} />
                </div>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center">
                    <Switch
                        checked={!!aluna.liberouTreinoDieta}
                        onCheckedChange={(val) => handleUpdateAluna(aluna, { liberouTreinoDieta: val })}
                    />
                </div>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center">
                    <Switch
                        checked={!!aluna.liberouFotos}
                        onCheckedChange={(val) => handleUpdateAluna(aluna, { liberouFotos: val })}
                    />
                </div>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={mandarWhatsApp}
                        title="Manda a mensagem de liberação, já com a data da reavaliação (35 dias depois das fotos)"
                        className={cn(
                            "gap-2 text-xs",
                            reavaliacaoHoje && "border-primary text-primary bg-primary/5"
                        )}
                    >
                        <MessageSquare className="h-3.5 w-3.5 text-success" />
                        {reavaliacao ? format(parseISO(reavaliacao), "dd/MM/yy") : "---"}
                    </Button>
                </div>
            </td>

            <td className="px-4 py-4">
                <div className="flex justify-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        title="Marcar rotina completa"
                        className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => {
                            const todayStr = format(new Date(), "yyyy-MM-dd");
                            const revalDateStr = format(addDays(new Date(), 35), "yyyy-MM-dd");
                            handleUpdateAluna(aluna, {
                                anamneseMfit: true,
                                fotosAnamnese: true,
                                dataFotosAnamnese: aluna.dataFotosAnamnese || todayStr,
                                liberouTreinoDieta: true,
                                liberouFotos: true,
                                dataAvaliacao: aluna.dataAvaliacao || revalDateStr
                            });
                        }}
                    >
                        <CheckCheck className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        title="Cancelar plano (marca aluna como inativa e tira tarefas dela da agenda do time)"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                            if (
                                !confirm(
                                    `Cancelar o plano de ${aluna.nomeCompleto}?\n\n` +
                                    `Ela vai virar INATIVA e some das agendas do time (reavaliações, liberações, cobranças). ` +
                                    `Você pode reativar depois mudando a tab de "Inativas" e editando.`
                                )
                            ) return;
                            handleUpdateAluna(aluna, { status: "inativa" } as Partial<Aluna>);
                        }}
                    >
                        <Ban className="h-4 w-4" />
                    </Button>
                </div>
            </td>
        </tr>
    );
}

export default function PersonalNutri() {
    const [alunas, setAlunas] = useState<Aluna[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const { user } = useAuth();
    const { toast } = useToast();

    // Quando o Breno clica no nome lá na lista de alunas, ele chega aqui já com
    // a busca preenchida, em vez de ter que procurar ela de novo.
    const [searchParams] = useSearchParams();
    const [searchTerm, setSearchTerm] = useState(() => searchParams.get("aluna") ?? "");
    const [dateFilter, setDateFilter] = useState<DateRange | undefined>();
    const [planFilter, setPlanFilter] = useState<string>("all");
    const [statusTab, setStatusTab] = useState<"ativas" | "inativas">("ativas");

    const [filterAnamnese, setFilterAnamnese] = useState<"all" | "pendente" | "concluido">("all");
    const [filterFotos, setFilterFotos] = useState<"all" | "pendente" | "concluido">("all");
    const [filterTreino, setFilterTreino] = useState<"all" | "pendente" | "concluido">("all");
    const [filterFotosLib, setFilterFotosLib] = useState<"all" | "pendente" | "concluido">("all");

    type SortKey = "nome" | "anamnese" | "fotos" | "treino" | "fotosLib" | "reavaliacao" | null;
    const [sortKey, setSortKey] = useState<SortKey>(null);
    const [sortAsc, setSortAsc] = useState(true);

    const toggleSort = (key: Exclude<SortKey, null>) => {
        if (sortKey === key) {
            if (sortAsc) setSortAsc(false);
            else { setSortKey(null); setSortAsc(true); }
        } else {
            setSortKey(key);
            setSortAsc(true);
        }
    };

    const filteredAlunas = useMemo(() => {
        let result = alunas.filter(a => statusTab === "ativas" ? a.status !== "inativa" : a.status === "inativa");

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(a => a.nomeCompleto.toLowerCase().includes(lower));
        }

        if (planFilter && planFilter !== "all") {
            result = result.filter(a => a.programa === planFilter);
        }

        if (dateFilter?.from) {
            result = result.filter(a => {
                if (!a.dataCompra) return false;
                try {
                    const d = parseISO(a.dataCompra);
                    if (dateFilter.to) {
                        return d >= dateFilter.from! && d <= dateFilter.to!;
                    }
                    return isSameDay(d, dateFilter.from!);
                } catch {
                    return false;
                }
            });
        }

        if (filterAnamnese !== "all") {
            result = result.filter(a => filterAnamnese === "concluido" ? !!a.anamneseMfit : !a.anamneseMfit);
        }
        if (filterFotos !== "all") {
            result = result.filter(a => filterFotos === "concluido" ? !!a.dataFotosAnamnese : !a.dataFotosAnamnese);
        }
        if (filterTreino !== "all") {
            result = result.filter(a => filterTreino === "concluido" ? !!a.liberouTreinoDieta : !a.liberouTreinoDieta);
        }
        if (filterFotosLib !== "all") {
            result = result.filter(a => filterFotosLib === "concluido" ? !!a.liberouFotos : !a.liberouFotos);
        }

        if (sortKey) {
            const dir = sortAsc ? 1 : -1;
            const getVal = (a: Aluna): string | number => {
                switch (sortKey) {
                    case "nome": return a.nomeCompleto.toLowerCase();
                    case "anamnese": return a.anamneseMfit ? 1 : 0;
                    case "fotos": return a.dataFotosAnamnese || "";
                    case "treino": return a.liberouTreinoDieta ? 1 : 0;
                    case "fotosLib": return a.liberouFotos ? 1 : 0;
                    case "reavaliacao": {
                        // Ordena por proximidade de hoje: hoje, amanhã, ontem, etc.
                        const data = dataReavaliacao(a);
                        if (!data) return Number.MAX_SAFE_INTEGER;
                        try {
                            const diffDays = differenceInCalendarDays(parseISO(data), new Date());
                            return Math.abs(diffDays);
                        } catch {
                            return Number.MAX_SAFE_INTEGER;
                        }
                    }
                    default: return "";
                }
            };
            result = [...result].sort((a, b) => {
                const va = getVal(a);
                const vb = getVal(b);
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
                return 0;
            });
        }

        return result;
    }, [alunas, searchTerm, planFilter, dateFilter, filterAnamnese, filterFotos, filterTreino, filterFotosLib, sortKey, sortAsc]);

    const loadAlunas = useCallback(async () => {
        try {
            const data = await fetchAlunas();
            setAlunas(data);
        } catch (err: any) {
            toast({ title: "Erro ao carregar", description: err.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadAlunas();
        // Request notification permission on load
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, [loadAlunas]);

    // Check for re-evaluations today
    useEffect(() => {
        if (alunas.length > 0) {
            const today = new Date();
            // Aluna de teste não entra na cobrança do dia.
            const todayEvaluations = semAlunasTeste(alunas).filter(a =>
                a.dataAvaliacao && isSameDay(parseISO(a.dataAvaliacao), today)
            );

            if (todayEvaluations.length > 0) {
                toast({
                    title: "Reavaliações Hoje! 🔔",
                    description: `Você tem ${todayEvaluations.length} aluna(s) para cobrar reavaliação hoje.`,
                    duration: 10000,
                });

                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("BX Fitness - Reavaliações", {
                        body: `Você tem ${todayEvaluations.length} aluna(s) para reavaliar hoje!`,
                        icon: logoCouple
                    });
                }
            }
        }
    }, [alunas, toast]);

    const handleUpdateAluna = async (aluna: Aluna, updates: Partial<Aluna>) => {
        if (!user) return;
        const updatedAluna = { ...aluna, ...updates };

        // Optimistic update
        setAlunas(prev => prev.map(a => a.id === aluna.id ? updatedAluna : a));

        setSaving(aluna.id);
        try {
            await upsertAluna(updatedAluna, user.id);

            // Automatic Tasks Logic
            if (updates.dataFotosAnamnese || (updates.fotosAnamnese && !aluna.fotosAnamnese)) {
                // Task: Liberação de Treino/Dieta (+2 business days)
                const startDate = updates.dataFotosAnamnese ? parseISO(updates.dataFotosAnamnese) : new Date();
                const dueDate = calculateDeliveryDueDate(startDate);

                // Instead of a prefixed ID which breaks UUID columns, we omit the ID so Supabase generates a new UUID
                // If you want to prevent duplicates, you'd need to query first. For now, creating a new task.
                await upsertTask({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    title: `Liberação: ${aluna.nomeCompleto}`,
                    description: `Enviar treino e dieta (vence em ${format(dueDate, "dd/MM")})`,
                    dueDate: dueDate.toISOString(),
                    status: 'pending',
                    type: 'liberacao',
                    metadata: { alunaId: aluna.id, alunaNome: aluna.nomeCompleto }
                });
            }

            if (updates.dataAvaliacao) {
                // Task: Reavaliação
                const dueDate = parseISO(updates.dataAvaliacao);
                await upsertTask({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    title: `Reavaliação: ${aluna.nomeCompleto}`,
                    description: `Cobrar fotos e realizar reavaliação`,
                    dueDate: dueDate.toISOString(),
                    status: 'pending',
                    type: 'reavaliacao',
                    metadata: { alunaId: aluna.id, alunaNome: aluna.nomeCompleto }
                });
            }

            toast({ title: "Atualizado", description: `${aluna.nomeCompleto} atualizada.` });
        } catch (err: any) {
            toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
            loadAlunas(); // Rollback
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link to="/alunas">
                            <Button variant="ghost" size="icon" className="h-9 w-9">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div className="rounded-xl overflow-hidden">
                            <img src={logoCouple} alt="BG Fitness" className="h-12 w-12 rounded-xl object-cover object-top" />
                        </div>
                        <div>
                            <h1 className="font-display text-xl font-bold tracking-tight">Painel Personal/Nutri</h1>
                            <p className="text-xs text-muted-foreground">Controle de pendências e reavaliações</p>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadAlunas} disabled={loading} className="gap-2">
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        Sincronizar
                    </Button>
                </div>
            </header>

            <main className="container max-w-6xl mx-auto px-4 py-8">
                {/* Filtros */}
                <div className="flex flex-col md:flex-row gap-4 mb-6 bg-card/50 p-4 rounded-xl border border-border">
                    <div className="flex-1 relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Buscar por nome..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 h-9"
                        />
                    </div>
                    <div className="w-full md:w-auto">
                        <DateRangeFilter dateRange={dateFilter} onRangeChange={setDateFilter} onClear={() => setDateFilter(undefined)} />
                    </div>
                    <div className="w-full md:w-56">
                        <Select value={planFilter} onValueChange={setPlanFilter}>
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="Tipo de plano" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os planos</SelectItem>
                                {(Object.entries(PROGRAM_LABELS) as [string, string][]).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 mb-6 bg-card/50 p-4 rounded-xl border border-border">
                    <span className="text-xs font-semibold text-muted-foreground self-center w-full md:w-auto uppercase tracking-wider">Filtros de Pendência:</span>
                    <Select value={filterAnamnese} onValueChange={setFilterAnamnese as any}>
                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Anamnese/MFIT" /></SelectTrigger>
                        <SelectContent className="text-xs">
                            <SelectItem value="all">Anamnese: Todos</SelectItem>
                            <SelectItem value="pendente">Pendente</SelectItem>
                            <SelectItem value="concluido">Concluído</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterFotos} onValueChange={setFilterFotos as any}>
                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Enviou Fotos" /></SelectTrigger>
                        <SelectContent className="text-xs">
                            <SelectItem value="all">Env. Fotos: Todos</SelectItem>
                            <SelectItem value="pendente">Pendente</SelectItem>
                            <SelectItem value="concluido">Recebido</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterTreino} onValueChange={setFilterTreino as any}>
                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Treino/Dieta" /></SelectTrigger>
                        <SelectContent className="text-xs">
                            <SelectItem value="all">Treino/Dieta: Todos</SelectItem>
                            <SelectItem value="pendente">Pendente</SelectItem>
                            <SelectItem value="concluido">Liberado</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterFotosLib} onValueChange={setFilterFotosLib as any}>
                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Fotos Lib." /></SelectTrigger>
                        <SelectContent className="text-xs">
                            <SelectItem value="all">Fotos Lib: Todos</SelectItem>
                            <SelectItem value="pendente">Pendente</SelectItem>
                            <SelectItem value="concluido">Liberado</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="mb-6 flex justify-start">
                    <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as any)} className="w-full sm:w-auto">
                        <TabsList className="grid w-full grid-cols-2 sm:w-[400px]">
                            <TabsTrigger value="ativas">Ativas</TabsTrigger>
                            <TabsTrigger value="inativas">Inativas</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
                        <RefreshCw className="h-8 w-8 animate-spin" />
                        <p>Carregando alunas...</p>
                    </div>
                ) : (
                    <div className="grid gap-6">
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-muted/50 border-b border-border">
                                            {([
                                                { key: "nome", label: "Aluna", align: "text-left" },
                                                { key: "anamnese", label: "ANAMNESE/MFIT", align: "text-center" },
                                                { key: "fotos", label: "ENVIOU FOTOS", align: "text-center" },
                                                { key: null, label: "LINK DA ANAMNESE", align: "text-center" },
                                                { key: "treino", label: "Treino/Dieta", align: "text-center" },
                                                { key: "fotosLib", label: "FOTOS LIB.", align: "text-center" },
                                                { key: "reavaliacao", label: "WhatsApp (35 dias)", align: "text-center" },
                                            ] as const).map((col) => (
                                                <th
                                                    key={col.label}
                                                    onClick={() => col.key && toggleSort(col.key)}
                                                    className={cn(
                                                        "px-4 py-4 text-sm whitespace-nowrap select-none transition-colors",
                                                        col.align,
                                                        col.key && "cursor-pointer hover:bg-muted/70",
                                                        col.key && sortKey === col.key ? "font-extrabold text-foreground" : "font-semibold text-muted-foreground"
                                                    )}
                                                    title={col.key ? "Clique para ordenar" : undefined}
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        {col.label}
                                                        {col.key && sortKey === col.key && (
                                                            sortAsc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                                                        )}
                                                    </span>
                                                </th>
                                            ))}
                                            <th className="px-4 py-4 text-sm font-semibold text-center">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {filteredAlunas.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                                                    Nenhuma aluna encontrada.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredAlunas.map((aluna) => (
                                                <AlunaRow
                                                    key={aluna.id}
                                                    aluna={aluna}
                                                    handleUpdateAluna={handleUpdateAluna}
                                                    toast={toast}
                                                />
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 p-4 rounded-xl bg-primary/5 border border-primary/10 text-primary">
                            <Bell className="h-5 w-5 shrink-0" />
                            <p className="text-xs">
                                <strong>Dica:</strong> A data no botão do WhatsApp é a reavaliação, 35 dias depois das fotos. Em azul quer dizer que é hoje. Clique no nome da aluna pra ver tudo sobre ela.
                            </p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
