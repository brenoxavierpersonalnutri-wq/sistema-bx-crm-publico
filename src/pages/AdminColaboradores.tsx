import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    Users,
    CheckCircle2,
    Clock,
    AlertTriangle,
    Target,
    TrendingUp,
    Eye,
    RefreshCw,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RTooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";
import { isBefore, parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface Profile {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
    approved: boolean | null;
}

interface RawTask {
    id: string;
    user_id: string;
    status: string;
    type: string;
    due_date: string;
}

interface UserStats {
    profile: Profile;
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    metas: number;
    completionRate: number; // 0..100
}

async function fetchProfiles(): Promise<Profile[]> {
    const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, role, approved")
        .eq("approved", true);
    if (error) throw error;
    return (data as any) ?? [];
}

async function fetchAllTasks(): Promise<RawTask[]> {
    const { data, error } = await supabase
        .from("collaborator_tasks" as any)
        .select("id, user_id, status, type, due_date");
    if (error) throw error;
    return (data as any) ?? [];
}

export default function AdminColaboradores() {
    const navigate = useNavigate();
    const { isAdmin } = useAuth();

    const {
        data: profiles = [],
        isLoading: loadingProfiles,
        error: profilesError,
    } = useQuery({ queryKey: ["admin-colaboradores-profiles"], queryFn: fetchProfiles });

    const {
        data: tasks = [],
        isLoading: loadingTasks,
        error: tasksError,
        refetch,
        isRefetching,
    } = useQuery({ queryKey: ["admin-colaboradores-tasks"], queryFn: fetchAllTasks });

    const stats = useMemo<UserStats[]>(() => {
        const today = startOfDay(new Date());
        return profiles
            .map((p) => {
                const userTasks = tasks.filter((t) => t.user_id === p.id);
                const completed = userTasks.filter((t) => t.status === "completed").length;
                const pending = userTasks.filter((t) => t.status !== "completed").length;
                const overdue = userTasks.filter(
                    (t) =>
                        t.status !== "completed" &&
                        isBefore(parseISO(t.due_date), today)
                ).length;
                const metas = userTasks.filter((t) => t.type === "meta").length;
                const total = userTasks.length;
                const completionRate = total === 0 ? 0 : (completed / total) * 100;
                return {
                    profile: p,
                    total,
                    completed,
                    pending,
                    overdue,
                    metas,
                    completionRate,
                };
            })
            .sort((a, b) => {
                // Prioridade: quem tem mais atrasadas primeiro (precisa atenção),
                // depois ordem alfabética.
                if (a.overdue !== b.overdue) return b.overdue - a.overdue;
                return (a.profile.full_name || "").localeCompare(b.profile.full_name || "");
            });
    }, [profiles, tasks]);

    const totals = useMemo(() => {
        const t = {
            colaboradores: stats.length,
            total: 0,
            completed: 0,
            pending: 0,
            overdue: 0,
            metas: 0,
        };
        for (const s of stats) {
            t.total += s.total;
            t.completed += s.completed;
            t.pending += s.pending;
            t.overdue += s.overdue;
            t.metas += s.metas;
        }
        return t;
    }, [stats]);

    const chartData = useMemo(
        () =>
            stats
                .filter((s) => s.total > 0)
                .map((s) => ({
                    nome: (s.profile.full_name || "—").split(" ")[0],
                    Concluídas: s.completed,
                    Pendentes: s.pending - s.overdue,
                    Atrasadas: s.overdue,
                })),
        [stats]
    );

    const isLoading = loadingProfiles || loadingTasks;
    const error = profilesError || tasksError;

    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <Card className="max-w-md w-full text-center p-6 space-y-3">
                    <h2 className="text-lg font-semibold">Acesso restrito</h2>
                    <p className="text-sm text-muted-foreground">
                        Esse painel é só pra admin.
                    </p>
                    <Button onClick={() => navigate("/")} variant="outline" className="gap-2">
                        <ArrowLeft className="h-4 w-4" /> Voltar
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <Link to="/">
                            <Button variant="ghost" size="icon" className="h-9 w-9">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <UserProfileHeader />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetch()}
                            disabled={isRefetching}
                            className="gap-2"
                        >
                            <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
                            Atualizar
                        </Button>
                    </div>
                </div>
            </header>

            <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
                <div>
                    <h1 className="font-display text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6 text-primary" />
                        Time & Tarefas
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Painel de monitoramento — todos os colaboradores e o status das tarefas/metas.
                    </p>
                </div>

                {error && (
                    <Card className="border-destructive/30 bg-destructive/5">
                        <CardContent className="p-4 text-sm text-destructive">
                            Erro ao carregar: {(error as Error).message}
                        </CardContent>
                    </Card>
                )}

                {/* KPIs gerais */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Colaboradores
                            </div>
                            <div className="text-2xl font-bold mt-1 tabular-nums">
                                {totals.colaboradores}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Total tarefas
                            </div>
                            <div className="text-2xl font-bold mt-1 tabular-nums">{totals.total}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Concluídas
                            </div>
                            <div className="text-2xl font-bold mt-1 tabular-nums text-success">
                                {totals.completed}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Atrasadas
                            </div>
                            <div className="text-2xl font-bold mt-1 tabular-nums text-destructive">
                                {totals.overdue}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                Metas ativas
                            </div>
                            <div className="text-2xl font-bold mt-1 tabular-nums text-amber-500">
                                {totals.metas}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Gráfico de barras empilhado */}
                {chartData.length > 0 && (
                    <Card>
                        <CardContent className="p-4">
                            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-primary" />
                                Distribuição de tarefas por colaborador
                            </h3>
                            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
                                <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                                    <XAxis type="number" allowDecimals={false} />
                                    <YAxis type="category" dataKey="nome" width={100} />
                                    <RTooltip
                                        contentStyle={{
                                            background: "hsl(var(--card))",
                                            border: "1px solid hsl(var(--border))",
                                        }}
                                    />
                                    <Bar dataKey="Concluídas" stackId="a" fill="#22c55e" />
                                    <Bar dataKey="Pendentes" stackId="a" fill="#3b82f6" />
                                    <Bar dataKey="Atrasadas" stackId="a" fill="#ef4444" />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                )}

                {/* Lista de colaboradores */}
                <div className="space-y-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Carregando...
                        </div>
                    ) : stats.length === 0 ? (
                        <Card>
                            <CardContent className="p-8 text-center text-sm text-muted-foreground">
                                Nenhum colaborador aprovado ainda.
                            </CardContent>
                        </Card>
                    ) : (
                        stats.map((s) => (
                            <Card
                                key={s.profile.id}
                                className={cn(
                                    "transition-shadow hover:shadow-md",
                                    s.overdue > 0 && "border-destructive/30"
                                )}
                            >
                                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                                    <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                                        {s.profile.avatar_url ? (
                                            <img
                                                src={s.profile.avatar_url}
                                                alt={s.profile.full_name || "Colaborador"}
                                                className="h-10 w-10 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                                                {(s.profile.full_name || "?").charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="font-semibold text-sm truncate">
                                                {s.profile.full_name || "Sem nome"}
                                            </div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                {s.profile.role && <span>{s.profile.role}</span>}
                                                {s.metas > 0 && (
                                                    <>
                                                        {s.profile.role && " · "}
                                                        <Target className="h-3 w-3 text-amber-500" />
                                                        {s.metas} meta{s.metas === 1 ? "" : "s"}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 text-xs">
                                        <div className="flex items-center gap-1.5 text-success">
                                            <CheckCircle2 className="h-4 w-4" />
                                            <span className="tabular-nums font-medium">{s.completed}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-blue-500">
                                            <Clock className="h-4 w-4" />
                                            <span className="tabular-nums font-medium">{s.pending}</span>
                                        </div>
                                        <div
                                            className={cn(
                                                "flex items-center gap-1.5",
                                                s.overdue > 0 ? "text-destructive font-semibold" : "text-muted-foreground"
                                            )}
                                        >
                                            <AlertTriangle className="h-4 w-4" />
                                            <span className="tabular-nums">{s.overdue}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className="w-24">
                                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className={cn(
                                                        "h-full transition-all",
                                                        s.completionRate >= 80
                                                            ? "bg-success"
                                                            : s.completionRate >= 40
                                                            ? "bg-primary"
                                                            : "bg-destructive"
                                                    )}
                                                    style={{ width: `${s.completionRate}%` }}
                                                />
                                            </div>
                                            <div className="text-[10px] text-muted-foreground text-center mt-1 tabular-nums">
                                                {s.completionRate.toFixed(0)}%
                                            </div>
                                        </div>

                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="gap-1.5"
                                            onClick={() => navigate(`/colaborador?user=${s.profile.id}`)}
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                            Ver agenda
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </main>
        </div>
    );
}
