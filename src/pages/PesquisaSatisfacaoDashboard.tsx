import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { ArrowLeft, RefreshCw, MessageSquare, Copy, Check, ExternalLink, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  PesquisaResponse,
  ProdutoConfig,
  PRODUTOS,
  PRODUTOS_LISTA,
  PLANOS,
  TEMPO_PROGRAMA,
  INSTA_TIPOS,
  INSTA_FREQUENCIA,
  WPP_FREQUENCIA,
  COMERCIAL_PRESSAO,
  NPS_INDICOU,
  npsBucket,
} from "@/types/pesquisaSatisfacao";
import { linkPublico } from "@/lib/linkPublico";

const C = {
  bg: "#0a0a0a",
  card: "#131313",
  border: "#1f1f1f",
  text: "#e8e8e8",
  textDim: "#888",
  brand: "#ffc000",
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
};

const DONUT_PALETTE = [C.brand, "#fb923c", "#a78bfa", "#60a5fa", "#34d399", "#f472b6"];

function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "10px",
        padding: "20px",
      }}
    >
      {title && (
        <h3
          className="font-semibold mb-4"
          style={{ color: C.text, fontSize: "14px", letterSpacing: "0.02em" }}
        >
          {title.toUpperCase()}
        </h3>
      )}
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide" style={{ color: C.textDim }}>
        {label}
      </div>
      <div
        className="font-bold mt-2 tabular-nums"
        style={{ color: color || C.text, fontSize: "32px", lineHeight: 1 }}
      >
        {value}
      </div>
      {hint && (
        <div className="text-xs mt-2" style={{ color: C.textDim }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

interface NumDistroProps {
  values: number[];
  gradient?: boolean; // bar 0..10 com gradiente vermelho->verde se true
  color?: string;
}

function Distribuicao0a10({ values, gradient, color }: NumDistroProps) {
  const buckets = Array.from({ length: 11 }, (_, i) => ({
    nota: i,
    qtd: values.filter((v) => v === i).length,
  }));
  const colorFor = (n: number) => {
    if (!gradient) return color || C.brand;
    if (n <= 4) return C.red;
    if (n <= 7) return C.yellow;
    return C.green;
  };
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="nota" stroke={C.textDim} fontSize={12} />
        <YAxis allowDecimals={false} stroke={C.textDim} fontSize={12} />
        <RTooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="qtd" radius={[4, 4, 0, 0]}>
          {buckets.map((b) => (
            <Cell key={b.nota} fill={colorFor(b.nota)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface BarHProps {
  data: { label: string; valor: number }[];
  color?: string;
  height?: number;
  formatValor?: (n: number) => string;
}

function BarChartHorizontal({ data, color, height = 200, formatValor }: BarHProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
        <XAxis type="number" stroke={C.textDim} fontSize={12} />
        <YAxis type="category" dataKey="label" stroke={C.textDim} fontSize={12} width={130} />
        <RTooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(v: any) => [formatValor ? formatValor(Number(v)) : v, "valor"]}
        />
        <Bar dataKey="valor" fill={color || C.brand} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface DonutProps {
  data: { label: string; value: number }[];
  height?: number;
  colors?: string[];
}

function Donut({ data, height = 220, colors = DONUT_PALETTE }: DonutProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ color: C.textDim, height }}
      >
        Sem dados ainda
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={55}
          outerRadius={85}
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <RTooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
        />
        <Legend
          verticalAlign="bottom"
          wrapperStyle={{ color: C.text, fontSize: "12px" }}
          formatter={(v) => <span style={{ color: C.text }}>{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Chave de mensagem é por produto pra que MGMD e Elite possam ter copies
// diferentes editáveis pelo time, sem misturar.
const MENSAGEM_KEY_PREFIX = "pesquisa-convite-mensagem-v2-";
const mensagemKey = (produtoSlug: string) => `${MENSAGEM_KEY_PREFIX}${produtoSlug}`;

const MENSAGENS_PADRAO: Record<string, string> = {
  mgmd: `Oi [nome]! Tô fazendo uma pesquisa rápida pra entender como tá sua experiência no programa MGMD e melhorar o que precisar. Demora uns 4 min e tua resposta sincera vale muito pra mim.

👉 [link]

Pode responder com calma, no seu tempo. Obrigado!`,
  elite: `Oi [nome]! Tô fazendo uma pesquisa rápida pra entender como tá sua experiência na Consultoria de Elite e melhorar o que precisar. Demora uns 4 min e tua resposta sincera vale muito pra mim.

👉 [link]

Pode responder com calma, no seu tempo. Obrigado!`,
};

// Card de "Enviar pesquisa" reutilizado por produto. Cada produto tem chave
// de mensagem própria no localStorage pra que o time edite copies distintos
// pra MGMD e Elite sem misturar.
function ShareCard({ produto }: { produto: ProdutoConfig }) {
  const link = linkPublico(`/pesquisa-satisfacao/${produto.slug}`);
  const storageKey = mensagemKey(produto.slug);
  const defaultMsg = MENSAGENS_PADRAO[produto.slug] ?? "";

  const [mensagem, setMensagem] = useState<string>(() => {
    if (typeof window === "undefined") return defaultMsg;
    try {
      return localStorage.getItem(storageKey) ?? defaultMsg;
    } catch {
      return defaultMsg;
    }
  });
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);

  // Persiste edição com debounce — useEffect (não useMemo) pra rodar como
  // side-effect sem warning de pureness do React.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, mensagem);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [mensagem, storageKey]);

  const mensagemFinal = mensagem.replace(/\[link\]/g, link);

  async function copy(text: string, marker: "link" | "msg") {
    const setter = marker === "link" ? setCopiedLink : setCopiedMsg;
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setter(true);
        setTimeout(() => setter(false), 2000);
      } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: "10px",
        padding: "20px",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Send style={{ height: 18, width: 18, color: C.brand }} />
        <h3
          className="font-semibold"
          style={{ color: C.text, fontSize: "14px", letterSpacing: "0.02em" }}
        >
          ENVIAR PESQUISA — {produto.nome.toUpperCase()}
        </h3>
      </div>
      <p className="text-xs mb-4" style={{ color: C.textDim }}>
        {produto.tagline}
      </p>

      <div className="space-y-4">
        <div>
          <label
            className="text-xs uppercase tracking-wide block mb-2"
            style={{ color: C.textDim }}
          >
            Link público
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={link}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: "8px",
                padding: "10px 12px",
                color: C.text,
                fontSize: "13px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                outline: "none",
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={() => copy(link, "link")}
              style={{
                background: copiedLink ? C.green : C.brand,
                color: "#000",
                border: "none",
                borderRadius: "8px",
                padding: "0 14px",
                height: "40px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
              }}
            >
              {copiedLink ? (
                <>
                  <Check style={{ height: 14, width: 14 }} />
                  Copiado
                </>
              ) : (
                <>
                  <Copy style={{ height: 14, width: 14 }} />
                  Copiar
                </>
              )}
            </button>
          </div>
          <a
            href={`/pesquisa-satisfacao/${produto.slug}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 500,
              textDecoration: "none",
              marginTop: "8px",
            }}
          >
            <ExternalLink style={{ height: 12, width: 12 }} />
            Ver como a aluna vê (nova aba)
          </a>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              className="text-xs uppercase tracking-wide"
              style={{ color: C.textDim }}
            >
              Mensagem (editável)
            </label>
            <button
              type="button"
              onClick={() => {
                if (!confirm("Restaurar a mensagem padrão? Sua edição vai ser perdida."))
                  return;
                setMensagem(defaultMsg);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: C.textDim,
                fontSize: "11px",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Restaurar padrão
            </button>
          </div>
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              padding: "12px 14px",
              color: C.text,
              fontSize: "13px",
              lineHeight: 1.5,
              fontFamily: "inherit",
              outline: "none",
              resize: "vertical",
              minHeight: "120px",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = C.brand)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
          />
          <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
            <p className="text-xs" style={{ color: C.textDim }}>
              Use <code style={{ color: C.brand }}>[link]</code> e edite{" "}
              <code style={{ color: C.brand }}>[nome]</code> antes de enviar.
            </p>
            <button
              type="button"
              onClick={() => copy(mensagemFinal, "msg")}
              style={{
                background: copiedMsg ? C.green : C.brand,
                color: "#000",
                border: "none",
                borderRadius: "8px",
                padding: "0 14px",
                height: "38px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {copiedMsg ? (
                <>
                  <Check style={{ height: 14, width: 14 }} />
                  Mensagem copiada
                </>
              ) : (
                <>
                  <Copy style={{ height: 14, width: 14 }} />
                  Copiar mensagem
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function fetchResponses(): Promise<PesquisaResponse[]> {
  const { data, error } = await supabase
    .from("pesquisa_responses" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PesquisaResponse[];
}

type Tab = "surpreendeu" | "decepcionou" | "mudaria" | "nps";

export default function PesquisaSatisfacaoDashboard() {
  const { data: respostas = [], isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["pesquisa-responses"],
    queryFn: fetchResponses,
  });

  const [planoFilter, setPlanoFilter] = useState<string>("todos");
  const [periodo, setPeriodo] = useState<"30d" | "90d" | "1y" | "all">("all");
  const [produtoFilter, setProdutoFilter] = useState<"todos" | "mgmd" | "elite">("todos");
  const [tab, setTab] = useState<Tab>("surpreendeu");

  const filtradas = useMemo(() => {
    return respostas.filter((r) => {
      if (produtoFilter !== "todos" && r.produto !== produtoFilter) return false;
      if (planoFilter !== "todos" && r.plano !== planoFilter) return false;
      if (periodo !== "all" && r.created_at) {
        const dias = { "30d": 30, "90d": 90, "1y": 365 }[periodo];
        const limite = new Date();
        limite.setDate(limite.getDate() - dias);
        if (new Date(r.created_at) < limite) return false;
      }
      return true;
    });
  }, [respostas, planoFilter, periodo, produtoFilter]);

  const total = filtradas.length;

  const satisGeralMed = useMemo(() => {
    const arr = filtradas.map((r) => r.satisfacao_geral).filter((v): v is number => typeof v === "number");
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }, [filtradas]);

  const npsBuckets = useMemo(() => {
    const buckets = { promotora: 0, passiva: 0, detratora: 0, sem: 0 };
    filtradas.forEach((r) => {
      const b = npsBucket(r.nps_nota);
      if (b) buckets[b]++;
      else buckets.sem++;
    });
    const valid = buckets.promotora + buckets.passiva + buckets.detratora;
    const nps = valid === 0 ? 0 : ((buckets.promotora - buckets.detratora) / valid) * 100;
    return { ...buckets, valid, nps };
  }, [filtradas]);

  const taxaIndicacao = useMemo(() => {
    if (total === 0) return 0;
    const ind = filtradas.filter(
      (r) => r.nps_indicou === "sim_fechou" || r.nps_indicou === "sim_nao_fechou" || r.nps_indicou === "pretendo"
    ).length;
    return (ind / total) * 100;
  }, [filtradas, total]);

  // Datasets dos gráficos
  const distSatis = useMemo(
    () => filtradas.map((r) => r.satisfacao_geral).filter((v): v is number => typeof v === "number"),
    [filtradas]
  );
  const distExpect = useMemo(
    () => filtradas.map((r) => r.expectativa_resultado).filter((v): v is number => typeof v === "number"),
    [filtradas]
  );
  const distComercial = useMemo(
    () => filtradas.map((r) => r.comercial_nota).filter((v): v is number => typeof v === "number"),
    [filtradas]
  );

  const wppMedias = useMemo(() => {
    const calc = (key: keyof PesquisaResponse) => {
      const arr = filtradas
        .map((r) => r[key])
        .filter((v): v is number => typeof v === "number");
      return arr.length === 0 ? 0 : arr.reduce((a, b) => a + (b as number), 0) / arr.length;
    };
    return [
      { label: "Satisfação", valor: calc("wpp_satisfacao") },
      { label: "Tempo resposta", valor: calc("wpp_tempo_resposta") },
      { label: "Clareza", valor: calc("wpp_clareza") },
    ];
  }, [filtradas]);

  const wppFreqData = useMemo(() => {
    return WPP_FREQUENCIA.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.wpp_frequencia === opt.value).length,
    }));
  }, [filtradas]);

  const comercialPressaoData = useMemo(() => {
    return COMERCIAL_PRESSAO.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.comercial_pressao === opt.value).length,
    }));
  }, [filtradas]);

  const instaTiposData = useMemo(() => {
    return INSTA_TIPOS.map((tipo) => ({
      label: tipo,
      valor: filtradas.filter((r) => r.insta_tipos?.includes(tipo)).length,
    })).sort((a, b) => b.valor - a.valor);
  }, [filtradas]);

  const instaFreqData = useMemo(() => {
    return INSTA_FREQUENCIA.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.insta_frequencia === opt.value).length,
    }));
  }, [filtradas]);

  const tempoData = useMemo(() => {
    return TEMPO_PROGRAMA.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.tempo_programa === opt.value).length,
    }));
  }, [filtradas]);

  const planoData = useMemo(() => {
    return PLANOS.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.plano === opt.value).length,
    }));
  }, [filtradas]);

  const indicouData = useMemo(() => {
    return NPS_INDICOU.map((opt) => ({
      label: opt.label,
      value: filtradas.filter((r) => r.nps_indicou === opt.value).length,
    }));
  }, [filtradas]);

  // Citações da tab atual
  const citacoes = useMemo(() => {
    const mapKey: Record<Tab, keyof PesquisaResponse> = {
      surpreendeu: "surpreendeu",
      decepcionou: "decepcionou",
      mudaria: "mudaria_uma_coisa",
      nps: "nps_motivo",
    };
    const key = mapKey[tab];
    return filtradas
      .filter((r) => typeof r[key] === "string" && (r[key] as string).trim().length > 2)
      .map((r) => ({
        id: r.id ?? `${r.created_at}-${r.nome}`,
        nome: r.nome,
        plano: r.plano,
        tempo: r.tempo_programa,
        texto: r[key] as string,
        npsNota: r.nps_nota,
      }));
  }, [filtradas, tab]);

  const tabBorderColor = (t: Tab, npsNota?: number) => {
    if (t === "surpreendeu") return C.green;
    if (t === "decepcionou") return C.red;
    if (t === "nps") {
      const b = npsBucket(npsNota);
      if (b === "promotora") return C.green;
      if (b === "detratora") return C.red;
      return C.yellow;
    }
    return C.border;
  };

  const npsColor =
    npsBuckets.nps > 50 ? C.green : npsBuckets.nps >= 0 ? C.yellow : C.red;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <header
        style={{
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div className="container max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/alunas">
              <button
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  height: "36px",
                  width: "36px",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <ArrowLeft style={{ height: 16, width: 16 }} />
              </button>
            </Link>
            <div>
              <h1 className="font-semibold" style={{ fontSize: "18px", color: C.text }}>
                Pesquisa de Satisfação
              </h1>
              <p className="text-xs" style={{ color: C.textDim }}>
                {total} resposta{total === 1 ? "" : "s"} filtrada{total === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={produtoFilter}
              onChange={(e) => setProdutoFilter(e.target.value as any)}
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "13px",
                outline: "none",
              }}
            >
              <option value="todos">Todos os produtos</option>
              {PRODUTOS_LISTA.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.rotulo}
                </option>
              ))}
            </select>
            <select
              value={planoFilter}
              onChange={(e) => setPlanoFilter(e.target.value)}
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "13px",
                outline: "none",
              }}
            >
              <option value="todos">Todos os planos</option>
              {PLANOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as any)}
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "13px",
                outline: "none",
              }}
            >
              <option value="all">Todo o período</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="1y">Último ano</option>
            </select>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isRefetching}
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              <RefreshCw
                style={{ height: 14, width: 14 }}
                className={isRefetching ? "animate-spin" : ""}
              />
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-5 py-6 space-y-5">
        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.08)",
              border: `1px solid ${C.red}`,
              color: C.red,
              padding: "14px 16px",
              borderRadius: "10px",
              fontSize: "14px",
            }}
          >
            Erro ao carregar pesquisa: {(error as Error).message}
          </div>
        )}

        {/* Cards de compartilhar — renderiza 1 ou 2 conforme filtro de produto. */}
        <div
          className={`grid gap-4 ${
            produtoFilter === "todos" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {(produtoFilter === "todos" || produtoFilter === "mgmd") && (
            <ShareCard produto={PRODUTOS.mgmd} />
          )}
          {(produtoFilter === "todos" || produtoFilter === "elite") && (
            <ShareCard produto={PRODUTOS.elite} />
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 justify-center" style={{ color: C.textDim }}>
            <RefreshCw className="animate-spin" style={{ height: 16, width: 16 }} />
            Carregando...
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total de respostas" value={total} />
              <KpiCard
                label="Satisfação geral"
                value={total === 0 ? "—" : satisGeralMed.toFixed(1)}
                hint="média de 0 a 10"
              />
              <KpiCard
                label="NPS"
                value={npsBuckets.valid === 0 ? "—" : Math.round(npsBuckets.nps)}
                hint={`${npsBuckets.valid} respostas válidas`}
                color={npsBuckets.valid === 0 ? undefined : npsColor}
              />
              <KpiCard
                label="Taxa de indicação"
                value={total === 0 ? "—" : `${taxaIndicacao.toFixed(0)}%`}
                hint="já indicou ou pretende"
              />
            </div>

            {/* NPS bar destacada */}
            <Card title="Distribuição do NPS">
              {npsBuckets.valid === 0 ? (
                <div className="text-sm" style={{ color: C.textDim }}>
                  Sem respostas válidas ainda.
                </div>
              ) : (
                <>
                  <div
                    style={{
                      height: "32px",
                      borderRadius: "8px",
                      overflow: "hidden",
                      display: "flex",
                      background: C.border,
                    }}
                  >
                    <div
                      style={{
                        background: C.green,
                        width: `${(npsBuckets.promotora / npsBuckets.valid) * 100}%`,
                      }}
                      title={`Promotoras: ${npsBuckets.promotora}`}
                    />
                    <div
                      style={{
                        background: C.yellow,
                        width: `${(npsBuckets.passiva / npsBuckets.valid) * 100}%`,
                      }}
                      title={`Passivas: ${npsBuckets.passiva}`}
                    />
                    <div
                      style={{
                        background: C.red,
                        width: `${(npsBuckets.detratora / npsBuckets.valid) * 100}%`,
                      }}
                      title={`Detratoras: ${npsBuckets.detratora}`}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-3 text-sm">
                    <span style={{ color: C.green }}>
                      Promotoras (9-10): {npsBuckets.promotora}
                    </span>
                    <span style={{ color: C.yellow }}>Passivas (7-8): {npsBuckets.passiva}</span>
                    <span style={{ color: C.red }}>Detratoras (0-6): {npsBuckets.detratora}</span>
                  </div>
                </>
              )}
            </Card>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title="Distribuição Satisfação Geral">
                <Distribuicao0a10 values={distSatis} gradient />
              </Card>
              <Card title="Expectativa vs Resultado">
                <Distribuicao0a10 values={distExpect} color={C.yellow} />
              </Card>
              <Card title="Médias WhatsApp">
                <BarChartHorizontal
                  data={wppMedias}
                  color={C.green}
                  formatValor={(v) => v.toFixed(1)}
                />
              </Card>
              <Card title="Frequência de contato WhatsApp">
                <Donut data={wppFreqData} />
              </Card>
              <Card title="Comercial — distribuição da nota">
                <Distribuicao0a10 values={distComercial} gradient />
              </Card>
              <Card title="Pressão na compra">
                <Donut data={comercialPressaoData} />
              </Card>
              <Card title="Conteúdos do Instagram mais úteis">
                <BarChartHorizontal data={instaTiposData} color={C.brand} height={260} />
              </Card>
              <Card title="Frequência de consumo Instagram">
                <Donut data={instaFreqData} />
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Tempo de programa">
                <Donut data={tempoData} height={200} />
              </Card>
              <Card title="Plano contratado">
                <Donut data={planoData} height={200} />
              </Card>
              <Card title="Status de indicação">
                <Donut data={indicouData} height={200} />
              </Card>
            </div>

            {/* Citações */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare style={{ height: 18, width: 18, color: C.brand }} />
                <h3
                  className="font-semibold"
                  style={{ color: C.text, fontSize: "14px", letterSpacing: "0.02em" }}
                >
                  CITAÇÕES ABERTAS
                </h3>
              </div>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {(["surpreendeu", "decepcionou", "mudaria", "nps"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      background: tab === t ? "rgba(255,192,0,0.12)" : "transparent",
                      border: `1px solid ${tab === t ? C.brand : C.border}`,
                      color: tab === t ? C.brand : C.text,
                      padding: "6px 14px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {t === "nps" ? "Motivo do NPS" : t}
                  </button>
                ))}
              </div>
              <div
                style={{
                  maxHeight: "440px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {citacoes.length === 0 ? (
                  <div
                    className="text-sm py-8 text-center"
                    style={{ color: C.textDim }}
                  >
                    Nenhuma resposta nesse campo ainda.
                  </div>
                ) : (
                  citacoes.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderLeft: `3px solid ${tabBorderColor(tab, c.npsNota)}`,
                        borderRadius: "8px",
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        className="text-xs mb-1"
                        style={{ color: C.textDim }}
                      >
                        <strong style={{ color: C.text }}>{c.nome}</strong>
                        {c.plano && <> · {PLANOS.find((p) => p.value === c.plano)?.label ?? c.plano}</>}
                        {c.tempo && <> · {TEMPO_PROGRAMA.find((t) => t.value === c.tempo)?.label ?? c.tempo}</>}
                        {tab === "nps" && typeof c.npsNota === "number" && (
                          <> · NPS {c.npsNota}</>
                        )}
                      </div>
                      <div style={{ color: C.text, fontSize: "14px", lineHeight: 1.5 }}>
                        {c.texto}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
