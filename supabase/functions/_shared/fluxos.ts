// Fluxos de várias etapas (equivalente aos workflows do Full Funnel): regras puras, sem Deno e sem banco.
// Usadas pela edge function crm-automacoes (motor) e pela tela (editor). Testadas em src/test/crmFluxos.test.ts.
//
// Um fluxo é: gatilho (tag, etapa ou evento externo) + lista de passos executados em ordem por contato.
// Passos: esperar, condição (respondeu? tem tag? etapa?), template oficial (Full Funnel), mensagem não oficial
// (roteiro/passo, entra na fila com os limites anti-ban), pôr/tirar tag, mudar etapa, parar.
// Mesmos princípios das automações (16/10/2026): nasce DESLIGADO, gatilho só olha eventos depois de ligado
// (máx. 24 h para trás) e o mesmo contato não entra duas vezes no mesmo fluxo (a menos que "permitir_repetir").
import { normalizarTag, type ContatoBasico, type EventoContato } from "./automacoes.ts";
import { SLUGS_SISTEMA, ehEtapaValida, etapasValidas } from "./etapas.ts";

/** As 5 etapas padrão (fallback). As etapas reais vêm de crm_etapas: use etapasValidas() / useEtapas. */
export const ETAPAS_FLUXO = SLUGS_SISTEMA;

export type FluxoGatilho = "tag" | "etapa" | "evento" | "segmento" | "sem_resposta" | "data" | "banco" | "webhook";

/** Fontes do gatilho "Novo lead no banco de dados" (trigger no banco grava o evento banco_<fonte>). */
export type FonteBanco = "formulario" | "agendamento" | "compra" | "base_leads" | "contato_whatsapp";
export const FONTES_BANCO: FonteBanco[] = ["formulario", "agendamento", "compra", "base_leads", "contato_whatsapp"];
export const NIVEIS_FORMULARIO = ["A", "B", "C", "D", "DQ"];
export const ORIGENS_FORMULARIO = ["avaliacao", "individual"];
/** Nome do evento que o trigger da fonte grava em crm_contato_eventos. */
export const eventoDoBanco = (fonte: FonteBanco): string => `banco_${fonte}`;
/** Evento que a entrada (edge function fluxo-entrada) grava para o fluxo: webhook_<uuid sem hífen>. */
export const eventoWebhook = (fluxoId: string): string => `webhook_${String(fluxoId).replace(/-/g, "").toLowerCase()}`;
export type UnidadeEspera = "minutos" | "horas" | "dias";
/** "continuar" = próximo passo; "parar" = encerra; número = pula para o passo N (1-based, só para frente). */
export type Desvio = "continuar" | "parar" | number;
export type Condicao =
  | { tipo: "respondeu" }
  | { tipo: "tem_tag"; valor: string }
  | { tipo: "etapa"; valor: string }
  /** campo do contato (nome, etapa, origem) ou do evento que inscreveu (dados.email...) */
  | { tipo: "campo"; campo: string; operador: "igual" | "contem" | "existe"; valor?: string }
  /** a IA de atendimento passou a conversa para o humano depois que o contato entrou no fluxo (crm_ai_eventos) */
  | { tipo: "ia_transferiu" };

export type TipoMidia = "image" | "audio" | "document";

