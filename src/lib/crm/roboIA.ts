// Robô de atendimento por IA na tela (18/10/2026): quem atende a conversa, transferir para a IA / assumir,
// log da IA por conversa e estado real do robô (Agente IA). Tabelas e RPCs da migration 20261103100000.
// A regra (fila, portões, transferência) roda no servidor: supabase/functions/_shared/roboAtendimento.ts.
import { db } from "@/lib/crm/treinarIA";
import { quemAtende, seloIA } from "./seloIA";

export { quemAtende, seloIA };

export interface AgenteAtendimento {
  id: string;
  slug: string;
  nome: string;
  tipo?: string | null;
  ativo: boolean;
  numero_id?: string | null;
}

export interface EventoIA {
  id: string;
  tipo: string;
  detalhe: string | null;
  mensagem?: string | null;
  modelo?: string | null;
  agent_slug?: string | null;
  tokens_entrada?: number | null;
  tokens_saida?: number | null;
  custo_estimado_usd?: number | null;
  created_at: string;
}

export interface NumeroRoboIA {
  id: string;
  apelido: string;
  chave?: string;
  tipo?: string;
  ativo?: boolean;
  robo_ia_ligado?: boolean | null;
}

/** Agentes de atendimento que podem atender esta conversa: tipo atendimento e mesmo número da conversa. */
export function agentesCompativeis(agentes: AgenteAtendimento[], numeroId: string | null | undefined): AgenteAtendimento[] {
  return agentes.filter((a) => (a.tipo ?? "atendimento") === "atendimento" && !!numeroId && a.numero_id === numeroId);
}

const erroLegivel = (e: { message?: string } | null): string => {
  const m = String(e?.message ?? "erro");
  if (/function .* does not exist|Could not find the function|schema cache/i.test(m)) {
    return "Falta rodar a migration 20261103100000_crm_robo_atendimento_ia.sql.";
  }
  return m;
};

export async function listarAgentesAtendimento(): Promise<AgenteAtendimento[]> {
  const { data, error } = await db.from("crm_ai_agents").select("id, slug, nome, tipo, ativo, numero_id").order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []) as AgenteAtendimento[];
}

export async function roboDoNumero(numeroId: string | null | undefined): Promise<boolean | null> {
  if (!numeroId) return null;
  const { data, error } = await db.from("crm_numeros").select("robo_ia_ligado").eq("id", numeroId).maybeSingle();
  if (error) return null; // coluna ainda não existe
  return Boolean(data?.robo_ia_ligado);
}

export async function transferirParaIA(numeroId: string | null, phone: string, slug: string): Promise<void> {
  const { error } = await db.rpc("crm_ai_transferir_para_ia", { p_numero_id: numeroId, p_phone: phone, p_agent_slug: slug });
  if (error) throw new Error(erroLegivel(error));
}

export async function assumirHumano(numeroId: string | null, phone: string): Promise<void> {
  const { error } = await db.rpc("crm_ai_assumir", { p_numero_id: numeroId, p_phone: phone });
  if (error) throw new Error(erroLegivel(error));
}

export async function eventosDaConversa(phone: string, numeroId: string | null, limite = 100): Promise<EventoIA[]> {
  let q = db.from("crm_ai_eventos").select("*").eq("contact_phone", phone);
  if (numeroId) q = q.or(`numero_id.eq.${numeroId},numero_id.is.null`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventoIA[];
}

export async function ligarRoboDoNumero(numeroId: string, ligado: boolean): Promise<void> {
  const { error } = await db.from("crm_numeros").update({ robo_ia_ligado: ligado }).eq("id", numeroId);
  if (error) throw new Error(/robo_ia_ligado/.test(String(error.message)) ? "Falta rodar a migration 20261103100000_crm_robo_atendimento_ia.sql." : error.message);
}

/** Estado real do robô para o aviso da tela Agente IA. */
export interface EstadoRobo {
  migracao: boolean;
  numeros: NumeroRoboIA[];
  conversasIA: number;
  precisaHumano: number;
  respostas24h: number;
  ultimoEvento: string | null;
}

export async function estadoRobo(): Promise<EstadoRobo> {
  const nums = await db.from("crm_numeros").select("id, apelido, chave, tipo, ativo, robo_ia_ligado").order("ordem");
  if (nums.error) {
    return { migracao: false, numeros: [], conversasIA: 0, precisaHumano: 0, respostas24h: 0, ultimoEvento: null };
  }
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [ia, ph, resp, ult] = await Promise.all([
    db.from("whatsapp_contacts").select("id", { count: "exact", head: true }).not("ai_agent_slug", "is", null).eq("ai_pausado", false),
    db.from("whatsapp_contacts").select("id", { count: "exact", head: true }).eq("ai_precisa_humano", true),
    db.from("crm_ai_eventos").select("id", { count: "exact", head: true }).eq("tipo", "resposta").gte("created_at", desde),
    db.from("crm_ai_eventos").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  return {
    migracao: !ph.error,
    numeros: (nums.data ?? []) as NumeroRoboIA[],
    conversasIA: ia.count ?? 0,
    precisaHumano: ph.count ?? 0,
    respostas24h: resp.count ?? 0,
    ultimoEvento: ult.data?.[0]?.created_at ?? null,
  };
}

export async function contarPrecisaHumano(): Promise<number | null> {
  const { count, error } = await db.from("whatsapp_contacts").select("id", { count: "exact", head: true }).eq("ai_precisa_humano", true);
  return error ? null : count ?? 0;
}

export const ROTULO_EVENTO: Record<string, string> = {
  atribuido: "IA assumiu (automático)",
  transferido_ia: "Transferido para a IA",
  ativado_gatilho: "IA ativada por gatilho",
  tags_aplicadas: "Tags ao começar aplicadas",
  tags_falha: "Tags ao começar não aplicadas",
  gatilho_avaliado: "Gatilho avaliado",
  assumido_humano: "Humano assumiu",
  pausado_humano: "IA pausada: atendimento humano",
  retomado_followup: "IA retomada pelo follow-up",
  resposta: "IA respondeu",
  transferido: "IA passou para humano",
  fora_horario: "Fora do horário",
  falha: "Falha da IA",
  falha_envio: "Falha no envio",
  silencio: "IA ficou em silêncio",
  ignorado: "Ignorado",
};
