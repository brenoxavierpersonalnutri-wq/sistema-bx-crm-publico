// Tela "Treinar IA" (/crm/agente-ia): tipos, acesso ao banco e regras puras (recomendação de número, link).
// Tabelas da migration 20261027140000_crm_treinar_ia.sql (ainda fora do types.ts gerado).
import { supabase } from "@/integrations/supabase/client";
import type { NumeroCRM } from "@/lib/crm/central";
import {
  FRASE_TRANSFERENCIA_PADRAO,
  LINK_AGENDAMENTO_PADRAO,
  PALAVRAS_TRANSFERENCIA_PADRAO,
  POLITICAS_PADRAO,
  linkAgendamento,
  prontoParaLigar,
  type ExemploTreino,
  type ItemConhecimento,
} from "../../../supabase/functions/_shared/agentesIA.ts";
import { ehFollowup, type TipoAgente } from "../../../supabase/functions/_shared/agentesIA.ts";
import { PROMPT_TRANSFERENCIA_PADRAO, type AgenteRobo } from "../../../supabase/functions/_shared/roboAtendimento.ts";
import { camposDoRitmo, normalizarRitmo } from "../../../supabase/functions/_shared/ritmoResposta.ts";
import {
  ATALHOS_AVALIACAO,
  LIMITES_ATIVACAO,
  MODOS_ATIVACAO,
  QUANDO_ATIVAR_AVALIACAO,
  camposDoModo,
  horasHumano,
  maxMensagensGatilho,
  modoAtivacao,
  type CamposAtivacao,
  type ModoAtivacao,
} from "../../../supabase/functions/_shared/iaGatilho.ts";
import { MAX_TAGS_AO_INICIAR, normalizarTagsAoIniciar } from "../../../supabase/functions/_shared/iaTagsInicio.ts";

/** Agente com os campos do robô (transferência para humano, migration 20261103100000) e da ativação (20261108100000). */
export type AgenteIA = AgenteRobo & CamposAtivacao;

export {
  ATALHOS_AVALIACAO,
  LIMITES_ATIVACAO,
  MODOS_ATIVACAO,
  QUANDO_ATIVAR_AVALIACAO,
  camposDoModo,
  horasHumano,
  maxMensagensGatilho,
  modoAtivacao,
  type ModoAtivacao,
};

/** A linha do agente já tem as colunas da ativação por gatilho (migration 20261108100000 aplicada)? */
export const temColunasAtivacao = (a: object): boolean => "ativacao_modo" in a;
/** A linha do agente já tem a coluna "Tags ao começar" (migration 20261113100000 aplicada)? */
export const temColunaTagsInicio = (a: object): boolean => "tags_ao_iniciar" in a;
export { MAX_TAGS_AO_INICIAR, normalizarTagsAoIniciar };
export { PROMPT_TRANSFERENCIA_PADRAO };
import {
  INSTRUCOES_TENTATIVA_PADRAO,
  PROMPT_FOLLOWUP_PADRAO,
  novoAgenteFollowup,
} from "../../../supabase/functions/_shared/agenteFollowup.ts";

export { ehFollowup, INSTRUCOES_TENTATIVA_PADRAO, PROMPT_FOLLOWUP_PADRAO, novoAgenteFollowup, type TipoAgente };

