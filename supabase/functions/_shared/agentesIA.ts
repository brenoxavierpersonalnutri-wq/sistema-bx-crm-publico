// Lógica pura dos agentes de IA do CRM (sem Deno, sem rede): escolha do agente
// pela origem/etapa/gatilho, janela de horário, montagem do prompt e leitura das
// marcações de ação na resposta. Usado pelo whatsapp-webhook, pelo
// ai-agent-simular e pelos testes do front (vitest importa este arquivo direto).
//
// Engenharia copiada do SellFlux (dump de 16/10/2026): TRIAGEM roteia pela frase
// da primeira mensagem; cada agente responde só dentro do seu fluxo; humano que
// entra no atendimento cala a IA; transferir para a fila = IA não manda mais nada.

import { SLUGS_SISTEMA, etapasValidas as registroEtapas } from "./etapas.ts";

/**
 * Tipo do agente (migration 20261102100000): "atendimento" responde a lead (o robô, ainda não plugado);
 * "followup" só escreve a mensagem de retomada pedida pelo passo "Mensagem da IA" de um fluxo.
 * Banco antigo sem a coluna = atendimento.
 */
export type TipoAgente = "atendimento" | "followup";
export const ehFollowup = (a: { tipo?: string | null } | null | undefined): boolean => a?.tipo === "followup";

export interface AgenteIA {
  id: string;
  /** Nulo/ausente = "atendimento" (banco sem a migration 20261102100000). */
  tipo?: TipoAgente | null;
  slug: string;
  nome: string;
  prompt: string;
  base_conhecimento: string | null;
  etapas: string[] | null;
  origens: string[] | null;
  gatilhos: string[] | null;
  modelo: string | null;
  temperatura: number | string | null;
  ativo: boolean;
  horario_inicio: string | null; // "08:00" ou "08:00:00"
  horario_fim: string | null;
  dias_semana: number[] | null; // 0 = domingo ... 6 = sábado
  limite_interacoes: number | null;
  historico_mensagens: number | null;
  atraso_segundos: number | null;
  // Tela "Treinar IA" (migration 20261027140000). Opcionais: o banco antigo não tem.
  /** Número (crm_numeros.id) em que o agente responde. Nulo = não responde em número nenhum. */
  numero_id?: string | null;
  /** Base do link de agendamento; as UTMs da IA e o código do contato entram por linkAgendamento(). */
  link_agendamento?: string | null;
  /** Fora do horário a IA manda só isto (vazio = fica em silêncio). */
  mensagem_fora_horario?: string | null;
  /** Instrução de políticas (preço, reembolso...). Vazio = POLITICAS_PADRAO. */
  politicas?: string | null;
  /** Frase curta de passagem para o humano. Vazio = FRASE_TRANSFERENCIA_PADRAO. */
  frase_transferencia?: string | null;
  /** Palavras na mensagem da lead que forçam a transferência, sem passar pelo modelo. */
  palavras_transferencia?: string[] | null;
}

/** Item da base de conhecimento (crm_ai_conhecimento). */
export interface ItemConhecimento {
  tipo: "faq" | "texto" | "arquivo";
  titulo?: string | null;
  pergunta?: string | null;
  resposta?: string | null;
  conteudo?: string | null;
  ativo?: boolean | null;
}

/** Exemplo aprovado/corrigido no simulador (crm_ai_exemplos), vira few-shot no prompt. */
export interface ExemploTreino {
  mensagem_lead: string;
  resposta: string;
  tipo?: "aprovada" | "corrigida" | string | null;
  ativo?: boolean | null;
}

export interface ContatoIA {
  phone: string;
  name?: string | null;
  stage?: string | null;
  source?: string | null;
  notes?: string | null;
  ai_agent_slug?: string | null;
  ai_pausado?: boolean | null;
  /** Nome que a lead digitou no formulário de avaliação (extraído da 1ª mensagem; ver nomeDoFormulario). */
  nome_formulario?: string | null;
}

