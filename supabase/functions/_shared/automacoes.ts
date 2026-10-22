// Automações e campanhas do CRM: regras puras (sem Deno, sem banco), usadas pela
// edge function crm-automacoes e pela tela. Testadas em src/test/crmAutomacoes.test.ts.
//
// Princípios (decisão do Breno, 16/10/2026):
// - tudo nasce DESLIGADO (envio não oficial, regras e campanhas);
// - gatilho só olha eventos DEPOIS que a regra foi ligada (e no máximo 24 h para trás),
//   para que ligar uma regra nunca vire disparo na base antiga;
// - a mesma automação nunca vai duas vezes ao mesmo contato;
// - envio não oficial tem ritmo por número: máx./hora, máx./dia, janela 8h-20h,
//   intervalo aleatório e pausa automática (3 falhas seguidas ou sinal de restrição).
import { ehEtapaValida, etapasValidas } from "./etapas.ts";
import { agoraSaoPaulo } from "./agentesIA.ts";

export type GatilhoTipo = "etapa" | "sem_resposta" | "tag";

export type Acao =
  | { tipo: "roteiro"; roteiro_id: string }
  | { tipo: "passo"; passo_id: string }
  | { tipo: "etapa"; etapa: string }
  | { tipo: "tag"; tag: string }
  | { tipo: "template_oficial"; template: string; variaveis?: Record<string, string> }
  /** texto/mídia escritos no passo do fluxo (sem roteiro): sai pelo número não oficial, com os mesmos limites */
  | { tipo: "livre"; itens: { tipo: "text" | "audio" | "image" | "document"; conteudo: string; media_url: string | null }[] }
  /** passo "Mensagem da IA" do fluxo: o texto é escrito pelo agente de follow-up na hora do envio (1 mensagem) */
  | { tipo: "ia_followup"; agente_id: string; instrucao?: string | null; tentativa?: number | null };

export interface Automacao {
  id: string;
  nome: string;
  ativo: boolean;
  gatilho_tipo: GatilhoTipo;
  gatilho_valor: string | null;      // etapa (etapa) ou tag (tag)
  sem_resposta_horas: number | null; // sem_resposta
  janela_max_horas: number;          // sem_resposta: só quem está calado há entre N e N+janela horas
  filtro_etapas: string[];           // vazio = qualquer etapa
  acoes: Acao[];
  ligado_em: string | null;
}

export interface ConfigEnvio {
  ligado: boolean;
  pausado: boolean;
  pausado_motivo: string | null;
  max_hora: number;
  max_dia: number;
  hora_inicio: number;  // 0-23, Brasília
  hora_fim: number;     // 1-24, Brasília (exclusivo)
  intervalo_min: number; // segundos
  intervalo_max: number;
  falhas_seguidas: number;
  proximo_envio_em: string | null;
}

export const CONFIG_PADRAO: ConfigEnvio = {
  ligado: false,
  pausado: false,
  pausado_motivo: null,
  max_hora: 30,
  max_dia: 200,
  hora_inicio: 8,
  hora_fim: 20,
  intervalo_min: 40,
  intervalo_max: 120,
  falhas_seguidas: 0,
  proximo_envio_em: null,
};

export interface EventoContato {
  contact_phone: string;
  tipo: "etapa" | "tag";
  valor: string;
  created_at: string;
}

export interface ContatoBasico {
  phone: string;
  name?: string | null;
  stage?: string | null;
  source?: string | null;
  tags?: string[] | null;
}

export interface MensagemBasica {
  contact_phone: string;
  direction: string; // inbound | outbound
  created_at: string;
}

const HORA = 3600_000;

export const normalizarTag = (t: unknown): string =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Ação que manda mensagem pelo número NÃO oficial (consome os limites). */
export const acaoUsaWhatsApp = (a: Acao): boolean =>
  a.tipo === "roteiro" || a.tipo === "passo" || a.tipo === "livre" || a.tipo === "ia_followup";