export type PassoFluxo =
  | { tipo: "esperar"; quantidade: number; unidade: UnidadeEspera; ate_responder?: boolean }
  | { tipo: "condicao"; condicao: Condicao; se_sim: Desvio; se_nao: Desvio }
  | { tipo: "template_oficial"; template: string; variaveis?: Record<string, string>; numero_id?: string | null }
  /** mensagem pelo número NÃO oficial: roteiro, um passo do roteiro, ou texto/mídia escritos no próprio passo */
  | { tipo: "mensagem"; roteiro_id?: string | null; passo_id?: string | null; texto?: string | null; midia_url?: string | null; midia_tipo?: TipoMidia | null; numero_id?: string | null }
  /**
   * Mensagem escrita pelo agente de follow-up (crm_ai_agents tipo "followup") na hora do envio, a partir do
   * histórico da conversa. Sai pelo número NÃO oficial do passo/fluxo, com os mesmos limites anti-ban.
   * instrucao = o ângulo desta tentativa ("2ª tentativa: lembrar do benefício X"); tentativa = 1, 2, 3...
   */
  | { tipo: "ia_followup"; agente_id: string; instrucao?: string | null; tentativa?: number | null; numero_id?: string | null }
  | { tipo: "tag"; acao: "por" | "tirar"; tag: string }
  | { tipo: "etapa"; etapa: string }
  /**
   * atendente = nome (rótulo e compatibilidade com fluxo antigo); atendente_id = profiles.id escolhido na lista (migration
   * 20261123140000). Com id, a conversa vai para ESSE usuário mesmo que alguém troque de nome; sem id (fluxo antigo), o
   * banco casa o nome com um único aprovado (crm_contato_atendente_guarda).
   */
  | { tipo: "atribuir"; atendente: string; atendente_id?: string | null }
  | { tipo: "agente_ia"; acao: "ligar" | "pausar"; agente?: string | null }
  /**
   * Passa a conversa para um agente de IA de atendimento (no número do agente), com os portões de iaGatilho.ts:
   * nunca grupo; humano atendendo barra, salvo mesmo_com_humano. Registra "IA ativada por gatilho: fluxo ...".
   */
  | { tipo: "transferir_ia"; agente: string; mesmo_com_humano?: boolean }
  /**
   * Passa a conversa para o humano (mesmo efeito da transferência da IA): pausa a IA, selo "Precisa de humano",
   * atendente (vazio = fila geral), tag e etapa opcionais. despedida sai pelo número do fluxo com os limites anti-ban
   * (sem_mensagem = não manda nada).
   */
  | { tipo: "transferir_humano"; despedida?: string | null; sem_mensagem?: boolean; para?: string | null; tag?: string | null; etapa?: string | null; numero_id?: string | null }
  | { tipo: "webhook"; url: string }
  | { tipo: "ir_fluxo"; fluxo_id: string }
  /** salto interno (gerado pelo construtor ao compilar o Se/Senão): vai ao passo N, só para frente */
  | { tipo: "ir_para"; passo: number }
  | { tipo: "parar" };

/** Gatilhos do construtor (vários, ligados por "Ou"). O primeiro também vai em gatilho_tipo/gatilho_valor. */
export type GatilhoFluxo =
  | { tipo: "tag"; valor: string }
  | { tipo: "etapa"; valor: string }
  /** formulário, PagTrust, webhook: evento registrado por crm_registrar_evento */
  | { tipo: "evento"; valor: string }
  /** segmento salvo do Banco de dados ou lista importada (base_leads.origem) */
  | { tipo: "segmento"; segmento_id?: string | null; lista_origem?: string | null; modo: "todos" | "novos" }
  | { tipo: "sem_resposta"; horas: number }
  /** numa data/hora, inscreve um segmento (ou quem tem uma tag) */
  | { tipo: "data"; em: string; segmento_id?: string | null; tag?: string | null }
  /**
   * Novo registro numa tabela do próprio banco (sem integração externa). Só registro NOVO: o evento nasce
   * no INSERT (trigger) e o motor só lê evento posterior a max(ligado_em, criado_em do gatilho).
   * niveis/origens vazios = qualquer um.
   */
  | { tipo: "banco"; fonte: FonteBanco; niveis?: string[]; origens?: string[]; criado_em?: string | null }
  /** URL própria do fluxo (crm_fluxo_entradas): POST de qualquer sistema cria/atualiza o contato e inscreve. */
  | { tipo: "webhook"; criado_em?: string | null };

export interface ConfigFluxo {
  /** janela de envio (Brasília); fora dela o passo de mensagem espera a próxima abertura */
  hora_inicio?: number;
  hora_fim?: number;
  /** máximo de inscrições por dia (Brasília) neste fluxo */
  limite_dia?: number | null;
}

export interface Fluxo {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
  gatilho_tipo: FluxoGatilho;
  gatilho_valor: string | null;
  parar_se_responder: boolean;
  permitir_repetir: boolean;
  passos: PassoFluxo[];
  ligado_em: string | null;
  origem_ff_workflow_id?: string | null;
  /** número de WhatsApp do fluxo (crm_numeros, Central /crm/central); null = número padrão */
  numero_id?: string | null;
  /** construtor (migration 20261027150000): vários gatilhos com "Ou"; vazio = usa gatilho_tipo/valor */
  gatilhos?: GatilhoFluxo[] | null;
  config?: ConfigFluxo | null;
}

