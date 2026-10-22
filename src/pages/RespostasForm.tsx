// Banco de Dados das respostas do formulário de captação — réplica da aba
// "Visão Geral" do admin do novaav, lendo de lead_form_responses (nosso banco).
// Rota protegida /respostas, acessível pelo botão "Banco de Dados" no header do CRM.
import { useEffect, useState, useMemo, Fragment } from "react";
import { Link } from "react-router-dom";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { numeroParaWhatsapp } from "@/lib/telefoneDaLead";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/DateFilter";
import { SdrPhoneSetting } from "@/components/SdrPhoneSetting";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts";
import { Users, CheckCircle2, XCircle, TrendingUp, ChevronDown, ChevronUp, Filter, ArrowLeft, CalendarCheck, MessageCircle } from "lucide-react";
import {
  contarChips,
  filtrosAtivos,
  passaFiltros,
  travouEmAtivo,
  type ContextoFiltro,
  type FiltroEtapa,
  type FiltroNivel,
  type FiltrosRespostas,
} from "@/lib/respostasFiltros";

// Telefone normalizado pros cruzamentos entre tabelas (form ↔ consulta ↔ wpp)
const phoneKey = (p: string | null | undefined): string | null => {
  const d = (p || "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
};

// Nome normalizado — reforço obrigatório: muitas consultas foram salvas com
// client_phone = "Não informado" (o redirect do novaav perdia o parâmetro),
// então só telefone deixaria essas leads marcadas como "não agendou".
const nameKey = (n: string | null | undefined): string | null => {
  const s = (n || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
  return s.length >= 5 ? s : null;
};

// Marcação manual do time (tabela lead_recovery). Fica fora do types.ts gerado
// pelo Lovable, então o acesso vai por um client destipado.
const RECOVERY_OPTIONS: { value: string; label: string; className: string }[] = [
  { value: "nao_trabalhado", label: "— não trabalhado", className: "text-muted-foreground" },
  { value: "tentando", label: "Em contato", className: "text-[hsl(210,90%,65%)]" },
  { value: "sem_resposta", label: "Não respondeu", className: "text-[hsl(45,100%,55%)]" },
  { value: "numero_errado", label: "Número errado", className: "text-[hsl(0,70%,60%)]" },
  { value: "recuperada", label: "✓ Recuperada", className: "text-[hsl(142,71%,55%)]" },
  { value: "descartada", label: "Descartada", className: "text-muted-foreground" },
];

// Situação da lead depois do formulário, montada por telefone
interface LeadJourney {
  agendou: boolean;
  dataConsulta: string | null;
  foiPraWpp: boolean; // clicou no botão do WhatsApp na tela de confirmação (whatsapp_clicked_at)
  instagram?: string | null; // instagram gravado na consulta (fallback do formulário)
  // Como a consulta foi encontrada — deixa cada marcação auditável na tela
  via?: "id" | "telefone" | "nome" | null;
}

interface LeadFormRow {
  id: string;
  consultation_id: string | null;
  nome: string | null;
  telefone: string | null;
  instagram: string | null;
  email: string | null;
  p1_objetivo: string | null;
  p2_situacao: string | null;
  p3_profissao: string | null;
  p4_altura: number | null;
  p4_peso: number | null;
  p4_idade: number | null;
  p5_estrategias: string | null;
  p6_caneta: string | null;
  p7_acompanhamento: string | null;
  p8_investimento: string | null;
  p9_prioridade: string | null;
  renda_mensal: string | null;
  origem: string | null; // "avaliacao" | "individual" (consultoria de elite)
  score: number;
  nivel: string; // A | B | C | D | DQ
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string;
}

// Labels amigáveis pros slugs gravados pelo submit-form-response
const OPT: Record<string, Record<string, string>> = {
  p1_objetivo: {
    emagrecer: "Apenas emagrecer",
    perder_gordura_definir: "Perder gordura e definir o corpo",
    definido_slim: "Ter um corpo definido e slim",
    volume_muscular: "Ganhar volume muscular",
  },
  p5_estrategias: {
    nao_entregam: "Não entregam resultado",
    demoro_muito: "Vou demorar muito",
    consigo_resultado: "Consigo o resultado",
  },
  p6_caneta: {
    uso_atual: "Faço uso atualmente",
    ja_usei: "Já usei, mas parei",
    nunca_usei: "Nunca usei",
  },
  p7_acompanhamento: {
    nutricional_convenio: "Nutricional (convênio)",
    nutricional: "Nutricional",
    treino: "Treino",
    ambos: "Os dois",
    nunca: "Nunca tive",
  },
  p8_investimento: {
    abaixo_100: "< R$100/mês",
    "100_250": "R$100-250/mês",
    "250_400": "R$250-400/mês",
    "400_600": "R$400-600/mês",
    "600_1000": "R$600-1000/mês",
    acima_1000: "> R$1000/mês",
  },
  p9_prioridade: {
    imediato: "Imediato",
    futuramente: "Futuramente",
    pensar: "Precisa pensar",
  },
  renda_mensal: {
    ate_2k: "Até R$2.000",
    "2k_4k": "R$2.000 a R$4.000",
    "5k_8k": "R$5.000 a R$8.000",
    "9k_15k": "R$9.000 a R$15.000",
    acima_15k: "Acima de R$15.000",
  },
};

// Renda é texto no banco. Sem esta escala, ordenar sairia em ordem alfabética
// e "Acima de R$15.000" cairia antes de "Até R$2.000".
const RENDA_PESO: Record<string, number> = {
  ate_2k: 1, "2k_4k": 2, "5k_8k": 3, "9k_15k": 4, acima_15k: 5,
};

const fmt = (field: string, value: string | number | null): string => {
  if (value === null || value === undefined || value === "") return "—";
  const map = OPT[field];
  return map?.[String(value)] ?? String(value);
};

// Renda em formato curto — cabe na tabela e serve pra decidir se vale chamar
const RENDA_CURTA: Record<string, string> = {
  ate_2k: "≤ 2k",
  "2k_4k": "2–4k",
  "5k_8k": "5–8k",
  "9k_15k": "9–15k",
  acima_15k: "15k+",
};
// Verde = tem dinheiro; vermelho = renda baixa (não adianta o score ser bom)
const RENDA_COR: Record<string, string> = {
  ate_2k: "text-[hsl(0,70%,60%)]",
  "2k_4k": "text-[hsl(45,100%,55%)]",
  "5k_8k": "text-[hsl(142,60%,55%)]",
  "9k_15k": "text-[hsl(142,71%,55%)]",
  acima_15k: "text-[hsl(142,80%,60%)] font-bold",
};

const NIVEL_LABEL: Record<string, string> = {
  A: "Nível A", B: "Nível B", C: "Nível C", D: "Nível D", DQ: "Desqualificada",
};

const getLevelColor = (nivel: string) => {
  switch (nivel) {
    case "A": return "bg-green-700 hover:bg-green-800 text-white";
    case "B": return "bg-green-500 hover:bg-green-600 text-white";
    case "C": return "bg-yellow-500 hover:bg-yellow-600 text-white";
    case "D": return "bg-orange-500 hover:bg-orange-600 text-white";
    case "DQ": return "bg-red-500 hover:bg-red-600 text-white";
    default: return "bg-secondary text-muted-foreground";
  }
};

const DETAIL_LABELS: { key: keyof LeadFormRow; label: string; optKey?: string }[] = [
  { key: "nome", label: "Nome completo" },
  { key: "telefone", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "p4_altura", label: "Altura (m)" },
  { key: "p4_peso", label: "Peso (kg)" },
  { key: "p4_idade", label: "Idade" },
  { key: "p3_profissao", label: "Profissão" },
  { key: "p1_objetivo", label: "Objetivo estético", optKey: "p1_objetivo" },
  { key: "p2_situacao", label: "Situação com o corpo" },
  { key: "p5_estrategias", label: "Estratégias atuais", optKey: "p5_estrategias" },
  { key: "p6_caneta", label: "Caneta emagrecedora", optKey: "p6_caneta" },
  { key: "p7_acompanhamento", label: "Acompanhamento individual", optKey: "p7_acompanhamento" },
  { key: "p8_investimento", label: "Investimento no físico", optKey: "p8_investimento" },
  { key: "p9_prioridade", label: "Prioridade de iniciar", optKey: "p9_prioridade" },
  { key: "renda_mensal", label: "Renda mensal", optKey: "renda_mensal" },
  { key: "utm_source", label: "UTM Source" },
  { key: "utm_campaign", label: "UTM Campaign" },
  { key: "utm_content", label: "UTM Content" },
  { key: "utm_term", label: "UTM Term" },
];

const FUNNEL_DEFS: { name: string; icon: string; color: string; match: (r: LeadFormRow) => boolean }[] = [
  {
    // Lead mais quente: entrou pelo /individual já pedindo consultoria de elite.
    // Fica primeiro na lista pra ganhar a etiqueta na coluna Funil.
    name: "/Individual (Elite)", icon: "👑", color: "border-yellow-500",
    match: (r) => (r.origem || "").toLowerCase() === "individual",
  },
  {
    name: "Tráfego Direto", icon: "📈", color: "border-purple-500",
    match: (r) => {
      if ((r.origem || "").toLowerCase() === "individual") return false; // já conta no card Elite
      const s = (r.utm_source || "").toLowerCase();
      return ["ig", "fb", "th"].includes(s) || (!r.utm_source && !r.utm_campaign);
    },
  },
  {
    name: "Social Selling", icon: "📣", color: "border-blue-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "social_selling" || (r.utm_campaign || "").toLowerCase() === "social_selling",
  },
  {
    name: "Low Ticket", icon: "📦", color: "border-amber-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "low_ticket" || (r.utm_campaign || "").toLowerCase() === "low_ticket",
  },
  {
    name: "Orgânico", icon: "🌐", color: "border-green-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "organico" || (r.utm_campaign || "").toLowerCase() === "organico",
  },
  {
    name: "Comentou Eu Quero", icon: "💬", color: "border-pink-500",
    match: (r) => (r.utm_campaign || "").toLowerCase() === "eu_quero",
  },
  {
    // Link entregue às parceiras: utm_source=parceira, utm_content=apelido dela.
    // Sem esta regra a lead de influencer caía em "Tráfego Direto" e o esforço
    // da parceria desaparecia do relatório.
    name: "ManyChat · Novo Seguidor", icon: "💬", color: "border-sky-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "manychat"
               || (r.utm_campaign || "").toLowerCase() === "novo_seguidor",
  },
  {
    name: "Parceria (Influencer)", icon: "🤝", color: "border-pink-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "parceira"
                || (r.utm_campaign || "").toLowerCase() === "microinfluencer",
  },
  {
    name: "Indicação", icon: "👥", color: "border-red-500",
    match: (r) => (r.utm_source || "").toLowerCase() === "indicacao" || (r.utm_campaign || "").toLowerCase() === "indicacao",
  },
  {
    name: "Acomp. Individual", icon: "🧑‍💼", color: "border-teal-500",
    match: (r) => (r.utm_campaign || "").toLowerCase() === "bio_link" || (r.utm_source || "").toLowerCase() === "acomp_individual" || (r.utm_campaign || "").toLowerCase() === "acomp_individual",
  },
  {
    name: "Avaliação + Low Ticket", icon: "📋", color: "border-orange-500",
    match: (r) => (r.utm_campaign || "").toLowerCase() === "avaliacao_low" || (r.utm_source || "").toLowerCase() === "avaliacao_low",
  },
];

// Atalhos de período — aparecem no topo e junto do Score médio, pra não
// obrigar o time a rolar a página inteira só pra trocar o dia.
function PeriodoFiltro({
  dateRange,
  onChange,
}: {
  dateRange: DateRange | undefined;
  onChange: (r: DateRange | undefined) => void;
}) {
  const sameDay = (a?: Date, b?: Date) => !!a && !!b && a.toDateString() === b.toDateString();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = (offset: number) => { const x = new Date(today); x.setDate(today.getDate() - offset); return x; };

  const presets: { label: string; from?: Date; to?: Date }[] = [
    { label: "Hoje", from: today, to: today },
    { label: "Ontem", from: d(1), to: d(1) },
    { label: "Hoje e ontem", from: d(1), to: today },
    { label: "7 dias", from: d(6), to: today },
    { label: "30 dias", from: d(29), to: today },
    { label: "Tudo" },
  ];

  const isActive = (p: { from?: Date; to?: Date }) =>
    p.from
      ? sameDay(dateRange?.from, p.from) && sameDay(dateRange?.to ?? dateRange?.from, p.to)
      : !dateRange?.from;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.from ? { from: p.from, to: p.to } : undefined)}
          className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
            isActive(p) ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
      <DateFilter dateRange={dateRange} onDateRangeChange={onChange} />
    </div>
  );
}

