// Geração de resposta dos agentes de IA, num lugar só (18/10/2026). Lógica pura: o modelo (Claude) e o banco
// entram por parâmetro, então o mesmo código roda no Deno (crm-automacoes, ai-agent-simular) e no vitest com IA
// falsa (src/test/crmAgenteResponder.test.ts).
//
//  - gerarRespostaAtendimento: o que o robô de atendimento vai usar para responder a lead (prompt + histórico +
//    marcações). Hoje só o simulador chama. NÃO há resposta automática a mensagem recebida: ligar isso é outra
//    entrega, no whatsapp-webhook / openwa-webhook.
//  - gerarFollowup / executarPassoFollowup: o passo "Mensagem da IA (follow-up)" dos fluxos.
import { semChave, type MensagemChat } from "./anthropic.ts";
import {
  type AgenteIA,
  type ContatoIA,
  ehFollowup,
  type ExemploTreino,
  finalizarSaida,
  type ItemConhecimento,
  interpretarResposta,
  montarSistema,
  nomeDoFormulario,
  type RespostaInterpretada,
} from "./agentesIA.ts";
import {
  type AgenteFollowup,
  bloqueioAntesDoModelo,
  type ContatoFollowup,
  finalizarFollowup,
  type LinhaHistorico,
  montarPedidoFollowup,
  tamanhoHistorico,
} from "./agenteFollowup.ts";

/** Quem chama o modelo. No Deno é completarChatCRM (_shared/iaCRM.ts); no teste, uma função falsa. */
export type Completar = (mensagens: MensagemChat[], opcoes: { tarefa: "conversa"; modelo?: string | null }) => Promise<string>;

/** Erro da IA em uma linha para log/tela: status HTTP (quando houver) + detalhe, sem a chave. */
export function descreverErroIA(e: unknown): string {
  const x = e as { status?: unknown; detalhe?: unknown; message?: unknown } | null;
  const status = typeof x?.status === "number" ? x.status : null;
  const det = typeof x?.detalhe === "string" ? x.detalhe : typeof x?.message === "string" ? x.message : String(e);
  return semChave(`${status ? `HTTP ${status}: ` : ""}${det}`).slice(0, 400);
}

// ------------------------------------------------------------------ atendimento (base do robô)

export interface PedidoAtendimento {
  agente: AgenteIA;
  contato: ContatoIA;
  /** conversa já no formato do chat (lead = user, nós = assistant); a última precisa ser da lead */
  chat: { role: "user" | "assistant"; content: string }[];
  completar: Completar;
  etapas?: string[];
  treino?: { conhecimento?: ItemConhecimento[]; exemplos?: ExemploTreino[] };
  /** valores de [LINK_AGENDAMENTO] e afins */
  extras?: Record<string, string>;
  agora?: Date;
}

/** Prompt do agente + histórico → Claude → marcações lidas → saída final (variável sem valor retém a mensagem). */
export async function gerarRespostaAtendimento(p: PedidoAtendimento): Promise<{ bruto: string; resposta: RespostaInterpretada & { retidas: string[] } }> {
  // Conversa que começou pela mensagem do formulário: o nome digitado lá vale mais que o do WhatsApp (21/10/2026).
  const nomeForm = p.contato.nome_formulario?.trim() || nomeDoFormulario(p.chat);
  const contato = nomeForm ? { ...p.contato, nome_formulario: nomeForm } : p.contato;
  const sistema = montarSistema(p.agente, contato, p.agora ?? new Date(), p.etapas, p.treino ?? {});
  const bruto = await p.completar([{ role: "system", content: sistema }, ...p.chat], { tarefa: "conversa", modelo: p.agente.modelo });
  // {primeiro_nome} e {nome} na saída também usam o nome do formulário
  const paraVariaveis = nomeForm ? { ...contato, name: nomeForm } : contato;
  return { bruto, resposta: finalizarSaida(interpretarResposta(bruto, p.etapas), paraVariaveis, p.extras ?? {}) };
}

// ------------------------------------------------------------------ follow-up

export type ResultadoFollowup =
  | { ok: true; texto: string; bruto: string; chamadas: number }
  /** falhaIA = o modelo não respondeu (sem chave, 4xx/5xx, timeout); false = uma trava decidiu não mandar */
  | { ok: false; motivo: string; falhaIA: boolean; bruto?: string };

export interface PedidoFollowup {
  agente: AgenteFollowup;
  contato: ContatoFollowup;
  /** últimas mensagens da conversa (qualquer ordem) */
  historico: LinhaHistorico[];
  instrucao?: string | null;
  tentativa?: number | null;
  /** início da execução do fluxo: mensagem da lead depois disso = ela respondeu (não sai) */
  desde?: string | null;
  completar: Completar;
  agora?: Date;
}

