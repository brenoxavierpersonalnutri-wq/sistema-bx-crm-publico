import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/components/DateFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { LeadFormResponsesDialog } from "@/components/shared/LeadFormResponsesDialog";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConversionIntelligence } from "./ConversionIntelligence";

// ===== Types =====
interface Lead {
  id: string;
  nome: string | null;
  telefone: string | null;
  // form fields (may be null when no form linked)
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
  // score / classification
  score: number | null;
  nivel: string; // A | B | C | D | DQ | "—"
  // consultation
  via: string | null;
  status_label: string; // convertida | nao_convertida | no_show | desqualificada | feita_pendente | sem_status
  attended: boolean | null;
  converted: boolean | null;
  disqualified: boolean | null;
  date: string; // consultation date
  created_at: string;
  has_form: boolean;
}

const QUESTIONS = [
  {
    key: "p1_objetivo",
    label: "P1 — Objetivo estético",
    options: {
      emagrecer: "Apenas emagrecer",
      perder_gordura_definir: "Perder gordura e definir",
      definido_slim: "Corpo definido e slim",
      volume_muscular: "Ganhar volume muscular",
    } as Record<string, string>,
  },
  {
    key: "p5_estrategias",
    label: "P5 — Acredita nas estratégias atuais",
    options: {
      nao_entregam: "Não entregam resultado",
      demoro_muito: "Vou demorar muito",
      consigo_resultado: "Consigo o resultado",
    } as Record<string, string>,
  },
  {
    key: "p6_caneta",
    label: "P6 — Uso de caneta emagrecedora",
    options: {
      uso_atual: "Faço uso atualmente",
      ja_usei: "Já usei, mas parei",
      nunca_usei: "Nunca usei",
    } as Record<string, string>,
  },
  {
    key: "p7_acompanhamento",
    label: "P7 — Acompanhamento individual prévio",
    options: {
      nutricional: "Nutricional",
      treino: "Treino",
      ambos: "Os dois",
      nunca: "Nunca tive",
    } as Record<string, string>,
  },
  {
    key: "p8_investimento",
    label: "P8 — Investimento mensal anterior",
    options: {
      abaixo_100: "< R$100",
      "100_250": "R$100-250",
      "250_400": "R$250-400",
      "400_600": "R$400-600",
      "600_1000": "R$600-1000",
      acima_1000: "> R$1000",
    } as Record<string, string>,
  },
  {
    key: "p9_prioridade",
    label: "P9 — Prioridade de iniciar",
    options: {
      imediato: "Imediato",
      futuramente: "Futuramente",
      pensar: "Precisa pensar",
    } as Record<string, string>,
  },
  {
    key: "renda_mensal",
    label: "P10 — Renda mensal",
    options: {
      ate_2k: "Até R$2.000",
      "2k_4k": "De R$2.000 a R$4.000",
      "5k_8k": "De R$5.000 a R$8.000",
      "9k_15k": "De R$9.000 a R$15.000",
      acima_15k: "Acima de R$15.000",
    } as Record<string, string>,
  },
] as const;

const STATUS_LABELS: Record<string, string> = {
  all: "Todos os status",
  convertida: "Convertida",
  nao_convertida: "Não convertida",
  no_show: "No-show",
  desqualificada: "Desqualificada",
  feita_pendente: "Feita (pendente)",
  sem_status: "Sem status",
};

function scoreToNivel(score: number | null): string {
  if (score === null || score === undefined) return "—";
  if (score >= 65) return "A";
  if (score >= 50) return "B";
  if (score >= 41) return "C";
  if (score >= 35) return "D";
  return "DQ";
}