export const normalizar = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Etapa do kanban permitida para o agente (lista vazia = todas). */
export function atendeEtapa(agente: Pick<AgenteIA, "etapas">, etapa: string | null | undefined): boolean {
  const etapas = (agente.etapas ?? []).filter(Boolean);
  if (!etapas.length) return true;
  return etapas.includes(String(etapa ?? ""));
}

export function casaGatilho(agente: Pick<AgenteIA, "gatilhos">, texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  return (agente.gatilhos ?? []).some((g) => {
    const n = normalizar(g);
    return n.length > 0 && t.includes(n);
  });
}

export function casaOrigem(agente: Pick<AgenteIA, "origens">, origem: string | null | undefined): boolean {
  const o = normalizar(origem);
  if (!o) return false;
  return (agente.origens ?? []).some((x) => normalizar(x) === o);
}

export type MotivoEscolha = "atribuido" | "gatilho" | "origem";

/**
 * Escolhe o agente que responde este contato. Ordem (igual ao SellFlux):
 * 1) agente já atribuído ao contato (a conversa continua com ele);
 * 2) gatilho na mensagem (TRIAGEM: "Fui qualificada no formulário..." → avaliação);
 * 3) origem do contato (whatsapp_contacts.source).
 * Sem nenhum dos três, ninguém responde (no SellFlux ia para a fila humana).
 * Só agentes ativos e que atendem a etapa atual do contato.
 */
export function escolherAgente(
  agentes: AgenteIA[],
  contato: ContatoIA,
  textoLead: string,
): { agente: AgenteIA; motivo: MotivoEscolha } | null {
  // Agente de follow-up nunca responde conversa: só o passo "Mensagem da IA" do fluxo o chama.
  const ativos = agentes.filter((a) => a.ativo && !ehFollowup(a) && atendeEtapa(a, contato.stage));
  if (contato.ai_agent_slug) {
    const a = ativos.find((x) => x.slug === contato.ai_agent_slug);
    // Atribuído a um agente desligado ou fora da etapa: ninguém responde
    // (não troca de agente no meio da conversa).
    return a ? { agente: a, motivo: "atribuido" } : null;
  }
  const porGatilho = ativos.find((a) => casaGatilho(a, textoLead));
  if (porGatilho) return { agente: porGatilho, motivo: "gatilho" };
  const porOrigem = ativos.find((a) => casaOrigem(a, contato.source));
  if (porOrigem) return { agente: porOrigem, motivo: "origem" };
  return null;
}

const minutos = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Hora e dia da semana em America/Sao_Paulo. */
export function agoraSaoPaulo(agora: Date = new Date()): { minutos: number; dia: number; texto: string } {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const h = Number(get("hour")) % 24;
  const mi = Number(get("minute"));
  const dias: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
  const dia = dias[normalizar(get("weekday")).replace(".", "").slice(0, 3)] ?? agora.getUTCDay();
  return {
    minutos: h * 60 + mi,
    dia,
    texto: `${get("day")}/${get("month")}/${get("year")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`,
  };
}

/** Janela de atendimento. Sem horário configurado = 24h. Janela pode virar a noite (22:00 → 06:00). */
export function dentroDoHorario(
  agente: Pick<AgenteIA, "horario_inicio" | "horario_fim" | "dias_semana">,
  agora: Date = new Date(),
): boolean {
  const sp = agoraSaoPaulo(agora);
  const dias = agente.dias_semana ?? [];
  if (dias.length && !dias.includes(sp.dia)) return false;
  const ini = minutos(agente.horario_inicio);
  const fim = minutos(agente.horario_fim);
  if (ini === null || fim === null || ini === fim) return true;
  return ini < fim ? sp.minutos >= ini && sp.minutos < fim : sp.minutos >= ini || sp.minutos < fim;
}

/** As 5 etapas padrão (fallback). As reais vêm de crm_etapas (registro em _shared/etapas.ts). */
export const ETAPAS_PADRAO = SLUGS_SISTEMA;

