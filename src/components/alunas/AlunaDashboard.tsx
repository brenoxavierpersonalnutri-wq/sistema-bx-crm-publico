import { useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, isSameMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Aluna, PROGRAM_LABELS, DURATION_LABELS } from "@/lib/alunaTypes";
import { AlertTriangle, CalendarDays, CheckCircle, ChevronLeft, ChevronRight, Search, Users, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";

interface DashboardOverviewProps {
  alunas: Aluna[];
  onEdit: (aluna: Aluna) => void;
  activeFilter?: string | null;
  onClearFilter?: () => void;
}

function AlunaTable({ alunas, onEdit, showVencimento = true, showEntrada = false }: { alunas: Aluna[]; onEdit: (a: Aluna) => void; showVencimento?: boolean; showEntrada?: boolean }) {
  // A coluna de data ocupa a mesma posição nas duas abas: vencimento quando se
  // olha pra frente, entrada quando se olha pra trás. Mantém a tabela com o
  // mesmo formato ao trocar de aba.
  const colunas = 3 + (showVencimento ? 1 : 0) + (showEntrada ? 1 : 0) + 1;
  return (
    <div className="overflow-x-auto max-h-96 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold">Nome</TableHead>
            <TableHead className="font-semibold">Plano</TableHead>
            <TableHead className="font-semibold">Duração</TableHead>
            {showVencimento && <TableHead className="font-semibold">Vencimento</TableHead>}
            {showEntrada && <TableHead className="font-semibold">Entrada</TableHead>}
            <TableHead className="font-semibold w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alunas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colunas} className="text-center text-muted-foreground py-6">Nenhuma aluna encontrada</TableCell>
            </TableRow>
          ) : (
            alunas.map((aluna) => (
              <TableRow key={aluna.id} className="hover:bg-muted/30">
                <TableCell className="font-medium">{aluna.nomeCompleto}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{PROGRAM_LABELS[aluna.programa]}</Badge></TableCell>
                <TableCell className="text-sm">{DURATION_LABELS[aluna.duracaoPlano] || aluna.duracaoPlano}</TableCell>
                {showVencimento && <TableCell className="text-sm">{format(new Date(aluna.dataVencimento), "dd/MM/yyyy", { locale: ptBR })}</TableCell>}
                {showEntrada && <TableCell className="text-sm">{format(new Date(aluna.dataCompra), "dd/MM/yyyy", { locale: ptBR })}</TableCell>}
                <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(aluna)}>Editar</Button></TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function AlunaDashboard({ alunas, onEdit, activeFilter, onClearFilter }: DashboardOverviewProps) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(format(now, "yyyy-MM"));
  const [expiringFilterMonth, setExpiringFilterMonth] = useState(format(now, "yyyy-MM"));

  const [busca, setBusca] = useState("");
  const [planoFiltro, setPlanoFiltro] = useState<string>("all");

  // Apply card filters + search + plano
  const filteredAlunas = useMemo(() => {
    let result: Aluna[] = alunas;
    if (activeFilter) {
      switch (activeFilter) {
        case "individuais":
          result = result.filter(a => a.programa !== "plataforma_magra");
          break;
        case "plataforma":
          result = result.filter(a => a.programa === "plataforma_magra");
          break;
        case "dia":
          result = result.filter(a => (a.programa !== "plataforma_magra" && a.pago));
          break;
        case "pendentes":
          result = result.filter(a => (a.programa !== "plataforma_magra" && !a.pago));
          break;
      }
    }

    if (busca.trim()) {
      const lower = busca.trim().toLowerCase();
      result = result.filter(a => a.nomeCompleto.toLowerCase().includes(lower));
    }

    if (planoFiltro !== "all") {
      result = result.filter(a => a.programa === planoFiltro);
    }

    return result;
  }, [alunas, activeFilter, busca, planoFiltro]);

  const filterLabel = useMemo(() => {
    switch (activeFilter) {
      case "individuais": return "Alunas Individuais";
      case "plataforma": return "Magra na Plataforma";
      case "dia": return "Pagamentos em Dia";
      case "pendentes": return "Pagamentos Pendentes";
      default: return "";
    }
  }, [activeFilter]);

  const monthlySummary = useMemo(() => {
    const map = new Map<string, number>();
    filteredAlunas.forEach((a) => {
      const key = format(new Date(a.dataCompra), "yyyy-MM");
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  }, [filteredAlunas]);

  const activeAlunasList = useMemo(() => filteredAlunas.filter((a) => new Date(a.dataVencimento) >= now), [filteredAlunas, now]);
  const inactiveAlunasList = useMemo(() => filteredAlunas.filter((a) => new Date(a.dataVencimento) < now), [filteredAlunas, now]);

  const expiringInMonth = useMemo(() => {
    const target = new Date(expiringFilterMonth + "-01");
    const start = startOfMonth(target);
    const end = endOfMonth(target);
    return filteredAlunas.filter((a) => isWithinInterval(new Date(a.dataVencimento), { start, end }));
  }, [filteredAlunas, expiringFilterMonth]);

  const enrolledInMonth = useMemo(() => {
    const target = new Date(selectedMonth + "-01");
    return filteredAlunas.filter((a) => isSameMonth(new Date(a.dataCompra), target));
  }, [filteredAlunas, selectedMonth]);

  const expiringMonthOptions = useMemo(() => {
    const set = new Set<string>();
    filteredAlunas.forEach((a) => set.add(format(new Date(a.dataVencimento), "yyyy-MM")));
    set.add(format(now, "yyyy-MM"));
    return Array.from(set).sort();
  }, [filteredAlunas, now]);

  const navigateMonth = (direction: number) => {
    const d = new Date(selectedMonth + "-01");
    d.setMonth(d.getMonth() + direction);
    setSelectedMonth(format(d, "yyyy-MM"));
  };

  const navigateExpiringMonth = (direction: number) => {
    const d = new Date(expiringFilterMonth + "-01");
    d.setMonth(d.getMonth() + direction);
    setExpiringFilterMonth(format(d, "yyyy-MM"));
  };

  return (
    <div className="space-y-6">
      {activeFilter && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 p-4 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Filtrando por: <span className="font-bold text-primary">{filterLabel}</span></p>
              <p className="text-xs text-muted-foreground">Mostrando {filteredAlunas.length} resultado(s)</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onClearFilter} className="gap-2 border-primary/30 hover:bg-primary/10">
            <XCircle className="h-4 w-4" />
            Limpar Filtro
          </Button>
        </div>
      )}

      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" />
            Resumo Geral — Entradas por Mês
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {monthlySummary.map(([key, count]) => {
              const d = new Date(key + "-01");
              const isSelected = key === selectedMonth;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedMonth(key)}
                  className={`rounded-lg p-3 text-center transition-all border ${isSelected ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-muted/50 hover:bg-muted border-transparent"}`}
                >
                  <p className="text-xs capitalize opacity-80">{format(d, "MMM", { locale: ptBR })}</p>
                  <p className="text-xs opacity-60">{format(d, "yyyy")}</p>
                  <p className="text-2xl font-bold mt-1">{count}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar aluna pelo nome..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-9"
              />
            </div>
            <Select value={planoFiltro} onValueChange={setPlanoFiltro}>
              <SelectTrigger className="h-9 w-full sm:w-56">
                <SelectValue placeholder="Filtrar por plano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os planos</SelectItem>
                {(Object.entries(PROGRAM_LABELS) as [string, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(busca.trim() || planoFiltro !== "all") && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 shrink-0"
                onClick={() => { setBusca(""); setPlanoFiltro("all"); }}
              >
                <XCircle className="h-4 w-4" />
                Limpar
              </Button>
            )}
          </div>

          <Tabs defaultValue="ativos" className="space-y-4">
            <TabsList className="grid w-full grid-cols-5 max-w-3xl">
              <TabsTrigger value="ativos" className="gap-1.5 text-xs sm:text-sm">
                <CheckCircle className="h-4 w-4" /><span>Ativos</span>
                <Badge className="bg-primary/20 text-primary border-none text-xs ml-1 hidden sm:inline-flex">{activeAlunasList.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="inativos" className="gap-1.5 text-xs sm:text-sm">
                <XCircle className="h-4 w-4" /><span>Inativos</span>
                <Badge variant="destructive" className="text-xs ml-1 hidden sm:inline-flex">{inactiveAlunasList.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="vencem" className="gap-1.5 text-xs sm:text-sm">
                <AlertTriangle className="h-4 w-4" /><span>Vencem em</span>
              </TabsTrigger>
              <TabsTrigger value="entradas" className="gap-1.5 text-xs sm:text-sm">
                <CalendarDays className="h-4 w-4" /><span>Entradas</span>
              </TabsTrigger>
              <TabsTrigger value="todas" className="gap-1.5 text-xs sm:text-sm">
                <Users className="h-4 w-4" /><span>Todas</span>
                <Badge variant="outline" className="text-xs ml-1 hidden sm:inline-flex">{filteredAlunas.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="todas"><AlunaTable alunas={filteredAlunas} onEdit={onEdit} /></TabsContent>

            <TabsContent value="ativos"><AlunaTable alunas={activeAlunasList} onEdit={onEdit} /></TabsContent>
            <TabsContent value="inativos"><AlunaTable alunas={inactiveAlunasList} onEdit={onEdit} /></TabsContent>
            <TabsContent value="vencem" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateExpiringMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="text-sm font-medium capitalize min-w-[140px] text-center">{format(new Date(expiringFilterMonth + "-01"), "MMMM yyyy", { locale: ptBR })}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateExpiringMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={expiringFilterMonth} onValueChange={setExpiringFilterMonth}>
                    <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {expiringMonthOptions.map((m) => (
                        <SelectItem key={m} value={m}><span className="capitalize">{format(new Date(m + "-01"), "MMMM yyyy", { locale: ptBR })}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className="text-xs">{expiringInMonth.length} aluna(s)</Badge>
                </div>
              </div>
              <AlunaTable alunas={expiringInMonth} onEdit={onEdit} />
            </TabsContent>
            <TabsContent value="entradas" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="text-sm font-medium capitalize min-w-[140px] text-center">{format(new Date(selectedMonth + "-01"), "MMMM yyyy", { locale: ptBR })}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
                <Badge className="bg-primary/10 text-primary border-none text-xs">{enrolledInMonth.length} aluna(s)</Badge>
              </div>
              <AlunaTable alunas={enrolledInMonth} onEdit={onEdit} showVencimento={false} showEntrada />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
