// Construtor visual de fluxos (pegada do "Builder" do Full Funnel): regras puras, sem Deno e sem banco.
// Usadas pela tela (src/components/crm/fluxos) e pelo motor (crm-automacoes). Testadas em
// src/test/crmFluxosConstrutor.test.ts.
//
// A tela edita uma ÁRVORE (passos em sequência; o Se/Senão tem dois ramos). O motor continua lendo a lista
// LINEAR crm_fluxos.passos: ao salvar, a árvore é COMPILADA para a lista (condição + salto "ir_para"),
// e a árvore vai junto em crm_fluxos.arvore para a tela reabrir igual. Fluxo antigo sem árvore é
// DESCOMPILADO a partir da lista.
import { normalizarTag, type ContatoBasico, type MensagemBasica } from "./automacoes.ts";
import {
  gatilhosDoFluxo,
  validarFluxo,
  variaveisDoTemplate,
  type Condicao,
  type ConfigFluxo,
  type Fluxo,
  type GatilhoFluxo,
  type PassoFluxo,
  type TipoMidia,
} from "./fluxos.ts";

// ------------------------------------------------------------------ árvore

/** Enviar WhatsApp: o número decide o que dá para mandar (oficial = só template). */
export interface PassoWhatsApp {
  tipo: "whatsapp";
  /** null = número padrão do fluxo */
  numero_id?: string | null;
  template?: string | null;
  variaveis?: Record<string, string>;
  roteiro_id?: string | null;
  passo_id?: string | null;
  texto?: string | null;
  midia_url?: string | null;
  midia_tipo?: TipoMidia | null;
}

export interface PassoSe {
  tipo: "se";
  condicao: Condicao;
  sim: NoFluxo[];
  nao: NoFluxo[];
}

/** Condição antiga com desvio por número de passo (só aparece em fluxo antigo que não casa com Se/Senão). */
export type PassoCondicaoLegada = Extract<PassoFluxo, { tipo: "condicao" }>;

export type PassoArvore =
  | PassoWhatsApp
  | PassoSe
  | PassoCondicaoLegada
  | Exclude<PassoFluxo, { tipo: "template_oficial" } | { tipo: "mensagem" } | { tipo: "condicao" } | { tipo: "ir_para" }>;

export interface NoFluxo {
  id: string;
  passo: PassoArvore;
}

let seq = 0;
export function novoId(): string {
  seq = (seq + 1) % 1_000_000;
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID().slice(0, 12) : `n${Date.now().toString(36)}${seq}`;
}

export const no = (passo: PassoArvore, id: string = novoId()): NoFluxo => ({ id, passo });

function passoLinear(p: PassoArvore): PassoFluxo {
  if (p.tipo === "whatsapp") {
    const numero_id = p.numero_id ?? null;
    if (String(p.template ?? "").trim()) {
      return { tipo: "template_oficial", template: String(p.template).trim(), variaveis: p.variaveis ?? {}, numero_id };
    }
    return {
      tipo: "mensagem", numero_id,
      roteiro_id: p.roteiro_id ?? null, passo_id: p.passo_id ?? null,
      texto: p.texto ?? null, midia_url: p.midia_url ?? null, midia_tipo: p.midia_url ? (p.midia_tipo ?? null) : null,
    };
  }
  if (p.tipo === "se") throw new Error("se não é passo linear");
  return p as PassoFluxo;
}

/**
 * Árvore → lista linear do motor. Se/Senão vira:
 *   [condição: sim = segue, não = vai ao início do Senão] [ramo Sim...] [ir_para depois do Senão] [ramo Senão...]
 * Salto que cairia depois do último passo vira "parar" (fim do fluxo).
 */