export interface ExecucaoFluxo {
  id: number;
  fluxo_id: string;
  contact_phone: string;
  passo_idx: number;            // 0-based, próximo passo a executar
  status: "ativo" | "concluido" | "parado" | "erro" | "cancelado";
  proximo_em: string;
  aguardando_resposta: boolean; // esperar "até responder"
  iniciado_em: string;
  ultimo_envio_em: string | null;
  dados: Record<string, unknown>;
}

export const MAX_PASSOS = 80;
const MIN = 60_000;

const ehNumeroPasso = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d);

export const normalizarEvento = (e: unknown): string =>
  String(e ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 60);

/** Milissegundos de um passo "esperar" (teto 60 dias). */
export function duracaoEspera(p: { quantidade: number; unidade: UnidadeEspera }): number {
  const q = Math.max(0, Number(p.quantidade) || 0);
  const mult = p.unidade === "dias" ? 1440 : p.unidade === "horas" ? 60 : 1;
  return Math.min(q * mult, 60 * 1440) * MIN;
}

/** Variáveis {{n}} do corpo de um template ("Olá, {{1}}" → [1]). */
export function variaveisDoTemplate(corpo: string): number[] {
  const s = new Set<number>();
  for (const m of String(corpo ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) s.add(Number(m[1]));
  return [...s].sort((a, b) => a - b);
}

/** Gatilhos que valem: a lista do construtor ou, sem ela, o gatilho único antigo. */
export function gatilhosDoFluxo(f: Partial<Fluxo>): GatilhoFluxo[] {
  if (Array.isArray(f.gatilhos) && f.gatilhos.length) return f.gatilhos;
  const v = String(f.gatilho_valor ?? "");
  // fluxo novo nasce com gatilho_tipo "evento" e valor vazio: isso é "sem gatilho", não um evento sem nome
  if (!v.trim()) return [];
  if (f.gatilho_tipo === "tag" || f.gatilho_tipo === "etapa" || f.gatilho_tipo === "evento") return [{ tipo: f.gatilho_tipo, valor: v }];
  return [];
}

export const MAX_GATILHOS = 10;
const ehDataValida = (s: unknown) => typeof s === "string" && !Number.isNaN(new Date(s).getTime());

/** Erros de um gatilho (prefixo "Gatilho N:"). */
export function validarGatilho(g: GatilhoFluxo, n: number, cfg: ConfigFluxo | null | undefined, etapas: string[] = etapasValidas()): string[] {
  const e: string[] = [];
  const p = `Gatilho ${n}:`;
  switch (g?.tipo) {
    case "tag": if (!normalizarTag(g.valor)) e.push(`${p} informe a tag.`); break;
    case "etapa": if (!ehEtapaValida(g.valor, etapas)) e.push(`${p} escolha a etapa.`); break;
    case "evento": if (!normalizarEvento(g.valor)) e.push(`${p} escolha o formulário/evento.`); break;
    case "segmento":
      if (!g.segmento_id && !String(g.lista_origem ?? "").trim()) e.push(`${p} escolha o segmento ou a lista importada.`);
      if (g.modo !== "todos" && g.modo !== "novos") e.push(`${p} escolha inscrever todos ou só os novos.`);
      break;
    case "sem_resposta": {
      const h = Number(g.horas);
      if (!Number.isFinite(h) || h < 1 || h > 24 * 60) e.push(`${p} sem resposta de 1 hora a 60 dias.`);
      break;
    }
    case "data":
      if (!ehDataValida(g.em)) e.push(`${p} escolha a data e a hora.`);
      if (!g.segmento_id && !normalizarTag(g.tag)) e.push(`${p} escolha o segmento ou a tag de quem entra na data.`);
      break;
    case "banco":
      if (!FONTES_BANCO.includes(g.fonte)) e.push(`${p} escolha a fonte (formulário, agendamento, compra, base ou WhatsApp).`);
      if ((g.niveis ?? []).some((n) => !NIVEIS_FORMULARIO.includes(n))) e.push(`${p} nível inválido (A, B, C, D ou DQ).`);
      if (g.fonte === "formulario" && (g.origens ?? []).some((o) => !ORIGENS_FORMULARIO.includes(o))) e.push(`${p} origem do formulário é avaliacao ou individual.`);
      break;
    case "webhook":
      break;
    default: e.push(`${p} tipo de gatilho inválido.`);
  }
  // base inteira de uma vez é o risco de ban: segmento/data só com teto diário
  // (base de leads e contato novo do WhatsApp também: importação/backfill cria milhares de linhas de uma vez)
  if (g?.tipo === "segmento" || g?.tipo === "data" || (g?.tipo === "banco" && (g.fonte === "base_leads" || g.fonte === "contato_whatsapp"))) {
    const lim = Number(cfg?.limite_dia);
    if (!Number.isInteger(lim) || lim < 1 || lim > 1000) e.push(`${p} gatilho por base exige limite por dia (1 a 1000) nas Configurações.`);
  }
  return e;
}

/**
 * O evento do banco bate no filtro do gatilho? (nível só vale para formulário e base; origem: formulário =
 * avaliacao/individual, base = base_leads.origem, compra = conta PagTrust, agendamento = via, WhatsApp = source)
 */
export function bateFiltroBanco(g: Extract<GatilhoFluxo, { tipo: "banco" }>, dados: Record<string, unknown> | null | undefined): boolean {
  const d = dados ?? {};
  const niveis = (g.niveis ?? []).map((n) => n.toUpperCase());
  if (niveis.length && (g.fonte === "formulario" || g.fonte === "base_leads")) {
    if (!niveis.includes(String(d.nivel ?? "").trim().toUpperCase())) return false;
  }
  const origens = (g.origens ?? []).map((o) => o.trim().toLowerCase()).filter(Boolean);
  if (origens.length && !origens.includes(String(d.origem ?? "").trim().toLowerCase())) return false;
  return true;
}

/** Desde quando o gatilho conta eventos: o mais recente entre o início do fluxo e a criação do gatilho. */
export function inicioDoGatilho(desdeFluxo: Date, g: { criado_em?: string | null }): Date {
  const c = g.criado_em ? new Date(g.criado_em) : null;
  return c && !Number.isNaN(c.getTime()) && c > desdeFluxo ? c : desdeFluxo;
}

/** Erros de configuração do fluxo (lista vazia = pode salvar/ligar). */
export function validarFluxo(f: Partial<Fluxo>, etapas: string[] = etapasValidas()): string[] {
  const e: string[] = [];
  if (!String(f.nome ?? "").trim()) e.push("Dê um nome ao fluxo.");
  if (Array.isArray(f.gatilhos) && f.gatilhos.length) {
    if (f.gatilhos.length > MAX_GATILHOS) e.push(`No máximo ${MAX_GATILHOS} gatilhos.`);
    f.gatilhos.forEach((g, i) => e.push(...validarGatilho(g, i + 1, f.config, etapas)));
  } else if (f.gatilho_tipo === "tag") {
    if (!normalizarTag(f.gatilho_valor)) e.push("Informe a tag que inicia o fluxo.");
  } else if (f.gatilho_tipo === "etapa") {
    if (!ehEtapaValida(f.gatilho_valor, etapas)) e.push("Escolha a etapa que inicia o fluxo.");
  } else if (f.gatilho_tipo === "evento") {
    if (!normalizarEvento(f.gatilho_valor)) e.push("Informe o nome do evento que inicia o fluxo.");
  } else e.push("Adicione pelo menos um gatilho.");
  const cfg = f.config ?? {};
  if (cfg.hora_inicio !== undefined || cfg.hora_fim !== undefined) {
    const a = Number(cfg.hora_inicio ?? 0), b = Number(cfg.hora_fim ?? 24);
    if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= 24 && a < b)) e.push("Horário permitido inválido (início antes do fim, 0 a 24).");
  }

  const passos = f.passos ?? [];
  if (!passos.length) e.push("Adicione pelo menos um passo.");
  if (passos.length > MAX_PASSOS) e.push(`No máximo ${MAX_PASSOS} passos.`);
  const desvioOk = (d: unknown, i: number) =>
    d === "continuar" || d === "parar" || (ehNumeroPasso(d) && d > i + 1 && d <= passos.length);
  passos.forEach((p, i) => {
    const n = `Passo ${i + 1}:`;
    switch (p?.tipo) {
      case "esperar":
        if (!(Number(p.quantidade) > 0)) e.push(`${n} informe quanto tempo esperar.`);
        if (!["minutos", "horas", "dias"].includes(p.unidade)) e.push(`${n} unidade inválida.`);
        if (Number(p.quantidade) * (p.unidade === "dias" ? 1440 : p.unidade === "horas" ? 60 : 1) > 60 * 1440)
          e.push(`${n} espera máxima de 60 dias.`);
        break;
      case "condicao": {
        const c = p.condicao;
        if (!c || !["respondeu", "tem_tag", "etapa", "campo", "ia_transferiu"].includes(c.tipo)) e.push(`${n} escolha a condição.`);
        else if (c.tipo === "tem_tag" && !normalizarTag(c.valor)) e.push(`${n} informe a tag da condição.`);
        else if (c.tipo === "etapa" && !ehEtapaValida(c.valor, etapas)) e.push(`${n} escolha a etapa da condição.`);
        else if (c.tipo === "campo" && (!String(c.campo ?? "").trim() || !["igual", "contem", "existe"].includes(c.operador)
          || (c.operador !== "existe" && !String(c.valor ?? "").trim()))) e.push(`${n} complete a condição do campo.`);
        if (!desvioOk(p.se_sim, i) || !desvioOk(p.se_nao, i)) e.push(`${n} desvio inválido (só "continuar", "parar" ou um passo mais à frente).`);
        break;
      }
      case "template_oficial":
        if (!String(p.template ?? "").trim()) e.push(`${n} escolha o template oficial.`);
        break;
      case "mensagem":
        if (!p.roteiro_id && !p.passo_id && !String(p.texto ?? "").trim() && !p.midia_url) e.push(`${n} escolha o roteiro ou o passo da mensagem, ou escreva o texto.`);
        if (p.midia_url && !/^https:\/\//.test(p.midia_url)) e.push(`${n} a mídia precisa de link https.`);
        if (p.midia_url && !["image", "audio", "document"].includes(String(p.midia_tipo))) e.push(`${n} escolha o tipo da mídia.`);
        break;
      case "ia_followup":
        if (!String(p.agente_id ?? "").trim()) e.push(`${n} escolha o agente de follow-up.`);
        if (String(p.instrucao ?? "").length > 500) e.push(`${n} instrução da tentativa com no máximo 500 caracteres.`);
        break;
      case "atribuir":
        if (!String(p.atendente ?? "").trim()) e.push(`${n} escolha o atendente.`);
        if (p.atendente_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.atendente_id)) e.push(`${n} atendente inválido.`);
        break;
      case "agente_ia":
        if (p.acao !== "ligar" && p.acao !== "pausar") e.push(`${n} escolha ligar ou pausar o agente.`);
        if (p.acao === "ligar" && !String(p.agente ?? "").trim()) e.push(`${n} escolha o agente de IA.`);
        break;
      case "transferir_ia":
        if (!String(p.agente ?? "").trim()) e.push(`${n} escolha o agente de IA que assume a conversa.`);
        break;
      case "webhook":
        if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(String(p.url ?? ""))) e.push(`${n} o webhook precisa de URL https.`);
        break;
      case "transferir_humano":
        if (p.etapa && !ehEtapaValida(p.etapa, etapas)) e.push(`${n} etapa da transferência inválida.`);
        if (String(p.despedida ?? "").length > 1000) e.push(`${n} despedida com no máximo 1000 caracteres.`);
        if (String(p.para ?? "").length > 80) e.push(`${n} nome do atendente muito longo.`);
        break;
      case "ir_fluxo":
        if (!String(p.fluxo_id ?? "").trim()) e.push(`${n} escolha o fluxo de destino.`);
        else if (p.fluxo_id === f.id) e.push(`${n} o fluxo não pode ir para ele mesmo.`);
        break;
      case "ir_para":
        if (!desvioOk(p.passo, i)) e.push(`${n} salto inválido.`);
        break;
      case "tag":
        if (!normalizarTag(p.tag)) e.push(`${n} informe a tag.`);
        if (p.acao !== "por" && p.acao !== "tirar") e.push(`${n} escolha pôr ou tirar.`);
        break;
      case "etapa":
        if (!ehEtapaValida(p.etapa, etapas)) e.push(`${n} escolha a etapa.`);
        break;
      case "parar":
        break;
      default:
        e.push(`${n} tipo de passo inválido.`);
    }
  });
  return e;
}

