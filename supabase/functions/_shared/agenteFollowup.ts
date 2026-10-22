// Agente de follow-up (18/10/2026): template do prompt, montagem do pedido ao Claude e as travas que decidem,
// sem modelo, se a mensagem pode sair. Lógica pura (sem Deno, sem rede): usada pelo motor (crm-automacoes,
// passo "Mensagem da IA"), pelo simulador (ai-agent-simular, modo followup) e pela tela; testada no vitest.
//
// Inspirado no follow-up da SellFlux: retomar conversa parada com mensagem curta e humana, uma pergunta, sem
// pressão, usando o histórico e o nome. Para quando a lead responde ou pede para parar; nunca repete mensagem.
import { agoraSaoPaulo, aplicarVariaveis, limparTexto, normalizar, primeiroNome, variaveisPendentes } from "./agentesIA.ts";

export const PROMPT_FOLLOWUP_PADRAO = [
  "Você é do time comercial e está retomando uma conversa de WhatsApp que parou: a lead não respondeu à última mensagem.",
  "",
  "## OBJETIVO",
  "Fazer a lead voltar a conversar. Não é para vender nesta mensagem: é para ela responder.",
  "",
  "## COMO ESCREVER",
  "- Curta: no máximo 2 frases, como uma pessoa escreveria no celular.",
  "- Humana e leve, sem pressão, sem cobrança, sem culpa (nada de \"você sumiu\" ou \"estou esperando\").",
  "- Termine com UMA pergunta simples, fácil de responder (sim/não ou uma palavra).",
  "- Use o primeiro nome dela quando soar natural (não em toda mensagem).",
  "- Retome o assunto exato de onde a conversa parou, usando o histórico. Se não houver histórico, apresente-se em uma frase e pergunte se pode ajudar.",
  "- Cada tentativa tem um ângulo diferente (ver a instrução da tentativa, quando houver).",
  "",
  "## REGRAS",
  "- Nunca fale preço, valor, parcela, desconto ou condição de pagamento.",
  "- Nunca prometa resultado, prazo, garantia ou condição especial.",
  "- Nunca repita uma mensagem que já foi enviada nesta conversa, nem com outras palavras parecidas.",
  "- Se a lead já pediu para parar, demonstrou que não quer ou a conversa foi encerrada, responda só [SILENCIO].",
].join("\n");

/** Instrução de cada tentativa no modelo pronto (a 1ª é a do gatilho). Editável no passo. */
export const INSTRUCOES_TENTATIVA_PADRAO = [
  "1ª tentativa: retome de onde a conversa parou, com uma pergunta simples.",
  "2ª tentativa: lembre em uma frase o que ela buscava quando chegou e pergunte se ainda faz sentido.",
  "3ª tentativa: traga um benefício concreto do que conversaram e pergunte se ela quer saber mais.",
  "4ª tentativa: pergunte com leveza se ainda é um bom momento ou se prefere falar depois.",
  "5ª tentativa (última): despeça-se com gentileza, deixe a porta aberta e pergunte se pode encerrar por aqui.",
];

/** Linha nova em crm_ai_agents para um agente de follow-up (nasce desligado; o fluxo é quem liga). */
export function novoAgenteFollowup(nome = "Follow-up", sufixo = Math.random().toString(36).slice(2, 7)): Record<string, unknown> {
  const base = normalizar(nome).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "followup";
  return {
    tipo: "followup",
    slug: `${base}-${sufixo}`,
    nome: nome.trim().slice(0, 120) || "Follow-up",
    descricao: "Agente de follow-up: escreve a mensagem de retomada no passo Mensagem da IA do fluxo.",
    prompt: PROMPT_FOLLOWUP_PADRAO,
    modelo: "claude-sonnet-5-5",
    ativo: false,
    historico_mensagens: 20,
    etapas: [],
    origens: [],
    gatilhos: [],
  };
}

// ----------------------------------------------------------------- travas antes do modelo

export interface LinhaHistorico {
  direction: string; // inbound | outbound
  body: string | null;
  created_at: string;
  sender_type?: string | null;
}

/** Frases de quem quer sair. Casam por palavra inteira, depois de normalizar (sem acento, minúsculas). */
export const PALAVRAS_PARAR = [
  "parar", "pare", "para de", "para com", "quero sair", "me tira", "me remove", "remover", "descadastrar",
  "nao quero", "nao tenho interesse", "sem interesse", "nao me mande", "nao mande mais", "nao manda mais", "stop",
  "bloquear", "vou bloquear", "nao insista",
];