export function compilarArvore(nos: NoFluxo[]): PassoFluxo[] {
  const out: PassoFluxo[] = [];
  const emitir = (lista: NoFluxo[]) => {
    for (const n of lista) {
      const p = n.passo;
      if (p.tipo !== "se") { out.push(passoLinear(p)); continue; }
      const iCond = out.length;
      out.push({ tipo: "parar" }); // reservado
      emitir(p.sim);
      const iSalto = out.length;
      out.push({ tipo: "parar" }); // reservado
      const inicioNao = out.length;
      emitir(p.nao);
      const fim = out.length;
      out[iCond] = { tipo: "condicao", condicao: p.condicao, se_sim: "continuar", se_nao: inicioNao + 1 };
      out[iSalto] = { tipo: "ir_para", passo: fim + 1 };
    }
  };
  emitir(nos);
  const total = out.length;
  return out.map((p) => {
    if (p.tipo === "ir_para" && p.passo > total) return { tipo: "parar" };
    if (p.tipo === "condicao" && typeof p.se_nao === "number" && p.se_nao > total) return { ...p, se_nao: "parar" };
    return p;
  });
}

function passoArvore(p: PassoFluxo): PassoArvore {
  if (p.tipo === "template_oficial") {
    return { tipo: "whatsapp", numero_id: p.numero_id ?? null, template: p.template, variaveis: p.variaveis ?? {} };
  }
  if (p.tipo === "mensagem") {
    return {
      tipo: "whatsapp", numero_id: p.numero_id ?? null, roteiro_id: p.roteiro_id ?? null, passo_id: p.passo_id ?? null,
      texto: p.texto ?? null, midia_url: p.midia_url ?? null, midia_tipo: p.midia_tipo ?? null,
    };
  }
  if (p.tipo === "ir_para") return { tipo: "parar" }; // salto solto (não deveria existir fora do padrão)
  return p as PassoArvore;
}

/** Lista linear → árvore (reconhece o padrão gerado por compilarArvore; o resto entra passo a passo). */
export function descompilarPassos(passos: PassoFluxo[]): NoFluxo[] {
  let k = 0;
  const id = () => `p${++k}`;
  const ler = (a: number, b: number): NoFluxo[] => {
    const nos: NoFluxo[] = [];
    let i = a;
    while (i < b) {
      const p = passos[i];
      if (p.tipo === "condicao" && p.se_sim === "continuar" && (typeof p.se_nao === "number" || p.se_nao === "parar")) {
        const inicioNao = typeof p.se_nao === "number" ? p.se_nao - 1 : b;
        const iSalto = inicioNao - 1;
        const salto = passos[iSalto];
        if (iSalto > i && iSalto < b && (salto?.tipo === "ir_para" || salto?.tipo === "parar")) {
          const fim = salto.tipo === "ir_para" ? salto.passo - 1 : b;
          if (fim >= inicioNao && fim <= b) {
            nos.push({ id: id(), passo: { tipo: "se", condicao: p.condicao, sim: ler(i + 1, iSalto), nao: ler(inicioNao, fim) } });
            i = fim;
            continue;
          }
        }
      }
      nos.push({ id: id(), passo: passoArvore(p) });
      i++;
    }
    return nos;
  };
  return ler(0, passos.length);
}

/** Árvore salva (crm_fluxos.arvore) ou, sem ela, a descompilada da lista. */
export function arvoreDoFluxo(f: { arvore?: unknown; passos?: PassoFluxo[] | null }): NoFluxo[] {
  if (Array.isArray(f.arvore) && f.arvore.every((n) => n && typeof n === "object" && "passo" in n)) return f.arvore as NoFluxo[];
  return descompilarPassos(f.passos ?? []);
}

// --------------------------------------------------------- edição da árvore

/** Endereço de uma lista na árvore: [] = raiz; [{id, ramo}] = ramo Sim/Senão do Se `id`. */
export type CaminhoLista = { id: string; ramo: "sim" | "nao" }[];

function listaEm(nos: NoFluxo[], caminho: CaminhoLista): NoFluxo[] | null {
  let atual = nos;
  for (const c of caminho) {
    const se = atual.find((n) => n.id === c.id);
    if (!se || se.passo.tipo !== "se") return null;
    atual = se.passo[c.ramo];
  }
  return atual;
}

const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Insere `novo` na lista do caminho, na posição `pos` (0 = antes do primeiro). */
export function inserirNo(nos: NoFluxo[], caminho: CaminhoLista, pos: number, novo: NoFluxo): NoFluxo[] {
  const r = clonar(nos);
  const l = listaEm(r, caminho);
  if (!l) return nos;
  l.splice(Math.max(0, Math.min(pos, l.length)), 0, novo);
  return r;
}

