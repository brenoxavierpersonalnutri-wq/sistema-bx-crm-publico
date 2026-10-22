import { mensagemErroIA } from "@/lib/crm/iaClaude";
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
  LineChart,
  Line,
} from "recharts";
import { ArrowLeft, RefreshCw, Copy, Check, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { C } from "@/components/feedback/FeedbackUI";
import {
  FeedbackSemanalResponse,
  FeedbackProdutoConfig,
  FEEDBACK_PRODUTOS_LISTA,
  TREINO_FREQUENCIA,
  TREINO_REPS_RESERVA,
  CARDIO_MINUTOS,
  REPS_RESERVA_IDEAL,
  repsReservaLonge,
  listaValores,
  respostasPorEtapa,
  FEEDBACK_PRODUTOS,
  DIETA_REFEICOES_FORA,
  DIETA_BELISCANDO,
  MAIOR_GARGALO,
  PERCEBE_MUDANCA,
  whatsappLink,
} from "@/types/feedbackSemanal";
import { linkPublico } from "@/lib/linkPublico";
import { fetchAlunas } from "@/lib/alunaStore";
import type { Aluna } from "@/lib/alunaTypes";
import { semFeedbacksDeTeste } from "@/lib/alunaTeste";

const DONUT_PALETTE = [C.brand, "#fb923c", "#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#f87171"];

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

// Cor semaforizada por nota 0-10 — usada em médias e listas de alunas.
function corNota(n: number): string {
  if (n <= 4) return C.red;
  if (n <= 7) return C.yellow;
  return C.green;
}

function Distribuicao0a10({ values }: { values: number[] }) {
  const buckets = Array.from({ length: 11 }, (_, i) => ({
    nota: i,
    qtd: values.filter((v) => v === i).length,
  }));
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
            <Cell key={b.nota} fill={corNota(b.nota)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarChartHorizontal({
  data,
  color,
  height = 220,
}: {
  data: { label: string; valor: number }[];
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
        <XAxis type="number" allowDecimals={false} stroke={C.textDim} fontSize={12} />
        <YAxis type="category" dataKey="label" stroke={C.textDim} fontSize={12} width={150} />
        <RTooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="valor" fill={color || C.brand} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Opção mais respondida de um conjunto — o "o que a maioria respondeu". */
function maioria(data: { label: string; valor: number }[]) {
  const total = data.reduce((acc, d) => acc + d.valor, 0);
  if (total === 0) return null;
  const topo = data.reduce((a, b) => (b.valor > a.valor ? b : a));
  if (topo.valor === 0) return null;
  return { label: topo.label, valor: topo.valor, pct: Math.round((topo.valor / total) * 100) };
}

/** Faixa de "maioria" que vai embaixo de cada gráfico de pergunta fechada. */
function Maioria({ data }: { data: { label: string; valor: number }[] }) {
  const m = maioria(data);
  if (!m) {
    return (
      <div className="text-xs mt-3" style={{ color: C.textDim }}>
        Sem resposta nessa pergunta ainda.
      </div>
    );
  }
  return (
    <div
      className="text-xs mt-3 px-3 py-2 rounded-lg"
      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textDim, lineHeight: 1.5 }}
    >
      A maioria respondeu{" "}
      <span style={{ color: C.brand, fontWeight: 600 }}>{m.label}</span>, {m.valor} resposta
      {m.valor === 1 ? "" : "s"} ({m.pct}%)
    </div>
  );
}

function Donut({
  data,
  height = 240,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-sm" style={{ color: C.textDim, height }}>
        Sem dados ainda
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={85} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
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

// ---------------------------------------------------------------------------
// Card de convite (link + mensagem por produto)
// ---------------------------------------------------------------------------

const MENSAGEM_KEY_PREFIX = "feedback-semanal-convite-v1-";

const MENSAGEM_PADRAO = (nomeProduto: string) =>
  `Oi [nome]! Bora fechar a semana. Preenche teu feedback rapidinho pra eu ajustar teu treino e tua dieta, leva uns 3 min.

👉 [link]

No fim é só apertar o botão do WhatsApp que já cai aqui pra mim.`;

function ShareCard({ produto }: { produto: FeedbackProdutoConfig }) {
  const link = linkPublico(`/feedback/${produto.slug}`);
  const storageKey = `${MENSAGEM_KEY_PREFIX}${produto.slug}`;
  const defaultMsg = MENSAGEM_PADRAO(produto.nome);

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

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, mensagem);
      } catch {
        // storage bloqueado: a mensagem só não persiste entre sessões
      }
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
      } catch {
        // sem clipboard disponível: o texto continua selecionável na tela
      }
      document.body.removeChild(ta);
    }
  }

  const btn: React.CSSProperties = {
    borderRadius: "8px",
    padding: "0 14px",
    height: "38px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    border: `1px solid ${C.border}`,
    background: "transparent",
    color: C.text,
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold" style={{ color: C.brand, fontSize: "14px" }}>
          {produto.rotulo.toUpperCase()}
        </h3>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: C.textDim, display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
        >
          Abrir <ExternalLink style={{ height: 12, width: 12 }} />
        </a>
      </div>

      <div
        className="text-xs mb-3 px-3 py-2 rounded-md break-all"
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textDim }}
      >
        {link}
      </div>

      <textarea
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        rows={5}
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: "8px",
          color: C.text,
          padding: "10px 12px",
          width: "100%",
          fontSize: "13px",
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
        }}
      />
      <p className="text-xs mt-2 mb-3" style={{ color: C.textDim }}>
        Use [nome] pra personalizar e [link] onde o link deve entrar.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => copy(link, "link")} style={btn}>
          {copiedLink ? <Check style={{ height: 14, width: 14 }} /> : <Copy style={{ height: 14, width: 14 }} />}
          {copiedLink ? "Link copiado" : "Copiar link"}
        </button>
        <button
          type="button"
          onClick={() => copy(mensagemFinal, "msg")}
          style={{ ...btn, background: C.brand, color: "#000", border: "none" }}
        >
          {copiedMsg ? <Check style={{ height: 14, width: 14 }} /> : <Copy style={{ height: 14, width: 14 }} />}
          {copiedMsg ? "Mensagem copiada" : "Copiar mensagem"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * Uma resposta de aluna: resumo escrito pela IA no topo e, abaixo, todas as
 * respostas agrupadas por etapa. O resumo é gerado sob demanda pela edge
 * function feedback-semanal-resumo e fica gravado na linha — a segunda
 * abertura não gasta chamada nenhuma.
 */
function RespostaCard({ r }: { r: FeedbackSemanalResponse }) {
  const [aberto, setAberto] = useState(false);
  const [resumo, setResumo] = useState(r.resumo_ia ?? "");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  const blocos = useMemo(() => respostasPorEtapa(r), [r]);
  const produto = r.produto ? FEEDBACK_PRODUTOS[r.produto as "mgmd" | "elite"] : undefined;

  async function gerar(force = false) {
    if (!r.id) return;
    setGerando(true);
    setErro("");
    try {
      const { data, error } = await supabase.functions.invoke("feedback-semanal-resumo", {
        body: { response_id: r.id, force },
      });
      if (error) throw new Error(await mensagemErroIA(error, data));
      const payload = data as { resumo?: string; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.resumo) throw new Error("A IA não devolveu resumo.");
      setResumo(payload.resumo);
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : "Não consegui gerar o resumo agora.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div
      className="px-4 py-3 rounded-lg"
      style={{ background: C.bg, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate" style={{ color: C.text, fontSize: "14px" }}>
            {r.nome}
          </span>
          {produto && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ border: `1px solid ${C.border}`, color: C.textDim }}
            >
              {produto.rotulo}
            </span>
          )}
          {r.periodicidade && (
            <span className="text-xs" style={{ color: C.textDim }}>
              {r.periodicidade}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: C.textDim }}>
          {r.created_at ? new Date(r.created_at).toLocaleDateString("pt-BR") : ""}
        </span>
      </div>

      {/* Resumo da IA */}
      <div
        className="mt-3 px-3 py-3 rounded-lg"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className="text-xs"
            style={{ color: C.brand, letterSpacing: "0.05em", fontWeight: 600 }}
          >
            RESUMO DA IA
          </span>
          <button
            type="button"
            onClick={() => gerar(!!resumo)}
            disabled={gerando}
            className="text-xs px-2 py-1 rounded"
            style={{
              border: `1px solid ${C.border}`,
              color: gerando ? C.textDim : C.text,
              background: "transparent",
              cursor: gerando ? "default" : "pointer",
            }}
          >
            {gerando ? "Gerando..." : resumo ? "Gerar de novo" : "Gerar resumo"}
          </button>
        </div>
        {resumo ? (
          <p className="text-sm whitespace-pre-line" style={{ color: C.text, lineHeight: 1.55 }}>
            {resumo}
          </p>
        ) : (
          <p className="text-sm" style={{ color: C.textDim, lineHeight: 1.5 }}>
            {erro || "Ainda sem resumo. Clica em gerar."}
          </p>
        )}
        {resumo && erro && (
          <p className="text-xs mt-2" style={{ color: C.red }}>
            {erro}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="text-xs mt-3"
        style={{ color: C.brand, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        {aberto ? "Esconder as respostas" : "Ver todas as respostas"}
      </button>

      {aberto && (
        <div className="mt-3 space-y-3">
          {blocos.map((bloco) => (
            <div key={bloco.etapa}>
              <div
                className="text-xs mb-1"
                style={{ color: C.textDim, letterSpacing: "0.05em", textTransform: "uppercase" }}
              >
                {bloco.etapa}
              </div>
              <div className="space-y-1">
                {bloco.itens.map((item) => (
                  <div
                    key={item.label}
                    className="text-sm flex gap-2"
                    style={{ color: C.text, lineHeight: 1.5 }}
                  >
                    <span style={{ color: C.textDim, minWidth: "45%" }}>{item.label}</span>
                    <span>{item.valor}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchFeedbacks(): Promise<FeedbackSemanalResponse[]> {
  const { data, error } = await supabase
    .from("feedback_semanal_responses" as any)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as FeedbackSemanalResponse[];

  // Feedback do treino (aluna de teste) não entra nas métricas.
  let alunas: Aluna[] = [];
  try {
    alunas = await fetchAlunas();
  } catch {
    // sem a lista de alunas, o filtro pelo telefone de teste ainda vale
  }
  return semFeedbacksDeTeste(rows, alunas);
}

function media(values: (number | undefined)[]): number {
  const arr = values.filter((v): v is number => typeof v === "number");
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function rotuloDe(
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  value: string | undefined
): string {
  if (!value) return "—";
  return opcoes.find((o) => o.value === value)?.label ?? value;
}

/**
 * Conta respostas por opção. Campos de múltipla escolha guardam os valores
 * separados por vírgula, então a mesma resposta soma em cada opção marcada —
 * por isso o total de um gráfico multi pode passar do total de respostas.
 */
function contagem(
  respostas: FeedbackSemanalResponse[],
  opcoes: ReadonlyArray<{ value: string; label: string }>,
  campo: keyof FeedbackSemanalResponse,
  multiplo = false
) {
  return opcoes.map((opt) => {
    const n = respostas.filter((r) => {
      const bruto = r[campo];
      if (typeof bruto !== "string") return false;
      return multiplo ? listaValores(bruto).includes(opt.value) : bruto === opt.value;
    }).length;
    return { label: opt.label, value: n, valor: n };
  });
}

type Periodo = "30d" | "90d" | "1y" | "all";

export default function FeedbackSemanalDashboard() {
  const { data: respostas = [], isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["feedback-semanal-responses"],
    queryFn: fetchFeedbacks,
  });

  const [produtoFilter, setProdutoFilter] = useState<string>("todos");
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    return respostas.filter((r) => {
      if (produtoFilter !== "todos" && r.produto !== produtoFilter) return false;
      if (periodo !== "all" && r.created_at) {
        const dias = { "30d": 30, "90d": 90, "1y": 365 }[periodo];
        const limite = new Date();
        limite.setDate(limite.getDate() - dias);
        if (new Date(r.created_at) < limite) return false;
      }
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!r.nome?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [respostas, produtoFilter, periodo, busca]);

  const total = filtradas.length;

  const alunasUnicas = useMemo(
    () => new Set(filtradas.map((r) => r.nome?.trim().toLowerCase()).filter(Boolean)).size,
    [filtradas]
  );

  const mExecucao = useMemo(() => media(filtradas.map((r) => r.treino_execucao)), [filtradas]);
  // Série válida agora é medida pelo RIR: % das respostas treinando a 1-3
  // repetições da falha.
  const pctSerieValida = useMemo(() => {
    const comResposta = filtradas.filter((r) => !!r.treino_reps_reserva);
    if (comResposta.length === 0) return null;
    const boas = comResposta.filter((r) => r.treino_reps_reserva === REPS_RESERVA_IDEAL).length;
    return Math.round((boas / comResposta.length) * 100);
  }, [filtradas]);
  const mCardio = useMemo(() => media(filtradas.map((r) => r.cardio_intensidade)), [filtradas]);
  const mAdesao = useMemo(() => media(filtradas.map((r) => r.dieta_adesao)), [filtradas]);

  // Alunas em risco: adesão da dieta <= 5, ou parando a 7+ repetições da falha
  // (série inválida) na resposta mais recente. É a lista pra puxar no WhatsApp
  // antes do problema virar mês perdido.
  const emRisco = useMemo(() => {
    const porAluna = new Map<string, FeedbackSemanalResponse>();
    // filtradas já vem ordenada por created_at desc — o primeiro é o mais recente.
    filtradas.forEach((r) => {
      const key = r.nome?.trim().toLowerCase();
      if (!key) return;
      if (!porAluna.has(key)) porAluna.set(key, r);
    });
    return Array.from(porAluna.values())
      .filter(
        (r) =>
          (typeof r.dieta_adesao === "number" && r.dieta_adesao <= 5) ||
          repsReservaLonge(r.treino_reps_reserva)
      )
      .sort((a, b) => (a.dieta_adesao ?? 10) - (b.dieta_adesao ?? 10));
  }, [filtradas]);

  // Evolução semanal das médias — a série temporal que o Breno acompanha.
  const evolucao = useMemo(() => {
    const semanas = new Map<string, FeedbackSemanalResponse[]>();
    filtradas.forEach((r) => {
      if (!r.created_at) return;
      const d = new Date(r.created_at);
      // Segunda-feira da semana da resposta como chave do bucket.
      const dia = (d.getDay() + 6) % 7;
      const segunda = new Date(d);
      segunda.setDate(d.getDate() - dia);
      const key = segunda.toISOString().slice(0, 10);
      if (!semanas.has(key)) semanas.set(key, []);
      semanas.get(key)!.push(r);
    });
    return Array.from(semanas.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rs]) => {
        const [, mes, dia] = key.split("-");
        return {
          semana: `${dia}/${mes}`,
          Adesao: Number(media(rs.map((r) => r.dieta_adesao)).toFixed(1)),
          Execucao: Number(media(rs.map((r) => r.treino_execucao)).toFixed(1)),
          respostas: rs.length,
        };
      });
  }, [filtradas]);

  const gargaloData = useMemo(() => contagem(filtradas, MAIOR_GARGALO, "maior_gargalo", true), [filtradas]);
  const mudancaData = useMemo(
    () => contagem(filtradas, PERCEBE_MUDANCA, "percebe_mudanca"),
    [filtradas]
  );
  const frequenciaData = useMemo(
    () => contagem(filtradas, TREINO_FREQUENCIA, "treino_frequencia_semanal"),
    [filtradas]
  );
  const repsReservaData = useMemo(
    () => contagem(filtradas, TREINO_REPS_RESERVA, "treino_reps_reserva"),
    [filtradas]
  );
  const cardioMinutosData = useMemo(
    () => contagem(filtradas, CARDIO_MINUTOS, "cardio_minutos_semanais"),
    [filtradas]
  );
  const refeicoesForaData = useMemo(
    () => contagem(filtradas, DIETA_REFEICOES_FORA, "dieta_refeicoes_fora"),
    [filtradas]
  );
  const beliscandoData = useMemo(
    () => contagem(filtradas, DIETA_BELISCANDO, "dieta_beliscando"),
    [filtradas]
  );

  const chipStyle = (active: boolean): React.CSSProperties => ({
    borderRadius: "8px",
    padding: "0 12px",
    height: "34px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${active ? C.brand : C.border}`,
    background: active ? "rgba(255,192,0,0.10)" : "transparent",
    color: active ? C.brand : C.textDim,
  });

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }}>
      <header
        style={{ borderBottom: `1px solid ${C.border}`, background: C.card }}
        className="sticky top-0 z-10"
      >
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/alunas" style={{ color: C.textDim }}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="font-semibold" style={{ fontSize: "18px", color: C.text }}>
                Feedback Semanal
              </h1>
              <p className="text-xs" style={{ color: C.textDim }}>
                Acompanhamento das alunas da consultoria
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            style={{
              borderRadius: "8px",
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.text,
              height: "36px",
              padding: "0 12px",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" style={chipStyle(produtoFilter === "todos")} onClick={() => setProdutoFilter("todos")}>
            Todos os produtos
          </button>
          {FEEDBACK_PRODUTOS_LISTA.map((p) => (
            <button
              key={p.slug}
              type="button"
              style={chipStyle(produtoFilter === p.slug)}
              onClick={() => setProdutoFilter(p.slug)}
            >
              {p.rotulo}
            </button>
          ))}


          <span style={{ width: 1, height: 24, background: C.border, margin: "0 4px" }} />

          {(["30d", "90d", "1y", "all"] as Periodo[]).map((p) => (
            <button key={p} type="button" style={chipStyle(periodo === p)} onClick={() => setPeriodo(p)}>
              {p === "all" ? "Tudo" : p === "1y" ? "1 ano" : p}
            </button>
          ))}

          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar aluna..."
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              color: C.text,
              height: "34px",
              padding: "0 12px",
              fontSize: "13px",
              outline: "none",
              marginLeft: "auto",
              minWidth: "180px",
            }}
          />
        </div>

        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.08)",
              border: `1px solid ${C.red}`,
              borderRadius: "8px",
              padding: "12px 14px",
              color: C.red,
              fontSize: "14px",
            }}
          >
            Não consegui carregar os feedbacks:{" "}
            {error instanceof Error ? error.message : "erro desconhecido"}
          </div>
        )}

        {isLoading ? (
          <div style={{ color: C.textDim }} className="py-16 text-center">
            Carregando...
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Respostas" value={total} hint={`${alunasUnicas} aluna(s) diferente(s)`} />
              <KpiCard
                label="Adesão da dieta"
                value={mAdesao.toFixed(1)}
                color={corNota(mAdesao)}
                hint="Média 0-10"
              />
              <KpiCard
                label="Séries válidas"
                value={pctSerieValida === null ? "—" : `${pctSerieValida}%`}
                color={
                  pctSerieValida === null
                    ? C.textDim
                    : pctSerieValida >= 60
                      ? C.green
                      : pctSerieValida >= 35
                        ? C.brand
                        : C.red
                }
                hint="Treinando a 1-3 reps da falha"
              />
              <KpiCard
                label="Alunas em risco"
                value={emRisco.length}
                color={emRisco.length > 0 ? C.red : C.green}
                hint="Adesão ≤ 5 ou parando longe da falha"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Técnica / amplitude" value={mExecucao.toFixed(1)} color={corNota(mExecucao)} />
              <KpiCard label="Intensidade do cardio" value={mCardio.toFixed(1)} color={corNota(mCardio)} />
            </div>

            {/* Alunas em risco */}
            {emRisco.length > 0 && (
              <Card title="Alunas pra puxar no WhatsApp">
                <div className="space-y-2">
                  {emRisco.map((r) => {
                    // Respostas novas guardam E.164 com "+" (o país sai do seletor
                    // do formulário). As antigas guardavam só DDD + número, então
                    // só nelas o 55 é completado na mão.
                    const bruto = r.telefone?.trim() ?? "";
                    const digitos = bruto.replace(/\D/g, "");
                    const tel = bruto.startsWith("+")
                      ? digitos
                      : digitos
                        ? `55${digitos.replace(/^55/, "")}`
                        : "";
                    const link = tel
                      ? whatsappLink(
                          tel,
                          `Oi ${r.nome?.split(" ")[0] ?? ""}, vi teu feedback dessa semana. Bora ajustar?`
                        )
                      : null;
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg"
                        style={{ background: C.bg, border: `1px solid ${C.border}` }}
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate" style={{ color: C.text, fontSize: "14px" }}>
                            {r.nome}
                          </div>
                          <div className="text-xs mt-1" style={{ color: C.textDim }}>
                            Gargalo: {rotuloDe(MAIOR_GARGALO, r.maior_gargalo)} ·{" "}
                            {r.created_at ? new Date(r.created_at).toLocaleDateString("pt-BR") : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <div className="text-xs" style={{ color: C.textDim }}>
                              Adesão
                            </div>
                            <div
                              className="font-bold tabular-nums"
                              style={{ color: corNota(r.dieta_adesao ?? 10), fontSize: "18px" }}
                            >
                              {r.dieta_adesao ?? "—"}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs" style={{ color: C.textDim }}>
                              Reps da falha
                            </div>
                            <div
                              className="font-bold tabular-nums"
                              style={{
                                color: !r.treino_reps_reserva
                                  ? C.textDim
                                  : r.treino_reps_reserva === REPS_RESERVA_IDEAL
                                    ? C.green
                                    : repsReservaLonge(r.treino_reps_reserva)
                                      ? C.red
                                      : C.brand,
                                fontSize: "18px",
                              }}
                            >
                              {r.treino_reps_reserva ?? "—"}
                            </div>
                          </div>
                          {link && (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                background: C.whatsapp,
                                color: "#fff",
                                borderRadius: "8px",
                                padding: "0 12px",
                                height: "34px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: 600,
                                textDecoration: "none",
                              }}
                            >
                              Chamar
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Evolução semanal */}
            {evolucao.length > 1 && (
              <Card title="Evolução semanal das médias">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={evolucao} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="semana" stroke={C.textDim} fontSize={12} />
                    <YAxis domain={[0, 10]} stroke={C.textDim} fontSize={12} />
                    <RTooltip
                      contentStyle={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                    />
                    <Legend wrapperStyle={{ color: C.text, fontSize: "12px" }} />
                    <Line type="monotone" dataKey="Adesao" stroke={C.brand} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Execucao" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* Distribuições */}
            <div className="grid md:grid-cols-2 gap-3">
              <Card title="Adesão da dieta (0-10)">
                <Distribuicao0a10
                  values={filtradas.map((r) => r.dieta_adesao).filter((v): v is number => typeof v === "number")}
                />
              </Card>
              <Card title="Técnica, amplitude e cadência (0-10)">
                <Distribuicao0a10
                  values={filtradas.map((r) => r.treino_execucao).filter((v): v is number => typeof v === "number")}
                />
              </Card>
            </div>

            {/* Fechadas */}
            <div className="grid md:grid-cols-2 gap-3">
              <Card title="Maior gargalo">
                <Donut data={gargaloData} />
                <Maioria data={gargaloData} />
              </Card>
              <Card title="Percebe mudança no corpo">
                <Donut data={mudancaData} />
                <Maioria data={mudancaData} />
              </Card>
              <Card title="Frequência semanal de treino">
                <BarChartHorizontal data={frequenciaData} height={240} />
                <Maioria data={frequenciaData} />
              </Card>
              <Card title="Repetições que ainda davam (RIR)">
                <BarChartHorizontal data={repsReservaData} color="#a78bfa" />
                <Maioria data={repsReservaData} />
              </Card>
              <Card title="Minutos de cardio por semana">
                <BarChartHorizontal data={cardioMinutosData} color="#34d399" />
                <Maioria data={cardioMinutosData} />
              </Card>
              <Card title="Refeições livres na semana">
                <BarChartHorizontal data={refeicoesForaData} color="#fb923c" />
                <Maioria data={refeicoesForaData} />
              </Card>
              <Card title="Beliscando">
                <BarChartHorizontal data={beliscandoData} color={C.red} />
                <Maioria data={beliscandoData} />
              </Card>
            </div>

            {/* Respostas abertas */}
            <Card title={`Respostas das alunas (${filtradas.length})`}>
              {filtradas.length === 0 ? (
                <div style={{ color: C.textDim }} className="text-sm py-6 text-center">
                  Nenhuma resposta ainda.
                </div>
              ) : (
                <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
                  {filtradas.map((r) => (
                    <RespostaCard key={r.id} r={r} />
                  ))}
                </div>
              )}
            </Card>

            {/* Links pra enviar */}
            <div>
              <h2
                className="font-semibold mb-3"
                style={{ color: C.text, fontSize: "14px", letterSpacing: "0.02em" }}
              >
                ENVIAR PRAS ALUNAS
              </h2>
              <div className="grid md:grid-cols-2 gap-3">
                {FEEDBACK_PRODUTOS_LISTA.map((p) => (
                  <ShareCard key={p.slug} produto={p} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