/** Template usado no fluxo que não está aprovado no catálogo (aviso na tela, não bloqueia). */
export function templatesNaoAprovados(f: Pick<Fluxo, "passos">, catalogo: { nome: string; status: string }[]): string[] {
  const ok = new Set(catalogo.filter((t) => t.status === "APPROVED").map((t) => t.nome));
  return [...new Set(f.passos.filter((p) => p.tipo === "template_oficial").map((p) => (p as { template: string }).template.trim()))]
    .filter((n) => n && !ok.has(n));
}

/** A partir de quando os eventos contam: ligado_em, no máximo 24 h para trás. */
export function inicioEventosFluxo(f: Pick<Fluxo, "ligado_em">, agora: Date): Date {
  const limite = new Date(agora.getTime() - 24 * 60 * MIN);
  if (!f.ligado_em) return limite;
  const l = new Date(f.ligado_em);
  return l > limite ? l : limite;
}

export interface EventoFluxo extends Omit<EventoContato, "tipo"> {
  tipo: "etapa" | "tag" | "evento";
  dados?: Record<string, unknown> | null;
}

/**
 * Quem entra no fluxo agora. `execucoes` = execuções existentes deste fluxo para os telefones dos eventos.
 * Sem "permitir_repetir": quem já teve qualquer execução não entra. Com: só entra se não há execução ativa
 * e o evento é posterior ao início da última execução (o mesmo evento não inscreve duas vezes).
 */