function mapearNos(nos: NoFluxo[], f: (n: NoFluxo) => NoFluxo | null): NoFluxo[] {
  const saida: NoFluxo[] = [];
  for (const n of nos) {
    const m = f(n);
    if (!m) continue;
    if (m.passo.tipo === "se") m.passo = { ...m.passo, sim: mapearNos(m.passo.sim, f), nao: mapearNos(m.passo.nao, f) };
    saida.push(m);
  }
  return saida;
}

export const removerNo = (nos: NoFluxo[], id: string) => mapearNos(clonar(nos), (n) => (n.id === id ? null : n));
export const trocarPasso = (nos: NoFluxo[], id: string, passo: PassoArvore) =>
  mapearNos(clonar(nos), (n) => (n.id === id ? { ...n, passo: clonar(passo) } : n));

export function acharNo(nos: NoFluxo[], id: string): NoFluxo | null {
  for (const n of nos) {
    if (n.id === id) return n;
    if (n.passo.tipo === "se") {
      const a = acharNo(n.passo.sim, id) ?? acharNo(n.passo.nao, id);
      if (a) return a;
    }
  }
  return null;
}

export function contarNos(nos: NoFluxo[]): number {
  return nos.reduce((s, n) => s + 1 + (n.passo.tipo === "se" ? contarNos(n.passo.sim) + contarNos(n.passo.nao) : 0), 0);
}

// ---------------------------------------------------------------- validação

export interface NumeroInfo {
  id: string;
  tipo: "openwa" | "oficial" | string;
  apelido?: string | null;
  ativo?: boolean;
}

export interface TemplateInfo {
  nome: string;
  status: string;
  corpo: string;
}

/** Agente de IA no catálogo do construtor (tipo nulo = atendimento, banco sem a migration 20261102100000). */
export interface AgenteInfo {
  id?: string;
  slug: string;
  nome: string;
  tipo?: string | null;
  /** número em que o agente responde (ausente = catálogo antigo, não confere) */
  numero_id?: string | null;
}

export type PassoTransferirIA = Extract<PassoFluxo, { tipo: "transferir_ia" }>;

/** Problemas do passo "Transferir para agente IA" com a lista de agentes: existe, é de atendimento e tem número. */
export function problemasTransferirIA(p: PassoTransferirIA, agentes?: AgenteInfo[]): string[] {
  if (!agentes || !p.agente) return [];
  const a = agentes.find((x) => x.slug === p.agente);
  if (!a) return ["o agente de IA escolhido não existe mais."];
  if (a.tipo === "followup") return [`o agente ${a.nome} é de follow-up: escolha um agente de atendimento.`];
  if ("numero_id" in a && !a.numero_id) return [`o agente ${a.nome} não tem número (Agente IA > Configuração).`];
  return [];
}

export type PassoIAFollowup = Extract<PassoFluxo, { tipo: "ia_followup" }>;

/**
 * Problemas do passo "Mensagem da IA", dado o número que ele vai usar: texto livre só sai por número NÃO oficial
 * (o oficial exige template aprovado pela Meta). Com a lista de agentes, confere se o escolhido existe e é de follow-up.
 */
export function problemasIAFollowup(p: PassoIAFollowup, numeroPadrao: string | null | undefined, numeros: NumeroInfo[], agentes?: AgenteInfo[]): string[] {
  const e: string[] = [];
  const numId = p.numero_id ?? numeroPadrao ?? null;
  const num = numId ? numeros.find((n) => n.id === numId) : undefined;
  if (numId && !num && numeros.length) e.push("o número escolhido não existe mais.");
  if (num && num.ativo === false) e.push(`o número ${num.apelido ?? ""} está desativado.`.replace("  ", " "));
  if (num?.tipo === "oficial") e.push("número oficial só envia template aprovado: a mensagem da IA sai só por número não oficial.");
  if (agentes && p.agente_id) {
    const a = agentes.find((x) => x.id === p.agente_id);
    if (!a) e.push("o agente de follow-up escolhido não existe mais.");
    else if (a.tipo !== "followup") e.push(`o agente ${a.nome} não é de follow-up.`);
  }
  return e;
}