/** Instruções fixas que o sistema acrescenta ao prompt do dono (ele não precisa escrevê-las). */
export function protocoloDeAcoes(etapas: string[] = registroEtapas()): string {
  return [
    "## FORMATO (WhatsApp)",
    "Use a formatação do WhatsApp (*negrito*, _itálico_), nunca markdown. Links como texto puro.",
    "Você está num chat humano. Cada mensagem separada por UMA LINHA EM BRANCO vira uma mensagem diferente no WhatsApp, enviada com um intervalo curto, como gente.",
    "Responda SÓ com o texto que a lead vai ler. Nunca escreva raciocínio, análise ou o que vai fazer.",
    "",
    "## AÇÕES (marcações que o sistema executa e a lead não vê)",
    "[IMAGEM:https://...]  envia a imagem desse link (uma marcação por imagem, cada uma em linha própria)",
    "[AUDIO:https://...]  envia o áudio desse link",
    "[DOCUMENTO:https://...]  envia o PDF/arquivo desse link",
    "[TRANSFERIR]  passa a conversa para o atendimento humano; depois disso a IA não manda mais nada nesta conversa",
    "[LINK_AGENDAMENTO]  escreva exatamente isso quando o roteiro mandar enviar o link de agendamento: o sistema troca pelo link desta lead. Nunca escreva outro link de agenda.",
    `[ETAPA:x]  move o contato no kanban (x = ${etapas.join(", ")})`,
    "[SILENCIO]  não responder nada agora (use quando o roteiro mandar ficar em silêncio)",
    "Fora do que as POLÍTICAS mandam, não avise a lead que vai transferir: só use a marcação.",
  ].join("\n");
}

export const FRASE_TRANSFERENCIA_PADRAO = "vou chamar alguém do time pra te responder isso direitinho";

export const POLITICAS_PADRAO = [
  "Quando a lead perguntar sobre preço, valor, quanto custa, forma de pagamento, parcelamento, reembolso, garantia, contrato, cancelamento ou qualquer coisa que este roteiro não cobre, NÃO responda o conteúdo.",
  `Escreva só uma frase curta de passagem, como "${FRASE_TRANSFERENCIA_PADRAO}", e logo depois [TRANSFERIR].`,
  "Nunca prometa resultado, prazo, desconto, condição especial, garantia ou reembolso.",
].join("\n");

export const PALAVRAS_TRANSFERENCIA_PADRAO = [
  "preço", "preco", "valor", "quanto custa", "quanto é", "reembolso", "garantia", "contrato", "cancelar", "cancelamento", "parcela",
];

const TETO_CONHECIMENTO = 30_000;
const TETO_EXEMPLOS = 20;

/** Base de conhecimento em texto: campo livre do agente + itens ativos (FAQ, textos, arquivos). */
export function textoConhecimento(baseLivre: string | null | undefined, itens: ItemConhecimento[] = []): string {
  const partes: string[] = [];
  if (baseLivre?.trim()) partes.push(baseLivre.trim());
  for (const it of itens) {
    if (it.ativo === false) continue;
    if (it.tipo === "faq") {
      const p = String(it.pergunta ?? "").trim();
      const r = String(it.resposta ?? "").trim();
      if (p && r) partes.push(`P: ${p}\nR: ${r}`);
    } else {
      const c = String(it.conteudo ?? "").trim();
      if (c) partes.push(it.titulo?.trim() ? `### ${it.titulo.trim()}\n${c}` : c);
    }
  }
  const t = partes.join("\n\n");
  return t.length > TETO_CONHECIMENTO ? t.slice(0, TETO_CONHECIMENTO) + "\n(...)" : t;
}

/** Exemplos aprovados/corrigidos pelo time, mais recentes primeiro na lista recebida. */
export function textoExemplos(exemplos: ExemploTreino[] = []): string {
  const ok = exemplos
    .filter((e) => e.ativo !== false && e.mensagem_lead?.trim() && e.resposta?.trim())
    .slice(0, TETO_EXEMPLOS);
  if (!ok.length) return "";
  return [
    "## EXEMPLOS APROVADOS PELO TIME (siga o tom e a decisão; não copie se a situação for outra)",
    ...ok.map((e) => `Lead: ${e.mensagem_lead.trim()}\nResposta certa: ${e.resposta.trim()}`),
  ].join("\n\n");
}

