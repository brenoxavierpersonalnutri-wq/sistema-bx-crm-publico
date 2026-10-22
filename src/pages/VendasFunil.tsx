import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Utensils, LayoutDashboard, CalendarIcon, TrendingUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FunnelDashboard } from "@/components/dashboard/FunnelDashboard";
import { CustomFunnelsSection } from "@/components/funnels/CustomFunnelsSection";
import { FunilOrigemIA } from "@/components/crm/ia/FunilOrigemIA";
import { useAuth } from "@/hooks/useAuth";
import { temComercial } from "@/lib/modules";
import { Lock } from "lucide-react";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { Calendar as CalendarIconLucide } from "lucide-react";

const VendasFunil = () => {
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
              Você não tem acesso liberado para o módulo de **Consultas/Vendas**.
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
            <Link to="/alunas">
              <Button variant="outline" size="sm" className="gap-2">
                <Utensils className="h-4 w-4" />
                Gestão de Alunas
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs
          value="funil"
          onValueChange={(v) => {
            if (v === "geral") navigate("/vendas");
            else if (v === "mensal") navigate("/balanco-mensal");
            else if (v === "anual") navigate("/anual");
          }}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full grid-cols-4 sm:w-[560px]">
            <TabsTrigger value="geral" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="funil" className="gap-2">
              <Filter className="h-4 w-4" />
              Funil
            </TabsTrigger>
            <TabsTrigger value="mensal" className="gap-2">
              <CalendarIconLucide className="h-4 w-4" />
              Mensal
            </TabsTrigger>
            <TabsTrigger value="anual" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Anual
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <FunilOrigemIA />

        <CustomFunnelsSection />

        <FunnelDashboard />

      </main>
    </div>
  );
};

export default VendasFunil;