/** Problemas do passo WhatsApp, dado o número que ele vai usar. */
export function problemasWhatsApp(p: PassoWhatsApp, numeroPadrao: string | null | undefined, numeros: NumeroInfo[], templates: TemplateInfo[] = []): string[] {
  const e: string[] = [];
  const numId = p.numero_id ?? numeroPadrao ?? null;
  const num = numId ? numeros.find((n) => n.id === numId) : undefined;
  if (numId && !num) e.push("o número escolhido não existe mais.");
  if (num && num.ativo === false) e.push(`o número ${num.apelido ?? ""} está desativado.`.replace("  ", " "));
  const temTemplate = !!String(p.template ?? "").trim();
  const temLivre = !!(p.roteiro_id || p.passo_id || String(p.texto ?? "").trim() || p.midia_url);
  if (num?.tipo === "oficial") {
    if (!temTemplate) e.push("número oficial só envia template aprovado: escolha o template.");
    if (temLivre) e.push("número oficial não manda texto livre, mídia ou roteiro (só template).");
  } else if (num) {
    if (temTemplate) e.push("template é do número oficial: troque o número ou escreva a mensagem.");
    if (!temLivre) e.push("escreva a mensagem, anexe a mídia ou escolha o roteiro.");
  } else if (!temTemplate && !temLivre) {
    e.push("escolha o número e o que enviar.");
  }
  if (p.midia_url && !/^https:\/\//.test(p.midia_url)) e.push("a mídia precisa de link https.");
  if (p.midia_url && !["image", "audio", "document"].includes(String(p.midia_tipo))) e.push("escolha o tipo da mídia.");
  if (temTemplate && templates.length) {
    const t = templates.find((x) => x.nome === String(p.template).trim());
    if (!t) e.push(`template ${p.template} não está no catálogo.`);
    else {
      if (t.status !== "APPROVED") e.push(`template ${t.nome} não está aprovado (${t.status}).`);
      const faltando = variaveisDoTemplate(t.corpo).filter((v) => !String(p.variaveis?.[String(v)] ?? "").trim());
      if (faltando.length) e.push(`preencha a variável {{${faltando.join("}}, {{")}}} do template.`);
    }
  }
  return e;
}

/** Erros do fluxo inteiro como o construtor monta (árvore + gatilhos + números). Vazio = pode publicar. */
export function validarConstrutor(
  f: Partial<Fluxo> & { arvore: NoFluxo[] },
  ctx: { numeros: NumeroInfo[]; templates?: TemplateInfo[]; agentes?: AgenteInfo[] },
): string[] {
  const erros: string[] = [];
  const passos = compilarArvore(f.arvore);
  // erros do motor, sem os "Passo N" (o número linear não bate com o desenho); os do WhatsApp vêm abaixo por nó
  for (const e of validarFluxo({ ...f, passos })) {
    if (/^Passo \d+: (escolha o template|escolha o roteiro ou o passo|a mídia precisa|escolha o tipo da mídia)/.test(e)) continue;
    erros.push(e.replace(/^Passo \d+:/, "Passo:"));
  }
  let n = 0;
  const andar = (lista: NoFluxo[]) => {
    for (const x of lista) {
      n++;
      if (x.passo.tipo === "whatsapp") {
        for (const e of problemasWhatsApp(x.passo, f.numero_id, ctx.numeros, ctx.templates)) erros.push(`Enviar WhatsApp (passo ${n}): ${e}`);
      } else if (x.passo.tipo === "ia_followup") {
        for (const e of problemasIAFollowup(x.passo, f.numero_id, ctx.numeros, ctx.agentes)) erros.push(`Mensagem da IA (passo ${n}): ${e}`);
      } else if (x.passo.tipo === "transferir_ia") {
        for (const e of problemasTransferirIA(x.passo, ctx.agentes)) erros.push(`Transferir para agente IA (passo ${n}): ${e}`);
      } else if (x.passo.tipo === "se") {
        andar(x.passo.sim);
        andar(x.passo.nao);
      } else if (x.passo.tipo === "condicao") {
        erros.push(`Passo ${n}: condição antiga com desvio por número; refaça como Se/Senão.`);
      }
    }
  };
  andar(f.arvore);
  return [...new Set(erros)];
}

/** Erros por nó (para pintar o cartão de vermelho no canvas). */
export function errosPorNo(arvore: NoFluxo[], numeroPadrao: string | null | undefined, numeros: NumeroInfo[], templates: TemplateInfo[] = [], agentes?: AgenteInfo[]): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  const andar = (lista: NoFluxo[]) => {
    for (const x of lista) {
      const p = x.passo;
      let e: string[] = [];
      if (p.tipo === "whatsapp") e = problemasWhatsApp(p, numeroPadrao, numeros, templates);
      else if (p.tipo === "se") { andar(p.sim); andar(p.nao); e = validarFluxo({ nome: "x", gatilho_tipo: "evento", gatilho_valor: "x", passos: [{ tipo: "condicao", condicao: p.condicao, se_sim: "continuar", se_nao: "continuar" }] }).map((s) => s.replace(/^Passo 1: /, "")); }
      else e = validarFluxo({ nome: "x", gatilho_tipo: "evento", gatilho_valor: "x", passos: [p as PassoFluxo] }).map((s) => s.replace(/^Passo 1: /, ""));
      if (p.tipo === "ia_followup") e = [...e, ...problemasIAFollowup(p, numeroPadrao, numeros, agentes)];
      if (p.tipo === "transferir_ia") e = [...e, ...problemasTransferirIA(p, agentes)];
      if (e.length) r[x.id] = e;
    }
  };
  andar(arvore);
  return r;
}