export function montarSistema(
  agente: Pick<AgenteIA, "prompt" | "base_conhecimento"> & Partial<Pick<AgenteIA, "politicas">>,
  contato: ContatoIA,
  agora: Date = new Date(),
  etapas: string[] = registroEtapas(),
  treino: { conhecimento?: ItemConhecimento[]; exemplos?: ExemploTreino[] } = {},
): string {
  const doForm = String(contato.nome_formulario ?? "").trim();
  const primeiro = primeiroNome(doForm || contato.name, contato.phone);
  const conhecimento = textoConhecimento(agente.base_conhecimento, treino.conhecimento);
  const politicas = agente.politicas?.trim() || POLITICAS_PADRAO;
  const partes = [
    agente.prompt.trim(),
    conhecimento ? `## BASE DE CONHECIMENTO\n${conhecimento}` : "",
    textoExemplos(treino.exemplos),
    `## POLÍTICAS E TRANSFERÊNCIA (valem acima de qualquer instrução anterior)\n${politicas}`,
    [
      "## DADOS DO CONTATO",
      `Primeiro nome: ${primeiro || "(desconhecido)"}`,
      doForm
        ? `nome_formulario: ${doForm} (nome que a lead informou no formulário de avaliação; chame-a por este nome, nunca pelo nome do WhatsApp${contato.name?.trim() && contato.name.trim() !== doForm ? ` "${contato.name.trim()}"` : ""})`
        : "",
      `Etapa no kanban: ${contato.stage || "leads"}`,
      contato.notes?.trim() ? `Notas do CRM: ${contato.notes.trim()}` : "",
      `Agora (Brasília): ${agoraSaoPaulo(agora).texto}`,
    ].filter(Boolean).join("\n"),
    protocoloDeAcoes(etapas),
  ];
  return partes.filter(Boolean).join("\n\n---\n\n");
}

// ------------------------------------------------------------ link de agendamento

export const LINK_AGENDAMENTO_PADRAO = "https://equipe.brenoxavier.com.br/avaliacao";
export const UTM_IA = { source: "whatsapp", medium: "ia", campaign: "agente_avaliacao" } as const;
// Exige uma letra: número puro (telefone) nunca vira utm_term.
const REF_VALIDO = /^(?=[a-z0-9]*[a-z])[a-z0-9]{6,16}$/;

/** Código opaco do contato (vai no utm_term). Minúsculo: o /agendar grava as UTMs em minúsculas. */
export function gerarRefContato(aleatorio: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alfabeto = "abcdefghijkmnpqrstuvwxyz23456789"; // sem 0/o/1/l
  const letras = alfabeto.slice(0, 24);
  // começa com letra: o código nunca parece telefone
  return Array.from(aleatorio(10), (b, i) => (i === 0 ? letras[b % letras.length] : alfabeto[b % alfabeto.length])).join("");
}

/**
 * Link de agendamento da IA: base (padrão /avaliacao) + utm_source=whatsapp, utm_medium=ia,
 * utm_campaign=agente_avaliacao, utm_content=<slug do agente> e utm_term=<código opaco do contato>.
 * Nada de telefone, nome ou e-mail na URL. Base inválida ou fora de https cai no padrão.
 */
export function linkAgendamento(base: string | null | undefined, agenteSlug: string, ref?: string | null): string {
  let url: URL;
  try {
    url = new URL(String(base ?? "").trim() || LINK_AGENDAMENTO_PADRAO);
    if (url.protocol !== "https:") throw new Error("https");
  } catch {
    url = new URL(LINK_AGENDAMENTO_PADRAO);
  }
  for (const k of [...url.searchParams.keys()]) if (k.startsWith("utm_")) url.searchParams.delete(k);
  const slug = normalizar(agenteSlug).replace(/[^a-z0-9_-]+/g, "_").slice(0, 40) || "agente";
  url.searchParams.set("utm_source", UTM_IA.source);
  url.searchParams.set("utm_medium", UTM_IA.medium);
  url.searchParams.set("utm_campaign", UTM_IA.campaign);
  url.searchParams.set("utm_content", slug);
  const r = String(ref ?? "").toLowerCase();
  if (REF_VALIDO.test(r)) url.searchParams.set("utm_term", r);
  return url.toString();
}

