import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Lead shape (subset of AnalysisTab.Lead) — kept loose to avoid coupling
export interface CILead {
  id: string;
  telefone: string | null;
  converted: boolean | null;
  attended: boolean | null;
  disqualified: boolean | null;
  has_form: boolean;
  p1_objetivo: string | null;
  p5_estrategias: string | null;
  p6_caneta: string | null;
  p7_acompanhamento: string | null;
  p8_investimento: string | null;
  p9_prioridade: string | null;
  renda_mensal: string | null;
}

type Filter = "todas" | "convertidas" | "nao_convertidas";

// ===== DDD mapping =====
const DDD_MAP: Record<string, { uf: string; regiao: string }> = {};
const add = (regiao: string, items: Record<string, string[]>) => {
  for (const [uf, ddds] of Object.entries(items)) {
    for (const d of ddds) DDD_MAP[d] = { uf, regiao };
  }
};
add("Sudeste", {
  SP: ["11", "12", "13", "14", "15", "16", "17", "18", "19"],
  RJ: ["21", "22", "24"],
  ES: ["27", "28"],
  MG: ["31", "32", "33", "34", "35", "37", "38"],
});
add("Sul", {
  PR: ["41", "42", "43", "44", "45", "46"],
  SC: ["47", "48", "49"],
  RS: ["51", "53", "54", "55"],
});
add("Centro-Oeste", {
  "GO/DF": ["61", "62", "64"],
  MT: ["65", "66"],
  MS: ["67"],
});
add("Norte", {
  TO: ["63"], AC: ["68"], RO: ["69"], AM: ["92", "97"],
  PA: ["91", "93", "94"], AP: ["96"], RR: ["95"],
});
add("Nordeste", {
  BA: ["71", "73", "74", "75", "77"], SE: ["79"], AL: ["82"],
  PE: ["81", "87"], PB: ["83"], RN: ["84"],
  CE: ["85", "88"], PI: ["86", "89"], MA: ["98", "99"],
});

const REGIOES = ["Sudeste", "Sul", "Centro-Oeste", "Norte", "Nordeste"];

function extractDDD(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("55") && digits.length > 10) digits = digits.slice(2);
  if (digits.length < 10) return null;
  return digits.slice(0, 2);
}

function rateColor(rate: number): { bg: string; border: string; text: string } {
  if (rate >= 30) return { bg: "bg-success/10", border: "border-success/40", text: "text-success" };
  if (rate >= 15) return { bg: "bg-warning/10", border: "border-warning/40", text: "text-warning" };
  return { bg: "bg-destructive/10", border: "border-destructive/40", text: "text-destructive" };
}

const QUESTIONS = [
  {
    key: "p1_objetivo",
    label: "P1 — Objetivo principal",
    options: {
      emagrecer: "Apenas emagrecer",
      perder_gordura_definir: "Perder gordura e definir",
      definido_slim: "Corpo definido e slim",
      volume_muscular: "Ganhar volume muscular",
    } as Record<string, string>,
  },
  {
    key: "p5_estrategias",
    label: "P5 — Estratégias anteriores",
    options: {
      nao_entregam: "Não entregam resultado",
      demoro_muito: "Vou demorar muito",
      consigo_resultado: "Consigo o resultado",
    } as Record<string, string>,
  },
  {
    key: "p6_caneta",
    label: "P6 — Caneta emagrecedora",
    options: {
      uso_atual: "Faço uso atualmente",
      ja_usei: "Já usei, mas parei",
      nunca_usei: "Nunca usei",
    } as Record<string, string>,
  },
  {
    key: "p7_acompanhamento",
    label: "P7 — Acompanhamento profissional",
    options: {
      nutricional: "Nutricional",
      treino: "Treino",
      ambos: "Os dois",
      nunca: "Nunca tive",
    } as Record<string, string>,
  },
  {
    key: "p8_investimento",
    label: "P8 — Quanto já investiu/mês",
    options: {
      abaixo_100: "Abaixo de R$100",
      "100_250": "R$100 - 250",
      "250_400": "R$250 - 400",
      "400_600": "R$400 - 600",
      "600_1000": "R$600 - 1000",
      acima_1000: "Acima de R$1000",
    } as Record<string, string>,
  },
  {
    key: "p9_prioridade",
    label: "P9 — Prioridade para começar",
    options: {
      imediato: "Imediatamente",
      futuramente: "Futuramente",
      pensar: "Ainda preciso pensar",
    } as Record<string, string>,
  },
  {
    key: "renda_mensal",
    label: "P10 — Renda mensal",
    options: {
      ate_2k: "Até R$2.000",
      "2k_4k": "R$2.000 - R$4.000",
      "5k_8k": "R$5.000 - R$8.000",
      "9k_15k": "R$9.000 - R$15.000",
      acima_15k: "Acima de R$15.000",
    } as Record<string, string>,
  },
] as const;

