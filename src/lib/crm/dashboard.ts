// Dashboard do CRM (/crm): lógica pura, sem React e sem rede (testada em src/test/crmDashboard.test.ts).
import { inicioDoDiaBRT } from "@/lib/crm/central";

export type PeriodoDashboard = "hoje" | "7d" | "30d";

export const PERIODOS: { id: PeriodoDashboard; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
];

/** Início do período em ISO UTC. "Hoje" começa à meia-noite de Brasília; 7d/30d contam para trás a partir de agora. */
export function inicioDoPeriodo(periodo: PeriodoDashboard, agora: Date = new Date()): string {
  if (periodo === "hoje") return inicioDoDiaBRT(agora);
  const dias = periodo === "7d" ? 7 : 30;
  return new Date(agora.getTime() - dias * 86_400_000).toISOString();
}

export interface EtapaFunil {
  id: string;
  titulo: string;
  /** leads que estão NESTA etapa agora */
  naEtapa: number;
  /** leads que chegaram pelo menos até esta etapa (esta + as seguintes) */
  alcancaram: number;
  /** % da etapa anterior que chegou até aqui (null na primeira ou quando a anterior é 0) */
  conversao: number | null;
}

/**
 * Funil a partir da contagem por etapa. O lead que está em "Fechou" passou por todas as anteriores,
 * então "alcançaram" é a soma da etapa com as seguintes e a conversão é alcançaram[i] / alcançaram[i-1].
 */
export function montarFunil(contagem: Record<string, number>, etapas: ReadonlyArray<{ id: string; title: string }>): EtapaFunil[] {
  const naEtapa = etapas.map((e) => Math.max(0, contagem[e.id] ?? 0));
  const alcancaram = naEtapa.map((_, i) => naEtapa.slice(i).reduce((s, n) => s + n, 0));
  return etapas.map((e, i) => ({
    id: e.id,
    titulo: e.title,
    naEtapa: naEtapa[i],
    alcancaram: alcancaram[i],
    conversao: i === 0 || alcancaram[i - 1] === 0 ? null : alcancaram[i] / alcancaram[i - 1],
  }));
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`.replace(".", ","));

export interface MsgLeve {
  contact_phone: string;
  direction: string;
  created_at: string;
}

export interface NaoRespondida {
  phone: string;
  /** ISO da última mensagem (recebida) */
  desde: string;
  horas: number;
}

/**
 * Conversas cuja ÚLTIMA mensagem é do cliente (recebida) e está sem resposta há mais de `horas`.
 * Grupos ficam de fora (o CRM não responde em grupo). Ordena da mais antiga para a mais nova.
 */
export function naoRespondidas(msgs: MsgLeve[], horas: number, agora: Date = new Date()): NaoRespondida[] {
  const ultima = new Map<string, MsgLeve>();
  for (const m of msgs) {
    if (!m.contact_phone || m.contact_phone.endsWith("@g.us")) continue;
    const atual = ultima.get(m.contact_phone);
    if (!atual || m.created_at > atual.created_at) ultima.set(m.contact_phone, m);
  }
  const limite = agora.getTime() - horas * 3_600_000;
  const out: NaoRespondida[] = [];
  for (const m of ultima.values()) {
    if (m.direction !== "inbound") continue;
    const t = new Date(m.created_at).getTime();
    if (!Number.isFinite(t) || t > limite) continue;
    out.push({ phone: m.contact_phone, desde: m.created_at, horas: Math.floor((agora.getTime() - t) / 3_600_000) });
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde));
}

/** "há 3 h", "há 2 d" */
export function tempoDesde(horas: number): string {
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
