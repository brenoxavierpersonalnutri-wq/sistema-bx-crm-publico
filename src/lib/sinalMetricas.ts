// Sinal de cor dos cards de Vendas (pedido do Breno, 14/10/2026) e as contas
// que os cards e o bloco "Fluxo do próximo dia útil" compartilham.
//
// Tudo aqui é puro (sem React, sem banco) pra ser testado fronteira por
// fronteira. O percentual que entra nas regras é o MESMO número inteiro que o
// card mostra (Math.round), pra cor e número nunca discordarem na tela.

import type { Consultation } from "@/types/consultation";

export type NivelSinal = "vermelho" | "laranja" | "amarelo" | "verde" | "ouro";

/** Faixa de uma regra: vale de `min` (inclusive) até `max` (exclusive). */
export interface Faixa {
  nivel: NivelSinal;
  min: number;
  max: number;
  /** Texto da legenda do tooltip, gerado de `min`/`max` (ver `rotuloFaixa`). */
  rotulo: string;
}

// Limites inteiros: o percentual chega arredondado, então "max 20" quer dizer
// "até 19%". O texto da legenda e da referência sai destes números, nunca
// escrito à mão: mudou o limite aqui, muda tudo o que aparece na tela.
type LimiteFaixa = Omit<Faixa, "rotulo">;

/** "abaixo de 15%", "15% a 19%", "acima de 25%" a partir dos limites. */
export function rotuloFaixa({ min, max }: LimiteFaixa): string {
  if (min === -Infinity) return `abaixo de ${max}%`;
  if (max === Infinity) return `acima de ${min - 1}%`;
  return `${min}% a ${max - 1}%`;
}

const comRotulo = (limites: LimiteFaixa[]): Faixa[] => limites.map((f) => ({ ...f, rotulo: rotuloFaixa(f) }));

// Regra 1 — Consultas Feitas, % sobre as AGENDADAS.
// <15 vermelho · 15 a <20 laranja · 20 a 25 verde (25 incluso) · >25 ouro.
export const FAIXAS_FEITAS: Faixa[] = comRotulo([
  { nivel: "vermelho", min: -Infinity, max: 15 },
  { nivel: "laranja", min: 15, max: 20 },
  { nivel: "verde", min: 20, max: 26 },
  { nivel: "ouro", min: 26, max: Infinity },
]);

// Regra 2 — Call Confirmadas, % do total.
// <20 vermelho · 20 a <30 laranja · 30 a <40 amarelo (faixa suposta: o Breno
// não definiu 30–39) · 40 a 60 verde (60 incluso) · >60 ouro.
export const FAIXAS_CONFIRMADAS: Faixa[] = comRotulo([
  { nivel: "vermelho", min: -Infinity, max: 20 },
  { nivel: "laranja", min: 20, max: 30 },
  { nivel: "amarelo", min: 30, max: 40 },
  { nivel: "verde", min: 40, max: 61 },
  { nivel: "ouro", min: 61, max: Infinity },
]);

export type RegraSinal = "feitas" | "confirmadas";

export const FAIXAS_POR_REGRA: Record<RegraSinal, Faixa[]> = {
  feitas: FAIXAS_FEITAS,
  confirmadas: FAIXAS_CONFIRMADAS,
};

/** Sobre o que o percentual de cada regra é calculado, como o card escreve. */
export const BASE_POR_REGRA: Record<RegraSinal, string> = {
  feitas: "das agendadas",
  confirmadas: "do total",
};

/**
 * Referência sempre visível embaixo da pílula (pedido do Breno, 15/10/2026:
 * "o que buscamos em cada um, escrito, a porcentagem").
 * - `meta` e `ouro`: as duas linhas curtas do card. Cabem em 2 linhas no card
 *   mais estreito (7 colunas no desktop, 2 colunas no celular); a base ("das
 *   agendadas"/"do total") já está escrita na própria pílula ao lado.
 * - `completa`: a frase inteira, no tooltip e no `title`.
 */
export interface ReferenciaMeta {
  meta: string;
  ouro: string;
  completa: string;
}

/** Monta a referência a partir das faixas (a verde é a meta; a ouro, o acima da meta). */
export function referenciaDeFaixas(faixas: Faixa[], base: string): ReferenciaMeta {
  const verde = faixas.find((f) => f.nivel === "verde");
  const ouro = faixas.find((f) => f.nivel === "ouro");
  if (!verde || !ouro) throw new Error("referenciaDeFaixas: regra sem faixa verde ou ouro");
  const ini = verde.min;
  const fim = verde.max - 1;
  const acima = ouro.min - 1;
  return {
    meta: `Meta: ${ini} a ${fim}%`,
    ouro: `Ouro: > ${acima}%`,
    completa: `Meta: ${ini} a ${fim}% ${base} · acima de ${acima}% é ouro`,
  };
}

