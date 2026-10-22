// Robô de atendimento por IA (18/10/2026): lógica pura, sem Deno e sem banco. O banco, o Claude e o WhatsApp entram
// por parâmetro (DepsRobo), então o mesmo código roda no Deno (ai-robo-tick, openwa-webhook) e no vitest com IA falsa
// (src/test/crmRoboAtendimento.test.ts).
//
// Estado por conversa (whatsapp_contacts): ai_agent_slug + ai_pausado = quem atende ("ia:<slug>" ou "humano").
// Ciclo de uma mensagem da lead numa conversa da IA:
//   webhook -> crm_ai_enfileirar (debounce: junta mensagens picadas) -> tick -> processarItemFila:
//   portões (robô do número, grupo, quem atende, agente, horário, teto do número)
//   -> atalhos determinísticos (máximo de respostas, palavra de transferência, lead pede humano)
//   -> classificação do Claude com o PROMPT DE TRANSFERÊNCIA ({transferir, motivo})
//   -> resposta (gerarRespostaAtendimento) -> envio com ritmo humano -> log.
// Transferência para humano: despedida (se houver), ai_pausado + ai_precisa_humano, atendente/tag/etapa/fluxo do
// agente, evento "transferido" com o motivo. Falha de IA: não envia, registra, e passa ao humano na N-ésima.
import { pausadaPorHumano } from "./pausaHumana.ts";
import {
  type AgenteIA,
  casaPalavraTransferencia,
  type ContatoIA,
  dentroDoHorario,
  escolherAgente,
  type ExemploTreino,
  FRASE_TRANSFERENCIA_PADRAO,
  historicoParaChat,
  type ItemConhecimento,
  linkAgendamento,
  normalizar,
} from "./agentesIA.ts";
import { type Completar, descreverErroIA, gerarRespostaAtendimento } from "./agenteResponder.ts";
import type { MensagemChat } from "./anthropic.ts";
import { type CamposRitmo, normalizarRitmo, planoEsperas, type RitmoResposta } from "./ritmoResposta.ts";

export {
  calcularResponderApos,
  LIMITES_RITMO,
  normalizarRitmo,
  planoEsperas,
  RITMO_PADRAO,
  type RitmoResposta,
  sortearAtraso,
  tempoDigitandoS,
} from "./ritmoResposta.ts";

// ------------------------------------------------------------------ tipos

/** Campos novos do agente (migration 20261103100000). Opcionais: banco antigo não tem. */
export interface AgenteRobo extends AgenteIA, CamposRitmo {
  prompt_transferencia?: string | null;
  transferir_sem_mensagem?: boolean | null;
  /** atendente (profiles.full_name); vazio = fila geral */
  transferir_para?: string | null;
  transferir_tag?: string | null;
  transferir_etapa?: string | null;
  transferir_fluxo_id?: string | null;
  max_falhas?: number | null;
}

export interface ContatoRobo extends ContatoIA {
  numero_id?: string | null;
  is_group?: boolean | null;
  tags?: string[] | null;
  atendente?: string | null;
  ai_precisa_humano?: boolean | null;
  ai_respostas?: number | null;
  ai_falhas?: number | null;
  ai_atribuido_em?: string | null;
  ai_ref?: string | null;
}

export interface NumeroRobo {
  id: string;
  robo_ia_ligado?: boolean | null;
  robo_ia_max_hora?: number | null;
  ativo?: boolean | null;
  tipo?: string | null;
}

export interface LinhaMensagem {
  direction: string;
  sender_type?: string | null;
  body: string | null;
  caption?: string | null;
  media_type?: string | null;
  created_at: string;
}

export const ehGrupo = (phone: string | null | undefined, isGroup?: boolean | null): boolean =>
  Boolean(isGroup) || String(phone ?? "").endsWith("@g.us");

/** "humano" ou "ia:<slug>". */
export function quemAtende(c: Pick<ContatoRobo, "ai_agent_slug" | "ai_pausado">): string {
  return c.ai_agent_slug && !c.ai_pausado ? `ia:${c.ai_agent_slug}` : "humano";
}

export const iaAtendendo = (c: Pick<ContatoRobo, "ai_agent_slug" | "ai_pausado">): boolean => quemAtende(c) !== "humano";