/** Linha gravada no banco a partir do que o construtor edita. */
export function registroParaSalvar(f: Partial<Fluxo> & { arvore: NoFluxo[] }): Record<string, unknown> {
  const gatilhos = gatilhosDoFluxo(f);
  const g0 = gatilhos[0];
  const valor0 = !g0 ? null
    : g0.tipo === "tag" || g0.tipo === "etapa" || g0.tipo === "evento" ? g0.valor
    : g0.tipo === "segmento" ? (g0.segmento_id ?? `lista:${g0.lista_origem ?? ""}`)
    : g0.tipo === "sem_resposta" ? String(g0.horas)
    : g0.tipo === "banco" ? `banco:${g0.fonte}`
    : g0.tipo === "webhook" ? "webhook"
    : g0.em;
  return {
    nome: String(f.nome ?? "").trim(),
    descricao: f.descricao ?? null,
    gatilho_tipo: g0?.tipo ?? "evento",
    gatilho_valor: valor0,
    gatilhos,
    parar_se_responder: !!f.parar_se_responder,
    permitir_repetir: !!f.permitir_repetir,
    numero_id: f.numero_id ?? null,
    config: f.config ?? {},
    arvore: f.arvore,
    passos: compilarArvore(f.arvore),
  };
}

// ------------------------------------------------------ gatilhos por base

export const chaveGatilhoBase = (g: Extract<GatilhoFluxo, { tipo: "segmento" | "data" }>): string =>
  g.tipo === "segmento" ? `seg:${g.segmento_id ?? `lista:${g.lista_origem ?? ""}`}` : `data:${g.em}:${g.segmento_id ?? `tag:${g.tag ?? ""}`}`;

export const MARCA_BASE = "__base__";

/**
 * Segmento/lista: quem inscrever agora.
 * - "todos": todo membro que ainda não teve execução neste fluxo (e quem entrar depois);
 * - "novos": na primeira passada só FOTOGRAFA a base (ninguém entra); depois entra quem aparecer fora da foto.
 * `vistos` = telefones já registrados para esta chave (inclui a marca da foto). Teto = vagas do dia.
 */