/** Passos de envio de uma ação "livre" (mídia primeiro, com o texto como legenda; só texto = um passo). */
export function passosLivres(a: Extract<Acao, { tipo: "livre" }>): PassoBasico[] {
  return (a.itens ?? []).slice(0, 5).map((x, i) => ({
    id: `livre-${i}`, ordem: i + 1, tipo: x.tipo, conteudo: String(x.conteudo ?? ""), media_url: x.media_url ?? null,
    file_name: null, atraso_segundos: 4, aguarda_resposta: false,
  }));
}
export const precisaWhatsApp = (acoes: Acao[]): boolean => acoes.some(acaoUsaWhatsApp);

/** Erros de configuração da regra (lista vazia = pode salvar). */
/** `etapas`: slugs aceitos (padrão: o registro de _shared/etapas.ts, preenchido a partir de crm_etapas). */
export function validarAutomacao(a: Partial<Automacao>, etapas: string[] = etapasValidas()): string[] {
  const erros: string[] = [];
  if (!String(a.nome ?? "").trim()) erros.push("Dê um nome à automação.");
  if (a.gatilho_tipo === "etapa" && !ehEtapaValida(a.gatilho_valor, etapas)) {
    erros.push("Escolha a etapa do kanban que dispara a regra.");
  } else if (a.gatilho_tipo === "tag" && !normalizarTag(a.gatilho_valor)) {
    erros.push("Informe a tag que dispara a regra.");
  } else if (a.gatilho_tipo === "sem_resposta") {
    const h = Number(a.sem_resposta_horas);
    if (!Number.isFinite(h) || h < 1 || h > 24 * 60) erros.push("Sem resposta: use de 1 hora a 60 dias.");
    const j = Number(a.janela_max_horas);
    if (!Number.isFinite(j) || j < 1 || j > 24 * 14) erros.push("Janela do sem resposta: de 1 hora a 14 dias.");
  } else if (!["etapa", "tag", "sem_resposta"].includes(String(a.gatilho_tipo))) {
    erros.push("Escolha o gatilho.");
  }
  const acoes = a.acoes ?? [];
  if (!acoes.length) erros.push("Adicione pelo menos uma ação.");
  for (const ac of acoes) {
    if (ac.tipo === "roteiro" && !ac.roteiro_id) erros.push("Escolha o roteiro a enviar.");
    if (ac.tipo === "passo" && !ac.passo_id) erros.push("Escolha o passo a enviar.");
    if (ac.tipo === "etapa" && !ehEtapaValida(ac.etapa, etapas)) erros.push("Escolha a etapa de destino.");
    if (ac.tipo === "tag" && !normalizarTag(ac.tag)) erros.push("Informe a tag a aplicar.");
    if (ac.tipo === "template_oficial" && !String(ac.template ?? "").trim()) erros.push("Informe o nome do template oficial.");
  }
  if (acoes.filter(acaoUsaWhatsApp).length > 1) erros.push("Só uma mensagem (roteiro ou passo) por automação.");
  // Regra que move para a mesma etapa que a dispara não faz nada (e confunde).
  if (a.gatilho_tipo === "etapa" && acoes.some((ac) => ac.tipo === "etapa" && ac.etapa === a.gatilho_valor)) {
    erros.push("A ação de mover etapa não pode ser a mesma etapa do gatilho.");
  }
  return erros;
}

/** A partir de quando os eventos contam: ligado_em, no máximo 24 h para trás (cron parado não vira rajada). */
export function inicioDosEventos(aut: Pick<Automacao, "ligado_em">, agora: Date, simulacao = false): Date {
  const limite = new Date(agora.getTime() - 24 * HORA);
  if (simulacao || !aut.ligado_em) return limite;
  const ligado = new Date(aut.ligado_em);
  return ligado > limite ? ligado : limite;
}