// ------------------------------------------------------------------ ritmo (debounce, atraso, digitando)
// A conta está em ritmoResposta.ts (tempo de resposta por agente, aba Configuração). Aqui só o envio.

// ------------------------------------------------------------------ lead pede humano

const PEDE_HUMANO = [
  /\b(falar|conversar|atendimento)\s+com\s+(um|uma|alguem|algum|o|a)?\s*(humano|humana|pessoa|atendente|gente|consultor|consultora|vendedor|vendedora)\b/,
  /\b(quero|prefiro|preciso|pode me passar|me passa|chama|chamar)\b.{0,30}\b(humano|atendente|pessoa de verdade|pessoa real|alguem do time|alguem da equipe)\b/,
  /\bvoce e (um )?(robo|bot|ia)\b.{0,40}\b(quero|prefiro)\b/,
  /\b(nao quero|para de) (falar com|conversar com)? ?(robo|bot|ia)\b/,
  /\bpessoa de verdade\b/,
  /\batendente humano\b/,
];

/** A lead pediu para falar com uma pessoa? (normalizado, sem acento) */
export function pedeHumano(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  return PEDE_HUMANO.some((r) => r.test(t));
}

// ------------------------------------------------------------------ prompt de transferência

/**
 * Modelo pronto, copiado da lógica dos agentes do SellFlux importados (migration 20261017110000:
 * "GATILHOS DE TRANSFERÊNCIA IMEDIATA PARA HUMANO", "Transferir para Fila", "terceira pergunta fora de contexto",
 * "Agendamento confirmado, transfere para humano") + as políticas de preço/reembolso da tela Treinar IA.
 */
export const PROMPT_TRANSFERENCIA_PADRAO = [
  "Transfira para o atendimento humano (fila) quando a lead:",
  "- perguntar preço, valor, quanto custa, forma de pagamento, parcelamento ou desconto;",
  "- quiser fechar, comprar, pedir link de pagamento ou contrato;",
  "- pedir reembolso, cancelamento ou garantia, ou reclamar de alguma coisa;",
  "- pedir para falar com uma pessoa, um atendente ou com o Breno;",
  "- pedir para reagendar, trocar o horário ou mudar o dia da consulta;",
  "- trouxer dúvida clínica ou de saúde (remédio, doença, lesão, gestação, exame), inclusive em áudio;",
  "- fizer a terceira pergunta fora do contexto deste roteiro (as duas primeiras a IA responde com o SUPORTE);",
  "- chegar ao fim do roteiro (agendamento confirmado ou etapa final concluída).",
  'Não transfira por "oi", "ok", "obrigada", confirmação curta ou resposta que o roteiro já cobre.',
  "Depois de transferir, a IA não manda mais nada nesta conversa.",
].join("\n");

export const promptTransferencia = (a: Pick<AgenteRobo, "prompt_transferencia">): string =>
  a.prompt_transferencia?.trim() || PROMPT_TRANSFERENCIA_PADRAO;

/** Pedido de classificação: só a regra de transferência + a conversa; resposta em JSON. */
export function montarClassificacao(
  agente: Pick<AgenteRobo, "prompt_transferencia" | "nome">,
  chat: { role: "user" | "assistant"; content: string }[],
): MensagemChat[] {
  const sistema = [
    `Você decide se a conversa de WhatsApp do agente "${agente.nome}" deve passar AGORA para um atendente humano.`,
    "Você NÃO responde a lead. Leia a regra de transferência e a conversa e devolva SÓ um JSON, sem texto em volta:",
    '{"transferir": true ou false, "motivo": "frase curta em português dizendo qual regra bateu (vazio se false)"}',
    "Olhe principalmente as últimas mensagens da lead (as mais recentes, depois da última resposta nossa).",
    "Na dúvida entre responder e transferir, só transfira se a regra mandar claramente.",
    "",
    "## REGRA DE TRANSFERÊNCIA",
    promptTransferencia(agente),
  ].join("\n");
  return [{ role: "system", content: sistema }, ...chat];
}

export interface Classificacao {
  transferir: boolean;
  motivo: string;
}

