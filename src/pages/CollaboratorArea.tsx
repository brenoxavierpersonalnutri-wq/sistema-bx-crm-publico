import { useAuth } from "@/hooks/useAuth";
import { useTasks } from "@/hooks/useTasks";
import { useQuery } from "@tanstack/react-query";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskChecklist } from "@/components/tasks/TaskChecklist";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckSquare, CalendarDays } from "lucide-react";
import { CollaboratorTask } from "@/lib/taskTypes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, User, Calendar as CalendarIcon, CalendarPlus, LogOut, Camera, Users, BarChart3 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AgendaAccessManager } from "@/components/tasks/AgendaAccessManager";

export default function CollaboratorArea() {
    const { user, profile, isAdmin, signOut } = useAuth();
    const [searchParams] = useSearchParams();
    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    const [viewedUserId, setViewedUserId] = useState<string | undefined>(user?.id);

    // Permite chegar via /colaborador?user=<id> (vindo do painel de admin).
    useEffect(() => {
        const fromUrl = searchParams.get("user");
        if (fromUrl && fromUrl !== viewedUserId) {
            setViewedUserId(fromUrl);
        }
    }, [searchParams]); // viewedUserId fora da dep list pra evitar loop
    const [editingTask, setEditingTask] = useState<CollaboratorTask | undefined>(undefined);
    const [defaultTaskDate, setDefaultTaskDate] = useState<Date | undefined>(undefined);
    // Numa série, qual ocorrência foi clicada (pra "só este" / "este e os futuros").
    const [editingOccurrence, setEditingOccurrence] = useState<Date | undefined>(undefined);

    const handleOpenTaskDialog = (task?: CollaboratorTask, dia?: Date) => {
        setEditingTask(task);
        setEditingOccurrence(dia);
        setDefaultTaskDate(undefined);
        setTaskDialogOpen(true);
    };

    // Clique num dia da agenda (ou "Adicionar tarefa") — abre o diálogo de
    // nova tarefa com aquela data já preenchida (UX igual o calendário do Mac).
    const handleCreateForDate = (date: Date) => {
        setEditingTask(undefined);
        setEditingOccurrence(undefined);
        setDefaultTaskDate(date);
        setTaskDialogOpen(true);
    };

    const { data: users = [] } = useQuery({
        queryKey: ["admin-users-list"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name")
                .order("full_name");
            if (error) throw error;
            return data;
        },
        enabled: isAdmin,
    });

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link to="/alunas">
                            <Button variant="ghost" size="icon" className="h-9 w-9">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <h1 className="font-display text-xl font-bold tracking-tight">Área do Usuário</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <>
                                <Link to="/admin/colaboradores">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                                    >
                                        <BarChart3 className="h-4 w-4" />
                                        Painel do Time
                                    </Button>
                                </Link>
                                <Link to="/admin/users">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 bg-secondary/50 border-border hover:bg-secondary"
                                    >
                                        <Users className="h-4 w-4" />
                                        Usuários
                                    </Button>
                                </Link>
                            </>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                            onClick={() => handleOpenTaskDialog()}
                        >
                            <CalendarPlus className="h-4 w-4" />
                            Agendar Tarefa
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
                            <LogOut className="h-4 w-4" />
                            Sair
                        </Button>
                    </div>
                </div>
            </header>

            <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
                {/* Profile Card */}
                <section>
                    <Card className="border-none shadow-premium bg-gradient-to-br from-card to-muted/30 overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            <User className="h-32 w-32" />
                        </div>
                        <CardHeader className="relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="relative">
                                    <div className="h-24 w-24 rounded-2xl overflow-hidden border-2 border-primary/20 p-1 bg-background shadow-premium relative">
                                        {profile?.avatar_url ? (
                                            <img
                                                src={profile.avatar_url}
                                                alt="Profile"
                                                className="h-full w-full object-cover rounded-xl"
                                            />
                                        ) : (
                                            <div className="h-full w-full bg-muted flex items-center justify-center rounded-xl">
                                                <User className="h-10 w-10 text-muted-foreground" />
                                            </div>
                                        )}
                                        
                                        <label
                                            htmlFor="avatar-upload"
                                            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/40 text-transparent hover:text-white transition-all cursor-pointer rounded-xl"
                                        >
                                            <Camera className="h-6 w-6 opacity-0 hover:opacity-100" />
                                        </label>
                                    </div>
                                    
                                    <label
                                        htmlFor="avatar-upload"
                                        className="absolute -bottom-1 -right-1 h-8 w-8 bg-primary text-primary-foreground rounded-lg flex items-center justify-center shadow-lg cursor-pointer hover:bg-primary/90 transition-colors border-2 border-background"
                                    >
                                        <Camera className="h-4 w-4" />
                                    </label>

                                    <input
                                        id="avatar-upload"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file || !user) return;

                                            // Validate type
                                            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                                            if (!allowedTypes.includes(file.type)) {
                                                alert('Formato inválido. Use JPG, PNG ou WEBP.');
                                                return;
                                            }

                                            // Validate size (max 5MB)
                                            const MAX_SIZE = 5 * 1024 * 1024;
                                            if (file.size > MAX_SIZE) {
                                                alert('Imagem muito grande. Tamanho máximo: 5MB.');
                                                return;
                                            }

                                            try {
                                                const fileExt = file.name.split('.').pop();
                                                const filePath = `${user.id}/${Date.now()}.${fileExt}`;

                                                console.log('Uploading file:', filePath);

                                                const { error: uploadError } = await (supabase.storage as any)
                                                    .from('avatars')
                                                    .upload(filePath, file, { upsert: true, contentType: file.type });

                                                if (uploadError) throw uploadError;

                                                const { data: { publicUrl } } = (supabase.storage as any)
                                                    .from('avatars')
                                                    .getPublicUrl(filePath);

                                                const { error: updateError } = await supabase
                                                    .from('profiles')
                                                    .update({ avatar_url: publicUrl } as any)
                                                    .eq('id', user.id);

                                                if (updateError) throw updateError;

                                                window.location.reload();
                                            } catch (err: any) {
                                                console.error('Error uploading avatar:', err);
                                                alert('Erro ao carregar imagem: ' + err.message);
                                            }
                                        }}
                                    />
                                </div>
                                <div className="flex-1">
                                    <CardTitle className="text-2xl font-display font-bold">{profile?.full_name || "Usuário"}</CardTitle>
                                    <p className="text-muted-foreground">{user?.email}</p>
                                    <div className="flex gap-2 mt-2">
                                        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                                            {isAdmin ? "Administrador" : "Usuário"}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-2">
                                        Foto recomendada: quadrada (400×400px), JPG/PNG/WEBP, até 5MB.
                                    </p>
                                </div>
                            </div>
                        </CardHeader>
                    </Card>
                </section>

                {isAdmin && <AgendaAccessManager />}

                {/* Agenda Section */}
                <section className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-display font-bold flex items-center gap-2">
                            <CalendarIcon className="h-6 w-6 text-primary" />
                            {viewedUserId === user?.id ? "Minha Agenda e Tarefas" : "Agenda do Usuário"}
                        </h2>
                        
                        {isAdmin && users.length > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">Ver agenda de:</span>
                                <select 
                                    className="bg-background border border-border rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    value={viewedUserId}
                                    onChange={(e) => setViewedUserId(e.target.value)}
                                >
                                    <option value={user?.id}>Minha (Própria)</option>
                                    {users.filter(u => u.id !== user?.id).map(u => (
                                        <option key={u.id} value={u.id}>{u.full_name || "Usuário sem nome"}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <Tabs defaultValue="checklist" className="space-y-4">
                        <TabsList className="grid w-full grid-cols-2 max-w-md">
                            <TabsTrigger value="checklist" className="gap-2">
                                <CheckSquare className="h-4 w-4" />
                                Checklist
                            </TabsTrigger>
                            <TabsTrigger value="agenda" className="gap-2">
                                <CalendarDays className="h-4 w-4" />
                                Agenda
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="checklist" className="space-y-4">
                            <TaskChecklist
                                userId={viewedUserId}
                                onAddTask={handleCreateForDate}
                                onEditTask={handleOpenTaskDialog}
                            />
                        </TabsContent>

                        <TabsContent value="agenda">
                            <div className="bg-card border border-border/40 rounded-2xl p-6 shadow-premium">
                                <TaskCalendar
                                    userId={viewedUserId}
                                    onEditTask={handleOpenTaskDialog}
                                    onCreateForDate={handleCreateForDate}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                </section>
            </main>

            <TaskDialog
                open={taskDialogOpen}
                onOpenChange={(open) => {
                    setTaskDialogOpen(open);
                    if (!open) {
                        setEditingTask(undefined);
                        setEditingOccurrence(undefined);
                        setDefaultTaskDate(undefined);
                    }
                }}
                task={editingTask}
                defaultDate={defaultTaskDate}
                occurrenceDate={editingOccurrence}
                defaultUserId={viewedUserId}
            />
        </div>
    );
}
