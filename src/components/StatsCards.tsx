import { useMemo } from "react";
import { Consultation, ConsultationStatus } from "@/types/consultation";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarCheck, TrendingUp, UserX, XCircle, RotateCcw, Handshake, ClipboardCheck, CalendarClock, MessageCircleOff, Sparkles, Flag, ClipboardX } from "lucide-react";
import { format, isBefore, startOfDay, isToday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePrivacy } from "@/hooks/usePrivacy";
import { calcularMetricasConsultas, sinalConfirmadas, sinalFeitas, type NivelSinal } from "@/lib/sinalMetricas";
import { CLASSES_SINAL, ReferenciaMetaSinal, SinalBadge, type RegraSinal } from "@/components/shared/SinalBadge";


type StatsFilterValue = ConsultationStatus | "desqualificada" | "call_confirmada" | "call_nao_confirmada" | "feitas" | "reembolsadas" | "pagamento_ok" | "negociando_lista" | "reagendamento_futuro" | "renda_baixa" | "fluxo_incompleto_whatsapp" | "convertido_pitch01" | "parou_pitch01" | "qualificadas_sem_agendar" | null;

interface FormLead {
  id: string;
  name: string;
  phone: string;
  utmSource: string | null;
  score: number | null;
  nivel: string | null;
  createdAt: string;
  status?: string;
}

