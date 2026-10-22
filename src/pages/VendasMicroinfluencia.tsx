import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, LayoutDashboard, CalendarIcon, TrendingUp, Filter, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MicroinfluenciaTab } from "@/components/funnels/MicroinfluenciaTab";
import { useAuth } from "@/hooks/useAuth";
import { temComercial } from "@/lib/modules";
import { Lock } from "lucide-react";
import { UserProfileHeader } from "@/components/UserProfileHeader";

const VendasMicroinfluencia = () => {
  const { signOut, isAdmin, allowedModules, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  if (!authLoading && !temComercial(isAdmin, allowedModules)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="bg-card p-8 rounded-2xl border border-border/60 shadow-lg max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <Lock className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Módulo Bloqueado</h2>
            <p className="text-muted-foreground">
              Você não tem acesso liberado para este módulo.
            </p>
          </div>
          <Button className="w-full gap-2" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
            Voltar para o Início
          </Button>
        </div>
      </div>
    );
  }

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
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs
          value="microinfluencia"
          onValueChange={(v) => {
            if (v === "geral") navigate("/vendas");
            else if (v === "funil") navigate("/vendas/funil");
            else if (v === "mensal") navigate("/balanco-mensal");
            else if (v === "anual") navigate("/anual");
          }}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full grid-cols-5 sm:w-[700px]">
            <TabsTrigger value="geral" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="funil" className="gap-2">
              <Filter className="h-4 w-4" />
              Funil
            </TabsTrigger>
            <TabsTrigger value="microinfluencia" className="gap-2">
              <Users className="h-4 w-4" />
              Microinfluência
            </TabsTrigger>
            <TabsTrigger value="mensal" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              Mensal
            </TabsTrigger>
            <TabsTrigger value="anual" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Anual
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <MicroinfluenciaTab />
      </main>
    </div>
  );
};

export default VendasMicroinfluencia;
