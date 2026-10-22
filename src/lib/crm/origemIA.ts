// Origem "IA WhatsApp": lead que chegou pelo link de agendamento que o agente de IA manda no WhatsApp
// (utm_source=whatsapp & utm_medium=ia, ver linkAgendamento() em supabase/functions/_shared/agentesIA.ts).
// Usado no funil do Monitoramento das Consultas (/vendas/funil), no Dashboard do CRM e na classificação
// de funis (lib/funnelClassification).
import { UTM_IA } from "../../../supabase/functions/_shared/agentesIA.ts";

export const VIA_IA_WHATSAPP = "ia-whatsapp";
export const ROTULO_IA_WHATSAPP = "IA WhatsApp";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export function ehOrigemIA(i: { via?: string | null; utmSource?: string | null; utmMedium?: string | null }): boolean {
  const via = norm(i.via).replace(/_/g, "-");
  if (via === VIA_IA_WHATSAPP) return true;
  return norm(i.utmSource) === UTM_IA.source && norm(i.utmMedium) === UTM_IA.medium;
}

/** Filtro PostgREST (.or) para linhas que vieram da IA. `comVia`: a tabela tem a coluna via (consultations). */
export function filtroOrigemIA(comVia: boolean): string {
  const utm = `and(utm_source.ilike.${UTM_IA.source},utm_medium.ilike.${UTM_IA.medium})`;
  return comVia ? `${utm},via.eq.${VIA_IA_WHATSAPP}` : utm;
}

export interface EtapasOrigem {
  leads: number | null;
  qualificados: number | null;
  agendados: number | null;
  compareceu: number | null;
}

export const ETAPAS_ORIGEM: { id: keyof EtapasOrigem; rotulo: string }[] = [
  { id: "leads", rotulo: "Leads (formulário)" },
  { id: "qualificados", rotulo: "Qualificados" },
  { id: "agendados", rotulo: "Agendados" },
  { id: "compareceu", rotulo: "Compareceu" },
];

/** Outras origens = total − IA (null quando qualquer lado não pôde ser lido). */
export function outrasOrigens(total: EtapasOrigem, ia: EtapasOrigem): EtapasOrigem {
  const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(0, a - b));
  return {
    leads: sub(total.leads, ia.leads),
    qualificados: sub(total.qualificados, ia.qualificados),
    agendados: sub(total.agendados, ia.agendados),
    compareceu: sub(total.compareceu, ia.compareceu),
  };
}

/** Taxa da etapa sobre a anterior ("—" sem base). */
export function taxaEtapa(atual: number | null, anterior: number | null): string {
  if (atual === null || anterior === null || anterior <= 0) return "—";
  return `${Math.round((atual / anterior) * 100)}%`;
}
