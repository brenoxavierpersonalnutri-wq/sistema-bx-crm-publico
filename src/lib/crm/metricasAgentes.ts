// Métricas por agente para os cartões da tela Agente IA (21/10/2026). Só leitura:
// - com a IA agora: contatos com ai_agent_slug = slug e IA não pausada;
// - atendidas hoje: contatos distintos que receberam resposta da IA hoje (Brasília);
// - respostas hoje e transferidas hoje: eventos "resposta" e "transferido" de crm_ai_eventos.
// Banco sem as colunas/tabela do robô (ou qualquer erro): devolve null e o cartão não mostra números.
import { db } from "@/lib/crm/treinarIA";
import { inicioDoPeriodo } from "@/lib/crm/dashboard";

export interface MetricasAgente {
  comIA: number;
  atendidasHoje: number;
  respostasHoje: number;
  transferidasHoje: number;
}

interface LinhaEvento { agent_slug?: string | null; tipo?: string | null; contact_phone?: string | null }
interface LinhaContato { ai_agent_slug?: string | null }

/** Junta as linhas lidas em métricas por slug (função pura, testável). */
export function agruparMetricas(contatos: LinhaContato[], eventos: LinhaEvento[]): Map<string, MetricasAgente> {
  const m = new Map<string, MetricasAgente>();
  const pegar = (slug: string) => {
    let x = m.get(slug);
    if (!x) { x = { comIA: 0, atendidasHoje: 0, respostasHoje: 0, transferidasHoje: 0 }; m.set(slug, x); }
    return x;
  };
  for (const c of contatos) if (c.ai_agent_slug) pegar(c.ai_agent_slug).comIA += 1;
  const atendidos = new Map<string, Set<string>>();
  for (const e of eventos) {
    if (!e.agent_slug) continue;
    const x = pegar(e.agent_slug);
    if (e.tipo === "resposta") {
      x.respostasHoje += 1;
      if (e.contact_phone) {
        const s = atendidos.get(e.agent_slug) ?? new Set<string>();
        s.add(e.contact_phone);
        atendidos.set(e.agent_slug, s);
      }
    } else if (e.tipo === "transferido") x.transferidasHoje += 1;
  }
  for (const [slug, s] of atendidos) pegar(slug).atendidasHoje = s.size;
  return m;
}

export async function metricasPorAgente(agora: Date = new Date()): Promise<Map<string, MetricasAgente> | null> {
  try {
    const desde = inicioDoPeriodo("hoje", agora);
    const [c, e] = await Promise.all([
      db.from("whatsapp_contacts").select("ai_agent_slug").not("ai_agent_slug", "is", null).eq("ai_pausado", false).limit(5000),
      db.from("crm_ai_eventos").select("agent_slug, tipo, contact_phone").in("tipo", ["resposta", "transferido"]).gte("created_at", desde).limit(10000),
    ]);
    if (c?.error || e?.error) return null;
    return agruparMetricas((c?.data ?? []) as LinhaContato[], (e?.data ?? []) as LinhaEvento[]);
  } catch {
    return null;
  }
}