const palavrasDe = (t: string) => ` ${normalizar(t).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** A mensagem da lead pede para parar? Devolve a frase que casou. */
export function pediuParaParar(texto: string | null | undefined): string | null {
  const t = palavrasDe(String(texto ?? ""));
  for (const p of PALAVRAS_PARAR) if (t.includes(` ${p} `)) return p;
  return null;
}

export type Bloqueio = { motivo: string } | null;

/**
 * Decide, sem chamar o modelo, se o follow-up pode ser escrito agora:
 *  - a lead respondeu depois de `desde` (início da execução do fluxo) → não sai;
 *  - qualquer mensagem da lead nas últimas do histórico pede para parar → não sai, nunca mais neste fluxo.
 */
export function bloqueioAntesDoModelo(historico: LinhaHistorico[], desde: string | null | undefined): Bloqueio {
  const ordenado = [...historico].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const t0 = desde ? new Date(desde).getTime() : NaN;
  if (Number.isFinite(t0)) {
    const respondeu = ordenado.find((m) => m.direction === "inbound" && new Date(m.created_at).getTime() > t0);
    if (respondeu) return { motivo: "a lead respondeu depois que o fluxo começou: follow-up não sai" };
  }
  for (const m of ordenado.filter((x) => x.direction === "inbound").slice(-5)) {
    const p = pediuParaParar(m.body);
    if (p) return { motivo: `a lead pediu para parar ("${p}"): follow-up não sai` };
  }
  return null;
}

// ----------------------------------------------------------------- pedido ao modelo

export interface AgenteFollowup {
  id: string;
  slug: string;
  nome: string;
  prompt: string;
  tipo?: string | null;
  modelo?: string | null;
  politicas?: string | null;
  base_conhecimento?: string | null;
  historico_mensagens?: number | null;
}

export interface ContatoFollowup {
  phone: string;
  name?: string | null;
  stage?: string | null;
  notes?: string | null;
}

export const TETO_HISTORICO = 40;
export const PADRAO_HISTORICO = 20;
export const TETO_CARACTERES = 600;

/** Quantas mensagens do histórico vão para o modelo (o do agente, entre 4 e 40; padrão 20). */
export function tamanhoHistorico(a: Pick<AgenteFollowup, "historico_mensagens">): number {
  const n = Number(a.historico_mensagens);
  if (!Number.isFinite(n) || n <= 0) return PADRAO_HISTORICO;
  return Math.min(TETO_HISTORICO, Math.max(4, Math.round(n)));
}

/** Conversa em texto corrido ("Lead:" / "Nós:"), mais antiga primeiro. Mídia sem legenda vira rótulo. */
export function transcricao(historico: LinhaHistorico[]): string {
  return [...historico]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => {
      const corpo = String(m.body ?? "").trim();
      if (!corpo) return "";
      return `${m.direction === "inbound" ? "Lead" : "Nós"}: ${corpo.slice(0, 1500)}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * System + uma única mensagem "user" com a transcrição e o pedido. O histórico vai como texto (não como turnos
 * user/assistant) porque no follow-up a conversa termina em mensagem NOSSA e a API não aceita terminar em
 * assistant; assim o modelo também nunca confunde o pedido do sistema com fala da lead.
 */