/** Lê o JSON da classificação (aceita cercas de código e texto em volta). Inválido = null. */
export function lerClassificacao(bruto: string): Classificacao | null {
  const t = String(bruto ?? "");
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    const d = JSON.parse(t.slice(ini, fim + 1)) as { transferir?: unknown; motivo?: unknown };
    if (typeof d?.transferir !== "boolean") return null;
    return { transferir: d.transferir, motivo: String(d.motivo ?? "").trim().slice(0, 300) };
  } catch {
    return null;
  }
}

/** Uma chamada ao Claude para classificar. Erro do modelo sobe (quem chama trata como falha de IA). */
export async function classificarTransferencia(
  agente: AgenteRobo,
  chat: { role: "user" | "assistant"; content: string }[],
  completar: Completar,
): Promise<Classificacao | null> {
  const bruto = await completar(montarClassificacao(agente, chat), { tarefa: "conversa", modelo: agente.modelo });
  return lerClassificacao(bruto);
}

// ------------------------------------------------------------------ transferência para humano

export interface PlanoTransferencia {
  /** despedida a mandar (null = não manda nada) */
  despedida: string | null;
  /** patch do contato */
  contato: Record<string, unknown>;
  /** fluxo a iniciar (crm_fluxo_execucoes) */
  fluxoId: string | null;
  motivo: string;
}

/** O que fazer ao passar a conversa para o humano (pura). `comDespedida` = false quando a IA já escreveu a passagem. */
export function planoTransferencia(
  agente: Pick<AgenteRobo, "frase_transferencia" | "transferir_sem_mensagem" | "transferir_para" | "transferir_tag" | "transferir_etapa" | "transferir_fluxo_id">,
  contato: Pick<ContatoRobo, "tags">,
  motivo: string,
  agora: Date,
  comDespedida = true,
): PlanoTransferencia {
  const patch: Record<string, unknown> = {
    ai_pausado: true,
    ai_pausado_motivo: `transferido: ${motivo}`.slice(0, 200),
    ai_precisa_humano: true,
    ai_transferido_em: agora.toISOString(),
    updated_at: agora.toISOString(),
  };
  const para = agente.transferir_para?.trim();
  if (para) patch.atendente = para.slice(0, 80);
  const tag = agente.transferir_tag?.trim();
  if (tag) {
    const atuais = contato.tags ?? [];
    const n = normalizar(tag);
    patch.tags = atuais.some((t) => normalizar(t) === n) ? atuais : [...atuais, tag];
  }
  const etapa = agente.transferir_etapa?.trim();
  if (etapa) patch.stage = etapa;
  const despedida = comDespedida && !agente.transferir_sem_mensagem
    ? (agente.frase_transferencia?.trim() || FRASE_TRANSFERENCIA_PADRAO)
    : null;
  return { despedida, contato: patch, fluxoId: agente.transferir_fluxo_id || null, motivo };
}

/**
 * A IA escreveu [TRANSFERIR] na resposta: sai a despedida? Só quando ela não escreveu texto nenhum (só a marcação, ou
 * tudo ficou retido): a lead nunca fica sem resposta. Com texto, a frase da IA já é a passagem e não se repete.
 * É a regra de processarItemFila; o simulador usa esta função para mostrar exatamente o que sairia.
 */
export function despedidaDoTransferirDaIA(
  agente: Pick<AgenteRobo, "frase_transferencia" | "transferir_sem_mensagem">,
  resposta: { mensagens: unknown[]; transferir: boolean; silencio?: boolean },
): string | null {
  if (!resposta.transferir || resposta.silencio || resposta.mensagens.length > 0) return null;
  if (agente.transferir_sem_mensagem) return null;
  return agente.frase_transferencia?.trim() || FRASE_TRANSFERENCIA_PADRAO;
}

// ------------------------------------------------------------------ atribuição automática

/**
 * Mensagem da lead chegou: a IA deve atender? Devolve o agente (já atribuído ou atribuído agora) ou o motivo de não.
 * Atribuição automática só em conversa NOVA para a IA (nunca atribuída, sem resposta de humano) e só com agente
 * "Ligado" (ativo) do mesmo número; a escolha (gatilho da 1ª mensagem / origem / etapa) é a de escolherAgente.
 */