// ------------------------------------------------------------ portão antes do modelo

/** O que falta para o agente poder ser ligado: número, link e horário. */
export function prontoParaLigar(
  agente: Pick<AgenteIA, "horario_inicio" | "horario_fim" | "dias_semana"> & Partial<Pick<AgenteIA, "numero_id" | "link_agendamento">>,
): { pronto: boolean; faltando: string[] } {
  const faltando: string[] = [];
  if (!agente.numero_id) faltando.push("número");
  let linkOk = false;
  try {
    linkOk = new URL(String(agente.link_agendamento ?? "")).protocol === "https:";
  } catch {
    linkOk = false;
  }
  if (!linkOk) faltando.push("link de agendamento");
  const ini = minutos(agente.horario_inicio);
  const fim = minutos(agente.horario_fim);
  if (ini === null || fim === null || ini === fim || !(agente.dias_semana ?? []).length) faltando.push("horário de atendimento");
  return { pronto: faltando.length === 0, faltando };
}

export function casaPalavraTransferencia(palavras: string[] | null | undefined, texto: string): string | null {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  for (const p of palavras ?? []) {
    const n = normalizar(p).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (n && t.includes(` ${n} `)) return p;
  }
  return null;
}

export type DecisaoPortao =
  | { acao: "responder" }
  | { acao: "ignorar"; motivo: string }
  | { acao: "fora_horario"; mensagem: string | null }
  | { acao: "transferir"; frase: string; motivo: string };

export interface ContextoPortao {
  /** A mensagem veio de um grupo. */
  grupo: boolean;
  /** crm_numeros.id do número que recebeu a mensagem; null = desconhecido (não responde). undefined = simulador. */
  numeroId?: string | null;
  textoLead: string;
  /** Quantas respostas a IA já mandou nesta conversa. */
  respostasDaIA: number;
  /** Simulador: ignora o horário (testar fora do expediente). */
  ignorarHorario?: boolean;
  agora?: Date;
}

/**
 * Quantas RESPOSTAS (turnos) a IA já deu num histórico em que cada bolha é um item. O robô de verdade soma 1 em
 * ai_respostas por turno (roboAtendimento.ts), não por bolha: bolhas seguidas do agente, sem mensagem da lead no
 * meio, são uma resposta só. Antes (até 21/10/2026) o simulador contava bolha e "estourava" o limite de 15 em 3 turnos.
 */
export function contarRespostasDaIA(chat: { role: string }[]): number {
  let turnos = 0;
  let anterior = "";
  for (const m of chat) {
    if (m.role === "assistant" && anterior !== "assistant") turnos++;
    anterior = m.role;
  }
  return turnos;
}

/**
 * Decide, sem chamar o modelo, se o agente pode responder agora. Ordem:
 * grupo → desligado → número → horário → limite de mensagens → palavra de transferência.
 * Etapa e origem/gatilho já foram checados em escolherAgente().
 */
export function decidirAntesDoModelo(agente: AgenteIA, ctx: ContextoPortao): DecisaoPortao {
  const frase = agente.frase_transferencia?.trim() || FRASE_TRANSFERENCIA_PADRAO;
  if (ctx.grupo) return { acao: "ignorar", motivo: "grupo: a IA nunca responde em grupo" };
  if (!agente.ativo && ctx.numeroId !== undefined) return { acao: "ignorar", motivo: "agente desligado" };
  if (ctx.numeroId !== undefined) {
    if (!agente.numero_id) return { acao: "ignorar", motivo: "agente sem número escolhido" };
    if (ctx.numeroId !== agente.numero_id) return { acao: "ignorar", motivo: "mensagem chegou em outro número" };
  }
  if (!ctx.ignorarHorario && !dentroDoHorario(agente, ctx.agora)) {
    return { acao: "fora_horario", mensagem: agente.mensagem_fora_horario?.trim() || null };
  }
  const limite = Number(agente.limite_interacoes ?? 15);
  if (limite > 0 && ctx.respostasDaIA >= limite) return { acao: "transferir", frase, motivo: `limite de ${limite} respostas` };
  const palavra = casaPalavraTransferencia(agente.palavras_transferencia, ctx.textoLead);
  if (palavra) return { acao: "transferir", frase, motivo: `palavra "${palavra}"` };
  return { acao: "responder" };
}

