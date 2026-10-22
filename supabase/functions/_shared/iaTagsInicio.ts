// "Tags ao começar" (21/10/2026): tags que o agente de IA põe no contato quando assume a conversa, por qualquer
// caminho (gatilho, modo "todas"/Ligado, botão "Transferir para IA" e passos de fluxo "transferir_ia"/"agente_ia" ligar).
// Coluna crm_ai_agents.tags_ao_iniciar e RPC crm_ai_aplicar_tags_inicio da migration 20261113100000_crm_ai_tags_ao_iniciar.sql.
//
// Mecanismo de tag = o mesmo da equipe em Contatos/chat: whatsapp_contacts.tags. O UPDATE dessa coluna dispara o trigger
// trg_crm_eventos_contato (evento 'tag' em crm_contato_eventos), que é o que as automações e fluxos "recebeu a tag" leem:
// tag posta pela IA dispara as mesmas regras que tag posta à mão.
//
// Regras: só adiciona (nunca remove), não duplica (compara normalizado: "Comprou" = "comprou"), grava evento
// 'tags_aplicadas' em crm_ai_eventos (a RPC grava) e falha NUNCA impede a IA de atender (esta função não lança).
import { normalizarTag } from "./automacoes.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const MAX_TAGS_AO_INICIAR = 20;

/** Lista da tela/banco: normalizada, sem vazias, sem repetidas, até 20. */
export function normalizarTagsAoIniciar(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : [];
  return [...new Set(lista.map(normalizarTag).filter(Boolean))].slice(0, MAX_TAGS_AO_INICIAR);
}

/** Tags do agente que o contato ainda não tem (comparação normalizada). Mesma regra da RPC em SQL. */
export function tagsParaAdicionar(atuais: string[] | null | undefined, doAgente: unknown): string[] {
  const tem = new Set((atuais ?? []).map(normalizarTag));
  return normalizarTagsAoIniciar(doAgente).filter((t) => !tem.has(t));
}

/** Resultado de juntar: as atuais intactas (grafia original) + as que faltam no fim. Nunca remove. */
export function mesclarTagsAoIniciar(atuais: string[] | null | undefined, doAgente: unknown): string[] {
  return [...(atuais ?? []), ...tagsParaAdicionar(atuais, doAgente)];
}

export type OrigemTags = "gatilho" | "todas" | "transferencia_manual" | "fluxo_transferir_ia" | "fluxo_agente_ia";

const log = (msg: string, e?: unknown) => console.error(`ia-tags: ${msg}`, e instanceof Error ? e.message : e ?? "");

/**
 * Aplica as "Tags ao começar" do agente no contato (whatsapp_contacts.tags) pela RPC atômica do banco.
 * Agente sem tags = nenhuma chamada. NUNCA lança: devolve as tags adicionadas ou o erro em texto (só para log/detalhe).
 * `numeroId` null = todas as conversas do telefone (o mesmo alcance do passo de fluxo "agente_ia").
 */
export async function aplicarTagsAoIniciar(db: Db, p: {
  numeroId: string | null;
  phone: string;
  agente: { slug: string; tags_ao_iniciar?: unknown } | null | undefined;
  origem: OrigemTags;
}): Promise<{ adicionadas: string[]; erro: string | null }> {
  try {
    if (!p.agente?.slug || !normalizarTagsAoIniciar(p.agente.tags_ao_iniciar).length) return { adicionadas: [], erro: null };
    const { data, error } = await db.rpc("crm_ai_aplicar_tags_inicio", {
      p_numero_id: p.numeroId, p_phone: p.phone, p_agent_slug: p.agente.slug, p_origem: p.origem,
    });
    if (error) {
      const msg = String(error.message ?? error);
      log(`não aplicou as tags (${p.origem})`, msg);
      return { adicionadas: [], erro: msg };
    }
    return { adicionadas: Array.isArray(data) ? data.map(String) : [], erro: null };
  } catch (e) {
    log(`não aplicou as tags (${p.origem})`, e);
    return { adicionadas: [], erro: e instanceof Error ? e.message : String(e) };
  }
}