export function decidirAoReceber(p: {
  numero: NumeroRobo | null;
  contato: ContatoRobo | null;
  agentes: AgenteRobo[];
  primeiraMensagemLead: string;
  humanoJaRespondeu: boolean;
}): { enfileirar: true; agente: AgenteRobo; atribuirAgora: boolean; motivo: string } | { enfileirar: false; motivo: string } {
  const { numero, contato } = p;
  if (!numero?.robo_ia_ligado) return { enfileirar: false, motivo: "robô de IA desligado neste número" };
  if (!contato) return { enfileirar: false, motivo: "contato não encontrado" };
  if (ehGrupo(contato.phone, contato.is_group)) return { enfileirar: false, motivo: "grupo: a IA nunca responde em grupo" };
  const doNumero = p.agentes.filter((a) => (a.tipo ?? "atendimento") === "atendimento" && a.numero_id === numero.id);
  // atendimento humano entrou (motivo "humano"): o robô não reassume; só o follow-up ou o botão "Devolver para IA"
  if (pausadaPorHumano(contato)) return { enfileirar: false, motivo: "IA pausada: atendimento humano" };
  if (contato.ai_agent_slug) {
    if (contato.ai_pausado) return { enfileirar: false, motivo: "conversa com humano" };
    const a = doNumero.find((x) => x.slug === contato.ai_agent_slug);
    return a ? { enfileirar: true, agente: a, atribuirAgora: false, motivo: "conversa da IA" } : { enfileirar: false, motivo: "agente da conversa não responde neste número" };
  }
  if (contato.ai_atribuido_em) return { enfileirar: false, motivo: "conversa já passou pela IA" };
  if (p.humanoJaRespondeu) return { enfileirar: false, motivo: "humano já respondeu esta conversa" };
  const e = escolherAgente(doNumero, { ...contato, ai_agent_slug: null }, p.primeiraMensagemLead);
  if (!e) return { enfileirar: false, motivo: "nenhum agente ligado casa com esta conversa" };
  return { enfileirar: true, agente: e.agente as AgenteRobo, atribuirAgora: true, motivo: `atribuído por ${e.motivo}` };
}

// Mensagem nossa (fromMe) que o webhook não conhecia: humano ou sistema? Mora em envioSistema.ts (21/10/2026).
export { ehMensagemDeHumano } from "./envioSistema.ts";

// ------------------------------------------------------------------ worker

export interface ItemFila {
  id: number;
  numero_id: string | null;
  contact_phone: string;
  agent_slug: string;
  tentativas: number;
  primeira_msg_em?: string;
}

export interface ContextoItem {
  numero: NumeroRobo | null;
  contato: ContatoRobo | null;
  agente: AgenteRobo | null;
  /** últimas mensagens, MAIS ANTIGA PRIMEIRO */
  historico: LinhaMensagem[];
  conhecimento?: ItemConhecimento[];
  exemplos?: ExemploTreino[];
  etapas?: string[];
  /** mensagens que o robô já mandou neste número na última hora */
  usoNumeroHora: number;
  /** a mensagem de fora do horário já saiu nas últimas 12 h nesta conversa */
  foraHorarioRecente: boolean;
  /** envio do número pausado por restrição (crm_envio_config) */
  envioPausado?: string | null;
}

export type TipoEvento =
  | "resposta" | "transferido" | "fora_horario" | "falha" | "falha_envio" | "silencio" | "ignorado" | "atribuido";

export interface EventoRobo {
  tipo: TipoEvento;
  detalhe: string;
  mensagem?: string | null;
  modelo?: string | null;
}

export interface DepsRobo {
  carregar(item: ItemFila): Promise<ContextoItem>;
  completar: Completar;
  /** manda uma mensagem pelo número da conversa (grava a linha sender_type "bot"); erro = exceção */
  enviar(m: { tipo: "text" | "image" | "audio" | "document"; conteudo: string; gravando?: boolean }): Promise<void>;
  atualizarContato(patch: Record<string, unknown>): Promise<void>;
  iniciarFluxo(fluxoId: string, motivo: string): Promise<void>;
  registrar(e: EventoRobo): Promise<void>;
  dormir(ms: number): Promise<void>;
  /**
   * Indicador "digitando…"/"gravando áudio…" no WhatsApp da lead (opcional; melhor esforço: nunca lança). Sem ele
   * (proxy sem a rota), o robô só espera o mesmo tempo calado.
   */
  digitando?(estado: "typing" | "recording" | "paused"): Promise<void>;
  agora(): Date;
}