const passaFiltroEtapa = (aut: Pick<Automacao, "filtro_etapas">, c: ContatoBasico | undefined): boolean =>
  !aut.filtro_etapas?.length || (c?.stage ? aut.filtro_etapas.includes(c.stage) : false);

/**
 * Gatilhos "entrou na etapa X" e "recebeu a tag T": devolve os telefones atingidos.
 * Exige que o contato AINDA esteja na etapa / com a tag (quem saiu antes do envio não recebe).
 */
export function avaliarEventos(
  aut: Automacao,
  eventos: EventoContato[],
  contatos: Map<string, ContatoBasico>,
  jaNaFila: Set<string>,
  agora: Date,
  simulacao = false,
): string[] {
  if (aut.gatilho_tipo !== "etapa" && aut.gatilho_tipo !== "tag") return [];
  const desde = inicioDosEventos(aut, agora, simulacao).getTime();
  const alvo = aut.gatilho_tipo === "tag" ? normalizarTag(aut.gatilho_valor) : String(aut.gatilho_valor ?? "");
  const saida: string[] = [];
  const vistos = new Set<string>();
  for (const ev of eventos) {
    if (ev.tipo !== aut.gatilho_tipo) continue;
    const valor = ev.tipo === "tag" ? normalizarTag(ev.valor) : ev.valor;
    if (valor !== alvo) continue;
    const t = new Date(ev.created_at).getTime();
    if (!(t >= desde && t <= agora.getTime())) continue;
    const phone = ev.contact_phone;
    if (vistos.has(phone) || jaNaFila.has(phone)) continue;
    const c = contatos.get(phone);
    if (!c) continue;
    if (aut.gatilho_tipo === "etapa" && c.stage !== alvo) continue;
    if (aut.gatilho_tipo === "tag" && !(c.tags ?? []).map(normalizarTag).includes(alvo)) continue;
    if (!passaFiltroEtapa(aut, c)) continue;
    vistos.add(phone);
    saida.push(phone);
  }
  return saida;
}

/** Última mensagem de cada contato (entrada em qualquer ordem). */
export function ultimaMensagemPorContato(msgs: MensagemBasica[]): Map<string, MensagemBasica> {
  const m = new Map<string, MensagemBasica>();
  for (const msg of msgs) {
    const atual = m.get(msg.contact_phone);
    if (!atual || new Date(msg.created_at) > new Date(atual.created_at)) m.set(msg.contact_phone, msg);
  }
  return m;
}

/**
 * Gatilho "sem resposta há N horas": a última mensagem da conversa é NOSSA (outbound)
 * e tem entre N e N+janela horas. Quem está calado há mais que isso fica de fora:
 * a regra não varre a base antiga quando é ligada.
 * `msgs` precisa cobrir pelo menos as últimas N+janela horas.
 */
export function avaliarSemResposta(
  aut: Automacao,
  msgs: MensagemBasica[],
  contatos: Map<string, ContatoBasico>,
  jaNaFila: Set<string>,
  agora: Date,
): string[] {
  if (aut.gatilho_tipo !== "sem_resposta") return [];
  const n = Number(aut.sem_resposta_horas) * HORA;
  const max = n + Number(aut.janela_max_horas || 48) * HORA;
  const saida: string[] = [];
  for (const [phone, ultima] of ultimaMensagemPorContato(msgs)) {
    if (ultima.direction !== "outbound") continue;
    const idade = agora.getTime() - new Date(ultima.created_at).getTime();
    if (idade < n || idade > max) continue;
    if (jaNaFila.has(phone)) continue;
    const c = contatos.get(phone);
    if (!c || !passaFiltroEtapa(aut, c)) continue;
    saida.push(phone);
  }
  return saida;
}

/** Na hora de enviar um "sem resposta": se a lead respondeu depois de entrar na fila, não envia. */
export function aindaSemResposta(ultima: MensagemBasica | undefined): boolean {
  return Boolean(ultima && ultima.direction === "outbound");
}