// Normaliza pra cruzar form ↔ consulta: telefone (últimos 8 dígitos) e nome sem acento
const phoneTail = (p: string | null | undefined) => {
  const digits = (p || "").replace(/[^0-9]/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
};
const normName = (n: string | null | undefined) => {
  const s = (n || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  return s.length >= 5 ? s : null; // nomes muito curtos ou vazios não servem pra match
};

interface StatsCardsProps {
  consultations: Consultation[];
  hasDateFilter: boolean;
  dateRange?: DateRange;
  activeFilter?: StatsFilterValue;
  onFilterChange?: (status: StatsFilterValue) => void;
  onCardDrill?: (filter: Exclude<StatsFilterValue, null>, label: string) => void;
  onAgendamentosDrill?: (fromIso: string, toIso: string, label: string) => void;
  onFormLeadsDrill?: (formLeads: FormLead[], label: string) => void;
}

export function StatsCards({ consultations, hasDateFilter, dateRange, activeFilter, onFilterChange, onCardDrill, onAgendamentosDrill, onFormLeadsDrill }: StatsCardsProps) {
  const { formatMoney } = usePrivacy();
  const notExcluded = (c: Consultation) => c.is_future_reschedule !== true && c.is_incomplete_flow !== true && c.lowIncome !== true;
  const notRefunded = (c: Consultation) => c.refunded !== true;

  // Total, feitas, confirmadas e desqualificadas saem da mesma conta que o
  // bloco "Fluxo do próximo dia útil" usa — definição única, sem divergir.
  const metricas = calcularMetricasConsultas(consultations);
  const total = metricas.total;
  const feitas = metricas.feitas;
  const converted = consultations.filter(c => c.status === "convertido" && notExcluded(c) && notRefunded(c)).length;
  const noShow = consultations.filter(c => c.callConfirmed === true && c.attended === false && notExcluded(c) && notRefunded(c)).length;
  const notConverted = consultations.filter(c => c.status === "não convertido" && notExcluded(c) && notRefunded(c)).length;

  const callConfirmed = metricas.callConfirmadas;
  const callConfirmedRate = metricas.pctConfirmadasDoTotal ?? 0;

  const callNotConfirmed = consultations.filter(c => c.callConfirmed === false && notExcluded(c) && notRefunded(c)).length;
  const callNotConfirmedRate = total > 0 ? Math.round((callNotConfirmed / total) * 100) : 0;

  const feitasRate = callConfirmed > 0 ? Math.round((feitas / callConfirmed) * 100) : 0;
  const conversionRate = feitas > 0 ? Math.round((converted / feitas) * 100) : 0;
  const noShowRate = callConfirmed > 0 ? Math.round((noShow / callConfirmed) * 100) : 0;
  const notConvertedRate = feitas > 0 ? Math.round((notConverted / feitas) * 100) : 0;

  const desqualificadas = metricas.desqualificadas;
  const desqualificadasRate = total > 0 ? Math.round((desqualificadas / total) * 100) : 0;
  const feitasRateOverPeriod = metricas.pctFeitasSobreAgendadas ?? 0;
  const nivelFeitas = sinalFeitas(metricas.pctFeitasSobreAgendadas);
  const nivelConfirmadas = sinalConfirmadas(metricas.pctConfirmadasDoTotal);

  const refundedList = consultations.filter(c => c.refunded === true);
  const refundedCount = refundedList.length;
  const refundedTotal = refundedList.reduce((sum, c) => sum + (c.ticketValue || 0), 0);
  const refundedTotalLabel = formatMoney(refundedTotal);

  const futureRescheduleCount = consultations.filter(
    c => c.is_future_reschedule === true && c.refunded !== true
  ).length;

  const lowIncomeCount = consultations.filter(
    c => c.lowIncome === true && c.refunded !== true
  ).length;

  const negotiatingList = consultations.filter(c => (c.status === "negociando" || c.negotiating === true) && c.refunded !== true);
  const negotiatingCount = negotiatingList.length;
  const negotiatingPotential = negotiatingList.reduce((sum, c) => sum + (c.ticketValue || 0), 0);
  const negotiatingPotentialLabel = formatMoney(negotiatingPotential);

  const WHATSAPP_TRACKING_START = "2026-07-14T00:00:00Z";
  const incompleteWhatsappList = consultations.filter(c =>
    c.refunded !== true &&
    c.disqualified !== true &&
    (
      c.is_incomplete_flow === true ||
      (
        !c.whatsappClickedAt &&
        c.via != null &&
        !!c.createdAt &&
        c.createdAt >= WHATSAPP_TRACKING_START
      )
    )
  );
  const incompleteWhatsappCount = incompleteWhatsappList.length;

  const convertedPitch01Count = consultations.filter(c =>
    c.status === "convertido" && c.passedPitch01 === true && notExcluded(c) && notRefunded(c)
  ).length;
  const passedPitch01Total = consultations.filter(c =>
    c.passedPitch01 === true && notExcluded(c) && notRefunded(c)
  ).length;
  const convertedPitch01Rate = passedPitch01Total > 0
    ? Math.round((convertedPitch01Count / passedPitch01Total) * 100)
    : 0;

  const parouPitch01List = consultations.filter(c =>
    c.attended === true && c.converted === false && c.passedPitch01 === false && notExcluded(c) && notRefunded(c)
  );
  const parouPitch01Count = parouPitch01List.length;
  const parouPitch01Rate = feitas > 0 ? Math.round((parouPitch01Count / feitas) * 100) : 0;

  const formRange = useMemo(() => {
    const from = dateRange?.from ? startOfDay(dateRange.from) : startOfDay(new Date());
    const to = dateRange?.to ? startOfDay(dateRange.to) : from;
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    return { fromIso: from.toISOString(), toIso: toEnd.toISOString() };
  }, [dateRange]);

  const { data: completedForms = 0 } = useQuery({
    queryKey: ["completed-bookings-count", formRange.fromIso, formRange.toIso],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("consultations")
        .select("id", { count: "exact", head: true })
        .gte("created_at", formRange.fromIso)
        .lte("created_at", formRange.toIso)
        .not("via", "is", null); // só tráfego — manual do time (via=null) não entra
      if (error) return 0;
      return count ?? 0;
    },
  });

  // Qualificadas que chegaram no período e ainda NÃO agendaram. A base é o
  // próprio conjunto de respostas qualificadas, não "qualificadas totais -
  // todos os agendamentos do dia" (que pode subtrair uma consulta de outra
  // pessoa ou de um funil diferente).
  const { data: qualifiedStats = { total: 0, semAgendar: 0, leads: [] } } = useQuery({
    queryKey: ["qualified-sem-agendar", formRange.fromIso, formRange.toIso],
    queryFn: async () => {
      const { data: forms, error: formsErr } = await supabase
        .from("lead_form_responses")
        .select("id, nome, telefone, utm_source, score, nivel, created_at, consultation_id")
        .gte("created_at", formRange.fromIso)
        .lte("created_at", formRange.toIso)
        .neq("nivel", "DQ");

      if (formsErr || !forms || forms.length === 0) return { total: 0, semAgendar: 0, leads: [] as FormLead[] };

      // Deduplicar por telefone — múltiplos envios do mesmo lead contam como 1
      const byPhone = new Map<string, typeof forms[0]>();
      for (const f of forms) {
        const phone = (f.telefone || "").replace(/[^0-9]/g, "").slice(-9);
        const key = phone.length >= 8 ? phone : f.id;
        const prev = byPhone.get(key);
        if (!prev || f.created_at > prev.created_at) byPhone.set(key, f);
      }

      const uniqueForms = Array.from(byPhone.values());
      const total = uniqueForms.length;

      // Cruza com as consultas do período (tráfego) por telefone e nome:
      // quem tem match agendou; quem sobra é a lista real de "sem agendar"
      const { data: cons } = await supabase
        .from("consultations")
        .select("client_phone, client_name")
        .gte("created_at", formRange.fromIso)
        .lte("created_at", formRange.toIso)
        .not("via", "is", null);

      const bookedPhones = new Set<string>();
      const bookedNames = new Set<string>();
      for (const c of cons ?? []) {
        const pt = phoneTail(c.client_phone);
        if (pt) bookedPhones.add(pt);
        const nn = normName(c.client_name);
        if (nn) bookedNames.add(nn);
      }

      const semAgendarForms = uniqueForms.filter(f => {
        // Fluxo novo: vínculo determinístico gravado ao confirmar o
        // agendamento. Não depende de nome/telefone e continua correto mesmo
        // se a consulta for criada depois do período selecionado.
        if (f.consultation_id) return false;
        const pt = phoneTail(f.telefone);
        if (pt && bookedPhones.has(pt)) return false;
        const nn = normName(f.nome);
        if (nn && bookedNames.has(nn)) return false;
        return true;
      });

      const leads: FormLead[] = semAgendarForms.map(f => ({
        id: f.id,
        name: f.nome || "—",
        phone: f.telefone || "—",
        utmSource: f.utm_source,
        score: f.score ?? null,
        nivel: f.nivel,
        createdAt: f.created_at,
      }));

      return { total, semAgendar: leads.length, leads };
    },
  });

  // Agendou pelo tráfego mas NÃO clicou no botão do WhatsApp (e SDR ainda não confirmou)
  const dateDisplay = useMemo(() => {
    if (!dateRange?.from) return format(new Date(), "dd 'de' MMMM", { locale: ptBR });
    if (!dateRange.to) return format(dateRange.from, "dd 'de' MMMM", { locale: ptBR });
    return `${format(dateRange.from, "dd/MM")} - ${format(dateRange.to, "dd/MM")}`;
  }, [dateRange]);

  const cards: {
    label: string;
    value: number;
    pct?: string;
    subtitle?: string;
    subtitle2?: string;
    icon: typeof CalendarCheck;
    color: string;
    filterStatus: string | null;
    formLeads?: FormLead[];
    /** Sinal de cor: em qual número a pílula vai e qual regra vale. */
    sinal?: { regra: RegraSinal; nivel: NivelSinal | null; em: "pct" | "subtitle2" };
  }[] = [
      {
        label: hasDateFilter ? "Consultas no Período" : "Consultas Hoje",
        value: total - desqualificadas,
        subtitle: dateDisplay,
        icon: CalendarCheck,
        color: "bg-primary/10 text-primary",
        filterStatus: null,
      },
      {
        label: "Consultas Feitas",
        value: feitas,
        pct: `${feitasRate}%`,
        subtitle: "das confirmadas",
        subtitle2: `${feitasRateOverPeriod}% das agendadas`,
        icon: CalendarCheck,
        color: "bg-blue-500/10 text-blue-500",
        filterStatus: "feitas",
        sinal: { regra: "feitas", nivel: nivelFeitas, em: "subtitle2" },
      },
      {
        label: "Convertidas",
        value: converted,
        pct: `${conversionRate}%`,
        subtitle: "das feitas",
        icon: TrendingUp,
        color: "bg-success/10 text-success",
        filterStatus: "convertido",
      },
      {
        label: "Convertidas / Pagamento OK",
        value: converted - refundedCount,
        pct: `${feitas > 0 ? Math.round(((converted - refundedCount) / feitas) * 100) : 0}%`,
        subtitle: "das feitas",
        icon: TrendingUp,
        color: "bg-emerald-500/10 text-emerald-600",
        filterStatus: "pagamento_ok",
      },
      {
        label: "Convertidas / Pitch 01",
        value: convertedPitch01Count,
        pct: passedPitch01Total > 0 ? `${convertedPitch01Rate}%` : undefined,
        subtitle: passedPitch01Total > 0
          ? `de ${passedPitch01Total} que passaram do Pitch 01`
          : "Nenhum lead passou do Pitch 01",
        icon: Sparkles,
        color: "bg-emerald-500/10 text-emerald-700",
        filterStatus: "convertido_pitch01",
      },
      {
        label: "No-Show",
        value: noShow,
        pct: `${noShowRate}%`,
        subtitle: "das confirmadas",
        icon: UserX,
        color: "bg-noshow/10 text-noshow",
        filterStatus: "no-show",
      },
      {
        label: "Não Convertidas",
        value: notConverted,
        pct: `${notConvertedRate}%`,
        subtitle: "das feitas",
        icon: XCircle,
        color: "bg-warning/10 text-warning",
        filterStatus: "não convertido",
      },
      {
        label: "Parou no Pitch 01",
        value: parouPitch01Count,
        pct: feitas > 0 ? `${parouPitch01Rate}%` : undefined,
        subtitle: feitas > 0 ? "das feitas" : "Sem consultas feitas",
        icon: Flag,
        color: "bg-amber-500/10 text-amber-600",
        filterStatus: "parou_pitch01",
      },
      {
        label: "Desqualificadas",
        value: desqualificadas,
        pct: `${desqualificadasRate}%`,
        subtitle: "do total",
        icon: UserX,
        color: "bg-slate-500/10 text-slate-500",
        filterStatus: "desqualificada",
      },
      {
        label: "Call Confirmadas",
        value: callConfirmed,
        pct: `${callConfirmedRate}%`,
        subtitle: "do total",
        icon: CalendarCheck,
        color: "bg-indigo-500/10 text-indigo-500",
        filterStatus: "call_confirmada",
        sinal: { regra: "confirmadas", nivel: nivelConfirmadas, em: "pct" },
      },
      {
        label: "Call Não Confirmadas",
        value: callNotConfirmed,
        pct: `${callNotConfirmedRate}%`,
        subtitle: "do total",
        icon: XCircle,
        color: "bg-red-500/10 text-red-500",
        filterStatus: "call_nao_confirmada",
      },
      {
        label: "Fluxo Incompleto (não foi pro WPP)",
        value: incompleteWhatsappCount,
        subtitle: incompleteWhatsappCount === 0
          ? "Todos que agendaram clicaram no WhatsApp"
          : "Agendou e não abriu o WhatsApp · clique p/ ver",
        icon: MessageCircleOff,
        color: "bg-orange-500/10 text-orange-600",
        filterStatus: "fluxo_incompleto_whatsapp",
      },
      {
        label: "Reembolsadas",
        value: refundedCount,
        subtitle: `${refundedTotalLabel} reembolsado`,
        icon: RotateCcw,
        color: "bg-destructive/10 text-destructive",
        filterStatus: "reembolsadas",
      },
      {
        label: "Negociando",
        value: negotiatingCount,
        subtitle: `${negotiatingPotentialLabel} em potencial`,
        icon: Handshake,
        color: "bg-amber-500/10 text-amber-600",
        filterStatus: "negociando_lista",
      },
      {
        label: "Agendamentos no Dia",
        value: completedForms,
        subtitle: "Agendamentos do tráfego no dia (exclui manuais)",
        icon: ClipboardCheck,
        color: "bg-purple-500/10 text-purple-600",
        filterStatus: "__agendamentos_drill__" as any,
      },
      {
        label: "Reagendamento Futuro",
        value: futureRescheduleCount,
        subtitle: futureRescheduleCount === 0 ? "Nenhum pendente" : "Marcadas pra reagendar depois",
        icon: CalendarClock,
        color: "bg-indigo-500/10 text-indigo-600",
        filterStatus: "reagendamento_futuro",
      },
      {
        label: "Renda < R$ 2K",
        value: lowIncomeCount,
        subtitle: lowIncomeCount === 0 ? "Nenhum lead" : "Renda mensal até R$ 2.000",
        icon: UserX,
        color: "bg-rose-500/10 text-rose-600",
        filterStatus: "renda_baixa",
      },
      {
        label: "Qualificadas sem Agendar",
        value: qualifiedStats.semAgendar,
        subtitle: qualifiedStats.total > 0
          ? `${qualifiedStats.semAgendar} de ${qualifiedStats.total} qualificadas não agendaram · clique p/ ver a lista`
          : "Preencheram form (novaav) e não marcaram",
        icon: ClipboardX,
        color: "bg-teal-500/10 text-teal-600",
        filterStatus: null,
        formLeads: qualifiedStats.leads,
      },
    ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
      {cards.map((card) => {
        const isActive = activeFilter === card.filterStatus;
        const bordaSinal = card.sinal?.nivel ? `border ${CLASSES_SINAL[card.sinal.nivel].borda}` : "border-none";
        return (
          <Card
            key={card.label}
            data-card={card.label}
            className={`${bordaSinal} shadow-sm hover:shadow-md transition-all cursor-pointer ${isActive ? "ring-2 ring-primary ring-offset-2" : ""
              }`}
            onClick={() => {
              if (card.filterStatus === "__agendamentos_drill__") {
                onAgendamentosDrill?.(formRange.fromIso, formRange.toIso, card.label);
                return;
              }
              if (card.formLeads && card.formLeads.length > 0) {
                onFormLeadsDrill?.(card.formLeads, card.label);
                return;
              }
              const newFilter = isActive ? null : (card.filterStatus as StatsFilterValue);
              if (onFilterChange) {
                onFilterChange(newFilter);
              }
              if (onCardDrill && card.filterStatus) {
                onCardDrill(card.filterStatus as Exclude<StatsFilterValue, null>, card.label);
              }
            }}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {card.label}
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-3xl font-display font-bold">{card.value}</p>
                    {card.pct !== undefined && (card.sinal?.em === "pct" ? (
                      <SinalBadge regra={card.sinal.regra} nivel={card.sinal.nivel} className="text-sm">{card.pct}</SinalBadge>
                    ) : (
                      <span className="text-base font-semibold text-muted-foreground">{card.pct}</span>
                    ))}
                  </div>
                  {card.subtitle && (
                    <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
                  )}
                  {card.subtitle2 && (card.sinal?.em === "subtitle2" ? (
                    <div className="mt-1">
                      <SinalBadge regra={card.sinal.regra} nivel={card.sinal.nivel}>{card.subtitle2}</SinalBadge>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle2}</p>
                  ))}
                </div>
                <div className={`p-2.5 rounded-xl ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
              {/* Fora da linha do ícone: usa a largura inteira do card. */}
              {card.sinal && <ReferenciaMetaSinal regra={card.sinal.regra} className="mt-2" />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