function getStatusLabel(c: { converted: boolean | null; attended: boolean | null; disqualified: boolean | null }): string {
  if (c.converted === true) return "convertida";
  if (c.disqualified) return "desqualificada";
  if (c.attended === true && c.converted === false) return "nao_convertida";
  if (c.attended === false) return "no_show";
  if (c.attended === true) return "feita_pendente";
  return "sem_status";
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

function countBy<T>(arr: T[], key: (t: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of arr) {
    const k = key(item);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function normalizeText(s: string | null): string | null {
  if (!s) return null;
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function AnalysisTab() {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [funnels, setFunnels] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [funnelFilter, setFunnelFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [drill, setDrill] = useState<{ title: string; leads: Lead[] } | null>(null);
  const openDrill = (title: string, leads: Lead[]) => setDrill({ title, leads });

  const loadData = async () => {
    setLoading(true);
    try {
      // PostgREST limita 1000 linhas por request — pagina pra trazer tudo
      const fetchAll = async <T,>(table: string, select: string): Promise<T[]> => {
        const pageSize = 1000;
        let from = 0;
        const all: T[] = [];
        // safety cap 50k
        for (let i = 0; i < 50; i++) {
          const { data, error } = await supabase
            .from(table as any)
            .select(select)
            .order("created_at", { ascending: false })
            .range(from, from + pageSize - 1);
          if (error) throw error;
          const rows = (data ?? []) as T[];
          all.push(...rows);
          if (rows.length < pageSize) break;
          from += pageSize;
        }
        return all;
      };

      const cons = await fetchAll<any>(
        "consultations",
        "id, client_name, client_phone, status, converted, attended, disqualified, via, date, created_at, lead_score",
      );
      const fr = await fetchAll<any>("lead_form_responses", "*");

      // index forms by phone (last 8 digits) and consultation_id
      const formByConsultation = new Map<string, any>();
      const formByPhone = new Map<string, any>();
      for (const r of fr ?? []) {
        if (r.consultation_id) formByConsultation.set(r.consultation_id, r);
        const p = (r.telefone ?? "").replace(/[^0-9]/g, "");
        if (p.length >= 8) {
          const key = p.slice(-8);
          const prev = formByPhone.get(key);
          if (!prev || (r.created_at ?? "") > (prev.created_at ?? "")) {
            formByPhone.set(key, r);
          }
        }
      }

      const funnelSet = new Set<string>();
      const usedFormIds = new Set<string>();
      const out: Lead[] = (cons ?? []).map((c: any) => {
        if (c.via) funnelSet.add(c.via);
        let form = formByConsultation.get(c.id);
        if (!form) {
          const p = (c.client_phone ?? "").replace(/[^0-9]/g, "");
          if (p.length >= 8) form = formByPhone.get(p.slice(-8));
        }
        if (form) usedFormIds.add(form.id);
        const score = form?.score ?? c.lead_score ?? null;
        return {
          id: c.id,
          nome: c.client_name ?? null,
          telefone: c.client_phone ?? null,
          p1_objetivo: form?.p1_objetivo ?? null,
          p2_situacao: form?.p2_situacao ?? null,
          p3_profissao: form?.p3_profissao ?? null,
          p4_altura: form?.p4_altura ?? null,
          p4_peso: form?.p4_peso ?? null,
          p4_idade: form?.p4_idade ?? null,
          p5_estrategias: form?.p5_estrategias ?? null,
          p6_caneta: form?.p6_caneta ?? null,
          p7_acompanhamento: form?.p7_acompanhamento ?? null,
          p8_investimento: form?.p8_investimento ?? null,
          p9_prioridade: form?.p9_prioridade ?? null,
          renda_mensal: form?.renda_mensal ?? null,
          score,
          nivel: scoreToNivel(score),
          via: c.via ?? null,
          status_label: getStatusLabel(c),
          attended: c.attended,
          converted: c.converted,
          disqualified: c.disqualified,
          date: c.date,
          created_at: c.created_at,
          has_form: !!form,
        };
      });

      // Also include form responses that are NOT linked to any consultation yet
      for (const r of fr ?? []) {
        if (usedFormIds.has(r.id)) continue;
        const utmFunnel = r.utm_source ?? null;
        if (utmFunnel) funnelSet.add(utmFunnel);
        out.push({
          id: `form-${r.id}`,
          nome: r.nome ?? null,
          telefone: r.telefone ?? null,
          p1_objetivo: r.p1_objetivo ?? null,
          p2_situacao: r.p2_situacao ?? null,
          p3_profissao: r.p3_profissao ?? null,
          p4_altura: r.p4_altura ?? null,
          p4_peso: r.p4_peso ?? null,
          p4_idade: r.p4_idade ?? null,
          p5_estrategias: r.p5_estrategias ?? null,
          p6_caneta: r.p6_caneta ?? null,
          p7_acompanhamento: r.p7_acompanhamento ?? null,
          p8_investimento: r.p8_investimento ?? null,
          p9_prioridade: r.p9_prioridade ?? null,
          renda_mensal: r.renda_mensal ?? null,
          score: r.score ?? null,
          nivel: scoreToNivel(r.score ?? null),
          via: utmFunnel,
          status_label: "sem_status",
          attended: null,
          converted: null,
          disqualified: null,
          date: (r.created_at ?? "").slice(0, 10),
          created_at: r.created_at,
          has_form: true,
        });
      }

      setLeads(out);
      setFunnels(Array.from(funnelSet).sort());
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Date-filtered base — TODAS as consultas + form responses no período
  // (NÃO filtra por has_form, senão perdemos as consultas sem formulário vinculado)
  const inPeriod = useMemo(() => {
    const fromStr = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null;
    const toStr = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : fromStr;
    return leads.filter((l) => {
      if (fromStr && l.date < fromStr) return false;
      if (toStr && l.date > toStr) return false;
      if (funnelFilter !== "all" && (l.via ?? "") !== funnelFilter) return false;
      if (levelFilter !== "all" && l.nivel !== levelFilter) return false;
      return true;
    });
  }, [leads, dateRange, funnelFilter, levelFilter]);

  // Status-filtered group (the "selected group" for distribution analysis)
  const selectedGroup = useMemo(() => {
    if (statusFilter === "all") return inPeriod;
    return inPeriod.filter((l) => l.status_label === statusFilter);
  }, [inPeriod, statusFilter]);

  // Convertidas vs Não Convertidas (always from inPeriod, ignoring statusFilter)
  const convertidas = useMemo(() => inPeriod.filter((l) => l.status_label === "convertida"), [inPeriod]);
  const naoConvertidas = useMemo(
    () => inPeriod.filter((l) => ["nao_convertida", "no_show", "desqualificada"].includes(l.status_label)),
    [inPeriod],
  );
  const feitas = useMemo(() => inPeriod.filter((l) => l.attended === true).length, [inPeriod]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const groupHasForm = selectedGroup.filter((l) => l.has_form).length;

  return (
    <div className="space-y-6">
      {/* ===== Filters ===== */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <DateFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={funnelFilter} onValueChange={setFunnelFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Funil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os funis</SelectItem>
                {funnels.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Nível" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os níveis</SelectItem>
                <SelectItem value="A">A (≥65 pts)</SelectItem>
                <SelectItem value="B">B (50-64 pts)</SelectItem>
                <SelectItem value="C">C (41-49 pts)</SelectItem>
                <SelectItem value="D">D (35-40 pts)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            Período: <strong className="text-foreground">{inPeriod.length}</strong> leads • Feitas: <strong className="text-foreground">{feitas}</strong> • Convertidas: <strong className="text-foreground">{convertidas.length}</strong> ({pct(convertidas.length, feitas)}% das feitas)
            {statusFilter !== "all" && (
              <> • Grupo selecionado (<strong className="text-foreground">{STATUS_LABELS[statusFilter]}</strong>): <strong className="text-foreground">{selectedGroup.length}</strong> leads</>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== Conversão por funil (denominador = feitas) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conversão por funil</CardTitle>
            <p className="text-xs text-muted-foreground">Convertidas / consultas feitas no funil</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <FunnelBreakdown leads={inPeriod} onSelect={openDrill} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição por nível</CardTitle>
            <p className="text-xs text-muted-foreground">Quantos leads em cada faixa de score e taxa de conversão</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <LevelBreakdown leads={inPeriod} onSelect={openDrill} />
          </CardContent>
        </Card>
      </div>

      {/* ===== Distribuição P1-P9 do grupo selecionado ===== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Padrões do grupo: <span className="text-primary">{STATUS_LABELS[statusFilter]}</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {selectedGroup.length} leads no grupo • {groupHasForm} responderam o formulário
          </p>
        </CardHeader>
        <CardContent>
          {groupHasForm === 0 ? (
            <div className="text-sm text-muted-foreground bg-muted/40 rounded p-4 text-center">
              Nenhum lead deste grupo respondeu o formulário ainda.
              <br />
              <span className="text-xs">As respostas P1–P9 só aparecem quando o formulário do novaav começar a enviar dados para esta base (ou quando você vincular telefones manualmente).</span>
            </div>
          ) : (
            <div className="space-y-4">
              <P4Stats group={selectedGroup} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {QUESTIONS.map((q) => (
                  <QuestionDistribution key={q.key} q={q} group={selectedGroup} onSelect={openDrill} />
                ))}
                <TextQuestionDistribution label="P2 — Situação atual" field="p2_situacao" group={selectedGroup} onSelect={openDrill} />
                <TextQuestionDistribution label="P3 — Profissão" field="p3_profissao" group={selectedGroup} onSelect={openDrill} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Sempre visível: Convertidas vs Não Convertidas ===== */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Convertidas vs Não Convertidas (sempre)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Comparação fixa no período: {convertidas.length} convertidas vs {naoConvertidas.length} não convertidas
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <CompareBlock convertidas={convertidas} naoConvertidas={naoConvertidas} onSelect={openDrill} />
        </CardContent>
      </Card>

      {/* ===== Inteligência de Conversão (DDD + Perfil do formulário) ===== */}
      <ConversionIntelligence leads={inPeriod} />

      <LeadsDrillSheet drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

// ===== Helpers UI =====
function BarRow({ label, count, total, color = "primary", onClick }: { label: string; count: number; total: number; color?: "primary" | "success" | "warning"; onClick?: () => void }) {
  const p = pct(count, total);
  const colorClass = color === "success" ? "bg-success" : color === "warning" ? "bg-warning" : "bg-primary";
  const clickable = !!onClick && count > 0;
  return (
    <div
      className={`space-y-1 ${clickable ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground truncate pr-2">{label}</span>
        <span className="text-muted-foreground tabular-nums">{count} ({p}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function FunnelBreakdown({ leads, onSelect }: { leads: Lead[]; onSelect: (title: string, leads: Lead[]) => void }) {
  const map = new Map<string, { feitas: Lead[]; conv: Lead[] }>();
  for (const l of leads) {
    const f = l.via;
    if (!f) continue;
    const cur = map.get(f) ?? { feitas: [], conv: [] };
    if (l.attended === true) cur.feitas.push(l);
    if (l.converted === true) cur.conv.push(l);
    map.set(f, cur);
  }
  const rows = Array.from(map.entries())
    .map(([f, v]) => ({ f, feitas: v.feitas, conv: v.conv, rate: pct(v.conv.length, v.feitas.length) }))
    .sort((a, b) => b.feitas.length - a.feitas.length);

  if (rows.every((r) => r.feitas.length === 0 && r.conv.length === 0)) {
    return <p className="text-xs text-muted-foreground">Sem dados.</p>;
  }

  return (
    <>
      {rows.map((r) => (
        <div
          key={r.f}
          className="space-y-1 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => onSelect(`Funil ${r.f} — convertidas (${r.conv.length}) de ${r.feitas.length} feitas`, r.feitas)}
          role="button"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{r.f}</span>
            <span className="text-muted-foreground tabular-nums">
              {r.conv.length}/{r.feitas.length} feitas • <strong className="text-foreground">{r.rate}%</strong>
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${r.rate}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

function LevelBreakdown({ leads, onSelect }: { leads: Lead[]; onSelect: (title: string, leads: Lead[]) => void }) {
  const levels = ["A", "B", "C", "D"];
  const total = leads.length;
  return (
    <>
      {levels.map((lvl) => {
        const inLvl = leads.filter((l) => l.nivel === lvl);
        const conv = inLvl.filter((l) => l.converted === true).length;
        const feitas = inLvl.filter((l) => l.attended === true).length;
        const rate = pct(conv, feitas);
        return (
          <div
            key={lvl}
            className="space-y-1 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onSelect(`Nível ${lvl} — ${inLvl.length} leads`, inLvl)}
            role="button"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{lvl === "—" ? "Sem score" : `Nível ${lvl}`}</span>
              <span className="text-muted-foreground tabular-nums">
                {inLvl.length} leads • {conv}/{feitas} feitas conv. ({rate}%)
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${pct(inLvl.length, total)}%` }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

function QuestionDistribution({ q, group, onSelect }: { q: typeof QUESTIONS[number]; group: Lead[]; onSelect: (title: string, leads: Lead[]) => void }) {
  const counts = countBy(group, (l) => (l as any)[q.key] as string | null);
  const totalAnswered = Array.from(counts.values()).reduce((s, n) => s + n, 0);
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const topPct = top ? pct(top[1], totalAnswered) : 0;
  const isStrong = topPct > 50;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{q.label}</CardTitle>
          {isStrong && <Badge className="bg-success text-success-foreground">Padrão forte</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{totalAnswered} respostas</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {totalAnswered === 0 ? (
          <p className="text-xs text-muted-foreground">Sem respostas neste grupo.</p>
        ) : (
          Object.entries(q.options).map(([k, label]) => {
            const matched = group.filter((l) => (l as any)[q.key] === k);
            return (
              <BarRow
                key={k}
                label={label}
                count={counts.get(k) ?? 0}
                total={totalAnswered}
                onClick={() => onSelect(`${q.label} → ${label} (${matched.length} leads)`, matched)}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function P4Stats({ group }: { group: Lead[] }) {
  const withData = group.filter((l) => l.p4_peso !== null || l.p4_altura !== null || l.p4_idade !== null);
  if (withData.length === 0) return null;
  const avg = (key: "p4_peso" | "p4_altura" | "p4_idade") => {
    const vals = group.map((l) => l[key]).filter((v): v is number => v !== null && v !== undefined);
    return vals.length ? Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 10) / 10 : null;
  };
  const peso = avg("p4_peso");
  const altura = avg("p4_altura");
  const idade = avg("p4_idade");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">P4 — Perfil físico (médias)</CardTitle>
        <p className="text-xs text-muted-foreground">{withData.length} leads com dados</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-xl font-bold">{peso ?? "—"}<span className="text-xs text-muted-foreground"> kg</span></div><div className="text-xs text-muted-foreground">Peso médio</div></div>
          <div><div className="text-xl font-bold">{altura ?? "—"}<span className="text-xs text-muted-foreground"> m</span></div><div className="text-xs text-muted-foreground">Altura média</div></div>
          <div><div className="text-xl font-bold">{idade ?? "—"}<span className="text-xs text-muted-foreground"> anos</span></div><div className="text-xs text-muted-foreground">Idade média</div></div>
        </div>
      </CardContent>
    </Card>
  );
}

function TextQuestionDistribution({ label, field, group, onSelect }: { label: string; field: "p2_situacao" | "p3_profissao"; group: Lead[]; onSelect: (title: string, leads: Lead[]) => void }) {
  const counts = new Map<string, { count: number; raw: string }>();
  for (const l of group) {
    const norm = normalizeText(l[field] as string | null);
    if (!norm) continue;
    const prev = counts.get(norm);
    if (prev) prev.count += 1;
    else counts.set(norm, { count: 1, raw: (l[field] as string).trim() });
  }
  const total = Array.from(counts.values()).reduce((s, v) => s + v.count, 0);
  const rows = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        <p className="text-xs text-muted-foreground">{total} respostas</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem respostas neste grupo.</p>
        ) : (
          rows.map(([norm, v]) => {
            const matched = group.filter((l) => normalizeText(l[field] as string | null) === norm);
            return (
              <BarRow
                key={norm}
                label={v.raw}
                count={v.count}
                total={total}
                onClick={() => onSelect(`${label} → ${v.raw} (${matched.length} leads)`, matched)}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function CompareBlock({ convertidas, naoConvertidas, onSelect }: { convertidas: Lead[]; naoConvertidas: Lead[]; onSelect: (title: string, leads: Lead[]) => void }) {
  const tA = convertidas.length;
  const tB = naoConvertidas.length;
  const formA = convertidas.filter((l) => l.has_form).length;
  const formB = naoConvertidas.filter((l) => l.has_form).length;

  const avgScore = (arr: Lead[]) => {
    const withScore = arr.filter((l) => l.score !== null);
    return withScore.length ? Math.round(withScore.reduce((s, l) => s + (l.score ?? 0), 0) / withScore.length) : 0;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div
          className="text-center p-3 rounded-lg bg-success/10 border border-success/30 cursor-pointer hover:bg-success/15 transition-colors"
          onClick={() => onSelect(`Convertidas (${convertidas.length})`, convertidas)}
          role="button"
        >
          <div className="text-2xl font-bold text-success">{avgScore(convertidas)}</div>
          <div className="text-xs text-muted-foreground">Score médio convertidas</div>
        </div>
        <div
          className="text-center p-3 rounded-lg bg-destructive/10 border border-destructive/30 cursor-pointer hover:bg-destructive/15 transition-colors"
          onClick={() => onSelect(`Não convertidas (${naoConvertidas.length})`, naoConvertidas)}
          role="button"
        >
          <div className="text-2xl font-bold text-destructive">{avgScore(naoConvertidas)}</div>
          <div className="text-xs text-muted-foreground">Score médio não convertidas</div>
        </div>
      </div>

      {formA + formB === 0 ? (
        <p className="text-xs text-muted-foreground text-center">Sem respostas de formulário para comparar P1–P9.</p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Convertidas com form: {formA}/{tA} • Não convertidas com form: {formB}/{tB}
          </div>
          {QUESTIONS.map((q) => {
            const cA = countBy(convertidas, (l) => (l as any)[q.key] as string | null);
            const cB = countBy(naoConvertidas, (l) => (l as any)[q.key] as string | null);
            const totA = Array.from(cA.values()).reduce((s, n) => s + n, 0);
            const totB = Array.from(cB.values()).reduce((s, n) => s + n, 0);
            const topA = Array.from(cA.entries()).sort((a, b) => b[1] - a[1])[0];
            const topB = Array.from(cB.entries()).sort((a, b) => b[1] - a[1])[0];
            const labelA = topA ? `${q.options[topA[0]] ?? topA[0]} (${pct(topA[1], totA)}%)` : "—";
            const labelB = topB ? `${q.options[topB[0]] ?? topB[0]} (${pct(topB[1], totB)}%)` : "—";
            const divergent = topA && topB && topA[0] !== topB[0];
            const matchedA = topA ? convertidas.filter((l) => (l as any)[q.key] === topA[0]) : [];
            const matchedB = topB ? naoConvertidas.filter((l) => (l as any)[q.key] === topB[0]) : [];
            return (
              <div key={q.key} className="grid grid-cols-3 gap-2 text-xs items-center border-b pb-2">
                <div className="font-medium">{q.label}</div>
                <div
                  className={`text-success ${matchedA.length > 0 ? "cursor-pointer hover:underline" : ""}`}
                  onClick={() => matchedA.length > 0 && onSelect(`Convertidas → ${q.label}: ${labelA}`, matchedA)}
                >
                  {labelA}
                </div>
                <div className="text-destructive flex items-center gap-2">
                  <span
                    className={matchedB.length > 0 ? "cursor-pointer hover:underline" : ""}
                    onClick={() => matchedB.length > 0 && onSelect(`Não convertidas → ${q.label}: ${labelB}`, matchedB)}
                  >
                    {labelB}
                  </span>
                  {divergent && <Badge variant="destructive" className="text-[10px]">Divergência</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeadsDrillSheet({ drill, onClose }: { drill: { title: string; leads: Lead[] } | null; onClose: () => void }) {
  const [selected, setSelected] = useState<{ nome: string; telefone: string | null } | null>(null);
  return (
    <>
    <LeadFormResponsesDialog
      open={!!selected}
      onOpenChange={(o) => !o && setSelected(null)}
      clientName={selected?.nome ?? ""}
      clientPhone={selected?.telefone ?? null}
    />
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{drill?.title}</SheetTitle>
          <SheetDescription>
            {drill?.leads.length ?? 0} lead(s) — clique no nome para ir até o WhatsApp ou copie o telefone.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {drill && drill.leads.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Funil</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drill.leads
                  .slice()
                  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
                  .map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-primary hover:underline text-left"
                          onClick={() => setSelected({ nome: l.nome ?? "—", telefone: l.telefone ?? null })}
                        >
                          {l.nome ?? "—"}
                        </button>
                      </TableCell>
                      <TableCell className="tabular-nums">{l.telefone ?? "—"}</TableCell>
                      <TableCell className="text-xs">{l.via ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {l.nivel} {l.score !== null ? `(${l.score})` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{STATUS_LABELS[l.status_label] ?? l.status_label}</TableCell>
                      <TableCell className="text-xs tabular-nums">{l.date ?? "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}