// ---------------------------------------------------------------- campanhas

export interface FiltroPublico {
  etapas?: string[];
  tags?: string[];
  origens?: string[];
  sem_resposta_dias?: number | null; // lead não mandou nada há N dias (ou nunca mandou)
}

/**
 * Público da campanha. `respondeuRecente` = telefones com mensagem RECEBIDA nos últimos N dias.
 * Telefone inválido (menos de 10 dígitos) e grupo nunca entram.
 */
export function filtrarPublico(
  filtro: FiltroPublico,
  contatos: ContatoBasico[],
  respondeuRecente: Set<string> = new Set(),
): ContatoBasico[] {
  const etapas = filtro.etapas ?? [];
  const tags = (filtro.tags ?? []).map(normalizarTag).filter(Boolean);
  const origens = (filtro.origens ?? []).map((o) => o.trim().toLowerCase()).filter(Boolean);
  const dias = Number(filtro.sem_resposta_dias) || 0;
  const vistos = new Set<string>();
  return contatos.filter((c) => {
    const d = String(c.phone ?? "").replace(/\D/g, "");
    if (d.length < 10 || d.length > 15 || vistos.has(d)) return false;
    if (etapas.length && !etapas.includes(String(c.stage ?? ""))) return false;
    if (tags.length) {
      const t = (c.tags ?? []).map(normalizarTag);
      if (!tags.some((x) => t.includes(x))) return false;
    }
    if (origens.length && !origens.includes(String(c.source ?? "").trim().toLowerCase())) return false;
    if (dias > 0 && respondeuRecente.has(c.phone)) return false;
    vistos.add(d);
    return true;
  });
}

export const filtroVazio = (f: FiltroPublico): boolean =>
  !(f.etapas?.length || f.tags?.length || f.origens?.length || Number(f.sem_resposta_dias) > 0);

/** Data em Brasília (UTC-3 fixo desde 2019) como AAAA-MM-DD. */
export function diaSP(agora: Date): string {
  return new Date(agora.getTime() - 3 * HORA).toISOString().slice(0, 10);
}

/** 00:00 de hoje em Brasília, em UTC. */
export function inicioDoDiaSP(agora: Date): Date {
  return new Date(`${diaSP(agora)}T00:00:00-03:00`);
}

/**
 * Divide o público em lotes por dia: lote 0 começa agora, lote k no dia k às hora_inicio (Brasília).
 * Sem lote_por_dia, todos ficam para agora (o ritmo por hora/dia segura do mesmo jeito).
 */
export function agendarLotes(total: number, lotePorDia: number | null | undefined, agora: Date, horaInicio = 8): Date[] {
  const lote = Number(lotePorDia) > 0 ? Math.floor(Number(lotePorDia)) : 0;
  const datas: Date[] = [];
  const base = inicioDoDiaSP(agora).getTime() + horaInicio * HORA;
  for (let i = 0; i < total; i++) {
    const k = lote ? Math.floor(i / lote) : 0;
    datas.push(k === 0 ? agora : new Date(base + k * 24 * HORA));
  }
  return datas;
}

// ------------------------------------------------------------ ritmo e limites

export function dentroDaJanela(cfg: Pick<ConfigEnvio, "hora_inicio" | "hora_fim">, agora: Date): boolean {
  const min = agoraSaoPaulo(agora).minutos;
  return min >= cfg.hora_inicio * 60 && min < cfg.hora_fim * 60;
}

export type Veredito =
  | { ok: true }
  | { ok: false; motivo: "desligado" | "pausado" | "fora_janela" | "aguardando_intervalo" | "limite_hora" | "limite_dia"; detalhe: string };

/**
 * Pode mandar `nMensagens` agora? `uso` = mensagens não oficiais com sucesso na última hora e hoje (Brasília).
 */
