import { useMemo, useState } from "react";
import { format, subDays, startOfMonth, endOfMonth, parseISO, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateFilter } from "@/components/DateFilter";
import { Consultation } from "@/types/consultation";
import { inferFunnelKey, FunnelKey } from "@/lib/funnelClassification";
import { Target, CheckCircle2, Percent, AlertTriangle, CalendarCheck, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

const FUNNEL_OPTIONS: { value: FunnelKey | "all"; label: string }[] = [
  { value: "all", label: "Todos os funis" },
  { value: "organico", label: "Orgânico" },
  { value: "social_selling", label: "Social Selling - Avaliação" },
  { value: "social_selling_individual", label: "Social Selling - Consultoria" },
  { value: "low_ticket", label: "LOW/PAGINA DE OBRIGADO" },
  
  { value: "grupo_individual", label: "GRUPO DO LOW - CONSULTORIA" },
  { value: "grupo_avaliacao", label: "GRUPO DO LOW - AVALIAÇÃO" },
  { value: "trafego_direto", label: "Tráfego Direto" },
  { value: "indicacao", label: "Indicação" },
  { value: "acomp_individual", label: "Acompanhamento Individual" },
  { value: "comentou_eu_quero", label: "Comentou Eu Quero" },
  { value: "ex_aluna", label: "Ex aluna" },
  { value: "renovacao", label: "Renovação" },
  { value: "fluxo_incompleto", label: "Fluxo Incompleto" },
];

type GoalType = "confirmadas" | "feitas" | "conversoes";

const GOAL_LABELS: Record<GoalType, { card: string; goal: string; baseRate: string }> = {
  confirmadas: { card: "confirmadas", goal: "confirmadas", baseRate: "taxa de confirmação" },
  feitas: { card: "calls feitas", goal: "calls feitas", baseRate: "taxa de comparecimento (sobre agendadas)" },
  conversoes: { card: "conversões", goal: "conversões", baseRate: "taxa de conversão (sobre agendadas)" },
};

interface Props {
  consultations: Consultation[];
}

export const BookingGoalCalculator = ({ consultations }: Props) => {
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(today, 29),
    to: today,
  });
  const [funnelFilter, setFunnelFilter] = useState<FunnelKey | "all">("all");
  const [meta, setMeta] = useState<number>(8);
  const [goalType, setGoalType] = useState<GoalType>("confirmadas");

  const applyPreset = (days: number | "month") => {
    if (days === "month") {
      setDateRange({ from: startOfMonth(today), to: today });
    } else {
      setDateRange({ from: subDays(today, days - 1), to: today });
    }
  };

  // Filtro alinhado ao card "Consultas no Período" do dashboard Geral:
  // exclui apenas desqualificadas e reembolsadas (mantém reagendamentos futuros e fluxo incompleto)
  const filtered = useMemo(() => {
    const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "";
    const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : fromStr;
    return consultations.filter((c) => {
      if (c.disqualified === true) return false;
      if (c.refunded === true) return false;
      if (!c.date) return false;
      if (fromStr && c.date < fromStr) return false;
      if (toStr && c.date > toStr) return false;
      if (funnelFilter !== "all") {
        const key = inferFunnelKey({
          via: c.via,
          utmSource: c.utmSource,
          utmCampaign: c.utmCampaign,
          utmMedium: c.utmMedium,
          utmContent: c.utmContent,
          utmTerm: c.utmTerm,
        });
        if (key !== funnelFilter) return false;
      }
      return true;
    });
  }, [consultations, dateRange, funnelFilter]);

  const totalScheduled = filtered.length;
  const totalConfirmed = filtered.filter((c) => c.callConfirmed === true).length;
  const totalAttended = filtered.filter((c) => c.attended === true).length;
  const totalConverted = filtered.filter((c) => c.status === "convertido").length;

  const confirmRate = totalScheduled > 0 ? totalConfirmed / totalScheduled : 0;
  const attendedRateOverScheduled = totalScheduled > 0 ? totalAttended / totalScheduled : 0;
  const convertedRateOverScheduled = totalScheduled > 0 ? totalConverted / totalScheduled : 0;

  const attendedRateOverConfirmed = totalConfirmed > 0 ? totalAttended / totalConfirmed : 0;
  const convertedRateOverAttended = totalAttended > 0 ? totalConverted / totalAttended : 0;

  const daysInRange = useMemo(() => {
    if (!dateRange?.from) return 1;
    const end = dateRange.to ?? dateRange.from;
    const diff = Math.round((end.getTime() - dateRange.from.getTime()) / 86400000) + 1;
    return Math.max(1, diff);
  }, [dateRange]);

  const avgScheduledPerDay = totalScheduled / daysInRange;
  const avgConfirmedPerDay = totalConfirmed / daysInRange;
  const avgAttendedPerDay = totalAttended / daysInRange;
  const avgConvertedPerDay = totalConverted / daysInRange;

  // Taxa atual conforme o tipo de meta selecionado
  const activeRate = (() => {
    if (goalType === "confirmadas") return confirmRate;
    if (goalType === "feitas") return attendedRateOverScheduled;
    return convertedRateOverScheduled;
  })();

  const insufficient = totalScheduled < 10 || activeRate === 0;

  const requiredPerDay = insufficient ? 0 : Math.ceil(meta / activeRate);
  const requiredPerWeek = insufficient ? 0 : Math.ceil((meta * 7) / activeRate);
  const goalPerWeek = meta * 7;
  const requiredPerMonth = insufficient ? 0 : Math.ceil((meta * 22) / activeRate);
  const goalPerMonth = meta * 22;

  const dailyData = useMemo(() => {
    // Determina o intervalo completo a exibir: range filtrado, ou mês corrente.
    const today = new Date();
    const rangeStart = dateRange?.from ?? startOfMonth(today);
    const rangeEnd = dateRange?.to ?? dateRange?.from ?? endOfMonth(today);

    const allDays = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
    const map = new Map<string, { dateKey: string; label: string; agendadas: number; confirmadas: number; feitas: number; convertidas: number }>();

    // Inicializa todos os dias do intervalo com zero para mostrar o mês inteiro.
    allDays.forEach((d) => {
      const key = format(d, "yyyy-MM-dd");
      map.set(key, { dateKey: key, label: format(d, "dd/MM", { locale: ptBR }), agendadas: 0, confirmadas: 0, feitas: 0, convertidas: 0 });
    });

    filtered.forEach((c) => {
      try {
        const d = parseISO(c.date);
        const key = format(d, "yyyy-MM-dd");
        if (!map.has(key)) {
          map.set(key, { dateKey: key, label: format(d, "dd/MM", { locale: ptBR }), agendadas: 0, confirmadas: 0, feitas: 0, convertidas: 0 });
        }
        const row = map.get(key)!;
        row.agendadas += 1;
        if (c.callConfirmed === true) row.confirmadas += 1;
        if (c.attended === true) row.feitas += 1;
        if (c.status === "convertido") row.convertidas += 1;
      } catch {}
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => {
        const num = goalType === "confirmadas" ? v.confirmadas : goalType === "feitas" ? v.feitas : v.convertidas;
        return { ...v, taxa: v.agendadas > 0 ? Math.round((num / v.agendadas) * 100) : 0 };
      });
  }, [filtered, goalType, dateRange]);

  // Taxas adicionais de conversão para exibir no card de resultado
  const convOverScheduledPct = totalScheduled > 0 ? (totalConverted / totalScheduled) * 100 : 0;
  const convOverConfirmedPct = totalConfirmed > 0 ? (totalConverted / totalConfirmed) * 100 : 0;
  const convOverAttendedPct = totalAttended > 0 ? (totalConverted / totalAttended) * 100 : 0;

  const ratePct = Math.round(activeRate * 1000) / 10;

  const healthBadge = (() => {
    if (insufficient) return null;
    const thresholds: Record<GoalType, [number, number]> = {
      confirmadas: [70, 50],
      feitas: [60, 40],
      conversoes: [20, 10],
    };
    const [good, mid] = thresholds[goalType];
    if (ratePct >= good)
      return { variant: "success" as const, text: "Taxa saudável", icon: CheckCircle2 };
    if (ratePct >= mid)
      return {
        variant: "warning" as const,
        text: "Taxa média — possível melhorar processo",
        icon: AlertTriangle,
      };
    return {
      variant: "destructive" as const,
      text: "Taxa baixa — revisar funil e processo",
      icon: AlertTriangle,
    };
  })();

  const fmtPct = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1).replace(".", ",")}%`;

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filtros do período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DateFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            <Button variant="outline" size="sm" onClick={() => applyPreset(7)}>Últimos 7 dias</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset(15)}>Últimos 15 dias</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset(30)}>Últimos 30 dias</Button>
            <Button variant="outline" size="sm" onClick={() => applyPreset("month")}>Este mês</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Funil:</span>
            <Select value={funnelFilter} onValueChange={(v) => setFunnelFilter(v as FunnelKey | "all")}>
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Cards de métricas */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Target className="h-4 w-4" /> Consultas no Período
            </div>
            <div className="text-3xl font-bold">{totalScheduled}</div>
            <div className="text-xs text-muted-foreground">
              {avgScheduledPerDay.toFixed(1).replace(".", ",")}/dia em média
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CheckCircle2 className="h-4 w-4" /> Calls Confirmadas
            </div>
            <div className="text-3xl font-bold">{totalConfirmed}</div>
            <div className="text-xs text-muted-foreground">
              {avgConfirmedPerDay.toFixed(1).replace(".", ",")}/dia • {fmtPct(confirmRate)} do total
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CalendarCheck className="h-4 w-4" /> Calls Feitas
            </div>
            <div className="text-3xl font-bold">{totalAttended}</div>
            <div className="text-xs text-muted-foreground">
              {avgAttendedPerDay.toFixed(1).replace(".", ",")}/dia • {fmtPct(attendedRateOverConfirmed)} das confirmadas • {fmtPct(attendedRateOverScheduled)} das agendadas
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4" /> Conversões
            </div>
            <div className="text-3xl font-bold">{totalConverted}</div>
            <div className="text-xs text-muted-foreground">
              {avgConvertedPerDay.toFixed(1).replace(".", ",")}/dia • {fmtPct(convertedRateOverAttended)} das feitas
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Percent className="h-4 w-4" /> Taxa ({GOAL_LABELS[goalType].card})
            </div>
            <div className="text-3xl font-bold">
              {insufficient ? "—" : `${ratePct.toFixed(1).replace(".", ",")}%`}
            </div>
            <div className="text-xs text-muted-foreground">
              {insufficient ? "Dados insuficientes" : `sobre o total de agendadas`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aproveitamento das agendadas */}
      {(() => {
        const confirmPct = confirmRate * 100;
        const feitasPct = attendedRateOverScheduled * 100;
        const convPct = convertedRateOverScheduled * 100;

        type Tone = "success" | "warning" | "destructive" | "muted";
        const toneClasses: Record<Tone, { bg: string; border: string; text: string; chip: string }> = {
          success: { bg: "bg-success/10", border: "border-success/40", text: "text-success", chip: "bg-success/20 text-success" },
          warning: { bg: "bg-warning/10", border: "border-warning/40", text: "text-warning", chip: "bg-warning/20 text-warning" },
          destructive: { bg: "bg-destructive/10", border: "border-destructive/40", text: "text-destructive", chip: "bg-destructive/20 text-destructive" },
          muted: { bg: "bg-muted/40", border: "border-border", text: "text-foreground", chip: "bg-muted text-muted-foreground" },
        };
        const toneFor = (pct: number, min: number, max: number): Tone => {
          if (totalScheduled === 0) return "muted";
          if (pct >= max) return "success";
          if (pct >= min) return "warning";
          return "destructive";
        };

        const items = [
          {
            label: "Confirmadas / Agendadas",
            pct: confirmPct,
            num: totalConfirmed,
            meta: "Meta: 30% – 40%",
            tone: toneFor(confirmPct, 30, 40),
          },
          {
            label: "Calls Feitas / Agendadas",
            pct: feitasPct,
            num: totalAttended,
            meta: "Meta: 20% – 30%",
            tone: toneFor(feitasPct, 20, 30),
          },
          {
            label: "Conversões / Agendadas",
            pct: convPct,
            num: totalConverted,
            meta: "Meta a definir",
            tone: "muted" as Tone,
          },
        ];

        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Aproveitamento das agendadas</CardTitle>
              <p className="text-xs text-muted-foreground">
                % de quem foi agendada que avança em cada etapa — referência: verde dentro da meta, amarelo abaixo, vermelho bem abaixo.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {items.map((it) => {
                  const c = toneClasses[it.tone];
                  return (
                    <div key={it.label} className={`rounded-lg border p-4 ${c.bg} ${c.border}`}>
                      <div className="text-xs text-muted-foreground">{it.label}</div>
                      <div className={`text-3xl font-bold mt-1 ${c.text}`}>
                        {totalScheduled === 0 ? "—" : `${it.pct.toFixed(1).replace(".", ",")}%`}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
                        {it.num} de {totalScheduled} agendadas
                      </div>
                      <div className={`inline-block mt-2 text-[11px] px-2 py-0.5 rounded-full ${c.chip}`}>
                        {it.meta}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Simulador */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-xl">Quantas preciso agendar para bater minha meta?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Seletor de tipo de meta */}
          <div className="space-y-2">
            <label className="text-sm font-medium">O que você quer calcular?</label>
            <Tabs value={goalType} onValueChange={(v) => setGoalType(v as GoalType)}>
              <TabsList className="grid grid-cols-3 w-full md:w-auto">
                <TabsTrigger value="confirmadas">Confirmadas</TabsTrigger>
                <TabsTrigger value="feitas">Calls Feitas</TabsTrigger>
                <TabsTrigger value="conversoes">Conversões</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
            <div className="space-y-3">
              <label className="text-sm font-medium">
                Meta de {GOAL_LABELS[goalType].goal} por dia
              </label>
              <Slider
                value={[meta]}
                min={1}
                max={20}
                step={1}
                onValueChange={(v) => setMeta(v[0])}
              />
            </div>
            <Input
              type="number"
              min={1}
              max={20}
              value={meta}
              onChange={(e) => setMeta(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-24 text-center text-lg font-bold"
            />
          </div>

          {insufficient ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              <strong>Dados insuficientes para projeção confiável.</strong> Filtre um período maior
              (mínimo 10 agendadas e taxa &gt; 0%).
            </div>
          ) : (
            <>
              <div className="rounded-xl border-2 border-primary/40 bg-background p-6 text-center space-y-3">
                <div className="text-sm text-muted-foreground">
                  Para ter <strong className="text-foreground">{meta}</strong> {GOAL_LABELS[goalType].goal} por dia,
                  o SDR precisa AGENDAR:
                </div>
                <div className="text-5xl font-bold text-primary">≈ {requiredPerDay} <span className="text-2xl text-muted-foreground font-medium">por dia</span></div>
                <div className="text-xs text-muted-foreground">
                  base: {GOAL_LABELS[goalType].baseRate} de {ratePct.toFixed(1).replace(".", ",")}% no período filtrado
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 mt-2 border-t border-border/60 text-xs">
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="text-muted-foreground">Conversão sobre agendadas</div>
                    <div className="font-semibold text-foreground text-sm">{convOverScheduledPct.toFixed(1).replace(".", ",")}%</div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="text-muted-foreground">Conversão sobre confirmadas</div>
                    <div className="font-semibold text-foreground text-sm">{convOverConfirmedPct.toFixed(1).replace(".", ",")}%</div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="text-muted-foreground">Conversão sobre calls feitas</div>
                    <div className="font-semibold text-foreground text-sm">{convOverAttendedPct.toFixed(1).replace(".", ",")}%</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-card p-4">
                  <div className="text-muted-foreground text-xs">Por semana</div>
                  <div className="font-semibold mt-1">
                    ≈ {requiredPerWeek} agendadas para {goalPerWeek} {GOAL_LABELS[goalType].goal}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="text-muted-foreground text-xs">Por mês (22 dias úteis)</div>
                  <div className="font-semibold mt-1">
                    ≈ {requiredPerMonth} agendadas para {goalPerMonth} {GOAL_LABELS[goalType].goal}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Gráfico diário */}
      {dailyData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Evolução diária</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" className="text-xs" interval="preserveStartEnd" minTickGap={16} />
                  <YAxis yAxisId="left" className="text-xs" />
                  <YAxis yAxisId="right" orientation="right" unit="%" className="text-xs" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="agendadas" name="Agendadas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="confirmadas" name="Confirmadas" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="feitas" name="Feitas" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="convertidas" name="Convertidas" fill="hsl(262 83% 58%)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="taxa" name={`Taxa ${GOAL_LABELS[goalType].card} %`} stroke="hsl(var(--warning))" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerta */}
      {healthBadge && (
        <div className="flex justify-center">
          <Badge variant={healthBadge.variant} className="text-sm py-2 px-4 gap-2">
            <healthBadge.icon className="h-4 w-4" />
            {healthBadge.text}
          </Badge>
        </div>
      )}
    </div>
  );
};