export type ResultadoItem =
  | { estado: "feito"; detalhe: string }
  | { estado: "ignorado"; detalhe: string }
  | { estado: "adiar"; detalhe: string; segundos: number }
  | { estado: "erro"; detalhe: string };

const MAX_FALHAS_PADRAO = 3;

/** Texto de uma linha do histórico para o chat do modelo. */
function corpoLinha(l: LinhaMensagem): string {
  const b = String(l.body ?? "").trim() || String(l.caption ?? "").trim();
  if (b) return b;
  return l.media_type ? `[${l.media_type === "audio" ? "áudio" : l.media_type === "image" ? "imagem" : l.media_type}]` : "";
}

type MensagemEnvio = { tipo: "text" | "image" | "audio" | "document"; conteudo: string };

/**
 * Manda as bolhas com o ritmo do agente: intervalo sorteado entre bolhas e "digitando…" proporcional ao tamanho.
 * Devolve quantas saíram; erro de envio sobe com `enviadas` preenchido até ali.
 */
export async function enviarComRitmo(
  mensagens: MensagemEnvio[],
  ritmo: RitmoResposta,
  deps: Pick<DepsRobo, "enviar" | "dormir" | "digitando">,
  aoEnviar: (m: MensagemEnvio) => void = () => {},
  aleatorio: () => number = Math.random,
): Promise<void> {
  const esperas = planoEsperas(mensagens, ritmo, aleatorio);
  for (const [i, m] of mensagens.entries()) {
    const e = esperas[i];
    if (e.intervaloMs > 0) await deps.dormir(e.intervaloMs);
    if (e.digitandoMs > 0) {
      if (deps.digitando) await deps.digitando(m.tipo === "audio" ? "recording" : "typing").catch(() => {});
      await deps.dormir(e.digitandoMs);
    }
    // áudio: o proxy mostra "gravando áudio…" proporcional à duração; só se o agente usa o "digitando"
    await deps.enviar(m.tipo === "audio" ? { ...m, gravando: ritmo.digitando } : m);
    aoEnviar(m);
  }
}