export function verificarLimites(
  cfg: ConfigEnvio,
  uso: { hora: number; dia: number },
  nMensagens: number,
  agora: Date,
): Veredito {
  if (!cfg.ligado) return { ok: false, motivo: "desligado", detalhe: "Envio não oficial desligado" };
  if (cfg.pausado) return { ok: false, motivo: "pausado", detalhe: cfg.pausado_motivo || "Pausado" };
  if (!dentroDaJanela(cfg, agora)) {
    return { ok: false, motivo: "fora_janela", detalhe: `Só envia das ${cfg.hora_inicio}h às ${cfg.hora_fim}h` };
  }
  if (cfg.proximo_envio_em && new Date(cfg.proximo_envio_em) > agora) {
    return { ok: false, motivo: "aguardando_intervalo", detalhe: `Próximo envio às ${cfg.proximo_envio_em}` };
  }
  const n = Math.max(1, nMensagens);
  if (uso.hora + n > cfg.max_hora) {
    return { ok: false, motivo: "limite_hora", detalhe: `${uso.hora}/${cfg.max_hora} na última hora` };
  }
  if (uso.dia + n > cfg.max_dia) {
    return { ok: false, motivo: "limite_dia", detalhe: `${uso.dia}/${cfg.max_dia} hoje` };
  }
  return { ok: true };
}

/** Segundos aleatórios entre min e max (inclusive). */
export function intervaloAleatorio(min: number, max: number, rand: () => number = Math.random): number {
  const a = Math.max(1, Math.floor(Math.min(min, max)));
  const b = Math.max(a, Math.floor(Math.max(min, max)));
  return a + Math.floor(rand() * (b - a + 1));
}

const PADROES_RESTRICAO = [
  /ban(ned|ido)?\b/i,
  /block(ed)?|bloquead/i,
  /restri/i,
  /spam/i,
  /not[ -_]?authori[sz]ed/i,
  /logged[ -_]?out|logout|desconectad|disconnected|not connected|session (closed|not found)/i,
  /too many|rate[- ]?limit/i,
];

/** Resposta do provedor que indica número restrito/desconectado: pausa na hora, sem esperar 3 falhas. */
export function sinalDeRestricao(status: number, detalhe: unknown): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  const t = typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe ?? "");
  return PADROES_RESTRICAO.some((r) => r.test(t));
}

/** Contabiliza um resultado e diz se o envio deve pausar sozinho. */
export function registrarResultado(
  falhasSeguidas: number,
  r: { ok: true } | { ok: false; status: number; detalhe: unknown },
): { falhasSeguidas: number; pausar: boolean; motivo: string | null } {
  if (!("status" in r)) return { falhasSeguidas: 0, pausar: false, motivo: null };
  const f = falhasSeguidas + 1;
  if (sinalDeRestricao(r.status, r.detalhe)) {
    return { falhasSeguidas: f, pausar: true, motivo: `Sinal de restrição do WhatsApp (HTTP ${r.status})` };
  }
  if (f >= 3) return { falhasSeguidas: f, pausar: true, motivo: "3 falhas seguidas" };
  return { falhasSeguidas: f, pausar: false, motivo: null };
}

// ------------------------------------------------------------- mensagens

export interface PassoBasico {
  id: string;
  ordem: number;
  tipo: "text" | "audio" | "image" | "document";
  conteudo: string;
  media_url: string | null;
  file_name: string | null;
  atraso_segundos: number;
  aguarda_resposta: boolean;
}

/** Passos que saem num envio de roteiro: em ordem, até o primeiro que espera resposta da lead. */
export function passosDoEnvio(passos: PassoBasico[]): PassoBasico[] {
  const ordenados = [...passos].sort((a, b) => a.ordem - b.ordem);
  const saida: PassoBasico[] = [];
  for (const [i, p] of ordenados.entries()) {
    if (i > 0 && p.aguarda_resposta) break;
    saida.push(p);
  }
  return saida;
}

