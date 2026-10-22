import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFunnelsSection } from "@/components/funnels/CustomFunnelsSection";
import { MicroinfluenciaTab } from "@/components/funnels/MicroinfluenciaTab";
import { ProgramsManager } from "@/components/programs/ProgramsManager";
import { useAuth } from "@/hooks/useAuth";
import { temComercial } from "@/lib/modules";
import { UserProfileHeader } from "@/components/UserProfileHeader";

export default function Funis() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, allowedModules, loading: authLoading } = useAuth();

  const moduleAllowed =
    isAdmin || allowedModules.includes("funis") || temComercial(isAdmin, allowedModules);

  const activeTab = searchParams.get("tab") ?? "programas";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  if (!authLoading && !moduleAllowed) {
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
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <UserProfileHeader />
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-2">
            <TabsTrigger value="programas">Programas</TabsTrigger>
            <TabsTrigger value="funis">Funis</TabsTrigger>
            <TabsTrigger value="microinfluencia">Microinfluência</TabsTrigger>
          </TabsList>

          <TabsContent value="programas">
            <ProgramsManager />
          </TabsContent>

          <TabsContent value="funis">
            <CustomFunnelsSection />
          </TabsContent>

          <TabsContent value="microinfluencia">
            <MicroinfluenciaTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
