// Reprises em lote e recorrência (puro: sem Deno, sem banco). Usado pela edge live-aula e pela tela (pré-visualização).
//
// Fuso: horário de Brasília FIXO (UTC-3; o Brasil não tem horário de verão desde 2019). Somar N dias é somar N*24 h e
// o relógio de parede não muda. A tela manda/recebe "AAAA-MM-DDTHH:mm" sempre lido como Brasília, não como o fuso do
// navegador (quem programa de outro país vê a mesma hora que o aluno brasileiro).
//
// Limites: no máximo 30 reprises por vez. Recorrência contínua (sem fim) cria só as próximas N (janela, padrão 4) e o
// tick da agenda cria a seguinte quando uma acontece ou é cancelada (rolamento), uma por vez, de forma idempotente
// (a reivindicação é um compare-and-set em live_reprise_series.proxima_em).

export const FUSO_BRT_MS = -3 * 3_600_000;
export const DIA_MS = 86_400_000;
export const FREQUENCIAS = [1, 7, 14, 21, 30] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];
export const ROTULO_FREQUENCIA: Record<Frequencia, string> = {
  1: "todo dia", 7: "a cada 7 dias", 14: "a cada 14 dias", 21: "a cada 21 dias", 30: "a cada 30 dias",
};
export const MAX_REPRISES = 30;
export const JANELA_CONTINUA = 4;
export const MAX_JANELA = 10;
export const MIN_ANTECEDENCIA_MS = 2 * 60_000;
export const MAX_HORIZONTE_MS = 366 * DIA_MS;
/** Cota diária padrão de um projeto da YouTube Data API (unidades). */
export const COTA_DIARIA_YT = 10_000;

// ------------------------------------------------------------------ fuso de Brasília

const dois = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-DDTHH:mm" (ou com :ss) lido como horário de Brasília. Inválido = null. */
export function deLocalBrt(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const [, a, mes, d, h, min, seg] = m.map(Number) as unknown as number[];
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || h > 23 || min > 59 || (seg ?? 0) > 59) return null;
  const t = Date.UTC(a, mes - 1, d, h, min, seg || 0) - FUSO_BRT_MS;
  const dt = new Date(t);
  // 31/02 vira 03/03 no Date.UTC: recusa
  return paraLocalBrt(dt).slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? dt : null;
}

/** Date -> "AAAA-MM-DDTHH:mm" em Brasília (valor de <input type="datetime-local">). */
export function paraLocalBrt(d: Date | string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + FUSO_BRT_MS).toISOString().slice(0, 16);
}