export {
  FRASE_TRANSFERENCIA_PADRAO,
  LINK_AGENDAMENTO_PADRAO,
  PALAVRAS_TRANSFERENCIA_PADRAO,
  POLITICAS_PADRAO,
  linkAgendamento,
  prontoParaLigar,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (tabela: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export interface ItemConhecimentoDB extends ItemConhecimento {
  id: string;
  agent_id: string;
  file_path: string | null;
  file_name: string | null;
  ordem: number;
}

export interface ExemploDB extends ExemploTreino {
  id: string;
  agent_id: string;
  tipo: "aprovada" | "corrigida";
  resposta_original: string | null;
  created_at: string;
}

export interface VersaoPrompt {
  id: string;
  prompt: string;
  created_at: string;
}

export type Recomendacao = "recomendado" | "evitar" | "indisponivel" | "neutro";

/**
 * Recomendação do número para a IA: o comercial é o certo; o closer (número pessoal/da venda) nunca;
 * o oficial não manda texto livre pelo OpenWA; desativado não responde.
 */
export function recomendacaoNumero(n: Pick<NumeroCRM, "chave" | "apelido" | "tipo" | "ativo">): { nivel: Recomendacao; nota: string } {
  const nome = `${n.chave} ${n.apelido}`.toLowerCase();
  if (!n.ativo) return { nivel: "indisponivel", nota: "desativado na Central" };
  if (n.tipo === "oficial") return { nivel: "indisponivel", nota: "oficial: só manda template, não conversa livre" };
  if (/closer|pessoal/.test(nome)) return { nivel: "evitar", nota: "nunca use o pessoal/closer" };
  if (/comercial/.test(nome)) return { nivel: "recomendado", nota: "recomendado" };
  return { nivel: "neutro", nota: "" };
}

/** Campos que a tela salva no agente (o resto da linha não é tocado). */
export const CAMPOS_AGENTE = [
  "nome", "ativo", "numero_id", "link_agendamento", "etapas", "origens", "gatilhos", "limite_interacoes",
  "palavras_transferencia", "frase_transferencia", "politicas", "horario_inicio", "horario_fim", "dias_semana",
  "mensagem_fora_horario", "modelo", "temperatura", "base_conhecimento", "prompt", "historico_mensagens",
] as const;

/** Campos da transferência para humano: só vão no update quando a linha já os tem (migration aplicada). */
export const CAMPOS_TRANSFERENCIA = [
  "prompt_transferencia", "transferir_sem_mensagem", "transferir_para", "transferir_tag", "transferir_etapa",
  "transferir_fluxo_id", "debounce_segundos", "max_falhas",
] as const;

/** Tempo de resposta (migration 20261105100000): também só vão quando a linha já tem as colunas. */
export const CAMPOS_RITMO = [
  "debounce_max_segundos", "atraso_min_segundos", "atraso_max_segundos", "digitando_ligado", "digitando_cps",
  "intervalo_min_segundos", "intervalo_max_segundos",
] as const;

/** A linha do agente já tem as colunas do tempo de resposta (migration aplicada)? */
export const temColunasRitmo = (a: object): boolean => "atraso_min_segundos" in a;

export function payloadAgente(a: AgenteIA): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_AGENTE) out[k] = (a as unknown as Record<string, unknown>)[k] ?? null;
  for (const k of CAMPOS_TRANSFERENCIA) {
    if (!(k in a)) continue;
    const v = (a as unknown as Record<string, unknown>)[k];
    out[k] = typeof v === "string" ? (v.trim() ? v : null) : v ?? null;
  }
  if ("transferir_sem_mensagem" in a) out.transferir_sem_mensagem = Boolean(a.transferir_sem_mensagem);
  if (temColunasRitmo(a)) {
    // tempo de resposta: tudo na faixa e coerente (máximo >= espera, mínimo <= máximo), igual aos CHECK do banco
    Object.assign(out, camposDoRitmo(normalizarRitmo(a)));
  } else if ("debounce_segundos" in a) {
    // banco sem a migration nova: faixa antiga do CHECK (10..120)
    out.debounce_segundos = Math.min(120, Math.max(10, Number(a.debounce_segundos) || 30));
  }
  if (temColunasAtivacao(a)) {
    // ativação: o "ativo" acompanha o modo (só "todas" liga o caminho antigo); faixas iguais aos CHECK do banco
    Object.assign(out, camposDoModo(modoAtivacao(a)));
    out.ativacao_quando = a.ativacao_quando?.trim() ? a.ativacao_quando : null;
    out.ativacao_max_mensagens = maxMensagensGatilho(a);
    out.ativacao_humano_horas = horasHumano(a);
  }
  // tags ao começar: só vai quando a linha já tem a coluna (sem a migration, o update não quebra)
  if (temColunaTagsInicio(a)) out.tags_ao_iniciar = normalizarTagsAoIniciar(a.tags_ao_iniciar);
  if ("max_falhas" in a) out.max_falhas = Math.min(10, Math.max(1, Number(a.max_falhas) || 3));
  out.horario_inicio = a.horario_inicio || null;
  out.horario_fim = a.horario_fim || null;
  out.mensagem_fora_horario = a.mensagem_fora_horario?.trim() ? a.mensagem_fora_horario : null;
  out.palavras_transferencia = a.palavras_transferencia ?? [];
  out.etapas = a.etapas ?? [];
  out.origens = a.origens ?? [];
  out.gatilhos = a.gatilhos ?? [];
  out.dias_semana = a.dias_semana ?? [];
  out.historico_mensagens = Math.min(40, Math.max(4, Number(a.historico_mensagens) || 20)); // coluna NOT NULL
  out.updated_at = new Date().toISOString();
  return out;
}