export function inscricoesDoFluxo(
  f: Fluxo,
  eventos: EventoFluxo[],
  contatos: Map<string, ContatoBasico>,
  execucoes: Pick<ExecucaoFluxo, "contact_phone" | "status" | "iniciado_em">[],
  agora: Date,
): { phone: string; dados: Record<string, unknown> }[] {
  if (!f.ativo) return [];
  const desde = inicioEventosFluxo(f, agora).getTime();
  const alvo =
    f.gatilho_tipo === "tag" ? normalizarTag(f.gatilho_valor) :
    f.gatilho_tipo === "evento" ? normalizarEvento(f.gatilho_valor) : String(f.gatilho_valor ?? "");
  const porPhone = new Map<string, Pick<ExecucaoFluxo, "status" | "iniciado_em">[]>();
  for (const x of execucoes) porPhone.set(x.contact_phone, [...(porPhone.get(x.contact_phone) ?? []), x]);
  const saida: { phone: string; dados: Record<string, unknown> }[] = [];
  const vistos = new Set<string>();
  for (const ev of [...eventos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (ev.tipo !== f.gatilho_tipo) continue;
    const valor = ev.tipo === "tag" ? normalizarTag(ev.valor) : ev.tipo === "evento" ? normalizarEvento(ev.valor) : ev.valor;
    if (valor !== alvo) continue;
    const t = new Date(ev.created_at).getTime();
    if (!(t >= desde && t <= agora.getTime())) continue;
    const phone = ev.contact_phone;
    if (vistos.has(phone)) continue;
    const c = contatos.get(phone);
    if (!c) continue;
    if (f.gatilho_tipo === "etapa" && c.stage !== alvo) continue;
    if (f.gatilho_tipo === "tag" && !(c.tags ?? []).map(normalizarTag).includes(alvo)) continue;
    const anteriores = porPhone.get(phone) ?? [];
    if (!f.permitir_repetir && anteriores.length) continue;
    if (f.permitir_repetir) {
      if (anteriores.some((x) => x.status === "ativo")) continue;
      if (anteriores.some((x) => new Date(x.iniciado_em).getTime() >= t)) continue;
    }
    vistos.add(phone);
    saida.push({ phone, dados: (ev.dados ?? {}) as Record<string, unknown> });
  }
  return saida;
}

export interface ContextoContato {
  contato: ContatoBasico;
  /** a lead mandou mensagem depois de `desde`? (o motor consulta o banco) */
  respondeuDesde: (desde: string) => boolean;
  /** a IA transferiu a conversa para o humano depois de `desde`? (sem a função = não) */
  iaTransferiuDesde?: (desde: string) => boolean;
}

/** Valor de um campo para a condição: nome/etapa/origem/telefone do contato ou dados.X do evento. */
export function valorDoCampo(campo: string, contato: ContatoBasico, dados: Record<string, unknown> | null | undefined): string | null {
  const c = String(campo ?? "").trim();
  if (c.startsWith("dados.")) {
    const v = dados?.[c.slice(6)];
    return v === undefined || v === null || v === "" ? null : String(v);
  }
  const mapa: Record<string, unknown> = { nome: contato.name, etapa: contato.stage, origem: contato.source, telefone: contato.phone };
  const v = mapa[c];
  return v === undefined || v === null || v === "" ? null : String(v);
}

export function avaliarCondicao(c: Condicao, ex: Pick<ExecucaoFluxo, "ultimo_envio_em" | "iniciado_em"> & { dados?: Record<string, unknown> }, ctx: ContextoContato): boolean {
  if (c.tipo === "respondeu") return ctx.respondeuDesde(ex.ultimo_envio_em ?? ex.iniciado_em);
  if (c.tipo === "ia_transferiu") return ctx.iaTransferiuDesde ? ctx.iaTransferiuDesde(ex.iniciado_em) : false;
  if (c.tipo === "tem_tag") return (ctx.contato.tags ?? []).map(normalizarTag).includes(normalizarTag(c.valor));
  if (c.tipo === "etapa") return ctx.contato.stage === c.valor;
  if (c.tipo === "campo") {
    const v = valorDoCampo(c.campo, ctx.contato, ex.dados);
    if (c.operador === "existe") return v !== null;
    if (v === null) return false;
    const a = v.trim().toLowerCase(), b = String(c.valor ?? "").trim().toLowerCase();
    return c.operador === "igual" ? a === b : a.includes(b);
  }
  return false;
}

/** Índice do próximo passo depois de um desvio (null = encerrar). */
export function aplicarDesvio(d: Desvio, idxAtual: number, total: number): number | null {
  if (d === "parar") return null;
  if (d === "continuar") return idxAtual + 1 < total ? idxAtual + 1 : null;
  if (ehNumeroPasso(d) && d - 1 > idxAtual && d - 1 < total) return d - 1;
  return idxAtual + 1 < total ? idxAtual + 1 : null;
}

/** Valores de template: {primeiro_nome}, {nome}, {telefone} e {dados.campo} (vindo do evento que inscreveu). */
export function resolverVariaveis(
  vars: Record<string, string> | undefined,
  dados: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const chaves = Object.keys(vars ?? {}).sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  for (const k of chaves) {
    out[k] = String(vars![k]).replace(/\{dados\.([a-zA-Z0-9_]+)\}/g, (_, campo: string) => {
      const v = dados?.[campo];
      return v === undefined || v === null ? "" : String(v);
    });
  }
  return out;
}

/** O que o motor deve fazer agora com uma execução (decisão pura; quem grava é a edge function). */
export type Decisao =
  | { fazer: "parar"; status: "concluido" | "parado"; motivo: string }
  | { fazer: "esperar"; ate: Date; aguardando_resposta: boolean; proximo_idx: number }
  | { fazer: "acao"; passo: Exclude<PassoFluxo, { tipo: "esperar" } | { tipo: "condicao" } | { tipo: "parar" } | { tipo: "ir_para" }>; idx: number; proximo_idx: number | null };

/**
 * Anda pela execução a partir de passo_idx: resolve condições e esperas e devolve a próxima ação concreta
 * (ou parar / esperar). `agora` serve para a espera; `respondeu` vale para o "parar se responder".
 * Limite de 30 saltos por chamada (fluxo mal configurado não trava o motor).
 */
export function decidir(f: Fluxo, ex: ExecucaoFluxo, ctx: ContextoContato, agora: Date): Decisao {
  if (f.parar_se_responder && ctx.respondeuDesde(ex.iniciado_em)) {
    return { fazer: "parar", status: "parado", motivo: "a lead respondeu (parar se responder)" };
  }
  let idx = ex.passo_idx;
  for (let saltos = 0; saltos < MAX_PASSOS + 1; saltos++) {
    if (idx < 0 || idx >= f.passos.length) return { fazer: "parar", status: "concluido", motivo: "fim do fluxo" };
    const p = f.passos[idx];
    if (p.tipo === "parar") return { fazer: "parar", status: "concluido", motivo: `passo ${idx + 1}: parar` };
    if (p.tipo === "condicao") {
      const r = avaliarCondicao(p.condicao, ex, ctx);
      const prox = aplicarDesvio(r ? p.se_sim : p.se_nao, idx, f.passos.length);
      if (prox === null) return { fazer: "parar", status: "concluido", motivo: `passo ${idx + 1}: condição ${r ? "sim" : "não"} → parar` };
      idx = prox;
      continue;
    }
    if (p.tipo === "ir_para") {
      const prox = aplicarDesvio(p.passo, idx, f.passos.length);
      if (prox === null) return { fazer: "parar", status: "concluido", motivo: "fim do fluxo" };
      idx = prox;
      continue;
    }
    if (p.tipo === "esperar") {
      return {
        fazer: "esperar",
        ate: new Date(agora.getTime() + duracaoEspera(p)),
        aguardando_resposta: Boolean(p.ate_responder),
        proximo_idx: idx + 1,
      };
    }
    return { fazer: "acao", passo: p, idx, proximo_idx: idx + 1 < f.passos.length ? idx + 1 : null };
  }
  return { fazer: "parar", status: "concluido", motivo: "saltos demais (revise os desvios)" };
}

/** Frase curta do passo para a lista do editor. */
export function resumoPasso(p: PassoFluxo, nomes: { etapas?: Record<string, string>; roteiros?: Record<string, string> } = {}): string {
  const et = (id: string) => nomes.etapas?.[id] ?? id;
  const desvio = (d: Desvio) => (d === "continuar" ? "segue" : d === "parar" ? "para" : `vai ao passo ${d}`);
  switch (p.tipo) {
    case "esperar": return `Esperar ${p.quantidade} ${p.unidade}${p.ate_responder ? " (ou até responder)" : ""}`;
    case "condicao": {
      const c = p.condicao.tipo === "respondeu" ? "respondeu?" : p.condicao.tipo === "ia_transferiu" ? "a IA transferiu?" : p.condicao.tipo === "tem_tag" ? `tem a tag ${p.condicao.valor}?`
        : p.condicao.tipo === "campo" ? `${p.condicao.campo} ${p.condicao.operador === "existe" ? "preenchido" : `${p.condicao.operador === "igual" ? "=" : "contém"} ${p.condicao.valor ?? ""}`}?`
        : `está em ${et(p.condicao.valor)}?`;
      return `Se ${c} sim: ${desvio(p.se_sim)}; não: ${desvio(p.se_nao)}`;
    }
    case "template_oficial": return `Template oficial ${p.template}`;
    case "mensagem":
      if (p.passo_id) return "Mensagem (um passo do roteiro)";
      if (p.roteiro_id) return `Mensagem: roteiro ${nomes.roteiros?.[p.roteiro_id] ?? ""}`.trim();
      if (p.midia_url) return `Mensagem com ${p.midia_tipo === "audio" ? "áudio" : p.midia_tipo === "image" ? "imagem" : "documento"}`;
      return `Mensagem: ${String(p.texto ?? "").slice(0, 60)}`;
    case "ia_followup": return `Mensagem da IA (follow-up)${p.tentativa ? `, ${p.tentativa}ª tentativa` : ""}`;
    case "tag": return `${p.acao === "por" ? "Pôr" : "Tirar"} a tag ${p.tag}`;
    case "etapa": return `Mover para ${et(p.etapa)}`;
    case "atribuir": return `Atribuir a ${p.atendente}`;
    case "agente_ia": return p.acao === "ligar" ? `Ligar agente de IA ${p.agente ?? ""}`.trim() : "Pausar agente de IA";
    case "transferir_ia": return `Transferir para agente IA ${p.agente}`.trim();
    case "transferir_humano": return `Transferir para humano${p.para ? ` (${p.para})` : " (fila geral)"}`;
    case "webhook": return `Webhook ${p.url.replace(/^https:\/\//, "").slice(0, 40)}`;
    case "ir_fluxo": return "Ir para outro fluxo";
    case "ir_para": return `Ir ao passo ${p.passo}`;
    case "parar": return "Parar";
  }
}
