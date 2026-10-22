import { useState, useEffect, useCallback } from "react";
import { AlunaStatsCards } from "@/components/alunas/AlunaStatsCards";
import { ROTULO_FILTRO, alunasVencendo, ehFiltroValido, filtrarAlunas } from "@/lib/alunaFiltros";
import { ExpiringReminders } from "@/components/alunas/ExpiringReminders";
import { Card } from "@/components/ui/card";
import { AlunaList } from "@/components/alunas/AlunaList";
import { AlunaForm } from "@/components/alunas/AlunaForm";
import { AlunaImportSheet } from "@/components/alunas/AlunaImportSheet";
import { AlunaDashboard } from "@/components/alunas/AlunaDashboard";
import { BotaoCriarAlunaTeste } from "@/components/alunas/AlunaTeste";
import { semAlunasTeste } from "@/lib/alunaTeste";
import { fetchAlunas, upsertAluna, deleteAlunaDb, importAlunasDb } from "@/lib/alunaStore";
import { Aluna } from "@/lib/alunaTypes";
import { atualizarTelasDepoisDeApagarAluna } from "@/lib/telasDaAluna";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { temComercial } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, LayoutDashboard, UserPlus, Users, ShoppingCart, Utensils, ArrowLeft, ClipboardList, MessageSquareHeart, PlaySquare, AlertCircle, Replace } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "react-router-dom";
import logoCouple from "@/assets/logo-couple.png";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { RefreshCw, Lock, CalendarPlus, Bell } from "lucide-react";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTasks } from "@/hooks/useTasks";
import { isSameDay, parseISO } from "date-fns";

