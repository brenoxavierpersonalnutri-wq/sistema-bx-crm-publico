// =============================================================
// Teste de página da IMPLEMENTAÇÃO (/r/implementacao) dentro do Link Master.
//
// O teste mora em outro projeto (bgimplementacao.brenoxavier.com.br, repo
// sales-win-watcher, outro banco). Este painel só LÊ o agregado pela função
// public.implementacao_teste_publico daquele banco (migration
// 20261013150000_implementacao_teste_publico.sql do sales-win-watcher), que
// devolve só contagens por versão: visitas, leads, qualificados, agendamentos.
// Nenhum dado pessoal sai de lá.
//
// URL e chave abaixo são as PÚBLICAS daquele projeto (role anon, a mesma que
// já vai no JavaScript do site bgimplementacao). Chave publishable é pública
// por definição; nada de service role aqui.
//
// Critérios (os mesmos do painel da implementação):
//   visitas      = cliques no /r/implementacao que caíram na versão;
//   leads        = cliques distintos que enviaram o quiz;
//   qualificados = leads com nível A/B/C e não desqualificados;
//   agendamentos = cliques distintos que agendaram no /agendar.
// Período filtra pela data do clique (dia de Brasília).
// =============================================================

export const IMPLEMENTACAO_SUPABASE_URL = "https://SEU_PROJECT_REF_3.supabase.co";
export const IMPLEMENTACAO_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IlNFVV9QUk9KRUNUX1JFRl8zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTY1NDEsImV4cCI6MjA5Mzc5MjU0MX0.ASSINATURA_FICTICIA_troque_pela_sua_anon_key";
export const IMPLEMENTACAO_SLUG = "implementacao";
export const IMPLEMENTACAO_LINK = "https://bgimplementacao.brenoxavier.com.br/r/implementacao";
export const IMPLEMENTACAO_PAINEL = "https://bgimplementacao.brenoxavier.com.br/rotator";

export interface VersaoImplementacao {
  versao: string;
  pagina: string;
  peso: number;
  ordem: number;
  visitas: number;
  leads: number;
  qualificados: number;
  agendamentos: number;
}

export interface VersaoComTaxas extends VersaoImplementacao {
  /** leads ÷ visitas, em % */
  taxa_lead: number;
  /** qualificados ÷ visitas, em % */
  taxa_qualificado: number;
  /** agendamentos ÷ visitas, em % */
  taxa_agendamento: number;
  /** agendamentos ÷ leads, em % */
  agendamento_por_lead: number;
}

export interface TotaisImplementacao {
  visitas: number;
  leads: number;
  qualificados: number;
  agendamentos: number;
  taxa_lead: number;
  taxa_qualificado: number;
  taxa_agendamento: number;
}

export interface Periodo {
  /** YYYY-MM-DD, inclusivo (dia de Brasília). Vazio = desde o começo. */
  desde?: string;
  /** YYYY-MM-DD, inclusivo (dia de Brasília). Vazio = até hoje. */
  ate?: string;
}

export class FuncaoAusenteError extends Error {
  constructor() {
    super("A função implementacao_teste_publico ainda não foi criada no banco da implementação.");
    this.name = "FuncaoAusenteError";
  }
}

const pct = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0);

const inteiro = (v: unknown) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza uma linha da RPC (bigint pode vir como string). */
export function lerLinha(l: Record<string, unknown>, i: number): VersaoImplementacao {
  return {
    versao: String(l.versao ?? "").trim() || `v${i + 1}`,
    pagina: String(l.pagina ?? "") || "/",
    peso: inteiro(l.peso),
    ordem: inteiro(l.ordem) || i + 1,
    visitas: inteiro(l.visitas),
    leads: inteiro(l.leads),
    qualificados: inteiro(l.qualificados),
    agendamentos: inteiro(l.agendamentos),
  };
}

export function comTaxas(v: VersaoImplementacao): VersaoComTaxas {
  return {
    ...v,
    taxa_lead: pct(v.leads, v.visitas),
    taxa_qualificado: pct(v.qualificados, v.visitas),
    taxa_agendamento: pct(v.agendamentos, v.visitas),
    agendamento_por_lead: pct(v.agendamentos, v.leads),
  };
}

