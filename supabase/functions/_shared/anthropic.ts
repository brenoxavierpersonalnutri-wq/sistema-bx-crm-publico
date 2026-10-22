// Provedor de IA do CRM: Claude, pela Messages API da Anthropic (crédito da conta do Breno).
// Lógica pura + a chamada HTTP com a chave recebida por parâmetro: sem Deno.env aqui, então roda no
// Deno (ai-agent-simular, feedback-semanal-resumo, anthropic-pareamento, robô do WhatsApp) e no vitest
// (src/test/anthropic.test.ts). De onde vem a chave: _shared/iaCRM.ts (env ou integracao_config).
//
// Regras da API para a geração 5.5 (docs da Anthropic, out/2026), todas respeitadas aqui:
//   - temperature/top_p/top_k diferentes do padrão dão 400: NÃO mandamos (o campo temperatura do
//     agente fica guardado, mas não vai para o Claude; o comportamento sai do prompt);
//   - o pensamento adaptativo está sempre ligado: a resposta pode começar com blocos "thinking", então o
//     texto é lido só dos blocos type "text" e max_tokens cobre pensamento + texto;
//   - a profundidade do pensamento é controlada por output_config.effort;
//   - não pode terminar em mensagem do assistente (prefill): a conversa precisa acabar na lead;
//   - stop_reason "refusal" vira erro claro, não resposta vazia.

export const URL_ANTHROPIC = "https://api.anthropic.com/v1/messages";
export const VERSAO_ANTHROPIC = "2023-06-01";

export const MODELO_CONVERSA = "claude-sonnet-5-5";
export const MODELO_RESUMO = "claude-haiku-5-5";

/** Opções do seletor da tela do agente (a primeira é a padrão). */
export const MODELOS_CLAUDE = [
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5 (padrão)" },
  { id: "claude-haiku-5-5", nome: "Claude Haiku 5.5 (mais barato)" },
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5 (mais caro)" },
] as const;

export type ModeloClaude = (typeof MODELOS_CLAUDE)[number]["id"];
const IDS = new Set<string>(MODELOS_CLAUDE.map((m) => m.id));

/**
 * Migração suave: qualquer valor que não seja um Claude da lista (google/gemini-*, openai/*, gpt-4o-mini,
 * vazio, nulo) vira o padrão da tarefa. Assim agente antigo no banco nunca manda "google/..." pra Anthropic.
 */
export function resolverModelo(modelo: unknown, padrao: ModeloClaude = MODELO_CONVERSA): ModeloClaude {
  const m = typeof modelo === "string" ? modelo.trim() : "";
  return (IDS.has(m) ? m : padrao) as ModeloClaude;
}

export type Esforco = "low" | "medium" | "high";

/** Ajuste por tipo de chamada: conversa responde a lead (qualidade), resumo é barato e curto. */
export const PERFIS = {
  conversa: { modelo: MODELO_CONVERSA as ModeloClaude, maxTokens: 8192, esforco: "medium" as Esforco, timeoutMs: 60_000 },
  resumo: { modelo: MODELO_RESUMO as ModeloClaude, maxTokens: 4096, esforco: "low" as Esforco, timeoutMs: 45_000 },
  /** classificador do gatilho de ativação da IA (iaGatilho.ts): sim/não em JSON, Haiku, curto e barato */
  gatilho: { modelo: MODELO_RESUMO as ModeloClaude, maxTokens: 300, esforco: "low" as Esforco, timeoutMs: 20_000 },
} as const;
export type Tarefa = keyof typeof PERFIS;