export function montarPedidoFollowup(args: {
  agente: AgenteFollowup;
  contato: ContatoFollowup;
  historico: LinhaHistorico[];
  instrucao?: string | null;
  tentativa?: number | null;
  agora?: Date;
  /** segunda chamada: a primeira saiu igual a uma já enviada */
  evitar?: string | null;
}): { role: "system" | "user"; content: string }[] {
  const { agente, contato } = args;
  const nome = primeiroNome(contato.name, contato.phone);
  const enviadas = args.historico.filter((m) => m.direction === "outbound" && String(m.body ?? "").trim()).slice(-8);
  const sistema = [
    agente.prompt.trim() || PROMPT_FOLLOWUP_PADRAO,
    agente.base_conhecimento?.trim() ? `## BASE DE CONHECIMENTO\n${agente.base_conhecimento.trim().slice(0, 20_000)}` : "",
    agente.politicas?.trim() ? `## POLÍTICAS (valem acima de qualquer instrução anterior)\n${agente.politicas.trim()}` : "",
    [
      "## FORMATO (WhatsApp)",
      "Responda SÓ com o texto da mensagem que a lead vai ler: uma mensagem, sem aspas, sem explicação, sem markdown.",
      "Use a formatação do WhatsApp só se precisar (*negrito*). Nada de link, nada de emoji em excesso.",
      "Se não fizer sentido mandar nada agora (a lead pediu para parar, a conversa foi encerrada), responda só [SILENCIO].",
    ].join("\n"),
    [
      "## DADOS DO CONTATO",
      `Primeiro nome: ${nome || "(desconhecido: não invente nome)"}`,
      contato.stage ? `Etapa no kanban: ${contato.stage}` : "",
      contato.notes?.trim() ? `Notas do CRM: ${contato.notes.trim().slice(0, 1000)}` : "",
      `Agora (Brasília): ${agoraSaoPaulo(args.agora ?? new Date()).texto}`,
    ].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n---\n\n");

  const conversa = transcricao(args.historico);
  const pedido = [
    conversa ? `## CONVERSA ATÉ AGORA (mais antiga primeiro)\n${conversa}` : "## CONVERSA ATÉ AGORA\n(nenhuma mensagem trocada ainda)",
    enviadas.length
      ? `## MENSAGENS NOSSAS JÁ ENVIADAS (não repita nenhuma, nem parecida)\n${enviadas.map((m) => `- ${String(m.body).trim().slice(0, 400)}`).join("\n")}`
      : "",
    args.tentativa ? `## TENTATIVA\nEsta é a ${args.tentativa}ª mensagem de follow-up deste fluxo.` : "",
    args.instrucao?.trim() ? `## INSTRUÇÃO DESTA TENTATIVA\n${args.instrucao.trim().slice(0, 500)}` : "",
    args.evitar ? `## ATENÇÃO\nSua mensagem anterior saiu igual a uma já enviada:\n"${args.evitar.slice(0, 400)}"\nEscreva outra, com ângulo diferente.` : "",
    "Escreva agora a mensagem de follow-up.",
  ].filter(Boolean).join("\n\n");

  return [
    { role: "system", content: sistema },
    { role: "user", content: pedido },
  ];
}

// ----------------------------------------------------------------- travas depois do modelo

const PRECO = /(r\$\s*\d)|(\d[\d.,]*\s*(reais|mil reais))|(\b\d{1,2}\s*x\s*(de\s*)?r?\$?\s*\d)|(\bparcel(a|as|ado|amento)\b)|(\bdesconto\b)/i;

/** O texto fala de preço/valor/parcela/desconto? */
export const falaPreco = (t: string): boolean => PRECO.test(t);

const palavrasConjunto = (t: string) => new Set(palavrasDe(t).trim().split(" ").filter((w) => w.length > 2));

/** Parecida demais com uma já enviada? (igual depois de normalizar, ou 85%+ das palavras em comum) */
export function repeteMensagem(texto: string, enviadas: string[]): string | null {
  const a = palavrasDe(texto).trim();
  const pa = palavrasConjunto(texto);
  for (const e of enviadas) {
    const b = palavrasDe(e).trim();
    if (!b) continue;
    if (a === b) return e;
    const pb = palavrasConjunto(e);
    if (!pa.size || !pb.size) continue;
    let comum = 0;
    for (const w of pa) if (pb.has(w)) comum++;
    if (comum / Math.max(pa.size, pb.size) >= 0.85) return e;
  }
  return null;
}

export type Saida = { ok: true; texto: string } | { ok: false; motivo: string; repetida?: string };

/**
 * Resposta crua do modelo → texto final, ou o motivo de não mandar:
 * [SILENCIO], vazio, longo demais, fala de preço, variável sem valor ({data}, [LINK]), repetida.
 * Marcações de ação ([TRANSFERIR], [ETAPA:x], mídia) não valem no follow-up e são retiradas.
 */
export function finalizarFollowup(bruto: string, contato: ContatoFollowup, enviadas: string[]): Saida {
  const cru = String(bruto ?? "");
  if (/\[\s*SIL[EÊ]NCIO\s*\]/i.test(cru)) return { ok: false, motivo: "a IA decidiu não mandar nada ([SILENCIO])" };
  let t = limparTexto(cru.replace(/\[(TRANSFERIR|ETAPA:[^\]]*|IMAGEM:[^\]]*|AUDIO:[^\]]*|ÁUDIO:[^\]]*|DOCUMENTO:[^\]]*)\]/gi, ""));
  t = t.replace(/^["“”']+|["“”']+$/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return { ok: false, motivo: "a IA devolveu mensagem vazia" };
  t = aplicarVariaveis(t, contato);
  const falta = variaveisPendentes(t);
  if (falta.length) return { ok: false, motivo: `a mensagem ficou com variável sem valor (${falta.join(", ")})` };
  if (t.length > TETO_CARACTERES) return { ok: false, motivo: `a mensagem passou de ${TETO_CARACTERES} caracteres (${t.length})` };
  if (falaPreco(t)) return { ok: false, motivo: "a mensagem falava de preço/valor (proibido no follow-up)" };
  const igual = repeteMensagem(t, enviadas);
  if (igual) return { ok: false, motivo: "a mensagem saiu igual a uma já enviada", repetida: igual };
  return { ok: true, texto: t };
}