export function inscricoesPorSegmento(args: {
  modo: "todos" | "novos";
  membros: string[];
  jaInscritos: Set<string>;
  vistos: Set<string>;
  vagas: number;
}): { inscrever: string[]; fotografar: string[] } {
  const membros = [...new Set(args.membros.filter(Boolean))];
  if (args.modo === "novos" && !args.vistos.has(MARCA_BASE)) {
    return { inscrever: [], fotografar: [MARCA_BASE, ...membros] };
  }
  const candidatos = membros.filter((p) => !args.jaInscritos.has(p) && (args.modo === "todos" || !args.vistos.has(p)));
  const inscrever = candidatos.slice(0, Math.max(0, args.vagas));
  return { inscrever, fotografar: args.modo === "novos" ? inscrever : [] };
}

/**
 * Sem resposta há X horas: a última mensagem da conversa é NOSSA, mandada há pelo menos X horas, e o
 * prazo venceu depois de `desde` (ligar o fluxo não pega silêncio antigo). Devolve quando o silêncio começou.
 */
export function alvosSemResposta(mensagens: MensagemBasica[], horas: number, desde: Date, agora: Date): { phone: string; desde: string }[] {
  const ultima = new Map<string, MensagemBasica>();
  for (const m of mensagens) {
    const u = ultima.get(m.contact_phone);
    if (!u || m.created_at > u.created_at) ultima.set(m.contact_phone, m);
  }
  const prazo = horas * 3600_000;
  const saida: { phone: string; desde: string }[] = [];
  for (const [phone, m] of ultima) {
    if (m.direction !== "outbound") continue;
    const venceu = new Date(m.created_at).getTime() + prazo;
    if (venceu <= agora.getTime() && venceu >= desde.getTime()) saida.push({ phone, desde: m.created_at });
  }
  return saida.sort((a, b) => a.desde.localeCompare(b.desde));
}

/** Data de "hoje" em Brasília (AAAA-MM-DD) e o início desse dia em UTC. */
export function inicioDiaBRT(agora: Date): Date {
  const brt = new Date(agora.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), 3, 0, 0));
}

/** Vagas de inscrição que sobram hoje (sem limite = muitas). */
export function vagasHoje(cfg: ConfigFluxo | null | undefined, inscritosHoje: number): number {
  const lim = Number(cfg?.limite_dia);
  if (!Number.isFinite(lim) || lim <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, lim - inscritosHoje);
}

/** Fora do horário permitido: devolve quando a janela abre (Brasília); dentro: null. */
export function proximaJanela(agora: Date, cfg: ConfigFluxo | null | undefined): Date | null {
  const ini = Number.isInteger(cfg?.hora_inicio) ? Number(cfg!.hora_inicio) : 0;
  const fim = Number.isInteger(cfg?.hora_fim) ? Number(cfg!.hora_fim) : 24;
  if (ini <= 0 && fim >= 24) return null;
  const brt = new Date(agora.getTime() - 3 * 3600_000);
  const h = brt.getUTCHours() + brt.getUTCMinutes() / 60;
  if (h >= ini && h < fim) return null;
  const dia = inicioDiaBRT(agora);
  const abreHoje = new Date(dia.getTime() + ini * 3600_000);
  return h < ini ? abreHoje : new Date(abreHoje.getTime() + 24 * 3600_000);
}

/** O passo manda mensagem (respeita horário permitido)? */
export const passoEnvia = (p: PassoFluxo): boolean => p.tipo === "template_oficial" || p.tipo === "mensagem" || p.tipo === "ia_followup";

/** Dado de contato para o webhook de saída (sem nada além do que o CRM já mostra). */
export function corpoWebhook(f: Pick<Fluxo, "id" | "nome">, contato: ContatoBasico, dados: Record<string, unknown>): Record<string, unknown> {
  return {
    evento: "crm_fluxo_passo",
    fluxo: { id: f.id, nome: f.nome },
    contato: { telefone: contato.phone, nome: contato.name ?? null, etapa: contato.stage ?? null, tags: (contato.tags ?? []).map(normalizarTag) },
    dados,
    enviado_em: new Date().toISOString(),
  };
}

// ------------------------------------------------------ modelo pronto: Follow-up IA

/** Esperas entre as tentativas, em dias (padrão: 1, 2, 4 e 7 → 5 mensagens: no gatilho, D+1, D+3, D+7, D+14). */
export const CADENCIA_PADRAO = [1, 2, 4, 7];
export const MAX_TENTATIVAS_FOLLOWUP = 8;