function HBar({ label, count, total }: { label: string; count: number; total: number }) {
  const p = total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground truncate pr-2">{label}</span>
        <span className="text-muted-foreground tabular-nums">{p}% ({count})</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function ConversionIntelligence({ leads }: { leads: CILead[] }) {
  const [filter, setFilter] = useState<Filter>("todas");

  // Only real consultations (exclude form-only rows that AnalysisTab adds with id "form-…")
  const consultations = useMemo(
    () => leads.filter((l) => !l.id.startsWith("form-")),
    [leads],
  );

  const filtered = useMemo(() => {
    if (filter === "convertidas") return consultations.filter((l) => l.converted === true);
    if (filter === "nao_convertidas")
      return consultations.filter(
        (l) => l.converted === false && l.attended === true && l.disqualified !== true,
      );
    return consultations;
  }, [consultations, filter]);

  // ===== Bloco 1: por região / DDD (sempre baseado em "consultations", mas conversões usam filtro semântico fixo) =====
  // O filtro global afeta o universo de análise → recomputamos contagens sobre filtered
  // Para % de conversão, contamos "convertidas dentro do conjunto filtrado" / total filtrado
  const regiaoStats = useMemo(() => {
    const map = new Map<string, { total: number; conv: number }>();
    for (const r of REGIOES) map.set(r, { total: 0, conv: 0 });
    for (const l of filtered) {
      const ddd = extractDDD(l.telefone);
      const info = ddd ? DDD_MAP[ddd] : null;
      if (!info) continue;
      const cur = map.get(info.regiao)!;
      cur.total += 1;
      if (l.converted === true) cur.conv += 1;
    }
    return map;
  }, [filtered]);

  const dddStats = useMemo(() => {
    const map = new Map<string, { uf: string; regiao: string; total: number; conv: number }>();
    for (const l of filtered) {
      const ddd = extractDDD(l.telefone);
      if (!ddd) continue;
      const info = DDD_MAP[ddd];
      if (!info) continue;
      const cur = map.get(ddd) ?? { uf: info.uf, regiao: info.regiao, total: 0, conv: 0 };
      cur.total += 1;
      if (l.converted === true) cur.conv += 1;
      map.set(ddd, cur);
    }
    return Array.from(map.entries())
      .map(([ddd, v]) => ({
        ddd,
        ...v,
        rate: v.total === 0 ? 0 : (v.conv / v.total) * 100,
      }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total);
  }, [filtered]);

  // ===== Bloco 2: perfil do formulário =====
  const withForm = useMemo(() => filtered.filter((l) => l.has_form), [filtered]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Inteligência de Conversão</CardTitle>
            <p className="text-xs text-muted-foreground">
              Cruzamento de região (DDD) e respostas do formulário com o resultado da consulta.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border bg-muted/30 p-1">
            {([
              { v: "todas", l: "Todas" },
              { v: "convertidas", l: "Convertidas" },
              { v: "nao_convertidas", l: "Não convertidas" },
            ] as { v: Filter; l: string }[]).map((opt) => (
              <Button
                key={opt.v}
                size="sm"
                variant={filter === opt.v ? "default" : "ghost"}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setFilter(opt.v)}
              >
                {opt.l}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* ===== BLOCO 1 — Perfil do Formulário (movido para o topo) ===== */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Perfil das Respostas do Formulário</h3>
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">{withForm.length}</strong> de{" "}
              <strong className="text-foreground">{filtered.length}</strong> consultas com formulário vinculado
            </p>
          </div>

          {withForm.length === 0 ? (
            <div className="text-sm text-muted-foreground bg-muted/40 rounded p-4 text-center">
              Nenhuma consulta deste grupo tem formulário vinculado.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {QUESTIONS.map((q) => {
                const answered = withForm.filter((l) => (l as any)[q.key]);
                const total = answered.length;
                return (
                  <Card key={q.key}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{q.label}</CardTitle>
                      <p className="text-xs text-muted-foreground">{total} respostas</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {total === 0 ? (
                        <p className="text-xs text-muted-foreground">Sem respostas.</p>
                      ) : (
                        Object.entries(q.options).map(([k, label]) => {
                          const count = answered.filter((l) => (l as any)[q.key] === k).length;
                          return <HBar key={k} label={label} count={count} total={total} />;
                        })
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ===== BLOCO 2 — DDD / Região ===== */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Análise por DDD / Região</h3>
            <p className="text-xs text-muted-foreground">
              {filtered.length} consultas no grupo selecionado • cores: verde ≥ 30%, amarelo 15–30%, vermelho &lt; 15%
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {REGIOES.map((r) => {
              const s = regiaoStats.get(r)!;
              const rate = s.total === 0 ? 0 : Math.round((s.conv / s.total) * 1000) / 10;
              const c = rateColor(rate);
              return (
                <div key={r} className={`rounded-lg border p-3 ${c.bg} ${c.border}`}>
                  <div className="text-xs font-medium text-muted-foreground">{r}</div>
                  <div className={`text-2xl font-bold ${c.text}`}>{rate}%</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {s.conv} conv / {s.total} consultas
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DDD</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Região</TableHead>
                  <TableHead className="text-right">Consultas</TableHead>
                  <TableHead className="text-right">Convertidas</TableHead>
                  <TableHead className="text-right">% Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dddStats.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      Sem dados com DDD válido neste grupo.
                    </TableCell>
                  </TableRow>
                ) : (
                  dddStats.map((row) => {
                    const c = rateColor(row.rate);
                    return (
                      <TableRow key={row.ddd}>
                        <TableCell className="font-mono">{row.ddd}</TableCell>
                        <TableCell>{row.uf}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.regiao}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.conv}</TableCell>
                        <TableCell className={`text-right tabular-nums font-medium ${c.text}`}>
                          {Math.round(row.rate * 10) / 10}%
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
