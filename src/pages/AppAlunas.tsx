import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Dumbbell, Library, Search, Users, ChevronRight, Smartphone, PlaySquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchAlunas } from "@/lib/alunaStore";
import { PROGRAM_LABELS } from "@/lib/alunaTypes";
import { SeloTeste } from "@/components/alunas/AlunaTeste";
import { ehAlunaTeste } from "@/lib/alunaTeste";
import { fetchAcessos } from "@/lib/appAluna/store";
import { ExerciciosLibrary } from "@/components/appAluna/ExerciciosLibrary";
import { FasesManager } from "@/components/appAluna/FasesManager";
import { PlanoTreinoTab } from "@/components/appAluna/PlanoTreinoTab";
import { DietaTab } from "@/components/appAluna/DietaTab";
import { FeedbackTab } from "@/components/appAluna/FeedbackTab";
import { AcessoTab } from "@/components/appAluna/AcessoTab";

export default function AppAlunas() {
  const [alunaSelecionada, setAlunaSelecionada] = useState<{ id: string; nome: string } | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" aria-label="Voltar ao início">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold">App das Alunas</h1>
              <p className="truncate text-xs text-muted-foreground">
                Biblioteca de exercícios, fases de treino, dieta e feedback
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/alunas/conteudos">
              <Button variant="outline" size="sm" className="gap-2">
                <PlaySquare className="h-4 w-4" />
                <span className="hidden sm:inline">Conteúdos</span>
              </Button>
            </Link>
          <a href="/aluna" target="_blank" rel="noopener noreferrer" className="shrink-0">
            <Button variant="outline" size="sm" className="gap-2">
              <Smartphone className="h-4 w-4" />
              <span className="hidden sm:inline">Ver como aluna</span>
            </Button>
          </a>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="alunas" className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="alunas" className="gap-2">
              <Users className="h-4 w-4" /> Alunas
            </TabsTrigger>
            <TabsTrigger value="fases" className="gap-2">
              <Dumbbell className="h-4 w-4" /> Fases de treino
            </TabsTrigger>
            <TabsTrigger value="exercicios" className="gap-2">
              <Library className="h-4 w-4" /> Exercícios
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alunas">
            {alunaSelecionada ? (
              <AlunaDetalhe
                alunaId={alunaSelecionada.id}
                nome={alunaSelecionada.nome}
                onVoltar={() => setAlunaSelecionada(null)}
              />
            ) : (
              <ListaAlunas onSelecionar={(id, nome) => setAlunaSelecionada({ id, nome })} />
            )}
          </TabsContent>

          <TabsContent value="fases"><FasesManager /></TabsContent>
          <TabsContent value="exercicios"><ExerciciosLibrary /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ListaAlunas({ onSelecionar }: { onSelecionar: (id: string, nome: string) => void }) {
  const [busca, setBusca] = useState("");

  const { data: alunas = [], isLoading } = useQuery({
    queryKey: ["alunas"],
    queryFn: fetchAlunas,
  });

  const { data: acessos = [] } = useQuery({
    queryKey: ["acessos"],
    queryFn: fetchAcessos,
  });

  const comAcesso = useMemo(
    () => new Map(acessos.map((a) => [a.alunaId, a])),
    [acessos],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return alunas
      .filter((a) => a.status !== "inativa")
      .filter((a) => !termo || a.nomeCompleto.toLowerCase().includes(termo));
  }, [alunas, busca]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar aluna"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma aluna encontrada. Cadastre em Gestão de Alunas.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((a) => {
            const acesso = comAcesso.get(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelecionar(a.id, a.nomeCompleto)}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.nomeCompleto}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {PROGRAM_LABELS[a.programa] ?? a.programa}
                    </Badge>
                    {ehAlunaTeste(a) && <SeloTeste />}
                    {acesso?.ativo && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-[10px] text-emerald-600"
                      >
                        app liberado
                      </Badge>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlunaDetalhe({
  alunaId, nome, onVoltar,
}: {
  alunaId: string;
  nome: string;
  onVoltar: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1 gap-1" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4" /> Todas as alunas
        </Button>
        <h2 className="text-xl font-semibold">{nome}</h2>
      </div>

      <Tabs defaultValue="treino" className="space-y-5">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="treino">Treino</TabsTrigger>
          <TabsTrigger value="dieta">Dieta</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="acesso">Acesso</TabsTrigger>
        </TabsList>

        <TabsContent value="treino"><PlanoTreinoTab alunaId={alunaId} /></TabsContent>
        <TabsContent value="dieta"><DietaTab alunaId={alunaId} /></TabsContent>
        <TabsContent value="feedback"><FeedbackTab alunaId={alunaId} /></TabsContent>
        <TabsContent value="acesso"><AcessoTab alunaId={alunaId} nomeAluna={nome} /></TabsContent>
      </Tabs>
    </div>
  );
}