/** Processa um item vencido da fila (uma rajada de mensagens da lead). */
export async function processarItemFila(item: ItemFila, deps: DepsRobo): Promise<ResultadoItem> {
  const ctx = await deps.carregar(item);
  const { numero, contato, agente } = ctx;
  const ignorar = async (detalhe: string, log = true): Promise<ResultadoItem> => {
    if (log) await deps.registrar({ tipo: "ignorado", detalhe });
    return { estado: "ignorado", detalhe };
  };

  if (!numero?.robo_ia_ligado) return ignorar("robô de IA desligado neste número");
  if (!contato) return ignorar("conversa não encontrada");
  if (ehGrupo(contato.phone, contato.is_group)) return ignorar("grupo: a IA nunca responde em grupo");
  if (!iaAtendendo(contato)) return ignorar("conversa com humano", false);
  if (!agente || agente.slug !== contato.ai_agent_slug) return ignorar("agente da conversa não existe mais");
  if ((agente.tipo ?? "atendimento") !== "atendimento") return ignorar("agente de follow-up não atende conversa");
  if (agente.numero_id !== numero.id) return ignorar("o agente responde em outro número");
  const ritmo = normalizarRitmo(agente);

  const linhas = ctx.historico.filter((l) => corpoLinha(l));
  const ultima = linhas[linhas.length - 1];
  if (!ultima || ultima.direction !== "inbound") return ignorar("a última mensagem não é da lead (já respondida)", false);
  // humano respondeu depois da última resposta da IA e o webhook não pausou (corrida): não atropela
  const chat = historicoParaChat(linhas.map((l) => ({ direction: l.direction, sender_type: l.sender_type, body: corpoLinha(l) })));
  // só o que a lead mandou depois da nossa última mensagem conta para atalhos determinísticos
  const ultimasLead: string[] = [];
  for (let i = linhas.length - 1; i >= 0 && linhas[i].direction === "inbound"; i--) ultimasLead.unshift(corpoLinha(linhas[i]));
  const textoLead = ultimasLead.join("\n");
  const agora = deps.agora();

  // horário (regra da tela: fora dele manda só a mensagem de fora do horário, uma vez; vazia = silêncio)
  if (!dentroDoHorario(agente, agora)) {
    const msg = agente.mensagem_fora_horario?.trim() || null;
    if (msg && !ctx.foraHorarioRecente) {
      try {
        await enviarComRitmo([{ tipo: "text", conteudo: msg }], ritmo, deps);
      } catch (e) {
        await deps.registrar({ tipo: "falha_envio", detalhe: `mensagem de fora do horário não saiu: ${descreverErroIA(e)}` });
        return { estado: "erro", detalhe: "envio fora do horário falhou" };
      }
      await deps.registrar({ tipo: "fora_horario", detalhe: "fora do horário: mandou a mensagem de fora do horário", mensagem: msg });
      return { estado: "feito", detalhe: "fora do horário (mensagem enviada)" };
    }
    await deps.registrar({ tipo: "fora_horario", detalhe: msg ? "fora do horário: mensagem já enviada nas últimas 12 h, silêncio" : "fora do horário: silêncio (sem mensagem configurada)" });
    return { estado: "ignorado", detalhe: "fora do horário" };
  }

  // anti-ban: envio pausado por restrição e teto do robô por hora no número
  if (ctx.envioPausado) return { estado: "adiar", detalhe: `envio pausado: ${ctx.envioPausado}`, segundos: 300 };
  const teto = Number(numero.robo_ia_max_hora ?? 60);
  if (ctx.usoNumeroHora >= teto) return { estado: "adiar", detalhe: `teto do robô no número (${ctx.usoNumeroHora}/${teto} na última hora)`, segundos: 300 };

  const transferir = async (motivo: string, comDespedida = true): Promise<ResultadoItem> => {
    const plano = planoTransferencia(agente, contato, motivo, agora, comDespedida);
    if (plano.despedida) {
      try {
        await enviarComRitmo([{ tipo: "text", conteudo: plano.despedida }], ritmo, deps);
      } catch (e) {
        // a despedida não saiu: transfere do mesmo jeito (o humano assume) e registra
        await deps.registrar({ tipo: "falha_envio", detalhe: `despedida não saiu: ${descreverErroIA(e)}` });
      }
    }
    await deps.atualizarContato(plano.contato);
    if (plano.fluxoId) await deps.iniciarFluxo(plano.fluxoId, motivo);
    const extras = [
      agente.transferir_para?.trim() ? `para ${agente.transferir_para.trim()}` : "fila geral",
      agente.transferir_tag?.trim() ? `tag ${agente.transferir_tag.trim()}` : "",
      agente.transferir_etapa?.trim() ? `etapa ${agente.transferir_etapa.trim()}` : "",
      plano.fluxoId ? "fluxo iniciado" : "",
    ].filter(Boolean).join(", ");
    await deps.registrar({ tipo: "transferido", detalhe: `${motivo} (${extras})`, mensagem: plano.despedida, modelo: agente.modelo });
    return { estado: "feito", detalhe: `transferido: ${motivo}` };
  };

  const falhaIA = async (detalhe: string): Promise<ResultadoItem> => {
    const falhas = Number(contato.ai_falhas ?? 0) + 1;
    const max = Number(agente.max_falhas ?? MAX_FALHAS_PADRAO);
    await deps.registrar({ tipo: "falha", detalhe: `${detalhe} (falha ${falhas} de ${max})`, modelo: agente.modelo });
    if (falhas >= max) {
      await deps.atualizarContato({ ai_falhas: falhas });
      return transferir(`a IA falhou ${falhas} vezes seguidas`, false);
    }
    await deps.atualizarContato({ ai_falhas: falhas });
    return { estado: "adiar", detalhe, segundos: 60 };
  };

  // atalhos determinísticos
  const limite = Number(agente.limite_interacoes ?? 15);
  if (limite > 0 && Number(contato.ai_respostas ?? 0) >= limite) return transferir(`máximo de ${limite} respostas da IA atingido`);
  const palavra = casaPalavraTransferencia(agente.palavras_transferencia, textoLead);
  if (palavra) return transferir(`palavra de transferência "${palavra}"`);
  if (pedeHumano(textoLead)) return transferir("a lead pediu para falar com uma pessoa");

  // classificação com o prompt de transferência (antes da resposta normal)
  let cls: Classificacao | null;
  try {
    cls = await classificarTransferencia(agente, chat, deps.completar);
  } catch (e) {
    return falhaIA(`IA (Claude) falhou na decisão de transferência: ${descreverErroIA(e)}`);
  }
  if (!cls) return falhaIA("a decisão de transferência veio fora do formato (JSON)");
  if (cls.transferir) return transferir(cls.motivo ? `IA decidiu transferir: ${cls.motivo}` : "IA decidiu transferir");

  // resposta normal
  let gerado: Awaited<ReturnType<typeof gerarRespostaAtendimento>>;
  try {
    const link = linkAgendamento(agente.link_agendamento, agente.slug, contato.ai_ref ?? null);
    gerado = await gerarRespostaAtendimento({
      agente, contato, chat, etapas: ctx.etapas, treino: { conhecimento: ctx.conhecimento ?? [], exemplos: ctx.exemplos ?? [] },
      extras: { link_agendamento: link }, completar: deps.completar, agora,
    });
  } catch (e) {
    return falhaIA(`IA (Claude) falhou ao responder: ${descreverErroIA(e)}`);
  }
  const r = gerado.resposta;
  if (r.silencio) {
    await deps.atualizarContato({ ai_falhas: 0 });
    await deps.registrar({ tipo: "silencio", detalhe: "a IA decidiu não responder agora ([SILENCIO])", mensagem: gerado.bruto.slice(0, 2000), modelo: agente.modelo });
    return { estado: "feito", detalhe: "silêncio" };
  }
  if (!r.mensagens.length) {
    // IA devolveu só "[TRANSFERIR]" (ou tudo ficou retido): transfere COM a despedida configurada, para a lead nunca
    // ficar sem resposta (só não sai se o agente marcou "Não mandar nada").
    const motivo = r.retidas.length ? `variável sem valor na resposta: ${r.retidas.join(", ")}` : r.transferir ? "a IA pediu [TRANSFERIR]" : "a IA não soube responder (resposta vazia)";
    return transferir(motivo);
  }

  // envio com o ritmo do agente (intervalo entre bolhas + "digitando…"); o atraso antes de responder já foi na fila
  const enviadas: string[] = [];
  try {
    await enviarComRitmo(r.mensagens, ritmo, deps, (m) => enviadas.push(m.tipo === "text" ? m.conteudo : `[${m.tipo}] ${m.conteudo}`));
  } catch (e) {
    await deps.registrar({ tipo: "falha_envio", detalhe: `WhatsApp não enviou: ${descreverErroIA(e)}`, mensagem: enviadas.join("\n\n") || null });
    if (enviadas.length) await deps.atualizarContato({ ai_respostas: Number(contato.ai_respostas ?? 0) + 1 });
    return falhaIA("envio pelo WhatsApp falhou");
  }
  const patch: Record<string, unknown> = { ai_respostas: Number(contato.ai_respostas ?? 0) + 1, ai_falhas: 0 };
  if (r.etapa) patch.stage = r.etapa;
  await deps.atualizarContato(patch);
  await deps.registrar({ tipo: "resposta", detalhe: `respondeu ${enviadas.length} mensagem(ns)${r.etapa ? `, etapa → ${r.etapa}` : ""}`, mensagem: enviadas.join("\n\n"), modelo: agente.modelo });
  if (r.transferir) {
    const motivo = r.retidas.length ? `variável sem valor na resposta: ${r.retidas.join(", ")}` : "a IA pediu [TRANSFERIR]";
    // a IA já escreveu a frase de passagem: não manda a despedida de novo
    return transferir(motivo, false);
  }
  return { estado: "feito", detalhe: `respondeu ${enviadas.length}` };
}