const Alunas = () => {
  const navigate = useNavigate();
  const [alunas, setAlunas] = useState<Aluna[]>([]);
  const [activeTab, setActiveTab] = useState("cadastro");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingAluna, setEditingAluna] = useState<Aluna | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [defaultTaskDate, setDefaultTaskDate] = useState<Date | undefined>(undefined);
  const { signOut, isAdmin, user, allowedModules } = useAuth();
  const { toast } = useToast();
  const { data: tasks = [] } = useTasks(user?.id);
  const queryClient = useQueryClient();

  // Clicar num cartão do topo abre a tela focada: só aquelas alunas, sem
  // agenda e sem as abas. Sair dela é voltar pro painel inteiro.
  const [verVencimentos, setVerVencimentos] = useState(false);
  // Aluna de teste aparece na lista do Cadastro (com o selo), mas não conta em
  // nada: cartões, painel, vencimentos e as listas que os cartões abrem.
  const reais = semAlunasTeste(alunas);
  const vencendo = alunasVencendo(reais);

  const handleFilterSelect = (filter: string) => {
    setActiveFilter(filter);
    setVerVencimentos(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

  useEffect(() => { loadAlunas(); }, [loadAlunas]);

  useEffect(() => {
    const handler = () => loadAlunas();
    window.addEventListener('alunas-updated', handler);
    return () => window.removeEventListener('alunas-updated', handler);
  }, [loadAlunas]);

  // Task Notifications
  useEffect(() => {
    if (tasks.length > 0) {
      const today = new Date();
      const todayTasks = tasks.filter(t =>
        t.status === 'pending' && isSameDay(parseISO(t.dueDate), today)
      );

      if (todayTasks.length > 0) {
        toast({
          title: "Tarefas para Hoje! 🔔",
          description: `Você tem ${todayTasks.length} tarefa(s) pendente(s) para hoje na agenda.`,
          duration: 10000,
        });

        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("BX Fitness - Agenda", {
            body: `Você tem ${todayTasks.length} tarefa(s) para hoje!`,
            icon: logoCouple
          });
        }
      }
    }
  }, [tasks, toast]);

  const handleSave = async (aluna: Aluna) => {
    if (!user) return;
    try {
      await upsertAluna(aluna, user.id);
      await loadAlunas();
      setEditingAluna(null);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAlunaDb(id);
      void atualizarTelasDepoisDeApagarAluna(queryClient);
      await loadAlunas();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = (aluna: Aluna) => { setEditingAluna(aluna); setFormOpen(true); };
  const handleAdd = () => { setEditingAluna(null); setFormOpen(true); };

  const handleImport = async (imported: Aluna[]) => {
    if (!user) return;
    try {
      await importAlunasDb(imported, user.id);
      await loadAlunas();
    } catch (err: any) {
      toast({ title: "Erro ao importar", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleResiduo = async (aluna: Aluna) => {
    if (!user) return;
    try {
      // Toggle the flag directly or assume true if clicked "Mark as Done"
      await upsertAluna({ ...aluna, residuoPago: true }, user.id);
      await loadAlunas();
      toast({ title: "Sucesso", description: "Lembrete marcado como pago!" });
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <UserProfileHeader />
          </div>
          <div className="flex items-center gap-2">
            <BotaoCriarAlunaTeste />
            <Link to="/">
              <Button variant="outline" size="sm" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Início
              </Button>
            </Link>
            <Link to="/alunas/personal-nutri">
              <Button variant="outline" size="sm" className="gap-2 border-primary text-primary">
                <Utensils className="h-4 w-4" />
                Personal/Nutri
              </Button>
            </Link>
            <Link to="/alunas/pesquisa-satisfacao">
              <Button variant="outline" size="sm" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                Pesquisa de Satisfação
              </Button>
            </Link>
            <Link to="/alunas/feedback">
              <Button variant="outline" size="sm" className="gap-2">
                <MessageSquareHeart className="h-4 w-4" />
                Feedback Semanal
              </Button>
            </Link>
            <Link to="/alunas/pesquisa-trocas">
              <Button variant="outline" size="sm" className="gap-2">
                <Replace className="h-4 w-4" />
                Pesquisa das Trocas
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                setVerVencimentos(true);
                setActiveFilter(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <AlertCircle className="h-4 w-4" />
              Vencimentos
              {vencendo.length > 0 && (
                <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
                  {vencendo.length}
                </span>
              )}
            </Button>
            <Link to="/alunas/conteudos">
              <Button variant="outline" size="sm" className="gap-2">
                <PlaySquare className="h-4 w-4" />
                Conteúdos
              </Button>
            </Link>
            <Link to="/alunas/parcerias">
              <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary">
                <Users className="h-4 w-4" />
                Parcerias
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                if (temComercial(isAdmin, allowedModules)) {
                  navigate("/vendas");
                } else {
                  toast({
                    title: "Acesso Negado",
                    description: "Você não tem acesso liberado para este módulo. Solicite ao administrador.",
                    variant: "destructive",
                  });
                }
              }}
            >
              <ShoppingCart className="h-4 w-4" />
              Consulta
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          verVencimentos ? (
          <>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setVerVencimentos(false)}
                aria-label="Voltar"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h2 className="font-display text-xl font-bold">Vencimentos pendentes</h2>
                <p className="text-sm text-muted-foreground">
                  {vencendo.length} aluna(s) vencendo em 7 dias ou menos
                </p>
              </div>
            </div>

            {vencendo.length === 0 ? (
              <Card className="flex flex-col items-center justify-center border-dashed p-12 gap-2">
                <p className="font-semibold">Nenhum vencimento pendente</p>
                <p className="text-sm text-muted-foreground">
                  Ninguém vencendo nos próximos 7 dias.
                </p>
              </Card>
            ) : (
              <ExpiringReminders alunas={reais} />
            )}
          </>
          ) : ehFiltroValido(activeFilter) ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActiveFilter(null)}
                  aria-label="Voltar"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <h2 className="font-display text-xl font-bold">
                    {ROTULO_FILTRO[activeFilter]}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {filtrarAlunas(reais, activeFilter).length} aluna(s)
                  </p>
                </div>
              </div>
            </div>

            <AlunaList
              alunas={filtrarAlunas(reais, activeFilter)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onImport={() => setImportOpen(true)}
              onToggleResiduo={handleToggleResiduo}
              listarTudo
              semAvisos
            />
          </>
          ) : (
          <>
            <AlunaStatsCards alunas={reais} onFilterSelect={handleFilterSelect} />

            <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-2xl p-3 shadow-sm">
              <h2 className="text-lg font-display font-bold mb-3 flex items-center gap-2">
                <CalendarPlus className="h-6 w-6 text-primary" />
                Minha Agenda
              </h2>
              <TaskCalendar
                onCreateForDate={(date) => {
                  setDefaultTaskDate(date);
                  setTaskDialogOpen(true);
                }}
              />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-2 max-w-sm">
                <TabsTrigger value="cadastro" className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">Cadastro</span>
                </TabsTrigger>
                <TabsTrigger value="dashboard" className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">Painel</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cadastro" className="space-y-6">
                <AlunaList alunas={alunas} onEdit={handleEdit} onDelete={handleDelete} onAdd={handleAdd} onImport={() => setImportOpen(true)} onToggleResiduo={handleToggleResiduo} onApagadaTeste={loadAlunas} />
              </TabsContent>

              <TabsContent value="dashboard">
                <AlunaDashboard
                  alunas={reais}
                  onEdit={handleEdit}
                  activeFilter={activeFilter}
                  onClearFilter={() => setActiveFilter(null)}
                />
              </TabsContent>
            </Tabs>
          </>
          )
        )}
      </main>

      <AlunaForm
        key={editingAluna?.id || (formOpen ? "new" : "closed")}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingAluna(null); }}
        onSave={handleSave}
        aluna={editingAluna}
      />

      <AlunaImportSheet open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} />

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) setDefaultTaskDate(undefined);
        }}
        defaultDate={defaultTaskDate}
      />
    </div>
  );
};

export default Alunas;