/** A mensagem que o /agendar (src/pages/Agendar.tsx) monta para o WhatsApp: "Olá! Fui qualificada ..." + "*Nome:* ...". */
const RE_FORM_INICIO = /fui\s+qualificad[ao]/i;
const RE_FORM_NOME = /\*\s*nome\s*:\s*\*\s*([^\n*]+)/i;

/**
 * Nome digitado no formulário, se a conversa começou com a mensagem do formulário de avaliação
 * (primeira mensagem da lead no chat). Sem formulário, sem nome ou só dígitos = "".
 */
export function nomeDoFormulario(chat: { role: string; content: string }[] | null | undefined): string {
  const primeira = (chat ?? []).find((m) => m.role === "user");
  const t = String(primeira?.content ?? "");
  if (!RE_FORM_INICIO.test(t)) return "";
  const nome = (t.match(RE_FORM_NOME)?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (!nome || !/\p{L}/u.test(nome)) return "";
  return nome.slice(0, 80);
}

export function primeiroNome(nome: string | null | undefined, phone?: string | null): string {
  const n = String(nome ?? "").trim();
  const digitos = String(phone ?? "").replace(/\D/g, "");
  // Nome igual ao telefone (contato sem nome) não vira primeiro nome.
  if (!n || (digitos && n.replace(/\D/g, "") === digitos)) return "";
  const p = n.split(/\s+/)[0];
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** Variáveis dos roteiros: {primeiro_nome}, {nome}, {telefone}; aceita {{lead.first_name}} do SellFlux. */
export function aplicarVariaveis(
  texto: string,
  contato: { name?: string | null; phone?: string | null },
  extras: Record<string, string> = {},
): string {
  const primeiro = primeiroNome(contato.name, contato.phone);
  const mapa: Record<string, string> = {
    primeiro_nome: primeiro,
    "primeiro nome": primeiro,
    "lead.first_name": primeiro,
    nome: String(contato.name ?? "").trim(),
    telefone: String(contato.phone ?? ""),
    ...extras,
  };
  return texto
    .replace(/\{\{?\s*([a-zA-Z_. ]+?)\s*\}?\}/g, (inteiro, chave: string) => {
      const k = chave.toLowerCase();
      return k in mapa && mapa[k] !== "" ? mapa[k] : inteiro;
    })
    // Marcador em colchete do SellFlux ([LINK_AGENDAMENTO]): só troca se alguém preencheu.
    .replace(PLACEHOLDER_COLCHETE, (inteiro, chave: string) => {
      const v = extras[chave.toLowerCase()];
      return v ? v : inteiro;
    });
}

/** [LINK_AGENDAMENTO], [PRODUTOS]: marcador em caixa alta do texto do SellFlux (não é marcação de ação). */
const PLACEHOLDER_COLCHETE = /\[([A-Z][A-Z0-9_]{2,})\]/g;
const MARCACOES_ACAO = new Set(["TRANSFERIR", "SILENCIO", "SILÊNCIO"]);

/** Variáveis ainda não resolvidas: {data}, {{lead.first_name}}, [LINK_AGENDAMENTO]. */
export function variaveisPendentes(texto: string): string[] {
  const achadas = new Set<string>();
  for (const m of texto.matchAll(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_. ]*?)\s*\}?\}/g)) achadas.add(m[1].trim());
  for (const m of texto.matchAll(PLACEHOLDER_COLCHETE)) if (!MARCACOES_ACAO.has(m[1])) achadas.add(m[1]);
  return [...achadas];
}

export type TipoMensagem = "text" | "image" | "audio" | "document";