/**
 * Escreve a mensagem de follow-up. Travas antes do modelo (respondeu / pediu para parar), uma chamada ao Claude,
 * travas depois (silêncio, preço, variável, tamanho, repetição). Saiu repetida: UMA segunda chamada pedindo outra.
 */
export async function gerarFollowup(p: PedidoFollowup): Promise<ResultadoFollowup> {
  const bloqueio = bloqueioAntesDoModelo(p.historico, p.desde);
  if (bloqueio) return { ok: false, motivo: bloqueio.motivo, falhaIA: false };
  const enviadas = p.historico.filter((m) => m.direction === "outbound").map((m) => String(m.body ?? "")).filter((t) => t.trim());
  let evitar: string | null = null;
  for (let chamada = 1; chamada <= 2; chamada++) {
    const msgs = montarPedidoFollowup({
      agente: p.agente, contato: p.contato, historico: p.historico, instrucao: p.instrucao, tentativa: p.tentativa, agora: p.agora, evitar,
    });
    let bruto: string;
    try {
      bruto = await p.completar(msgs, { tarefa: "conversa", modelo: p.agente.modelo ?? null });
    } catch (e) {
      return { ok: false, falhaIA: true, motivo: `IA (Claude) falhou: ${descreverErroIA(e)}` };
    }
    const s = finalizarFollowup(bruto, p.contato, enviadas);
    // checagem com "in": o tsconfig do front não é strict e não estreita a união pelo boolean
    if ("texto" in s) return { ok: true, texto: s.texto, bruto, chamadas: chamada };
    if (s.repetida && chamada === 1) { evitar = s.repetida; continue; }
    return { ok: false, falhaIA: false, motivo: chamada > 1 ? `${s.motivo} (mesmo pedindo outra)` : s.motivo, bruto };
  }
  return { ok: false, falhaIA: false, motivo: "sem mensagem" }; // inalcançável
}

/** Ação gravada na fila pelo motor para o passo "Mensagem da IA". */
export interface AcaoFollowup {
  agente_id: string;
  instrucao?: string | null;
  tentativa?: number | null;
}

export type ResultadoPasso =
  | { estado: "enviado" }
  | { estado: "ignorado"; motivo: string }
  | { estado: "erro"; motivo: string; falhaWhatsApp?: { status: number; detalhe: unknown } };

/** O que o motor injeta (banco, Claude e WhatsApp). */
export interface DepsPassoFollowup {
  carregarAgente(id: string): Promise<AgenteFollowup | null>;
  carregarHistorico(phone: string, limite: number): Promise<LinhaHistorico[]>;
  completar: Completar;
  /** manda o texto pelo número do fluxo e grava a mensagem; devolve o resultado do envio */
  enviarTexto(texto: string): Promise<ResultadoPasso>;
  /** linha no log do fluxo (crm_automacao_log, canal crm, tipo ia_followup) */
  registrar(ok: boolean, detalhe: string): Promise<void>;
}

/**
 * Executa o passo na hora do envio: carrega o agente e a conversa, gera com o Claude, registra a mensagem gerada
 * no log e só então envia. IA falhou = não envia, log com o motivo e estado "erro" (o motor tenta de novo uma vez,
 * 15 min depois). Trava (respondeu, pediu para parar, preço, repetida...) = "ignorado", nada sai.
 */
export async function executarPassoFollowup(
  acao: AcaoFollowup,
  ctx: { contato: ContatoFollowup; desde?: string | null; agora?: Date },
  deps: DepsPassoFollowup,
): Promise<ResultadoPasso> {
  const agente = acao.agente_id ? await deps.carregarAgente(acao.agente_id) : null;
  if (!agente) {
    await deps.registrar(false, "não enviado: o agente de follow-up do passo não existe mais");
    return { estado: "ignorado", motivo: "agente de follow-up não existe" };
  }
  if (!ehFollowup(agente)) {
    await deps.registrar(false, `não enviado: o agente ${agente.nome} não é de follow-up`);
    return { estado: "ignorado", motivo: "agente não é de follow-up" };
  }
  const historico = await deps.carregarHistorico(ctx.contato.phone, tamanhoHistorico(agente));
  const r = await gerarFollowup({
    agente, contato: ctx.contato, historico, instrucao: acao.instrucao, tentativa: acao.tentativa, desde: ctx.desde,
    completar: deps.completar, agora: ctx.agora,
  });
  const quem = `agente ${agente.nome}${acao.tentativa ? `, ${acao.tentativa}ª tentativa` : ""}`;
  if ("motivo" in r) {
    await deps.registrar(false, `não enviado (${quem}): ${r.motivo}`);
    return r.falhaIA ? { estado: "erro", motivo: r.motivo } : { estado: "ignorado", motivo: r.motivo };
  }
  await deps.registrar(true, `mensagem gerada (${quem}): "${r.texto}"`);
  return deps.enviarTexto(r.texto);
}