const VARIAVEIS_CONHECIDAS = new Set(["primeiro_nome", "primeiro nome", "lead.first_name", "nome", "telefone"]);

/** Variáveis que o envio automático NÃO sabe preencher ({data}, {link_agendamento}...). */
export function variaveisSemValor(texto: string): string[] {
  const achadas = new Set<string>();
  for (const m of texto.matchAll(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_. ]*?)\s*\}?\}/g)) {
    const k = m[1].trim().toLowerCase();
    if (!VARIAVEIS_CONHECIDAS.has(k)) achadas.add(m[1].trim());
  }
  return [...achadas];
}

/** Problemas que impedem o envio automático de um conjunto de passos. */
export function problemasDosPassos(passos: PassoBasico[]): string[] {
  const p: string[] = [];
  if (!passos.length) p.push("A mensagem não tem passos.");
  for (const x of passos) {
    if (x.tipo === "text" && !x.conteudo.trim()) p.push(`Passo ${x.ordem}: texto vazio.`);
    if (x.tipo !== "text" && !x.media_url) p.push(`Passo ${x.ordem}: falta o arquivo.`);
    const v = variaveisSemValor(x.conteudo);
    if (v.length) p.push(`Passo ${x.ordem}: troque {${v.join("}, {")}} antes (o envio automático não preenche).`);
  }
  return p;
}

// ------------------------------------------------------------- Full Funnel

/** Telefone do CRM (só dígitos, 55...) para E.164. Mesma regra de public.telefone_e164. */
export function telefoneE164(bruto: string | null | undefined): string | null {
  const s = String(bruto ?? "").trim();
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (s.startsWith("+") || d.startsWith("00")) {
    d = d.replace(/^00/, "");
    if (!d.startsWith("55")) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
    d = d.slice(2);
  } else if (d.length === 12 || d.length === 13) {
    if (!d.startsWith("55")) return null;
    d = d.slice(2);
  } else if (d.length !== 10 && d.length !== 11) {
    return null;
  }
  d = d.replace(/^0/, "");
  if (d.length === 10 && "6789".includes(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  if ((d.length !== 10 && d.length !== 11) || d.startsWith("0")) return null;
  return `+55${d}`;
}

/**
 * Corpo do POST no Inbound Webhook do Full Funnel. Chaves fixas (o Full Funnel mapeia
 * por nome a partir da requisição de amostra): template + var_1..var_5 + variaveis.
 */
export function payloadTemplateOficial(
  contato: ContatoBasico,
  acao: { template: string; variaveis?: Record<string, string> },
  extras: { automacao?: string | null; teste?: boolean } = {},
): Record<string, unknown> | null {
  const phone = telefoneE164(contato.phone);
  if (!phone) return null;
  const nome = String(contato.name ?? "").trim();
  const nomeValido = nome && nome.replace(/\D/g, "") !== String(contato.phone ?? "").replace(/\D/g, "");
  const primeiro = nomeValido ? nome.split(/\s+/)[0] : "";
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(acao.variaveis ?? {})) {
    vars[k] = String(v)
      .replace(/\{primeiro_nome\}/g, primeiro)
      .replace(/\{nome\}/g, nomeValido ? nome : "")
      .replace(/\{telefone\}/g, phone);
  }
  const lista = Object.values(vars);
  return {
    evento: "crm_template",
    teste: extras.teste === true,
    site: "brenoxavier",
    template: acao.template.trim(),
    name: nomeValido ? nome : "Lead",
    first_name: primeiro || "Lead",
    phone,
    etapa: contato.stage ?? null,
    origem: contato.source ?? null,
    automacao: extras.automacao ?? null,
    var_1: lista[0] ?? "",
    var_2: lista[1] ?? "",
    var_3: lista[2] ?? "",
    var_4: lista[3] ?? "",
    var_5: lista[4] ?? "",
    variaveis: vars,
  };
}