export function totaisDe(versoes: VersaoImplementacao[]): TotaisImplementacao {
  const soma = (k: "visitas" | "leads" | "qualificados" | "agendamentos") =>
    versoes.reduce((s, v) => s + v[k], 0);
  const visitas = soma("visitas");
  const leads = soma("leads");
  const qualificados = soma("qualificados");
  const agendamentos = soma("agendamentos");
  return {
    visitas,
    leads,
    qualificados,
    agendamentos,
    taxa_lead: pct(leads, visitas),
    taxa_qualificado: pct(qualificados, visitas),
    taxa_agendamento: pct(agendamentos, visitas),
  };
}

/**
 * Melhor versão: maior taxa de agendamento; empate (ou ninguém agendou) cai
 * para qualificado ÷ visita e depois lead ÷ visita. Sem nenhuma conversão,
 * não há melhor (null) — destacar a v1 só porque ela vem primeiro mentiria.
 */
export function melhorVersao(versoes: VersaoComTaxas[]): string | null {
  const metricas = ["taxa_agendamento", "taxa_qualificado", "taxa_lead"] as const;
  const candidatas = versoes.filter((v) => v.visitas > 0);
  for (const m of metricas) {
    const topo = Math.max(0, ...candidatas.map((v) => v[m]));
    if (topo <= 0) continue;
    const empatadas = candidatas.filter((v) => v[m] === topo);
    if (empatadas.length === 1) return empatadas[0].versao;
    // Empate nesta métrica: decide pela próxima só entre as empatadas.
    const resto = metricas.slice(metricas.indexOf(m) + 1);
    for (const r of resto) {
      const t2 = Math.max(...empatadas.map((v) => v[r]));
      const e2 = empatadas.filter((v) => v[r] === t2);
      if (e2.length === 1) return e2[0].versao;
    }
    return null;
  }
  return null;
}

export function corpoDaChamada(periodo: Periodo): Record<string, string | null> {
  const desde = periodo.desde && DATA.test(periodo.desde) ? periodo.desde : null;
  const ate = periodo.ate && DATA.test(periodo.ate) ? periodo.ate : null;
  return { p_slug: IMPLEMENTACAO_SLUG, p_desde: desde, p_ate: ate };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Lê o teste no banco da implementação. Lança FuncaoAusenteError se o SQL ainda não rodou. */
export async function buscarTesteImplementacao(
  periodo: Periodo = {},
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): Promise<VersaoImplementacao[]> {
  const resp = await fetchImpl(`${IMPLEMENTACAO_SUPABASE_URL}/rest/v1/rpc/implementacao_teste_publico`, {
    method: "POST",
    headers: {
      apikey: IMPLEMENTACAO_PUBLISHABLE_KEY,
      Authorization: `Bearer ${IMPLEMENTACAO_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(corpoDaChamada(periodo)),
  });
  let corpo: unknown = null;
  try {
    corpo = await resp.json();
  } catch {
    corpo = null;
  }
  if (!resp.ok) {
    const c = (corpo ?? {}) as { code?: string; message?: string };
    if (resp.status === 404 || c.code === "PGRST202" || c.code === "42883") throw new FuncaoAusenteError();
    throw new Error(c.message || `HTTP ${resp.status}`);
  }
  if (!Array.isArray(corpo)) throw new Error("resposta inesperada do banco da implementação");
  return corpo
    .map((l, i) => lerLinha(l as Record<string, unknown>, i))
    .sort((a, b) => a.ordem - b.ordem);
}

export const pctBR = (n: number, casas = 1) => `${n.toFixed(casas).replace(".", ",")}%`;

export type PresetPeriodo = "tudo" | "hoje" | "ontem" | "7d" | "30d";

export const PRESETS: Array<{ id: PresetPeriodo; label: string }> = [
  { id: "tudo", label: "Desde o início" },
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
];

/** Dia (YYYY-MM-DD) em Brasília, independente do fuso do navegador. */
export function diaEmBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function menosDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d - n));
  return t.toISOString().slice(0, 10);
}

export function periodoDoPreset(p: PresetPeriodo, agora: Date = new Date()): Periodo {
  const hoje = diaEmBrasilia(agora);
  switch (p) {
    case "hoje": return { desde: hoje, ate: hoje };
    case "ontem": { const o = menosDias(hoje, 1); return { desde: o, ate: o }; }
    case "7d": return { desde: menosDias(hoje, 6), ate: hoje };
    case "30d": return { desde: menosDias(hoje, 29), ate: hoje };
    default: return {};
  }
}