const RespostasForm = () => {
  const [responses, setResponses] = useState<LeadFormRow[]>([]);
  const [journeys, setJourneys] = useState<Map<string, LeadJourney>>(new Map());
  const [journeysByName, setJourneysByName] = useState<Map<string, LeadJourney>>(new Map());
  const [journeysByConsultationId, setJourneysByConsultationId] = useState<Map<string, LeadJourney>>(new Map());
  const [recovery, setRecovery] = useState<Map<string, string>>(new Map());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FiltroNivel>("all");
  // Filtro de etapa da jornada — vira fila de recuperação pro time
  const [stageFilter, setStageFilter] = useState<FiltroEtapa>("none");
  // Filtro pela marcação que o time faz na coluna Recuperação
  const [recFilter, setRecFilter] = useState<string>("none");
  // Ordem por renda: o time trabalha de cima pra baixo, então maior primeiro
  const [ordemRenda, setOrdemRenda] = useState<"nenhuma" | "maior" | "menor">("nenhuma");
  // Sinal de alta intenção: respondeu que quer começar imediatamente
  const [onlyImediato, setOnlyImediato] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    // Abre nos últimos 30 dias: puxar a base inteira (12k+) deixava a tela lenta
    const to = new Date(); to.setHours(23, 59, 59, 999);
    const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
    return { from, to };
  });
  const [selectedFunnel, setSelectedFunnel] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const PAGE_SIZE = 1000;
      let all: LeadFormRow[] = [];
      let from = 0;
      for (let i = 0; i < 100; i++) {
        let q = supabase
          .from("lead_form_responses")
          .select("*")
          .order("created_at", { ascending: false });
        // Filtra no banco: sem isso a tela baixava as 12k+ respostas toda vez
        if (dateRange?.from) {
          const ini = new Date(dateRange.from); ini.setHours(0, 0, 0, 0);
          q = q.gte("created_at", ini.toISOString());
          const fim = new Date(dateRange.to ?? dateRange.from); fim.setHours(23, 59, 59, 999);
          q = q.lte("created_at", fim.toISOString());
        }
        const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
        if (error || !data) break;
        all = all.concat(data as LeadFormRow[]);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      setResponses(all);
      setLoading(false);
    };
    fetchAll();
  }, [dateRange]);

  // Cruza cada lead (por telefone) com agendamento, clique no WhatsApp e
  // mensagem recebida no CRM — mostra até onde ela chegou depois do formulário.
  useEffect(() => {
    const buildJourneys = async () => {
      const PAGE = 1000;

      const fetchConsultations = async () => {
        let out: { id: string; client_phone: string | null; client_name: string | null; date: string | null; whatsapp_clicked_at: string | null; instagram: string | null }[] = [];
        for (let i = 0; i < 100; i++) {
          let cq = supabase
            .from("consultations")
            .select("id, client_phone, client_name, date, whatsapp_clicked_at, instagram");
          if (dateRange?.from) {
            // 90 dias de folga pra pegar reagendamento e aluna que voltou
            const ini = new Date(dateRange.from); ini.setDate(ini.getDate() - 90);
            cq = cq.gte("date", ini.toISOString().slice(0, 10));
          }
          const { data, error } = await cq.range(i * PAGE, i * PAGE + PAGE - 1);
          if (error || !data) break;
          out = out.concat(data);
          if (data.length < PAGE) break;
        }
        return out;
      };

      const cons = await fetchConsultations();

      const map = new Map<string, LeadJourney>();
      const byName = new Map<string, LeadJourney>();
      const byConsultationId = new Map<string, LeadJourney>();

      const merge = (target: Map<string, LeadJourney>, key: string, c: typeof cons[number]) => {
        const prev = target.get(key);
        target.set(key, {
          agendou: true,
          // mantém a consulta mais recente quando a lead agendou mais de uma vez
          dataConsulta: !prev?.dataConsulta || (c.date ?? "") > prev.dataConsulta ? c.date : prev.dataConsulta,
          foiPraWpp: (prev?.foiPraWpp ?? false) || !!c.whatsapp_clicked_at,
          instagram: prev?.instagram || c.instagram || null,
        });
      };

      for (const c of cons) {
        merge(byConsultationId, c.id, c);
        const pk = phoneKey(c.client_phone);
        if (pk) merge(map, pk, c);
        const nk = nameKey(c.client_name);
        if (nk) merge(byName, nk, c);
      }

      setJourneys(map);
      setJourneysByName(byName);
      setJourneysByConsultationId(byConsultationId);
    };
    buildJourneys();
  }, [dateRange]);

  // lead_recovery ainda não está no types.ts gerado pelo Lovable
  const sb = supabase as unknown as { from: (t: string) => any };

  useEffect(() => {
    const loadRecovery = async () => {
      const PAGE = 1000;
      const map = new Map<string, string>();
      for (let i = 0; i < 100; i++) {
        const { data, error } = await sb
          .from("lead_recovery")
          .select("form_response_id, status")
          .range(i * PAGE, i * PAGE + PAGE - 1);
        if (error) {
          // Tabela ainda não criada — a coluna aparece desabilitada com o aviso
          setRecoveryReady(false);
          return;
        }
        if (!data) break;
        for (const row of data as { form_response_id: string; status: string }[]) {
          map.set(row.form_response_id, row.status);
        }
        if (data.length < PAGE) break;
      }
      setRecovery(map);
    };
    loadRecovery();
  }, []);

  const setRecoveryStatus = async (formResponseId: string, status: string) => {
    setSavingId(formResponseId);
    // Atualiza na tela na hora; se o banco recusar, volta ao valor anterior
    const previous = recovery.get(formResponseId);
    setRecovery((m) => new Map(m).set(formResponseId, status));
    const { error } = await sb
      .from("lead_recovery")
      .upsert(
        { form_response_id: formResponseId, status, updated_at: new Date().toISOString() },
        { onConflict: "form_response_id" },
      );
    if (error) {
      setRecovery((m) => {
        const next = new Map(m);
        if (previous) next.set(formResponseId, previous);
        else next.delete(formResponseId);
        return next;
      });
    }
    setSavingId(null);
  };

  // Só dá pra AFIRMAR "não agendou" para leads que passaram pelo fluxo unificado
  // (formulário e agendamento no mesmo domínio, com vínculo por ID). Antes disso
  // o telefone se perdia no redirect entre sites, então ausência de consulta não
  // prova nada — nesses casos a coluna fica "—" em vez de mentir.
  const rastreavel = (r: LeadFormRow) => !!r.origem;

  const journeyOf = (r: LeadFormRow): LeadJourney => {
    const vazio = { agendou: false, dataConsulta: null, foiPraWpp: false };
    // Vínculo determinístico do fluxo novo. Telefone/nome seguem abaixo só
    // como fallback para os registros anteriores à unificação.
    if (r.consultation_id) {
      const porId = journeysByConsultationId.get(r.consultation_id);
      if (porId) return { ...porId, via: "id" };
      return vazio;
    }
    const pk = phoneKey(r.telefone);
    const porTelefone = pk ? journeys.get(pk) : undefined;
    const nk = nameKey(r.nome);
    const porNome = nk ? journeysByName.get(nk) : undefined;
    if (!porTelefone && !porNome) return vazio;
    // Une os dois: telefone e nome podem cobrir consultas diferentes da mesma lead
    return {
      agendou: (porTelefone?.agendou ?? false) || (porNome?.agendou ?? false),
      dataConsulta: porTelefone?.dataConsulta ?? porNome?.dataConsulta ?? null,
      foiPraWpp: (porTelefone?.foiPraWpp ?? false) || (porNome?.foiPraWpp ?? false),
      instagram: porTelefone?.instagram ?? porNome?.instagram ?? null,
      via: porTelefone?.agendou ? "telefone" : porNome?.agendou ? "nome" : null,
    };
  };

  const isQualified = (r: LeadFormRow) => ["A", "B", "C", "D"].includes(r.nivel);
  const isDisqualified = (r: LeadFormRow) => r.nivel === "DQ";

  const dateScoped = useMemo(() => {
    return responses.filter((r) => {
      const d = new Date(r.created_at);
      if (dateRange?.from && d < dateRange.from) return false;
      if (dateRange?.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      return true;
    });
  }, [responses, dateRange]);

  const stats = useMemo(() => {
    const qualifiedCount = dateScoped.filter(isQualified).length;
    const disqualifiedCount = dateScoped.filter(isDisqualified).length;
    const avgScore = dateScoped.length
      ? Math.round(dateScoped.reduce((sum, r) => sum + r.score, 0) / dateScoped.length)
      : 0;
    const conversionRate = dateScoped.length
      ? Math.round((qualifiedCount / dateScoped.length) * 100)
      : 0;
    return { qualifiedCount, disqualifiedCount, avgScore, conversionRate, total: dateScoped.length };
  }, [dateScoped]);

  const pieData = useMemo(() => [
    { name: "Qualificadas", value: stats.qualifiedCount, color: "hsl(var(--primary))" },
    { name: "Não qualificadas", value: stats.disqualifiedCount, color: "hsl(var(--muted-foreground))" },
  ], [stats]);

  const dailyData = useMemo(() => {
    const map: Record<string, { date: string; total: number; qualified: number }> = {};
    dateScoped.forEach((r) => {
      const date = new Date(r.created_at).toLocaleDateString("pt-BR");
      if (!map[date]) map[date] = { date, total: 0, qualified: 0 };
      map[date].total++;
      if (isQualified(r)) map[date].qualified++;
    });
    return Object.values(map).reverse().slice(-14);
  }, [dateScoped]);

  const scoreDistribution = useMemo(() => {
    const ranges = [
      { label: "< 0", min: -100, max: -1 },
      { label: "0-10", min: 0, max: 10 },
      { label: "11-20", min: 11, max: 20 },
      { label: "21-30", min: 21, max: 30 },
      { label: "31-40", min: 31, max: 40 },
      { label: "41-50", min: 41, max: 50 },
      { label: "51+", min: 51, max: 200 },
    ];
    return ranges.map((r) => ({
      range: r.label,
      count: dateScoped.filter((resp) => resp.score >= r.min && resp.score <= r.max).length,
    }));
  }, [dateScoped]);

  const funnelData = useMemo(() => {
    return FUNNEL_DEFS.map((def) => {
      const leads = dateScoped.filter(def.match);
      const qualified = leads.filter(isQualified).length;
      return {
        name: def.name,
        icon: def.icon,
        color: def.color,
        total: leads.length,
        qualified,
        disqualified: leads.filter(isDisqualified).length,
        nivelA: leads.filter((r) => r.nivel === "A").length,
        nivelB: leads.filter((r) => r.nivel === "B").length,
        nivelC: leads.filter((r) => r.nivel === "C").length,
        nivelD: leads.filter((r) => r.nivel === "D").length,
        conversionRate: leads.length ? Math.round((qualified / leads.length) * 100) : 0,
      };
    });
  }, [dateScoped]);

  // Quantas leads em cada situação de recuperação. Sem isso o time marca
  // "Em contato" e ninguém enxerga o tamanho da fila nem o que já foi tocado.
  const recCounts = useMemo(() => {
    const base = dateScoped.filter((r) => isQualified(r) && rastreavel(r));
    const conta: Record<string, number> = {};
    RECOVERY_OPTIONS.forEach((o) => { conta[o.value] = 0; });
    for (const r of base) {
      const st = recovery.get(r.id) ?? "nao_trabalhado";
      if (conta[st] === undefined) conta[st] = 0;
      conta[st] += 1;
    }
    return { conta, total: base.length };
  }, [dateScoped, recovery, journeys, journeysByName]);

  const resolveFunilLabel = (r: LeadFormRow): string => {
    const def = FUNNEL_DEFS.find((d) => d.match(r));
    return def ? `${def.icon} ${def.name}` : "—";
  };

  const filtros: FiltrosRespostas = {
    nivel: filter,
    etapa: stageFilter,
    imediato: onlyImediato,
    rec: recFilter,
    funil: selectedFunnel,
    busca: searchTerm,
  };

  const ctxFiltro: ContextoFiltro<LeadFormRow> = {
    jornada: journeyOf,
    recuperacao: (r) => recovery.get(r.id) ?? "nao_trabalhado",
    casaFunil: (nome, r) => {
      const def = FUNNEL_DEFS.find((d) => d.name === nome);
      return def ? def.match(r) : true;
    },
  };

  const filtered = dateScoped.filter((r) => passaFiltros(r, filtros, ctxFiltro));

  // Número de cada botão = o que a lista mostra ao clicar nele, já respeitando
  // os filtros das outras linhas (ver respostasFiltros.ts)
  const chips = contarChips(dateScoped, filtros, ctxFiltro);

  // Lista vazia por combinação de filtros: quantas apareceriam sem o "Travou em"
  const semTravouEm = travouEmAtivo(filtros)
    ? dateScoped.filter((r) => passaFiltros(r, filtros, ctxFiltro, ["etapa", "imediato"])).length
    : 0;
  const nomesFiltrosAtivos = filtrosAtivos(
    filtros,
    (v) => (RECOVERY_OPTIONS.find((o) => o.value === v)?.label ?? v).replace("— ", "").replace("✓ ", ""),
  );
  const limparTravouEm = () => { setStageFilter("none"); setOnlyImediato(false); };
  const limparTudo = () => {
    setFilter("all"); setStageFilter("none"); setOnlyImediato(false);
    setRecFilter("none"); setSelectedFunnel(null); setSearchTerm("");
  };

  // Quem não informou renda vai pro fim nas duas direções: lead sem o dado não
  // deve disputar o topo da fila com quem declarou renda alta.
  const ordenadas = useMemo(() => {
    if (ordemRenda === "nenhuma") return filtered;
    const peso = (r: LeadFormRow) => RENDA_PESO[r.renda_mensal || ""] ?? 0;
    return [...filtered].sort((a, b) => {
      const pa = peso(a), pb = peso(b);
      if (pa === 0 && pb === 0) return 0;
      if (pa === 0) return 1;
      if (pb === 0) return -1;
      return ordemRenda === "maior" ? pb - pa : pa - pb;
    });
  }, [filtered, ordemRenda]);

  return (
    <div className="novaav-theme min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to="/vendas">
              <Button variant="ghost" size="icon" className="h-9 w-9 text-foreground hover:bg-secondary">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-3xl font-black">Banco de Dados — Respostas</h1>
          </div>
          <PeriodoFiltro dateRange={dateRange} onChange={setDateRange} />
        </div>

        <SdrPhoneSetting />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-bold uppercase tracking-wider">
              <Users size={16} /> Total
            </div>
            <p className="text-3xl font-black">{stats.total}</p>
          </div>
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-bold uppercase tracking-wider">
              <CheckCircle2 size={16} /> Qualificadas
            </div>
            <p className="text-3xl font-black text-primary">{stats.qualifiedCount}</p>
          </div>
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-bold uppercase tracking-wider">
              <XCircle size={16} /> Não qualificadas
            </div>
            <p className="text-3xl font-black">{stats.disqualifiedCount}</p>
          </div>
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-sm font-bold uppercase tracking-wider">
              <TrendingUp size={16} /> Conversão
            </div>
            <p className="text-3xl font-black">{stats.conversionRate}%</p>
          </div>
        </div>

        {/* Trabalho de recuperação — o que o time já tocou da fila */}
        {recoveryReady && (
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
                Recuperação · {recCounts.total} qualificadas rastreáveis
              </h3>
              {recFilter !== "none" && (
                <button
                  onClick={() => setRecFilter("none")}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  ✕ limpar filtro
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {RECOVERY_OPTIONS.map((o) => {
                const n = recCounts.conta[o.value] ?? 0;
                const ativo = recFilter === o.value;
                const pct = recCounts.total > 0 ? Math.round((n / recCounts.total) * 100) : 0;
                return (
                  <button
                    key={o.value}
                    onClick={() => setRecFilter(ativo ? "none" : o.value)}
                    className={`text-left rounded-xl border p-3 transition ${
                      ativo ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
                    }`}
                    title={`Ver só as leads marcadas como ${o.label}`}
                  >
                    <div className={`text-2xl font-black tabular-nums ${o.className}`}>{n}</div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight mt-0.5">
                      {o.label.replace("— ", "").replace("✓ ", "")}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{pct}%</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Qualificadas vs Não</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--foreground))" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 text-xs font-bold">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-primary inline-block" /> Qualificadas</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-muted-foreground inline-block" /> Não qualificadas</span>
            </div>
          </div>

          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Respostas por dia</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--foreground))" }}
                />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--foreground))" strokeWidth={2} name="Total" dot={false} />
                <Line type="monotone" dataKey="qualified" stroke="hsl(var(--primary))" strokeWidth={2} name="Qualificadas" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Distribuição de Score</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={scoreDistribution}>
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--foreground))" }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Funnel Metrics */}
        <div className="bg-secondary/50 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Filter size={16} /> Métricas por Funil / UTM
            </h3>
            {selectedFunnel && (
              <button
                onClick={() => setSelectedFunnel(null)}
                className="text-xs text-primary hover:underline font-bold"
              >
                ✕ Limpar filtro: {selectedFunnel}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {funnelData.map((f) => (
              <button
                key={f.name}
                onClick={() => setSelectedFunnel(selectedFunnel === f.name ? null : f.name)}
                className={`text-left border-2 rounded-xl p-4 space-y-2 transition-all ${
                  selectedFunnel === f.name
                    ? "border-primary bg-primary/10 ring-2 ring-primary"
                    : `${f.color} hover:border-primary/50 bg-secondary/30`
                }`}
              >
                <p className="font-bold text-sm text-foreground truncate">{f.icon} {f.name}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">{f.total}</span>
                  <span className="text-xs text-muted-foreground">leads</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge className="bg-green-700 text-white text-[10px] px-1.5 py-0">A: {f.nivelA}</Badge>
                  <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0">B: {f.nivelB}</Badge>
                  <Badge className="bg-yellow-500 text-white text-[10px] px-1.5 py-0">C: {f.nivelC}</Badge>
                  <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0">D: {f.nivelD}</Badge>
                  <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">DQ: {f.disqualified}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-primary font-bold">{f.qualified} qualif.</span>
                  <span>·</span>
                  <span>{f.conversionRate}% conversão</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Score médio + período (repetido aqui pra não ter que rolar até o topo) */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="bg-secondary/50 border border-border rounded-2xl p-5 inline-flex items-center gap-3">
            <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Score médio:</span>
            <span className="text-2xl font-black">{stats.avgScore}</span>
          </div>
          <PeriodoFiltro dateRange={dateRange} onChange={setDateRange} />
        </div>

        {/* Filtros + Tabela */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setFilter("all"); setSelectedFunnel(null); setSearchTerm(""); }}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === "all" && !selectedFunnel && !searchTerm ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                Todas ({chips.todas})
              </button>
              <button
                onClick={() => setFilter(filter === "individual" ? "all" : "individual")}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === "individual" ? "bg-[hsl(45,100%,51%)] text-black" : "bg-secondary text-muted-foreground"}`}
                title="Leads que entraram pelo /individual já pedindo consultoria de elite"
              >
                👑 Individual ({chips.individual}) · {chips.individualQualificadas} qualif.
              </button>
              <button onClick={() => setFilter("qualified")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === "qualified" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                Qualificadas ({chips.qualificadas})
              </button>
              <button onClick={() => setFilter("disqualified")} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${filter === "disqualified" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                Não qualificadas ({chips.naoQualificadas})
              </button>
              <button onClick={() => setFilter("A")} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${filter === "A" ? "bg-green-700 text-white" : "bg-secondary text-muted-foreground"}`}>
                Nível A
              </button>
              <button onClick={() => setFilter("B")} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${filter === "B" ? "bg-green-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                Nível B
              </button>
              <button onClick={() => setFilter("C")} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${filter === "C" ? "bg-yellow-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                Nível C
              </button>
              <button onClick={() => setFilter("D")} className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${filter === "D" ? "bg-orange-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                Nível D
              </button>
            </div>

            {/* Filas de recuperação — qualificadas que travaram em cada etapa */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Travou em:</span>
              <button
                onClick={() => setStageFilter(stageFilter === "sem_agendar" ? "none" : "sem_agendar")}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all border ${stageFilter === "sem_agendar" ? "bg-teal-600 text-white border-teal-500" : "bg-secondary text-muted-foreground border-border"}`}
                title="Qualificadas que preencheram o formulário e nunca agendaram"
              >
                Não agendou ({chips.semAgendar})
              </button>
              <button
                onClick={() => setStageFilter(stageFilter === "agendou" ? "none" : "agendou")}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all border ${stageFilter === "agendou" ? "bg-[hsl(142,71%,45%)] text-white border-[hsl(142,71%,55%)]" : "bg-secondary text-muted-foreground border-border"}`}
                title="Qualificadas que preencheram o formulário e chegaram a agendar a consulta"
              >
                Todas que agendaram ({chips.agendou})
              </button>
              <button
                onClick={() => setOnlyImediato(!onlyImediato)}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all border ${onlyImediato ? "bg-[hsl(142,71%,45%)] text-white border-[hsl(142,71%,55%)]" : "bg-secondary text-muted-foreground border-border"}`}
                title='Respondeu "Iniciaria de imediato — é minha principal prioridade"'
              >
                🔥 Quer começar já ({chips.imediato})
              </button>
              <button
                onClick={() => setStageFilter(stageFilter === "sem_wpp" ? "none" : "sem_wpp")}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all border ${stageFilter === "sem_wpp" ? "bg-orange-600 text-white border-orange-500" : "bg-secondary text-muted-foreground border-border"}`}
                title="Agendaram mas não apertaram o botão do WhatsApp na confirmação"
              >
                Agendou · não apertou o WPP ({chips.semWpp})
              </button>
            </div>
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="bg-secondary/50 border border-border rounded-lg pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-64"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  aria-label="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {(() => {
            const semRastreio = dateScoped.filter((r) => !rastreavel(r)).length;
            if (semRastreio === 0) return null;
            return (
              <div className="flex items-start gap-3 bg-secondary/40 border border-border rounded-xl px-4 py-3 text-sm">
                <span className="text-muted-foreground font-bold">ℹ</span>
                <p className="text-muted-foreground">
                  <strong className="text-foreground">{semRastreio}</strong> lead(s) deste período vieram antes da unificação do
                  funil (formulário no novaav e agendamento aqui). Para essas, o traço em <strong className="text-foreground">Agendou</strong> significa
                  <strong className="text-foreground"> sem dado confiável</strong>, não "não agendou" — o telefone se perdia no caminho entre os dois sites.
                  As filas de recuperação também ignoram essas leads de propósito.
                </p>
              </div>
            );
          })()}

          {!recoveryReady && (
            <div className="flex items-start gap-3 bg-[hsl(45,100%,51%)]/10 border border-[hsl(45,100%,51%)]/40 rounded-xl px-4 py-3 text-sm">
              <span className="text-[hsl(45,100%,51%)] font-bold">⚠</span>
              <p className="text-foreground/90">
                A coluna <strong>Recuperação</strong> está desligada porque a tabela <code className="font-mono text-xs">lead_recovery</code> ainda
                não existe no banco. Rode a migration <code className="font-mono text-xs">20260807120000_lead_recovery.sql</code> no
                SQL Editor do Supabase para ligar a marcação do time.
              </p>
            </div>
          )}

          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            nomesFiltrosAtivos.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma resposta encontrada.</p>
            ) : (
              <div data-testid="vazio-filtros" className="bg-secondary/40 border border-border rounded-xl px-4 py-4 space-y-3 text-sm">
                <p className="text-foreground font-bold">Nenhuma lead com todos estes filtros juntos:</p>
                <div className="flex flex-wrap gap-2">
                  {nomesFiltrosAtivos.map((n) => (
                    <span key={n} className="px-2 py-1 rounded-md bg-secondary text-foreground text-xs font-bold">{n}</span>
                  ))}
                </div>
                {travouEmAtivo(filtros) && (
                  <p className="text-muted-foreground">
                    Os filtros de <strong className="text-foreground">Travou em</strong> só contam leads qualificadas com rastreio.
                    {semTravouEm > 0 && <> Sem ele, a lista mostra <strong className="text-foreground">{semTravouEm}</strong> lead(s).</>}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {travouEmAtivo(filtros) && (
                    <Button size="sm" onClick={limparTravouEm}>Limpar filtro Travou em</Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={limparTudo}>Limpar todos os filtros</Button>
                </div>
              </div>
            )
          ) : (
            <div className="border border-border rounded-xl scroll-x-visible">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead className="text-center">Agendou</TableHead>
                    <TableHead className="text-center">Apertou o WPP</TableHead>
                    <TableHead>Recuperação</TableHead>
                    <TableHead className="text-center">Contato</TableHead>
                    <TableHead>Instagram</TableHead>
                    <TableHead>Profissão</TableHead>
                    <TableHead className="text-center">
                      <button
                        onClick={() => setOrdemRenda(
                          ordemRenda === "maior" ? "menor" : ordemRenda === "menor" ? "nenhuma" : "maior"
                        )}
                        className="inline-flex items-center gap-1 hover:text-foreground transition"
                        title={
                          ordemRenda === "maior" ? "Maior renda primeiro · clique para inverter"
                          : ordemRenda === "menor" ? "Menor renda primeiro · clique para voltar ao normal"
                          : "Ordenar da maior renda para a menor"
                        }
                      >
                        Renda
                        <span className="text-[10px] leading-none">
                          {ordemRenda === "maior" ? "▼" : ordemRenda === "menor" ? "▲" : "⇅"}
                        </span>
                      </button>
                    </TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Nível</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenadas.map((r) => {
                    const j = journeyOf(r);
                    return (
                    <Fragment key={r.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-secondary/80 transition-colors"
                        onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      >
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                          {" "}
                          <span className="opacity-60">{new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap max-w-[130px] truncate" title={r.nome || undefined}>
                          {(r.nome || "—").trim().split(/\s+/)[0]}
                        </TableCell>
                        <TableCell
                          className="text-center whitespace-nowrap"
                          title={
                            j.agendou
                              ? j.via === "id"
                                ? "Vínculo direto: gravado no momento do agendamento — certeza total"
                                : j.via === "telefone"
                                  ? "Encontrado pelo TELEFONE (consulta pode estar em outro nome — confira)"
                                  : "Encontrado pelo NOME (pode ser homônimo — confira)"
                              : undefined
                          }
                        >
                          {j.agendou ? (
                            <span className="inline-flex items-center gap-1 text-[hsl(142,71%,55%)] font-semibold text-xs">
                              <CalendarCheck size={13} />
                              {j.dataConsulta ? new Date(j.dataConsulta + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "Sim"}
                              {j.via !== "id" && <span className="text-[hsl(45,100%,55%)] font-bold" title="casamento por telefone/nome — não é vínculo direto">?</span>}
                            </span>
                          ) : isDisqualified(r) ? (
                            // Desqualificada cai na página de vídeo, nem chega a ver o calendário
                            <span className="text-muted-foreground text-xs italic">Desqualificada</span>
                          ) : rastreavel(r) ? (
                            <span className="inline-flex items-center gap-1 text-[hsl(0,70%,62%)] font-semibold text-xs">
                              <XCircle size={13} /> Não agendou
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs" title="Lead anterior à unificação do funil — sem dado confiável de agendamento">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          {j.foiPraWpp ? (
                            <MessageCircle size={15} className="inline text-[hsl(142,71%,55%)]" />
                          ) : isDisqualified(r) ? (
                            <span className="text-muted-foreground text-xs italic">Desqualificada</span>
                          ) : rastreavel(r) && !j.agendou ? (
                            // Nunca agendou, então nunca viu o botão: marcar
                            // "não apertou" em vermelho aqui seria mentira.
                            <span className="text-muted-foreground text-xs" title="Parou antes de agendar — nunca chegou na tela com o botão do WhatsApp">
                              n/a
                            </span>
                          ) : rastreavel(r) ? (
                            // Não chegou no WhatsApp — seja porque não agendou,
                            // seja porque agendou e não apertou. Pro time o
                            // desfecho é o mesmo: a conversa não começou.
                            <span
                              className="inline-flex items-center gap-1 text-[hsl(0,70%,62%)] font-semibold text-xs"
                              title="Agendou mas não apertou o botão do WhatsApp na confirmação"
                            >
                              <XCircle size={13} /> Não apertou
                            </span>
                          ) : (
                            // Lead antiga: sem dado confiável
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {j.agendou ? (
                            // Agendada não entra em recuperação: o status é
                            // calculado pela consulta vinculada, sem gravar ou
                            // sobrescrever uma marcação manual no banco.
                            <span className="inline-flex items-center gap-1 rounded-lg bg-[hsl(142,71%,55%)]/15 px-2 py-1 text-xs font-semibold text-[hsl(142,71%,55%)]">
                              <CheckCircle2 size={13} /> OK — agendou
                            </span>
                          ) : (() => {
                            const status = recovery.get(r.id) ?? "nao_trabalhado";
                            const opt = RECOVERY_OPTIONS.find((o) => o.value === status) ?? RECOVERY_OPTIONS[0];
                            return (
                              <select
                                value={status}
                                disabled={!recoveryReady || savingId === r.id}
                                onChange={(e) => setRecoveryStatus(r.id, e.target.value)}
                                title={recoveryReady ? "Marcar o que aconteceu com essa lead" : "Tabela lead_recovery ainda não criada no banco"}
                                className={`bg-secondary/60 border border-border rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 disabled:cursor-not-allowed ${opt.className}`}
                              >
                                {RECOVERY_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value} className="text-foreground bg-card">
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </TableCell>
                        {/* Só o ícone: o número aparece ao passar o mouse, sem ocupar a tela */}
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          {r.telefone ? (
                            <a
                              href={`https://wa.me/${numeroParaWhatsapp(r.telefone)}?text=${encodeURIComponent(`Olá${r.nome ? ` ${r.nome.split(" ")[0]}` : ""}, tudo bem? Aqui é do time do Breno Xavier. Vi que você tem interesse em ter um corpo Slim e Definido, e que preencheu nossa avaliação. Você ainda está buscando isso? Podemos te ajudar a chegar lá 💪`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={r.telefone}
                              aria-label={`WhatsApp ${r.telefone}`}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/30 transition-colors whitespace-nowrap"
                            >
                              <MessageCircle size={14} className="shrink-0" />
                              {/* número visível: o time procura por telefone com o Ctrl+F do navegador */}
                              <span className="text-[11px] font-mono">{r.telefone.replace(/\D/g, "")}</span>
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {(() => { const ig = r.instagram || j.instagram; return ig ? (
                            <a
                              href={`https://instagram.com/${ig.replace(/^@/, "").trim()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium text-xs whitespace-nowrap"
                            >
                              @{ig.replace(/^@/, "").trim()}
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          ); })()}
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate" title={r.p3_profissao || undefined}>{r.p3_profissao || "—"}</TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          {r.renda_mensal ? (
                            <span className={`text-xs font-semibold ${RENDA_COR[r.renda_mensal] ?? "text-foreground"}`}>
                              {RENDA_CURTA[r.renda_mensal] ?? r.renda_mensal}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-bold text-center">{r.score}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Badge className={getLevelColor(r.nivel)}>
                              {NIVEL_LABEL[r.nivel] ?? r.nivel}
                            </Badge>
                            {expandedId === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedId === r.id && (
                        <TableRow>
                          <TableCell colSpan={11} className="bg-secondary/30 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {DETAIL_LABELS.map(({ key, label, optKey }) => {
                                // Instagram: quando a resposta do formulário veio sem ele,
                                // usa o que está na consulta — mesmo fallback que a coluna
                                // da tabela já faz. Sem isto a tela mostrava o @ na linha
                                // e escondia no detalhe, como se não existisse.
                                const raw = key === "instagram" ? (r.instagram || j.instagram) : r[key];
                                if (raw === null || raw === undefined || raw === "") return null;
                                const value = optKey ? fmt(optKey, raw as string) : String(raw);
                                return (
                                  <div key={key} className="space-y-1">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                                    <p className="text-sm text-foreground">{value}</p>
                                  </div>
                                );
                              })}
                              <div className="space-y-1">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Score</p>
                                <p className="text-sm font-bold text-foreground">{r.score}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RespostasForm;