export function referenciaMeta(regra: RegraSinal): ReferenciaMeta {
  return referenciaDeFaixas(FAIXAS_POR_REGRA[regra], BASE_POR_REGRA[regra]);
}

// Para um valor fracionário (não deveria acontecer), arredonda antes de
// classificar, do mesmo jeito que o card arredonda pra mostrar.
function classificar(faixas: Faixa[], pct: number | null): NivelSinal | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const p = Math.round(pct);
  return faixas.find((f) => p >= f.min && p < f.max)?.nivel ?? null;
}

/** Regra 1. `null` = sem base (nenhuma agendada): não pinta. */
export function sinalFeitas(pctSobreAgendadas: number | null): NivelSinal | null {
  return classificar(FAIXAS_FEITAS, pctSobreAgendadas);
}

/** Regra 2. `null` = sem base (nenhuma consulta): não pinta. */
export function sinalConfirmadas(pctDoTotal: number | null): NivelSinal | null {
  return classificar(FAIXAS_CONFIRMADAS, pctDoTotal);
}

export const NOME_NIVEL: Record<NivelSinal, string> = {
  vermelho: "Vermelho",
  laranja: "Laranja",
  amarelo: "Amarelo",
  verde: "Verde",
  ouro: "Ouro",
};

/** Percentual inteiro, igual ao card. `null` quando a base é zero. */
export function pctInteiro(parte: number, base: number): number | null {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}

export interface MetricasConsultas {
  /** Todas as consultas da lista (inclui desqualificadas). */
  total: number;
  desqualificadas: number;
  /** total − desqualificadas: o "Consultas no Período" e a base de "das agendadas". */
  agendadas: number;
  feitas: number;
  callConfirmadas: number;
  /** Feitas sobre agendadas (o "11% das agendadas"). */
  pctFeitasSobreAgendadas: number | null;
  /** Call confirmadas sobre o total (o "21% do total"). */
  pctConfirmadasDoTotal: number | null;
}

// Mesmas definições que os cards usavam inline no StatsCards: reagendamento
// futuro, fluxo incompleto e renda baixa não contam; reembolsada não conta.
const naoExcluida = (c: Consultation) =>
  c.is_future_reschedule !== true && c.is_incomplete_flow !== true && c.lowIncome !== true;
const naoReembolsada = (c: Consultation) => c.refunded !== true;

export function calcularMetricasConsultas(consultas: Consultation[]): MetricasConsultas {
  const total = consultas.length;
  const conta = (pred: (c: Consultation) => boolean) =>
    consultas.filter((c) => pred(c) && naoExcluida(c) && naoReembolsada(c)).length;

  const desqualificadas = conta((c) => c.disqualified === true);
  const feitas = conta((c) => c.attended === true);
  const callConfirmadas = conta((c) => c.callConfirmed === true);
  const agendadas = total - desqualificadas;

  return {
    total,
    desqualificadas,
    agendadas,
    feitas,
    callConfirmadas,
    pctFeitasSobreAgendadas: pctInteiro(feitas, agendadas),
    pctConfirmadasDoTotal: pctInteiro(callConfirmadas, total),
  };
}

// ---------------------------------------------------------------------------
// Próximo dia útil, no relógio de São Paulo.

const SP_TZ = "America/Sao_Paulo";

/** Data civil (yyyy-MM-dd) de `agora` no fuso de São Paulo. */
export function dataEmSaoPaulo(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Amanhã, pulando sábado e domingo: seg–qui → dia seguinte; sexta, sábado e
 * domingo → segunda. Feriado não é considerado (não há calendário de feriados
 * no sistema). Devolve yyyy-MM-dd, o mesmo formato de `consultation.date`.
 */
export function proximoDiaUtil(agora: Date): string {
  const [a, m, d] = dataEmSaoPaulo(agora).split("-").map(Number);
  // Aritmética em UTC meia-noite: só data civil, sem horário de verão no meio.
  const dia = new Date(Date.UTC(a, m - 1, d));
  do {
    dia.setUTCDate(dia.getUTCDate() + 1);
  } while (dia.getUTCDay() === 0 || dia.getUTCDay() === 6);
  return dia.toISOString().slice(0, 10);
}

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "quarta-feira 15/10" a partir de yyyy-MM-dd. */
export function rotuloDia(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const semana = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${semana} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