export interface RespostaInterpretada {
  mensagens: { tipo: TipoMensagem; conteudo: string }[];
  transferir: boolean;
  silencio: boolean;
  etapa: string | null;
}

const MARCA = /\[(TRANSFERIR|SILENCIO|SIL[ÊE]NCIO|ETAPA:\s*([a-z_]+)|(IMAGEM|AUDIO|ÁUDIO|DOCUMENTO):\s*(https?:\/\/[^\]\s]+))\]/gi;

/** Limpeza de saída igual à do SellFlux (message_output_replaces). */
export function limparTexto(t: string): string {
  return t
    .replace(/(?:^|\r?\n)[\t ]*[-_*]{3,}[\t ]*(?:\r?\n)?/g, "\n")
    .replace(/\*\*/g, "*")
    .replace(/~~/g, "~")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$2") // [texto](link) → link
    .trim();
}

export function interpretarResposta(
  bruto: string,
  etapasValidas: string[] = registroEtapas(),
  maxMensagens = 10,
): RespostaInterpretada {
  const out: RespostaInterpretada = { mensagens: [], transferir: false, silencio: false, etapa: null };
  const pushTexto = (t: string) => {
    for (const bloco of limparTexto(t).split(/\n[\t ]*\n+/)) {
      const b = bloco.trim();
      if (b && !/^\(?sem resposta\)?$/i.test(b)) out.mensagens.push({ tipo: "text", conteudo: b });
    }
  };
  let ultimo = 0;
  for (const m of String(bruto ?? "").matchAll(MARCA)) {
    pushTexto(String(bruto).slice(ultimo, m.index));
    ultimo = (m.index ?? 0) + m[0].length;
    const cmd = m[1].toUpperCase();
    if (cmd === "TRANSFERIR") out.transferir = true;
    else if (cmd.startsWith("SIL")) out.silencio = true;
    else if (cmd.startsWith("ETAPA")) {
      const e = (m[2] ?? "").toLowerCase();
      if (etapasValidas.includes(e)) out.etapa = e;
    } else if (m[3] && m[4]) {
      const k = m[3].toUpperCase();
      out.mensagens.push({ tipo: k === "IMAGEM" ? "image" : k === "DOCUMENTO" ? "document" : "audio", conteudo: m[4] });
    }
  }
  pushTexto(String(bruto ?? "").slice(ultimo));
  if (out.silencio) out.mensagens = [];
  out.mensagens = out.mensagens.slice(0, maxMensagens);
  return out;
}

/**
 * Última checagem antes de mandar para a lead. Os prompts são o texto do SellFlux ao pé
 * da letra, com variáveis ({{lead.first_name}}, {{primeiro nome}}, {{data}}) e marcadores
 * ([LINK_AGENDAMENTO]) que o modelo às vezes devolve crus. Troca o primeiro nome; o que
 * continuar sem valor NÃO sai: a mensagem é retirada e a conversa vai para o humano
 * (melhor um atendente completar do que a lead ler "{{data}}" ou "[LINK_AGENDAMENTO]").
 */
export function finalizarSaida(
  r: RespostaInterpretada,
  contato: { name?: string | null; phone?: string | null },
  extras: Record<string, string> = {},
): RespostaInterpretada & { retidas: string[] } {
  const retidas: string[] = [];
  const mensagens: RespostaInterpretada["mensagens"] = [];
  for (const m of r.mensagens) {
    if (m.tipo !== "text") {
      mensagens.push(m);
      continue;
    }
    const conteudo = aplicarVariaveis(m.conteudo, contato, extras);
    const falta = variaveisPendentes(conteudo);
    if (falta.length) retidas.push(...falta);
    else mensagens.push({ ...m, conteudo });
  }
  return { ...r, mensagens, transferir: r.transferir || retidas.length > 0, retidas };
}

/** Histórico do banco → mensagens do chat do modelo (lead = user, nós = assistant). */
export function historicoParaChat(
  linhas: { direction: string; sender_type?: string | null; body: string | null }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const l of linhas) {
    const role = l.direction === "inbound" ? "user" : "assistant";
    const content = String(l.body ?? "").trim();
    if (!content) continue;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}