/** Dia de cada mensagem contando do gatilho (0 = na hora). [1,2,4,7] → [0,1,3,7,14]. */
export function diasDasTentativas(cadencia: number[]): number[] {
  const dias = [0];
  for (const d of cadencia) dias.push(dias[dias.length - 1] + d);
  return dias;
}

/** Cadência válida: 1 a 7 esperas (até 8 mensagens), cada uma de 1 a 30 dias. */
export function validarCadencia(cadencia: number[]): string[] {
  const e: string[] = [];
  if (!Array.isArray(cadencia) || !cadencia.length) e.push("informe pelo menos uma espera entre as tentativas.");
  else {
    if (cadencia.length > MAX_TENTATIVAS_FOLLOWUP - 1) e.push(`no máximo ${MAX_TENTATIVAS_FOLLOWUP} tentativas (${MAX_TENTATIVAS_FOLLOWUP - 1} esperas).`);
    if (cadencia.some((d) => !Number.isInteger(d) || d < 1 || d > 30)) e.push("cada espera precisa ser de 1 a 30 dias (número inteiro).");
  }
  return e;
}

export interface OpcoesModeloFollowup {
  agenteId: string;
  /** gatilho de entrada (padrão: sem resposta há 24 h) */
  gatilho?: GatilhoFluxo;
  /** esperas em dias entre as tentativas (padrão CADENCIA_PADRAO) */
  cadencia?: number[];
  /** número do fluxo (topo do construtor); null = padrão */
  numeroId?: string | null;
  /** instrução de cada tentativa (índice 0 = 1ª); faltando, fica sem instrução */
  instrucoes?: string[];
  nome?: string;
}

/**
 * Monta o fluxo "Follow-up IA": gatilho → Mensagem da IA (1ª) → Esperar → Se respondeu? (sim: Parar) →
 * Mensagem da IA (2ª) → ... → última mensagem → FIM. Liga "parar se responder" (o motor já para a execução
 * quando a lead responde, mesmo no meio de uma espera) e o horário 8h-20h. Nasce como RASCUNHO.
 */
export function modeloFollowupIA(o: OpcoesModeloFollowup): Pick<Fluxo, "nome" | "ativo" | "gatilhos" | "parar_se_responder" | "permitir_repetir" | "numero_id" | "config"> & { arvore: NoFluxo[] } {
  const cadencia = o.cadencia?.length ? o.cadencia : CADENCIA_PADRAO;
  const erros = validarCadencia(cadencia);
  if (erros.length) throw new Error(`Cadência: ${erros.join(" ")}`);
  const msg = (i: number): NoFluxo => no({
    tipo: "ia_followup", agente_id: o.agenteId, tentativa: i + 1, instrucao: o.instrucoes?.[i]?.trim() || null,
  });
  const arvore: NoFluxo[] = [msg(0)];
  cadencia.forEach((dias, i) => {
    arvore.push(no({ tipo: "esperar", quantidade: dias, unidade: "dias" }));
    arvore.push(no({ tipo: "se", condicao: { tipo: "respondeu" }, sim: [no({ tipo: "parar" })], nao: [] }));
    arvore.push(msg(i + 1));
  });
  return {
    nome: (o.nome ?? "Follow-up IA").trim().slice(0, 120) || "Follow-up IA",
    ativo: false,
    gatilhos: [o.gatilho ?? { tipo: "sem_resposta", horas: 24 }],
    parar_se_responder: true,
    permitir_repetir: false,
    numero_id: o.numeroId ?? null,
    config: { hora_inicio: 8, hora_fim: 20, limite_dia: 100 },
    arvore,
  };
}

// --------------------------------------------------------------- simulação

export interface CenarioTeste {
  respondeu: boolean;
  /** "A IA transferiu?" no teste (padrão: não) */
  iaTransferiu?: boolean;
  tags: string[];
  etapa: string;
  dados?: Record<string, unknown>;
}

/**
 * "Testar fluxo": anda a árvore para um contato imaginário, SEM enviar nada. Devolve o caminho percorrido
 * (cada linha = um nó; esperas aparecem como passo, não como tempo real).
 */
