import { useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useConsultations } from "@/hooks/useConsultations";
import { useAuth } from "@/hooks/useAuth";
import { RefreshCw, LogOut, ArrowLeft, ChevronLeft, ChevronRight, Users, TrendingUp, TrendingDown, BarChart3, Calendar } from "lucide-react";
import { UserProfileHeader } from "@/components/UserProfileHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { BookingGoalsChart } from "@/components/BookingGoalsChart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell, LineChart, Line, ComposedChart } from "recharts";
import { cn } from "@/lib/utils";
import { getMetaValue } from "@/lib/revenueUtils";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const METAS = {
  agendadas: 200,
  feitas: 160,
  noShowTaxa: 20,
  faturamento: 56100,
};

const AnnualDashboard = () => {
  const { data: consultations = [], isLoading } = useConsultations();
  const { signOut, isAdmin } = useAuth();
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const monthlyData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const monthStart = new Date(currentYear, i, 1);
      const monthEnd = endOfMonth(monthStart);
      const startStr = format(monthStart, "yyyy-MM-dd");
      const endStr = format(monthEnd, "yyyy-MM-dd");

      const monthConsultations = consultations.filter((c) => c.date >= startStr && c.date <= endStr);
      const agendadas = monthConsultations.length;
      const feitas = monthConsultations.filter((c) => c.attended === true).length;
      const noShow = monthConsultations.filter((c) => c.attended === false).length;
      const convertidas = monthConsultations.filter((c) => c.converted === true).length;
      const noShowTaxa = agendadas > 0 ? (noShow / agendadas) * 100 : 0;
      const conversionRate = feitas > 0 ? (convertidas / feitas) * 100 : 0;
      const faturamento = monthConsultations
        .filter((c) => c.converted === true && c.ticketValue)
        .reduce((sum, c) => sum + getMetaValue(c), 0);

      return {
        name: MONTH_LABELS[i],
        month: i,
        agendadas,
        feitas,
        noShow,
        noShowTaxa: Math.round(noShowTaxa * 10) / 10,
        convertidas,
        conversionRate: Math.round(conversionRate * 10) / 10,
        faturamento,
        metaAgendadas: METAS.agendadas,
        metaFeitas: METAS.feitas,
        metaFaturamento: METAS.faturamento,
      };
    });
  }, [consultations, currentYear]);

  const yearTotals = useMemo(() => {
    const totals = monthlyData.reduce(
      (acc, m) => ({
        agendadas: acc.agendadas + m.agendadas,
        feitas: acc.feitas + m.feitas,
        noShow: acc.noShow + m.noShow,
        convertidas: acc.convertidas + m.convertidas,
        faturamento: acc.faturamento + m.faturamento,
      }),
      { agendadas: 0, feitas: 0, noShow: 0, convertidas: 0, faturamento: 0 }
    );
    const noShowTaxa = totals.agendadas > 0 ? (totals.noShow / totals.agendadas) * 100 : 0;
    const conversionRate = totals.feitas > 0 ? (totals.convertidas / totals.feitas) * 100 : 0;
    return { ...totals, noShowTaxa, conversionRate };
  }, [monthlyData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-sm space-y-1">
        <p className="font-semibold">{label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">
              {entry.name === "Faturamento"
                ? `R$ ${entry.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            </Link>
            <UserProfileHeader />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation + Year Selector */}
      <div className="container max-w-6xl mx-auto px-4 pt-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link to="/vendas">
                <BarChart3 className="h-4 w-4" />
                Geral
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link to="/balanco-mensal">
                <Calendar className="h-4 w-4" />
                Mensal
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={() => setCurrentYear((y) => y - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center min-w-[120px]">
              <h2 className="text-2xl font-bold font-display">{currentYear}</h2>
            </div>
            <Button variant="outline" size="icon" onClick={() => setCurrentYear((y) => y + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Year Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card className="border-none shadow-sm">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Agendadas</p>
                  <p className="text-2xl font-bold">{yearTotals.agendadas}</p>
                  <p className="text-[10px] text-muted-foreground">meta: {METAS.agendadas * 12}/ano</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-sm">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Feitas</p>
                  <p className="text-2xl font-bold">{yearTotals.feitas}</p>
                  <p className="text-[10px] text-muted-foreground">meta: {METAS.feitas * 12}/ano</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-sm">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">No-Show</p>
                  <p className={cn("text-2xl font-bold", yearTotals.noShowTaxa <= METAS.noShowTaxa ? "text-success" : "text-destructive")}>
                    {yearTotals.noShowTaxa.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">meta: ≤{METAS.noShowTaxa}%</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-sm">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Conversão</p>
                  <p className="text-2xl font-bold text-primary">{yearTotals.conversionRate.toFixed(1)}%</p>
                  <p className="text-[10px] text-muted-foreground">{yearTotals.convertidas} convertidas</p>
                </CardContent>
              </Card>
              <Card className="border-none shadow-sm col-span-2 md:col-span-1">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Faturamento</p>
                  <p className="text-2xl font-bold text-success">
                    R$ {yearTotals.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-muted-foreground">meta: R$ {(METAS.faturamento * 12).toLocaleString("pt-BR")}/ano</p>
                </CardContent>
              </Card>
            </div>

            {/* Goals & Revenue */}
            <div className="grid lg:grid-cols-2 gap-6">
              <BookingGoalsChart 
                consultations={consultations}
                externalDateRange={{ from: new Date(currentYear, 0, 1), to: endOfMonth(new Date(currentYear, 11, 1)) }}
                hideDatePicker
                title={`Metas de Agendamento — ${currentYear}`}
              />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Faturamento Mensal</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Meta mensal: R$ {METAS.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <YAxis
                          domain={[0, 100000]}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: "12px" }} />
                        <ReferenceLine y={METAS.faturamento} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ value: `Meta R$ ${(METAS.faturamento / 1000).toFixed(0)}k`, fill: "hsl(var(--primary))", fontSize: 10 }} />
                        <Bar dataKey="faturamento" name="Faturamento" radius={[4, 4, 0, 0]}>
                          {monthlyData.map((entry: any, index: number) => (
                            <Cell key={index} fill={entry.faturamento >= METAS.faturamento ? "hsl(var(--success))" : "hsl(var(--warning))"} />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="faturamento" name="Tendência" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Consolidated Performance Funnel Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Funil de Performance Anual</CardTitle>
                <p className="text-xs text-muted-foreground">Visão consolidada: Agendamentos, Consultas Feitas, No-Show e Conversão %</p>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <YAxis yAxisId="left" domain={[0, 200]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />

                      <Bar yAxisId="left" dataKey="agendadas" name="Agendados" fill="hsl(var(--primary))" fillOpacity={0.4} radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar yAxisId="left" dataKey="feitas" name="Feitos" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar yAxisId="left" dataKey="noShow" name="No-Show" fill="hsl(var(--noshow))" radius={[4, 4, 0, 0]} barSize={20} />

                      <Line yAxisId="right" type="monotone" dataKey="conversionRate" name="Conversão %" stroke="hsl(var(--success))" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--success))" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Monthly Breakdown Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Resumo Mês a Mês</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-muted-foreground font-medium">Mês</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">Agendadas</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">Feitas</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">No-Show</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">No-Show %</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">Convertidas</th>
                        <th className="text-center py-2 px-2 text-muted-foreground font-medium">Conversão %</th>
                        <th className="text-right py-2 px-2 text-muted-foreground font-medium">Faturamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.map((m) => {
                        const hasData = m.agendadas > 0;
                        if (!hasData) return (
                          <tr key={m.name} className="border-b border-border/50 opacity-40">
                            <td className="py-2 px-2 font-medium">{m.name}</td>
                            <td colSpan={7} className="py-2 px-2 text-center text-muted-foreground">—</td>
                          </tr>
                        );
                        return (
                          <tr key={m.name} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-2 font-medium">{m.name}</td>
                            <td className={cn("text-center py-2 px-2 font-semibold", m.agendadas >= METAS.agendadas ? "text-success" : "text-destructive")}>{m.agendadas}</td>
                            <td className={cn("text-center py-2 px-2 font-semibold", m.feitas >= METAS.feitas ? "text-success" : "text-destructive")}>{m.feitas}</td>
                            <td className="text-center py-2 px-2">{m.noShow}</td>
                            <td className={cn("text-center py-2 px-2 font-semibold", m.noShowTaxa <= METAS.noShowTaxa ? "text-success" : "text-destructive")}>
                              {m.noShowTaxa.toFixed(1)}%
                            </td>
                            <td className="text-center py-2 px-2 font-semibold">{m.convertidas}</td>
                            <td className="text-center py-2 px-2 font-semibold text-primary">{m.conversionRate.toFixed(1)}%</td>
                            <td className={cn("text-right py-2 px-2 font-semibold", m.faturamento >= METAS.faturamento ? "text-success" : "text-warning")}>
                              R$ {m.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      <tr className="bg-muted/40 font-bold">
                        <td className="py-2 px-2">TOTAL</td>
                        <td className="text-center py-2 px-2">{yearTotals.agendadas}</td>
                        <td className="text-center py-2 px-2">{yearTotals.feitas}</td>
                        <td className="text-center py-2 px-2">{yearTotals.noShow}</td>
                        <td className={cn("text-center py-2 px-2", yearTotals.noShowTaxa <= METAS.noShowTaxa ? "text-success" : "text-destructive")}>
                          {yearTotals.noShowTaxa.toFixed(1)}%
                        </td>
                        <td className="text-center py-2 px-2">{yearTotals.convertidas}</td>
                        <td className="text-center py-2 px-2 text-primary">{yearTotals.conversionRate.toFixed(1)}%</td>
                        <td className="text-right py-2 px-2 text-success">
                          R$ {yearTotals.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
};

export default AnnualDashboard;