/** Texto de um arquivo .txt/.md/.csv/.json (lido no navegador). PDF/Word: o time cola o texto. */
export function arquivoDeTexto(f: File): boolean {
  return /^text\//.test(f.type) || /\.(txt|md|csv|json)$/i.test(f.name);
}

export async function subirArquivoConhecimento(agentId: string, file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo acima de 20 MB.");
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `ia/${agentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("whatsapp-media").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/** Link de agendamento para um contato do chat: cria o código opaco dele no banco na primeira vez. */
export async function linkAgendamentoDoContato(phone: string, agenteSlug: string, base?: string | null): Promise<string> {
  let ref: string | null = null;
  try {
    const { data, error } = await db.rpc("crm_ai_ref_do_contato", { p_phone: phone });
    if (!error && typeof data === "string") ref = data;
  } catch {
    ref = null;
  }
  return linkAgendamento(base ?? LINK_AGENDAMENTO_PADRAO, agenteSlug, ref);
}

// ------------------------------------------------------------------ novo agente

export const TIPOS_AGENTE: { id: TipoAgente; rotulo: string; ajuda: string }[] = [
  { id: "atendimento", rotulo: "Atendimento", ajuda: "Responde a lead na conversa (o robô do número, quando for ligado)." },
  { id: "followup", rotulo: "Follow-up", ajuda: "Escreve a mensagem de retomada no passo Mensagem da IA de um fluxo. Não responde conversa." },
];

export const PROMPT_ATENDIMENTO_INICIAL = [
  "Você é do time comercial e atende leads pelo WhatsApp.",
  "",
  "## OBJETIVO",
  "(o que este agente precisa conseguir na conversa)",
  "",
  "## ROTEIRO",
  "(passo a passo da conversa)",
].join("\n");

/** Linha nova em crm_ai_agents do tipo escolhido (nasce desligada). */
export function linhaNovoAgente(tipo: TipoAgente, nome: string, sufixo?: string): Record<string, unknown> {
  if (tipo === "followup") return novoAgenteFollowup(nome || "Follow-up", sufixo);
  const base = novoAgenteFollowup(nome || "Atendimento", sufixo);
  return {
    ...base,
    tipo: "atendimento",
    descricao: null,
    prompt: PROMPT_ATENDIMENTO_INICIAL,
  };
}

/** Cria o agente e devolve o id. Sem a coluna tipo (migration 20261102100000 pendente), explica o que falta. */
export async function criarAgente(tipo: TipoAgente, nome: string): Promise<string> {
  const { data, error } = await db.from("crm_ai_agents").insert(linhaNovoAgente(tipo, nome)).select("id").single();
  if (error) {
    if (/column .*tipo|tipo.*does not exist|schema cache/i.test(String(error.message))) {
      throw new Error("Falta rodar a migration 20261102100000_crm_ai_agents_followup.sql (coluna tipo).");
    }
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

/** Rótulo do tipo para a tela (banco sem a coluna = atendimento). */
export const rotuloTipo = (a: Pick<AgenteIA, "tipo">): string => (ehFollowup(a) ? "Follow-up" : "Atendimento");