export function simularArvore(nos: NoFluxo[], c: CenarioTeste): { id: string; texto: string }[] {
  const caminho: { id: string; texto: string }[] = [];
  const contato: ContatoBasico = { phone: "5531900000000", name: "Contato teste", stage: c.etapa, tags: [...c.tags] };
  const ctx = { contato, respondeuDesde: () => c.respondeu };
  let parou = false;
  const andar = (lista: NoFluxo[]) => {
    for (const n of lista) {
      if (parou) return;
      const p = n.passo;
      if (p.tipo === "se") {
        const r = avaliar(p.condicao);
        caminho.push({ id: n.id, texto: `Se: ${r ? "SIM" : "SENÃO"}` });
        andar(r ? p.sim : p.nao);
        continue;
      }
      if (p.tipo === "parar") { caminho.push({ id: n.id, texto: "Parar" }); parou = true; return; }
      if (p.tipo === "ir_fluxo") { caminho.push({ id: n.id, texto: "Vai para outro fluxo" }); parou = true; return; }
      if (p.tipo === "tag") {
        const t = normalizarTag(p.tag);
        contato.tags = p.acao === "por" ? [...new Set([...(contato.tags ?? []), t])] : (contato.tags ?? []).filter((x) => normalizarTag(x) !== t);
      }
      if (p.tipo === "etapa") contato.stage = p.etapa;
      if (p.tipo === "transferir_humano") {
        if (p.tag) contato.tags = [...new Set([...(contato.tags ?? []), normalizarTag(p.tag)])];
        if (p.etapa) contato.stage = p.etapa;
        caminho.push({ id: n.id, texto: `Transferir para humano${p.para ? ` (${p.para})` : ""}` });
        continue;
      }
      if (p.tipo === "transferir_ia") {
        caminho.push({ id: n.id, texto: `Transferir para agente IA (${p.agente})` });
        continue;
      }
      caminho.push({ id: n.id, texto: p.tipo === "ia_followup" ? `Mensagem da IA${p.tentativa ? ` (${p.tentativa}ª)` : ""}` : p.tipo });
    }
  };
  const avaliar = (cond: Condicao): boolean => {
    if (cond.tipo === "respondeu") return ctx.respondeuDesde();
    if (cond.tipo === "ia_transferiu") return Boolean(c.iaTransferiu);
    if (cond.tipo === "tem_tag") return (contato.tags ?? []).map(normalizarTag).includes(normalizarTag(cond.valor));
    if (cond.tipo === "etapa") return contato.stage === cond.valor;
    if (cond.tipo === "campo") {
      const v = cond.campo.startsWith("dados.") ? c.dados?.[cond.campo.slice(6)] : (contato as unknown as Record<string, unknown>)[cond.campo === "nome" ? "name" : cond.campo];
      if (cond.operador === "existe") return v !== undefined && v !== null && v !== "";
      const a = String(v ?? "").toLowerCase(), b = String(cond.valor ?? "").toLowerCase();
      return cond.operador === "igual" ? a === b : a.includes(b);
    }
    return false;
  };
  andar(nos);
  if (!parou) caminho.push({ id: "fim", texto: "FIM" });
  return caminho;
}

// -------------------------------------------------------------- lista da tela

export interface LinhaFluxo {
  id: string;
  nome: string;
  ativo: boolean;
  pasta_id?: string | null;
  excluido_em?: string | null;
  updated_at?: string;
  created_at?: string;
}

export type AbaLista = "todos" | "rascunhos" | "excluidos";

/** Filtro da lista (abas Todos / Rascunhos / Excluídos + busca + pasta). */
export function filtrarLista<T extends LinhaFluxo>(lista: T[], aba: AbaLista, busca: string, pasta: string | null): T[] {
  const b = busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return lista
    .filter((f) => (aba === "excluidos" ? !!f.excluido_em : !f.excluido_em))
    .filter((f) => aba !== "rascunhos" || !f.ativo)
    .filter((f) => !pasta || f.pasta_id === pasta)
    .filter((f) => !b || f.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(b))
    .sort((a, c) => String(c.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}
