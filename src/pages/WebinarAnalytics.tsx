import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { ChevronLeft, Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Version = "all" | "venda" | "avaliacao";
type Preset = "today" | "7d" | "30d" | "custom";

interface Row {
  id: string;
  session_id: string;
  url_version: "venda" | "avaliacao";
  entered_at: string;
  video_watched_seconds: number;
  clicked_cta: boolean;
}

const VENDA = "#00ff00";
const AVAL = "#FFD700";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function fmtDate(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMin(s: number) {
  if (!s) return "0min";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}min${sec > 0 ? ` ${sec}s` : ""}`;
}
function pct(n: number) {
  return `${n.toFixed(1)}%`;
}
function variation(curr: number, prev: number) {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / prev) * 100;
}

export default function WebinarAnalytics() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [version, setVersion] = useState<Version>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [prevRows, setPrevRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillDay, setDrillDay] = useState<{ day: string; rows: Row[] } | null>(null);

  const { start, end } = useMemo(() => {
    const now = new Date();
    if (preset === "today") return { start: startOfDay(now), end: endOfDay(now) };
    if (preset === "7d") {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    if (preset === "30d") {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    // custom
    const s = customStart ? new Date(customStart) : new Date(now);
    const e = customEnd ? new Date(customEnd) : new Date(now);
    return { start: startOfDay(s), end: endOfDay(e) };
  }, [preset, customStart, customEnd]);

  // Previous comparable period
  const { prevStart, prevEnd } = useMemo(() => {
    const span = end.getTime() - start.getTime();
    const pe = new Date(start.getTime() - 1);
    const ps = new Date(pe.getTime() - span);
    return { prevStart: ps, prevEnd: pe };
  }, [start, end]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const fetchRange = async (s: Date, e: Date) => {
        let q = supabase
          .from("webinar_analytics")
          .select("id, session_id, url_version, entered_at, video_watched_seconds, clicked_cta")
          .gte("entered_at", s.toISOString())
          .lte("entered_at", e.toISOString())
          .order("entered_at", { ascending: false })
          .limit(5000);
        if (version !== "all") q = q.eq("url_version", version);
        const { data, error } = await q;
        if (error) {
          console.warn("[analytics] fetch", error.message);
          return [] as Row[];
        }
        return (data ?? []) as Row[];
      };
      const [curr, prev] = await Promise.all([
        fetchRange(start, end),
        fetchRange(prevStart, prevEnd),
      ]);
      if (cancelled) return;
      setRows(curr);
      setPrevRows(prev);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end, prevStart, prevEnd, version]);

  // ------- Aggregations -------
  const kpis = useMemo(() => {
    const computeKpis = (rs: Row[]) => {
      const acessos = rs.length;
      const tempoMedio = acessos === 0 ? 0 : rs.reduce((a, r) => a + (r.video_watched_seconds || 0), 0) / acessos;
      const cliques = rs.filter((r) => r.clicked_cta).length;
      const taxaCTA = acessos === 0 ? 0 : (cliques / acessos) * 100;
      return { acessos, tempoMedio, cliques, taxaCTA };
    };
    const curr = computeKpis(rows);
    const prev = computeKpis(prevRows);
    return {
      curr,
      prev,
      varAcessos: variation(curr.acessos, prev.acessos),
      varTempo: variation(curr.tempoMedio, prev.tempoMedio),
      varTaxa: variation(curr.taxaCTA, prev.taxaCTA),
      varCliques: variation(curr.cliques, prev.cliques),
    };
  }, [rows, prevRows]);

  const versionStats = useMemo(() => {
    const split = (v: "venda" | "avaliacao") => {
      const rs = rows.filter((r) => r.url_version === v);
      const acessos = rs.length;
      const tempoMedio = acessos === 0 ? 0 : rs.reduce((a, r) => a + (r.video_watched_seconds || 0), 0) / acessos;
      const cliques = rs.filter((r) => r.clicked_cta).length;
      const taxaCTA = acessos === 0 ? 0 : (cliques / acessos) * 100;
      return { acessos, tempoMedio, cliques, taxaCTA };
    };
    return { venda: split("venda"), avaliacao: split("avaliacao") };
  }, [rows]);

  const champion: "venda" | "avaliacao" | null = useMemo(() => {
    const v = versionStats.venda.taxaCTA;
    const a = versionStats.avaliacao.taxaCTA;
    if (versionStats.venda.acessos === 0 && versionStats.avaliacao.acessos === 0) return null;
    return a > v ? "avaliacao" : "venda";
  }, [versionStats]);

  // Series por dia (linha)
  const lineData = useMemo(() => {
    const days: { key: string; label: string; venda: number; avaliacao: number }[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      days.push({ key, label: fmtDate(cursor), venda: 0, avaliacao: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    const idx = new Map(days.map((d) => [d.key, d]));
    rows.forEach((r) => {
      const k = new Date(r.entered_at).toISOString().slice(0, 10);
      const slot = idx.get(k);
      if (!slot) return;
      if (r.url_version === "venda") slot.venda += 1;
      else slot.avaliacao += 1;
    });
    return days;
  }, [rows, start, end]);

  // Distribuição tempo assistido
  const distribution = useMemo(() => {
    const buckets = [
      { label: "0-5min", max: 300, qtd: 0 },
      { label: "5-10min", max: 600, qtd: 0 },
      { label: "10-20min", max: 1200, qtd: 0 },
      { label: "20-40min", max: 2400, qtd: 0 },
      { label: "40min+", max: Infinity, qtd: 0 },
    ];
    rows.forEach((r) => {
      const s = r.video_watched_seconds || 0;
      const b = buckets.find((x) => s < x.max);
      if (b) b.qtd += 1;
    });
    const total = rows.length || 1;
    return buckets.map((b) => ({ ...b, pct: (b.qtd / total) * 100 }));
  }, [rows]);

  // Tabela diária
  const dailyTable = useMemo(() => {
    const map = new Map<string, { day: string; venda: Row[]; avaliacao: Row[] }>();
    rows.forEach((r) => {
      const k = new Date(r.entered_at).toISOString().slice(0, 10);
      if (!map.has(k)) map.set(k, { day: k, venda: [], avaliacao: [] });
      map.get(k)![r.url_version].push(r);
    });
    const entries: {
      day: string;
      version: "venda" | "avaliacao";
      acessos: number;
      tempoMedio: number;
      taxaCTA: number;
      cliques: number;
      best: boolean;
      rows: Row[];
    }[] = [];
    map.forEach(({ day, venda, avaliacao }) => {
      (["venda", "avaliacao"] as const).forEach((v) => {
        const rs = v === "venda" ? venda : avaliacao;
        if (rs.length === 0) return;
        const tempoMedio = rs.reduce((a, r) => a + (r.video_watched_seconds || 0), 0) / rs.length;
        const cliques = rs.filter((r) => r.clicked_cta).length;
        entries.push({
          day,
          version: v,
          acessos: rs.length,
          tempoMedio,
          taxaCTA: (cliques / rs.length) * 100,
          cliques,
          best: false,
          rows: rs,
        });
      });
    });
    entries.sort((a, b) => (a.day < b.day ? 1 : -1));
    // marcar melhor por dia (maior taxaCTA)
    const byDay = new Map<string, number>();
    entries.forEach((e) => {
      const cur = byDay.get(e.day) ?? -1;
      if (e.taxaCTA > cur) byDay.set(e.day, e.taxaCTA);
    });
    entries.forEach((e) => {
      if ((byDay.get(e.day) ?? -1) === e.taxaCTA && e.acessos > 0) e.best = true;
    });
    return entries;
  }, [rows]);

  const insights = useMemo(() => {
    const list: { tone: "ok" | "warn" | "info"; msg: string }[] = [];
    if (lineData.length > 0) {
      const totals = lineData.map((d) => ({ label: d.label, total: d.venda + d.avaliacao }));
      const top = totals.reduce((a, b) => (b.total > a.total ? b : a), totals[0]);
      if (top.total > 0) list.push({ tone: "ok", msg: `Melhor dia: ${top.label} (${top.total} acessos)` });
    }
    if (versionStats.venda.acessos + versionStats.avaliacao.acessos > 0) {
      const winner = versionStats.avaliacao.taxaCTA > versionStats.venda.taxaCTA ? "Avaliação" : "Venda";
      const winnerTaxa = Math.max(versionStats.venda.taxaCTA, versionStats.avaliacao.taxaCTA);
      list.push({ tone: "ok", msg: `Melhor versão: ${winner} (${pct(winnerTaxa)} taxa CTA)` });
    }
    if (kpis.varTempo < -5) list.push({ tone: "warn", msg: `Tempo médio caindo ${pct(kpis.varTempo)} vs período anterior` });
    if (kpis.varAcessos > 5) list.push({ tone: "info", msg: `Tendência: acessos crescendo ${pct(kpis.varAcessos)} vs período anterior` });
    if (champion) list.push({ tone: "info", msg: `Recomendação: foco na versão ${champion === "venda" ? "Venda 🟢" : "Avaliação 🟡"}` });
    return list;
  }, [lineData, versionStats, kpis, champion]);

  // ------- Export -------
  const exportCSV = () => {
    const headers = ["data", "versao", "acessos", "tempo_medio_seg", "cliques_cta", "taxa_cta_pct"];
    const lines = [headers.join(",")];
    dailyTable.forEach((e) => {
      lines.push([
        e.day,
        e.version,
        e.acessos,
        Math.round(e.tempoMedio),
        e.cliques,
        e.taxaCTA.toFixed(2),
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webinar-analytics-${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    // Print-friendly: open browser print dialog (user can "save as PDF")
    window.print();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-[#262626] bg-[#0a0a0a]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <nav className="text-sm text-[#888]">
            <Link to="/" className="hover:text-white transition">Equipe</Link>
            <span className="mx-2 opacity-50">›</span>
            <Link to="/webinar" className="hover:text-white transition">Webinar</Link>
            <span className="mx-2 opacity-50">›</span>
            <span className="text-white font-medium">Analytics</span>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 border-[#262626] bg-transparent hover:bg-[#1a1a1a]">
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 border-[#262626] bg-transparent hover:bg-[#1a1a1a]">
              <FileDown className="h-4 w-4" /> PDF
            </Button>
            <Link to="/webinar">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Filters */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
            <h2 className="text-lg font-bold">📊 Webinar Analytics</h2>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              {(["today", "7d", "30d", "custom"] as Preset[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                    preset === p
                      ? "bg-white text-black border-white"
                      : "bg-transparent text-[#aaa] border-[#262626] hover:border-[#444]"
                  }`}
                >
                  {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "Personalizado"}
                </button>
              ))}
              {preset === "custom" && (
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1.5 text-white"
                  />
                  <span className="text-[#666]">até</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="bg-[#0a0a0a] border border-[#262626] rounded px-2 py-1.5 text-white"
                  />
                </div>
              )}
              <span className="w-px h-6 bg-[#262626] mx-1 hidden md:block" />
              {(["all", "venda", "avaliacao"] as Version[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVersion(v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                    version === v
                      ? "bg-white text-black border-white"
                      : "bg-transparent text-[#aaa] border-[#262626] hover:border-[#444]"
                  }`}
                >
                  {v === "all" ? "Todas" : v === "venda" ? "Venda" : "Avaliação"}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI title="👥 Acessos" value={String(kpis.curr.acessos)} variation={kpis.varAcessos} suffix="vs período anterior" />
          <KPI title="⏱️ Tempo médio" value={fmtMin(kpis.curr.tempoMedio)} variation={kpis.varTempo} suffix="vs período anterior" />
          <KPI title="🎯 Taxa CTA" value={pct(kpis.curr.taxaCTA)} variation={kpis.varTaxa} suffix="vs período anterior" />
          <KPI title="💰 Cliques CTA" value={String(kpis.curr.cliques)} variation={kpis.varCliques} suffix="vs período anterior" />
        </div>

        {/* Comparison */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-5">
            <h3 className="text-sm uppercase tracking-wider text-[#888] mb-4">Performance por versão</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <VersionBlock
                color={VENDA}
                label="🟢 Venda"
                stats={versionStats.venda}
                champion={champion === "venda"}
              />
              <VersionBlock
                color={AVAL}
                label="🟡 Avaliação"
                stats={versionStats.avaliacao}
                champion={champion === "avaliacao"}
              />
            </div>
            {champion && (
              <div className="mt-4 text-center text-sm text-[#aaa]">
                🏆 Campeão:{" "}
                <span className="font-bold" style={{ color: champion === "venda" ? VENDA : AVAL }}>
                  {champion === "venda" ? "Venda" : "Avaliação"}
                </span>{" "}
                (maior taxa de clique)
              </div>
            )}
          </CardContent>
        </Card>

        {/* Line chart */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-5">
            <h3 className="text-sm uppercase tracking-wider text-[#888] mb-4">Acessos ao longo do tempo</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={lineData}
                  onClick={(e: any) => {
                    const k = e?.activePayload?.[0]?.payload?.key;
                    if (!k) return;
                    const dayRows = rows.filter((r) => new Date(r.entered_at).toISOString().slice(0, 10) === k);
                    setDrillDay({ day: k, rows: dayRows });
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="label" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} allowDecimals={false} />
                  <RTooltip
                    contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", color: "#fff" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="venda" name="Venda" stroke={VENDA} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="avaliacao" name="Avaliação" stroke={AVAL} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Distribution */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-5">
            <h3 className="text-sm uppercase tracking-wider text-[#888] mb-4">Distribuição de tempo assistido</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis type="number" stroke="#888" fontSize={11} />
                  <YAxis type="category" dataKey="label" stroke="#888" fontSize={11} width={70} />
                  <RTooltip
                    contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", color: "#fff" }}
                    formatter={(_v: any, _n: any, p: any) => [`${p.payload.qtd} (${p.payload.pct.toFixed(1)}%)`, "Sessões"]}
                  />
                  <Bar dataKey="qtd" radius={[0, 4, 4, 0]}>
                    {distribution.map((_, i) => (
                      <Cell key={i} fill={i % 2 === 0 ? VENDA : AVAL} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Daily table */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-5">
            <h3 className="text-sm uppercase tracking-wider text-[#888] mb-4">Análise diária</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[#888] text-xs uppercase">
                  <tr className="border-b border-[#262626]">
                    <th className="text-left py-2 px-2">Data</th>
                    <th className="text-left py-2 px-2">Versão</th>
                    <th className="text-right py-2 px-2">Acessos</th>
                    <th className="text-right py-2 px-2">Tempo</th>
                    <th className="text-right py-2 px-2">Taxa CTA</th>
                    <th className="text-right py-2 px-2">Cliques</th>
                    <th className="text-right py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyTable.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[#666]">
                        Sem dados no período selecionado.
                      </td>
                    </tr>
                  )}
                  {dailyTable.map((e, i) => (
                    <tr
                      key={i}
                      onClick={() => setDrillDay({ day: e.day, rows: e.rows })}
                      className="border-b border-[#262626] hover:bg-[#222] cursor-pointer transition"
                    >
                      <td className="py-2 px-2">{fmtDate(new Date(e.day))}</td>
                      <td className="py-2 px-2">
                        <span style={{ color: e.version === "venda" ? VENDA : AVAL }}>
                          {e.version === "venda" ? "Venda" : "Avaliação"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{e.acessos}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtMin(e.tempoMedio)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{pct(e.taxaCTA)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{e.cliques}</td>
                      <td className="py-2 px-2 text-right">{e.best ? "🏆 Melhor" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Insights */}
        <Card className="bg-[#1a1a1a] border-[#262626]">
          <CardContent className="p-5">
            <h3 className="text-sm uppercase tracking-wider text-[#888] mb-4">💡 Insights e recomendações</h3>
            {insights.length === 0 && <p className="text-[#666] text-sm">Sem dados suficientes para gerar insights.</p>}
            <ul className="space-y-2 text-sm">
              {insights.map((i, idx) => (
                <li key={idx} className="flex gap-2">
                  <span>{i.tone === "ok" ? "✅" : i.tone === "warn" ? "⚠️" : "📈"}</span>
                  <span>{i.msg}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {loading && <p className="text-center text-[#666] text-sm">Carregando...</p>}
      </main>

      {/* Drill dialog */}
      <Dialog open={!!drillDay} onOpenChange={(o) => !o && setDrillDay(null)}>
        <DialogContent className="bg-[#0a0a0a] border-[#262626] text-white max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sessões em {drillDay ? fmtDate(new Date(drillDay.day)) : ""}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-[#888] uppercase">
                <tr className="border-b border-[#262626]">
                  <th className="text-left py-2 px-2">Hora</th>
                  <th className="text-left py-2 px-2">Versão</th>
                  <th className="text-left py-2 px-2">Sessão</th>
                  <th className="text-right py-2 px-2">Tempo</th>
                  <th className="text-right py-2 px-2">CTA</th>
                </tr>
              </thead>
              <tbody>
                {drillDay?.rows
                  .slice()
                  .sort((a, b) => (a.entered_at < b.entered_at ? 1 : -1))
                  .map((r) => (
                    <tr key={r.id} className="border-b border-[#262626]/60">
                      <td className="py-1.5 px-2 tabular-nums">
                        {new Date(r.entered_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-1.5 px-2" style={{ color: r.url_version === "venda" ? VENDA : AVAL }}>
                        {r.url_version}
                      </td>
                      <td className="py-1.5 px-2 font-mono text-[10px] text-[#888]">{r.session_id}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{fmtMin(r.video_watched_seconds)}</td>
                      <td className="py-1.5 px-2 text-right">{r.clicked_cta ? "✅" : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({
  title,
  value,
  variation,
  suffix,
}: {
  title: string;
  value: string;
  variation: number;
  suffix?: string;
}) {
  const positive = variation >= 0;
  return (
    <Card className="bg-[#1a1a1a] border-[#262626]">
      <CardContent className="p-4">
        <p className="text-xs text-[#888]">{title}</p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
        <p className={`text-xs mt-1 ${positive ? "text-[#00ff00]" : "text-red-400"}`}>
          {positive ? "+" : ""}
          {variation.toFixed(1)}% {suffix}
        </p>
      </CardContent>
    </Card>
  );
}

function VersionBlock({
  color,
  label,
  stats,
  champion,
}: {
  color: string;
  label: string;
  stats: { acessos: number; tempoMedio: number; cliques: number; taxaCTA: number };
  champion: boolean;
}) {
  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        borderColor: `${color}55`,
        background: `${color}0d`,
        boxShadow: champion ? `0 0 20px ${color}33` : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold" style={{ color }}>
          {label}
        </h4>
        {champion && <span className="text-xs">🏆</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Acessos" value={String(stats.acessos)} />
        <Stat label="Tempo médio" value={fmtMin(stats.tempoMedio)} />
        <Stat label="Taxa CTA" value={pct(stats.taxaCTA)} />
        <Stat label="Cliques CTA" value={String(stats.cliques)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-[#888]">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