/** "AAAA-MM-DD" -> último milissegundo daquele dia em Brasília. */
export function fimDoDiaBrt(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ini = deLocalBrt(`${s}T00:00`);
  return ini ? new Date(ini.getTime() + DIA_MS - 1) : null;
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "ter, 10/11/2026 19:00" (Brasília). */
export function formatarBrt(d: Date | string): string {
  const x = new Date(new Date(d).getTime() + FUSO_BRT_MS);
  return `${SEMANA[x.getUTCDay()]}, ${dois(x.getUTCDate())}/${dois(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${dois(x.getUTCHours())}:${dois(x.getUTCMinutes())}`;
}

/** Sufixo curto do título: "10/11 19h" ou "10/11 19h30". */
export function sufixoData(d: Date): string {
  const x = new Date(d.getTime() + FUSO_BRT_MS);
  const min = x.getUTCMinutes();
  return `${dois(x.getUTCDate())}/${dois(x.getUTCMonth() + 1)} ${dois(x.getUTCHours())}h${min ? dois(min) : ""}`;
}

/** Título com a data no fim, cortando a base (nunca o sufixo) para caber no limite. */
export function tituloComSufixo(base: string, d: Date, max = 100): string {
  const suf = ` (${sufixoData(d)})`;
  const b = base.trim();
  return (b.length + suf.length <= max ? b : b.slice(0, Math.max(0, max - suf.length)).trimEnd()) + suf;
}

// ------------------------------------------------------------------ geração das datas

export type Recorrencia = {
  frequenciaDias: number;
  inicio: Date;
  ate?: Date | null; // inclusivo
  quantidade?: number | null;
  continua?: boolean;
  janela?: number;
};

export type ResultadoDatas =
  | { ok: true; datas: Date[]; continua: boolean; proxima: Date | null }
  | { ok: false; motivo: string; total?: number };

export const ehFrequencia = (n: unknown): n is Frequencia => FREQUENCIAS.includes(Number(n) as Frequencia);

/**
 * Datas de uma recorrência. Com "até" ou "quantidade", todas (no máximo MAX_REPRISES; passou disso recusa e diz o
 * total). Contínua: só as próximas `janela` e a `proxima` (a primeira que o tick vai criar depois).
 */
export function gerarDatas(r: Recorrencia, max = MAX_REPRISES): ResultadoDatas {
  if (!ehFrequencia(r.frequenciaDias)) return { ok: false, motivo: "frequência inválida (todo dia, 7, 14, 21 ou 30 dias)" };
  const ini = r.inicio?.getTime();
  if (!Number.isFinite(ini)) return { ok: false, motivo: "escolha a data e hora da primeira reprise" };
  const passo = r.frequenciaDias * DIA_MS;
  const em = (i: number) => new Date(ini + i * passo);

  if (r.continua) {
    const janela = Math.trunc(Number(r.janela ?? JANELA_CONTINUA));
    if (!(janela >= 1 && janela <= MAX_JANELA)) return { ok: false, motivo: `deixe de 1 a ${MAX_JANELA} reprises à frente` };
    return { ok: true, datas: Array.from({ length: janela }, (_, i) => em(i)), continua: true, proxima: em(janela) };
  }
  if (r.quantidade != null) {
    const q = Math.trunc(Number(r.quantidade));
    if (!(q >= 1)) return { ok: false, motivo: "quantidade de vezes inválida" };
    if (q > max) return { ok: false, motivo: `no máximo ${max} reprises por vez (pediu ${q})`, total: q };
    return { ok: true, datas: Array.from({ length: q }, (_, i) => em(i)), continua: false, proxima: null };
  }
  if (r.ate) {
    const fim = r.ate.getTime();
    if (!Number.isFinite(fim)) return { ok: false, motivo: "data final inválida" };
    if (fim < ini) return { ok: false, motivo: "a data final é antes da primeira reprise" };
    const total = Math.floor((fim - ini) / passo) + 1;
    if (total > max) return { ok: false, motivo: `no máximo ${max} reprises por vez (esse período dá ${total})`, total };
    return { ok: true, datas: Array.from({ length: total }, (_, i) => em(i)), continua: false, proxima: null };
  }
  return { ok: false, motivo: "escolha até quando (data final), quantas vezes ou sem fim" };
}

/** Uma data serve para reprise? (pelo menos 2 min à frente, no máximo 1 ano) */
export function motivoDataInvalida(d: Date, agora: Date): string | null {
  const t = d.getTime();
  if (!Number.isFinite(t)) return "data inválida";
  if (t < agora.getTime() + MIN_ANTECEDENCIA_MS) return `${formatarBrt(d)}: precisa estar pelo menos 2 minutos no futuro`;
  if (t > agora.getTime() + MAX_HORIZONTE_MS) return `${formatarBrt(d)}: no máximo 1 ano à frente`;
  return null;
}

/** Ordena e tira repetidas (mesmo minuto). */
export function normalizarDatas(datas: Date[]): Date[] {
  const vistos = new Set<number>();
  const out: Date[] = [];
  for (const d of [...datas].sort((a, b) => a.getTime() - b.getTime())) {
    const k = Math.floor(d.getTime() / 60_000);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(d);
  }
  return out;
}

export type PedidoReprise = {
  datas: Date[];
  /** só na contínua: a série que o tick vai rolar */
  serie: { frequenciaDias: Frequencia; proximaEm: Date; janela: number } | null;
  sufixoData: boolean;
};

/**
 * Corpo da ação "reprisar". Aceita (em ordem): `recorrencia` {frequencia_dias, inicio (ISO), ate ("AAAA-MM-DD"),
 * quantidade, continua, janela}; `datas` (lista de ISO); `agendada_em` (uma data, o formato antigo).
 * A recorrência é recalculada aqui (não confia na lista da tela).
 */
export function lerPedidoReprise(b: Record<string, unknown>, agora: Date): { ok: true; p: PedidoReprise } | { ok: false; motivo: string } {
  const sufixo = b.sufixo_data === true;
  let datas: Date[];
  let serie: PedidoReprise["serie"] = null;
  if (b.recorrencia && typeof b.recorrencia === "object") {
    const r = b.recorrencia as Record<string, unknown>;
    const inicio = typeof r.inicio === "string" ? new Date(r.inicio) : new Date(NaN);
    const g = gerarDatas({
      frequenciaDias: Number(r.frequencia_dias),
      inicio,
      ate: r.ate ? fimDoDiaBrt(r.ate) ?? new Date(NaN) : null,
      quantidade: r.quantidade == null || r.quantidade === "" ? null : Number(r.quantidade),
      continua: r.continua === true,
      janela: r.janela == null ? undefined : Number(r.janela),
    });
    if (g.ok === false) return { ok: false, motivo: g.motivo };
    datas = g.datas;
    if (g.continua && g.proxima) serie = { frequenciaDias: Number(r.frequencia_dias) as Frequencia, proximaEm: g.proxima, janela: g.datas.length };
  } else if (Array.isArray(b.datas)) {
    if (b.datas.length > MAX_REPRISES) return { ok: false, motivo: `no máximo ${MAX_REPRISES} reprises por vez (pediu ${b.datas.length})` };
    datas = b.datas.map((x) => (typeof x === "string" && x ? new Date(x) : new Date(NaN)));
  } else if (typeof b.agendada_em === "string" && b.agendada_em) {
    datas = [new Date(b.agendada_em)];
  } else {
    return { ok: false, motivo: "escolha pelo menos uma data" };
  }
  if (datas.some((d) => !Number.isFinite(d.getTime()))) return { ok: false, motivo: "há uma data inválida na lista" };
  datas = normalizarDatas(datas);
  if (!datas.length) return { ok: false, motivo: "escolha pelo menos uma data" };
  if (datas.length > MAX_REPRISES) return { ok: false, motivo: `no máximo ${MAX_REPRISES} reprises por vez` };
  for (const d of datas) {
    const m = motivoDataInvalida(d, agora);
    if (m) return { ok: false, motivo: m };
  }
  return { ok: true, p: { datas, serie, sufixoData: sufixo } };
}

// ------------------------------------------------------------------ cota do YouTube

/**
 * Unidades da YouTube Data API por reprise (tabela oficial "Quota Calculator", conferida em 21/10/2026):
 * liveStreams.insert 1 + liveBroadcasts.insert 1 + liveBroadcasts.bind 1; thumbnails.set 50; playlistItems.insert 50.
 */
export const CUSTO_YT = { stream: 1, broadcast: 1, bind: 1, miniatura: 50, playlist: 50 } as const;

export function custoPorReprise(o: { miniatura: boolean; playlist: boolean; destinos?: number }): number {
  const um = CUSTO_YT.stream + CUSTO_YT.broadcast + CUSTO_YT.bind + (o.miniatura ? CUSTO_YT.miniatura : 0) + (o.playlist ? CUSTO_YT.playlist : 0);
  return um * Math.max(1, o.destinos ?? 1);
}

export function estimarCota(qtd: number, o: { miniatura: boolean; playlist: boolean; destinos?: number }) {
  const unidades = qtd * custoPorReprise(o);
  return { unidades, fracao: unidades / COTA_DIARIA_YT, alto: unidades > COTA_DIARIA_YT * 0.5 };
}

/** Razões do Google que significam "acabou a cota / limite de ritmo" (para parar o lote sem quebrar). */
export function ehErroCota(razao: unknown): boolean {
  return typeof razao === "string" && [
    "quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "userRequestsExceedRateLimit",
  ].includes(razao);
}

// ------------------------------------------------------------------ lote

export type ResultadoUma = { room_id: string; links: { destino_id: string; nome: string; video_id: string; link: string }[]; avisos: string[] };
export type Criada = ResultadoUma & { agendada_em: string };
export type Faltou = { agendada_em: string; motivo: string };

/** Erro de "cota acabou" levantado por quem cria uma reprise (a sala já foi desfeita por ele). */
export class ErroCotaReprise extends Error {}

/**
 * Cria as reprises com concorrência limitada. Erro de cota numa delas para o lote: o que já foi criado fica, o que
 * não deu entra em `faltaram` com o motivo. Outro erro numa data não para as outras.
 */
export async function criarLote(
  datas: Date[],
  criarUma: (d: Date) => Promise<ResultadoUma>,
  concorrencia = 3,
): Promise<{ criadas: Criada[]; faltaram: Faltou[]; avisos: string[]; cotaEsgotou: boolean }> {
  const criadas: Criada[] = [];
  const faltaram: Faltou[] = [];
  const avisos = new Set<string>();
  let cotaEsgotou = false;
  let i = 0;
  const trabalhador = async () => {
    while (i < datas.length) {
      const d = datas[i++];
      if (cotaEsgotou) {
        faltaram.push({ agendada_em: d.toISOString(), motivo: "cota diária do YouTube esgotada: não tentei" });
        continue;
      }
      try {
        const r = await criarUma(d);
        criadas.push({ ...r, agendada_em: d.toISOString() });
        r.avisos.forEach((a) => avisos.add(a));
      } catch (e) {
        if (e instanceof ErroCotaReprise) cotaEsgotou = true;
        faltaram.push({ agendada_em: d.toISOString(), motivo: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, datas.length)) }, trabalhador));
  const ord = (a: { agendada_em: string }, b: { agendada_em: string }) => a.agendada_em.localeCompare(b.agendada_em);
  return { criadas: criadas.sort(ord), faltaram: faltaram.sort(ord), avisos: [...avisos], cotaEsgotou };
}

// ------------------------------------------------------------------ rolamento (recorrência contínua)

export type SerieReprise = {
  id: string;
  frequencia_dias: number;
  proxima_em: string;
  janela: number;
  ativa: boolean;
  tentar_depois?: string | null;
};

/**
 * Quais datas o tick cria agora numa série contínua. Datas que já passaram (tick fora do ar) são puladas, nunca
 * criadas atrasadas. `futurasAtivas` = reprises da série ainda por acontecer e não canceladas.
 */
export function planejarRolamento(s: SerieReprise, futurasAtivas: number, agora: Date, maxPorTick = 2): { criar: Date[]; proximaEm: Date } {
  const passo = Number(s.frequencia_dias) * DIA_MS;
  let p = new Date(s.proxima_em).getTime();
  if (!s.ativa || !ehFrequencia(s.frequencia_dias) || !Number.isFinite(p)) return { criar: [], proximaEm: new Date(p) };
  if (s.tentar_depois && new Date(s.tentar_depois).getTime() > agora.getTime()) return { criar: [], proximaEm: new Date(p) };
  const limite = agora.getTime() + MIN_ANTECEDENCIA_MS;
  if (p < limite) p += Math.ceil((limite - p) / passo) * passo; // pula as perdidas
  const falta = Math.max(0, Math.min(s.janela - futurasAtivas, maxPorTick));
  const criar: Date[] = [];
  for (let k = 0; k < falta && p <= agora.getTime() + MAX_HORIZONTE_MS; k++, p += passo) criar.push(new Date(p));
  return { criar, proximaEm: new Date(p) };
}

export type DepsRolamento = {
  contarFuturasAtivas: (serieId: string) => Promise<number>;
  /** compare-and-set: grava `nova` só se proxima_em ainda for `antiga`. true = este tick ficou com as datas. */
  reivindicar: (serieId: string, antiga: string, nova: string) => Promise<boolean>;
  /** cria a reprise na data (a sala nasce com reprise_serie_id + agendada_em; repetida = false, sem erro). */
  criar: (s: SerieReprise, d: Date) => Promise<boolean>;
  /** falhou: devolve proxima_em para a data que faltou (se ninguém mexeu) e adia a série. */
  devolver: (serieId: string, deAgora: string, para: string, erro: string, cota: boolean) => Promise<void>;
};

/** Um passo de rolamento numa série. Idempotente: dois ticks ao mesmo tempo não criam a mesma data duas vezes. */
export async function rolarSerie(s: SerieReprise, agora: Date, deps: DepsRolamento): Promise<{ criadas: string[]; erro?: string }> {
  const futuras = await deps.contarFuturasAtivas(s.id);
  const plano = planejarRolamento(s, futuras, agora);
  if (!plano.criar.length) {
    // só pulou datas perdidas: avança o ponteiro para não recalcular sempre
    if (plano.proximaEm.getTime() !== new Date(s.proxima_em).getTime() && futuras >= s.janela) {
      await deps.reivindicar(s.id, s.proxima_em, plano.proximaEm.toISOString());
    }
    return { criadas: [] };
  }
  const nova = plano.proximaEm.toISOString();
  if (!(await deps.reivindicar(s.id, s.proxima_em, nova))) return { criadas: [] }; // outro tick pegou
  const criadas: string[] = [];
  for (const d of plano.criar) {
    try {
      if (await deps.criar(s, d)) criadas.push(d.toISOString());
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      await deps.devolver(s.id, nova, d.toISOString(), m.slice(0, 300), e instanceof ErroCotaReprise);
      return { criadas, erro: m };
    }
  }
  return { criadas };
}

// ------------------------------------------------------------------ lista e cancelamento

export type SalaReprise = {
  id: string;
  status: string;
  agendada_em: string | null;
  reprise_cancelada_em?: string | null;
  agenda_processada_em?: string | null;
  agenda_erro?: string | null;
};

export type EstadoReprise = "programada" | "no_ar" | "realizada" | "cancelada" | "erro" | "passou";

export function estadoReprise(s: SalaReprise, agora: Date, ytEstado?: string | null): EstadoReprise {
  if (s.reprise_cancelada_em) return "cancelada";
  if (s.status === "ao_vivo") return "no_ar";
  if (s.status === "encerrada") return "realizada";
  if (s.agenda_erro || ytEstado === "erro") return "erro";
  if (s.agendada_em && new Date(s.agendada_em).getTime() > agora.getTime()) return "programada";
  return "passou";
}

export const ROTULO_ESTADO_REPRISE: Record<EstadoReprise, string> = {
  programada: "Programada", no_ar: "No ar", realizada: "Realizada", cancelada: "Cancelada", erro: "Com erro", passou: "Passou",
};

/** Só dá pra cancelar a que ainda não começou (nem foi cancelada). */
export function podeCancelarReprise(s: SalaReprise, agora: Date): boolean {
  return !s.reprise_cancelada_em && s.status === "rascunho" && !!s.agendada_em && new Date(s.agendada_em).getTime() > agora.getTime();
}

export async function cancelarVarias<T extends SalaReprise>(
  salas: T[],
  agora: Date,
  cancelarUma: (s: T) => Promise<string | null>,
  concorrencia = 3,
): Promise<{ canceladas: string[]; avisos: string[] }> {
  const alvo = salas.filter((s) => podeCancelarReprise(s, agora));
  const canceladas: string[] = [];
  const avisos: string[] = [];
  let i = 0;
  const trabalhador = async () => {
    while (i < alvo.length) {
      const s = alvo[i++];
      try {
        const aviso = await cancelarUma(s);
        canceladas.push(s.id);
        if (aviso) avisos.push(aviso);
      } catch (e) {
        avisos.push(`${s.agendada_em ? formatarBrt(s.agendada_em) : s.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, alvo.length)) }, trabalhador));
  return { canceladas, avisos };
}