export interface MensagemChat {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PedidoAnthropic {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  output_config: { effort: Esforco };
}

/**
 * Formato chat (OpenAI: system dentro da lista) -> Messages API: os "system" viram o campo system (juntos,
 * na ordem), mensagens vazias somem, papéis iguais em sequência são juntados (a API quer alternância) e a
 * lista precisa começar e terminar em "user" (terminar em "assistant" seria prefill, recusado com 400).
 */
export function converterParaAnthropic(
  mensagens: MensagemChat[],
  opcoes: { modelo: string; maxTokens: number; esforco: Esforco },
): PedidoAnthropic {
  const sistemas: string[] = [];
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of mensagens) {
    const conteudo = String(m?.content ?? "");
    if (!conteudo.trim()) continue;
    if (m.role === "system") {
      sistemas.push(conteudo);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const ultima = msgs[msgs.length - 1];
    if (ultima && ultima.role === role) ultima.content += `\n\n${conteudo}`;
    else msgs.push({ role, content: conteudo });
  }
  if (!msgs.length) throw new ErroIA(400, "nada para mandar à IA: a conversa está vazia");
  if (msgs[msgs.length - 1].role !== "user") throw new ErroIA(400, "a última mensagem precisa ser da lead (user)");
  // A API aceita começar em assistant, mas o histórico do WhatsApp às vezes abre com mensagem nossa:
  // um marcador curto deixa explícito para o modelo que a conversa começou do nosso lado.
  if (msgs[0].role === "assistant") msgs.unshift({ role: "user", content: "(início da conversa)" });
  const pedido: PedidoAnthropic = {
    model: opcoes.modelo,
    max_tokens: opcoes.maxTokens,
    messages: msgs,
    output_config: { effort: opcoes.esforco },
  };
  if (sistemas.length) pedido.system = sistemas.join("\n\n");
  return pedido;
}

interface RespostaAnthropic {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  stop_reason?: string | null;
  stop_details?: { category?: string } | null;
}

/** Junta só os blocos "text" (os "thinking" vêm antes e não são resposta). */
export function extrairTexto(resposta: RespostaAnthropic): string {
  const blocos = Array.isArray(resposta?.content) ? resposta.content : [];
  const texto = blocos.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  if (resposta?.stop_reason === "refusal") {
    const cat = resposta.stop_details?.category ? ` (${resposta.stop_details.category})` : "";
    throw new ErroIA(422, `o Claude se recusou a responder esta mensagem${cat}`);
  }
  if (!texto.trim()) {
    if (resposta?.stop_reason === "max_tokens") {
      throw new ErroIA(502, "o Claude gastou o limite de tokens pensando e não chegou a escrever a resposta");
    }
    throw new ErroIA(502, "o Claude devolveu resposta vazia");
  }
  return texto;
}

/** Erro com mensagem em português pronta para a tela. Nunca carrega a chave. */
export class ErroIA extends Error {
  constructor(public status: number, public detalhe: string) {
    super(detalhe);
    this.name = "ErroIA";
  }
}

/** Tira qualquer coisa com cara de chave da Anthropic de um texto que vai para log ou tela. */
export function semChave(texto: string): string {
  return String(texto ?? "").replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***");
}

/** Status HTTP + corpo de erro da Anthropic -> ErroIA com mensagem clara (sem a chave, corpo cortado). */
export function erroDaAnthropic(status: number, corpo: string): ErroIA {
  let tipo = "";
  let msg = "";
  try {
    const d = JSON.parse(corpo);
    tipo = String(d?.error?.type ?? "");
    msg = String(d?.error?.message ?? "");
  } catch {
    msg = corpo;
  }
  const original = semChave(msg).slice(0, 300);
  const credito = /credit balance|billing|purchase credits/i.test(msg);
  let texto: string;
  if (status === 401) {
    texto = "chave da Anthropic inválida ou revogada: gere outra em console.anthropic.com e refaça o pareamento";
  } else if (status === 403) {
    texto = "a chave da Anthropic não tem permissão para este modelo ou esta organização";
  } else if (credito) {
    texto = "o crédito da conta Anthropic acabou: recarregue em console.anthropic.com (Billing)";
  } else if (status === 429) {
    texto = "limite de uso da conta Anthropic atingido (muitas chamadas por minuto ou teto de gasto): espere um pouco e tente de novo";
  } else if (status === 529 || tipo === "overloaded_error") {
    texto = "a Anthropic está sobrecarregada agora (529): tente de novo em alguns segundos";
  } else if (status === 404) {
    texto = "modelo não encontrado na Anthropic: confira o modelo escolhido no agente";
  } else if (status === 413) {
    texto = "conversa grande demais para mandar ao Claude";
  } else if (status === 400) {
    texto = `a Anthropic recusou o pedido: ${original || "pedido inválido"}`;
  } else if (status >= 500) {
    texto = `a Anthropic está instável (erro ${status}): tente de novo em alguns segundos`;
  } else {
    texto = `a Anthropic respondeu ${status}${original ? `: ${original}` : ""}`;
  }
  return new ErroIA(status, texto);
}

export interface OpcoesChamada {
  chave: string;
  mensagens: MensagemChat[];
  modelo: string;
  maxTokens: number;
  esforco: Esforco;
  timeoutMs: number;
  /** injetável nos testes */
  fetchImpl?: typeof fetch;
  /** uso real de tokens da chamada (campo usage da resposta), para o log do robô */
  aoUsar?: (u: UsoTokens) => void;
}

export interface UsoTokens {
  entrada: number;
  saida: number;
}

/** Tokens do campo usage (0 quando a resposta não traz). */
export function lerUso(resposta: RespostaAnthropic | null | undefined): UsoTokens {
  const u = resposta?.usage ?? {};
  return { entrada: Number(u.input_tokens) || 0, saida: Number(u.output_tokens) || 0 };
}

/** AbortSignal com prazo (AbortSignal.timeout no Deno; fallback com AbortController onde não existe). */
function sinalComPrazo(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
  return c.signal;
}

/** Uma chamada à Messages API. Devolve só o texto da resposta. */
export async function chamarAnthropic(o: OpcoesChamada): Promise<string> {
  if (!o.chave) throw new ErroIA(503, "chave da Anthropic não configurada: rode o pareamento na VPS (anthropic-parear)");
  const pedido = converterParaAnthropic(o.mensagens, { modelo: o.modelo, maxTokens: o.maxTokens, esforco: o.esforco });
  const f = o.fetchImpl ?? fetch;
  const signal = sinalComPrazo(o.timeoutMs);
  let res: Response;
  try {
    res = await f(URL_ANTHROPIC, {
      method: "POST",
      headers: {
        "x-api-key": o.chave,
        "anthropic-version": VERSAO_ANTHROPIC,
        "content-type": "application/json",
      },
      body: JSON.stringify(pedido),
      signal,
    });
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new ErroIA(504, `o Claude não respondeu em ${Math.round(o.timeoutMs / 1000)} s: tente de novo`);
    }
    throw new ErroIA(502, `sem conexão com a Anthropic (${nome || "erro de rede"})`);
  }
  if (!res.ok) throw erroDaAnthropic(res.status, await res.text().catch(() => ""));
  const dados = (await res.json().catch(() => null)) as RespostaAnthropic | null;
  if (!dados) throw new ErroIA(502, "a Anthropic devolveu uma resposta que não é JSON");
  if (o.aoUsar) {
    try { o.aoUsar(lerUso(dados)); } catch { /* log não derruba a resposta */ }
  }
  return extrairTexto(dados);
}

// ------------------------------------------------------------------ pareamento (VPS -> CRM)

/** Formato da chave de API da Anthropic (sk-ant-api03-...). */
export const CHAVE_OK = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

/** Corpo do anthropic-pareamento: {"api_key": "..."} -> valor normalizado que vai pro banco. */
export function validarCorpoAnthropic(corpo: string): { ok: true; valor: string } | { ok: false; motivo: string } {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(corpo);
  } catch {
    return { ok: false, motivo: "corpo não é JSON" };
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, motivo: "corpo não é objeto" };
  const chave = String(d.api_key ?? "").trim();
  if (!CHAVE_OK.test(chave)) return { ok: false, motivo: "api_key inválida (esperado sk-ant-...)" };
  return { ok: true, valor: JSON.stringify({ api_key: chave }) };
}

/** Lê a chave guardada em integracao_config.anthropic_api_key (JSON {api_key} ou o texto puro). */
export function lerChaveGuardada(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  let chave = valor.trim();
  if (chave.startsWith("{")) {
    try {
      chave = String(JSON.parse(chave)?.api_key ?? "").trim();
    } catch {
      return null;
    }
  }
  return CHAVE_OK.test(chave) ? chave : null;
}
