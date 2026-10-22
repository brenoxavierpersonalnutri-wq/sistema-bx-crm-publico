// CRM > Automação > Fluxos (lista + construtor visual). Acesso a dados atrás de uma FONTE: a real (Supabase)
// e a de demonstração (dados fictícios, rota /dev/automacao-v2). Regras puras em
// supabase/functions/_shared/fluxoConstrutor.ts (testadas em src/test/crmFluxosConstrutor.test.ts).
import { db } from "@/lib/crmRoteiros";
import {
  arvoreDoFluxo,
  registroParaSalvar,
  type AgenteInfo,
  type NoFluxo,
  type NumeroInfo,
  type TemplateInfo,
} from "../../../supabase/functions/_shared/fluxoConstrutor.ts";
import { eventoDoBanco, type ConfigFluxo, type ExecucaoFluxo, type FonteBanco, type Fluxo, type GatilhoFluxo } from "../../../supabase/functions/_shared/fluxos.ts";
import type { MapeamentoEntrada } from "../../../supabase/functions/_shared/fluxoEntrada.ts";
import { origemWebhook } from "../../../supabase/functions/_shared/fluxoEntrada.ts";
import { fonteTagsSupabase, type TagExistente } from "./tags";
import { nomeCompletoSegmento } from "./segmentos";

export * from "../../../supabase/functions/_shared/fluxoConstrutor.ts";
export * from "../../../supabase/functions/_shared/fluxoEntrada.ts";
export {
  ETAPAS_FLUXO,
  FONTES_BANCO,
  NIVEIS_FORMULARIO,
  ORIGENS_FORMULARIO,
  bateFiltroBanco,
  eventoDoBanco,
  eventoWebhook,
  type FonteBanco,
  gatilhosDoFluxo,
  validarGatilho,
  MAX_GATILHOS,
  resumoPasso,
  validarFluxo,
  variaveisDoTemplate,
  type Condicao,
  type ConfigFluxo,
  type ExecucaoFluxo,
  type Fluxo,
  type GatilhoFluxo,
  type PassoFluxo,
  type TipoMidia,
} from "../../../supabase/functions/_shared/fluxos.ts";

/** Fluxo como o construtor edita (linha do banco + árvore). */
export interface FluxoConstrutor extends Fluxo {
  arvore: NoFluxo[];
  pasta_id: string | null;
  excluido_em: string | null;
  canvas: { zoom?: number; x?: number; y?: number };
  created_at: string;
  updated_at: string;
}

export interface ResumoFluxo {
  total_inscritos: number;
  inscritos_ativos: number;
  enviados: number;
  respondidos: number;
  falhas: number;
}

export interface LinhaListaFluxo {
  id: string;
  nome: string;
  ativo: boolean;
  pasta_id: string | null;
  excluido_em: string | null;
  created_at: string;
  updated_at: string;
  gatilhos: GatilhoFluxo[];
  origem_ff_workflow_id: string | null;
  resumo: ResumoFluxo | null;
}

export interface Pasta { id: string; nome: string }

export interface ExecucaoLinha extends ExecucaoFluxo {
  nome_contato: string | null;
  motivo: string | null;
}

export interface LogLinha {
  id: number;
  contact_phone: string;
  canal: string;
  tipo: string;
  status: "ok" | "erro";
  detalhe: string | null;
  created_at: string;
}

export interface CatalogoConstrutor {
  numeros: (NumeroInfo & { telefone?: string | null })[];
  templates: (TemplateInfo & { rotulos_variaveis?: Record<string, string>; categoria?: string })[];
  segmentos: { id: string; nome: string; alunas?: boolean }[];
  listas: string[];
  roteiros: { id: string; nome: string }[];
  passosRoteiro: { id: string; roteiro_id: string; ordem: number; rotulo: string | null }[];
  /** id e tipo vêm da migration 20261102100000 (sem ela: só slug/nome, e o passo Mensagem da IA fica sem agente) */
  agentes: AgenteInfo[];
  atendentes: string[];
  /** id + nome dos aprovados: o passo Atribuir grava o id (migration 20261123140000). Opcional (demo/testes). */
  atendentesIds?: { id: string; nome: string }[];
  fluxos: { id: string; nome: string }[];
  /** eventos já vistos em crm_contato_eventos (inclui wh_* vindos de webhook); vazio se a migration faltar */
  eventosVistos?: { valor: string; total: number; ultimo: string | null }[];
}

/** id do usuário cujo nome é exatamente o escolhido (sem caixa/espaços); nome repetido ou fora da lista = null */
export function idDoAtendente(catalogo: Pick<CatalogoConstrutor, "atendentesIds"> | null, nome: string): string | null {
  const alvo = nome.trim().toLowerCase();
  if (!alvo) return null;
  const achados = (catalogo?.atendentesIds ?? []).filter((a) => a.nome.trim().toLowerCase() === alvo);
  return achados.length === 1 ? achados[0].id : null;
}

/** URL de entrada do fluxo (crm_fluxo_entradas). Só admin lê. */
export interface EntradaFluxo {
  fluxo_id: string;
  id_publico: string;
  token: string;
  segredo_assinatura: string | null;
  ativo: boolean;
  mapeamento: MapeamentoEntrada;
  tags: string[];
  origem: string;
  limite_minuto: number;
  total: number;
  ultima_amostra: unknown;
  ultima_em: string | null;
  ultimo_status: string | null;
  ultimo_erro: string | null;
}

export interface FonteFluxos {
  demo: boolean;
  listar(): Promise<LinhaListaFluxo[]>;
  pastas(): Promise<Pasta[]>;
  criarPasta(nome: string): Promise<Pasta>;
  moverPasta(id: string, pasta: string | null): Promise<void>;
  obter(id: string): Promise<FluxoConstrutor | null>;
  /** `modelo`: fluxo pronto (ex.: Follow-up IA, de modeloFollowupIA); sempre nasce como rascunho */
  criar(nome: string, pasta: string | null, modelo?: Partial<FluxoConstrutor> & { arvore: NoFluxo[] }): Promise<string>;
  salvar(f: FluxoConstrutor): Promise<string>; // devolve updated_at
  salvarCanvas(id: string, canvas: FluxoConstrutor["canvas"]): Promise<void>;
  publicar(id: string, ativo: boolean): Promise<void>;
  excluir(id: string): Promise<void>;
  restaurar(id: string): Promise<void>;
  catalogo(): Promise<CatalogoConstrutor>;
  historico(id: string): Promise<ExecucaoLinha[]>;
  logs(id: string): Promise<LogLinha[]>;
  cancelarExecucao(execId: number): Promise<void>;
  /** entrada por webhook do fluxo (cria na primeira vez); null = sem permissão (não é admin) */
  entrada(fluxoId: string, nomeFluxo: string): Promise<EntradaFluxo | null>;
  salvarEntrada(fluxoId: string, patch: Partial<Pick<EntradaFluxo, "mapeamento" | "tags" | "ativo" | "limite_minuto">>): Promise<void>;
  novoTokenEntrada(fluxoId: string): Promise<string>;
  assinaturaEntrada(fluxoId: string, ligar: boolean): Promise<string | null>;
  tags(): Promise<TagExistente[]>;
  criarTag(nome: string): Promise<string>;
}

/** Números do Full Funnel ao lado do nosso, só como referência (prints de 17/10/2026). */
export const FF_REFERENCIA: Record<string, { inscritos: number; nome: string }> = {
  "621465f1-a79b-41a0-9c94-54553b23ae3c": { inscritos: 70, nome: "Leads qualificados – Breno Xavier" },
  "2cde495b-5650-4d0d-af57-121a605c2cf6": { inscritos: 23, nome: "PagTrust Desafio – Carrinho abandonado" },
  "fcb742cf-88cb-4546-9ed3-b03f9ef24bae": { inscritos: 10, nome: "PagTrust Desafio – Compra aprovada" },
  "005c66c3-50d6-483c-9880-7dab49371a7f": { inscritos: 2, nome: "PagTrust Low Ticket – Carrinho abandonado" },
  "0aadc5a9-f954-49b6-ac40-6c80e17b5022": { inscritos: 1, nome: "PagTrust Low Ticket – Compra aprovada" },
};

export const ROTULO_FONTE_BANCO: Record<FonteBanco, { rotulo: string; ajuda: string }> = {
  formulario: { rotulo: "Formulário da avaliação", ajuda: "Nova resposta em lead_form_responses (sites de cliente ficam de fora)." },
  agendamento: { rotulo: "Agendamento", ajuda: "Novo agendamento em consultations (Calendly e manual)." },
  compra: { rotulo: "Compra PagTrust", ajuda: "Venda aprovada que o webhook do PagTrust já grava (estorno não conta)." },
  base_leads: { rotulo: "Base de leads", ajuda: "Nova linha em base_leads (importação, webhook...). Filtre pela origem." },
  contato_whatsapp: { rotulo: "Novo contato no WhatsApp", ajuda: "Contato que aparece pela primeira vez no CRM (grupos ficam de fora)." },
};

/**
 * Eventos para o gatilho "Formulário / evento". `produtor` = quem grava o evento hoje (sem produtor o fluxo
 * nunca dispara; a tela avisa).
 */
export const EVENTOS_GATILHO: { valor: string; rotulo: string; produtor?: boolean }[] = [
  { valor: "lead_qualificado", rotulo: "Formulário de avaliação (qualificado, nível ≠ DQ)", produtor: true },
  ...(Object.keys(ROTULO_FONTE_BANCO) as FonteBanco[]).map((f) => ({ valor: eventoDoBanco(f), rotulo: `Banco: ${ROTULO_FONTE_BANCO[f].rotulo}`, produtor: true })),
  { valor: "pagtrust_desafio_compra_aprovada", rotulo: "PagTrust Desafio: compra aprovada" },
  { valor: "pagtrust_desafio_carrinho_abandonado", rotulo: "PagTrust Desafio: carrinho abandonado" },
  { valor: "pagtrust_desafio_pix_gerado", rotulo: "PagTrust Desafio: Pix gerado" },
  { valor: "pagtrust_lowticket_compra_aprovada", rotulo: "PagTrust Low Ticket: compra aprovada" },
  { valor: "pagtrust_lowticket_carrinho_abandonado", rotulo: "PagTrust Low Ticket: carrinho abandonado" },
  { valor: "pagtrust_lowticket_pix_gerado", rotulo: "PagTrust Low Ticket: Pix gerado" },
];

/** Rótulo de um evento (conhecido, banco, wh_* de webhook ou o nome cru). */
export function rotuloEvento(valor: string): string {
  const c = EVENTOS_GATILHO.find((e) => e.valor === valor);
  if (c) return c.rotulo;
  if (/^wh_/.test(valor)) return `Webhook: ${valor.slice(3).replace(/_/g, " ")}`;
  return valor.replace(/_/g, " ");
}

/**
 * Lista do seletor "Formulário / evento": os conhecidos + os já vistos no banco (eventos customizados que
 * chegaram por webhook). Evento visto tem produtor; o interno webhook_<uuid> de cada fluxo não aparece.
 */
export function eventosParaEscolher(vistos: { valor: string; total: number }[] = []): { valor: string; rotulo: string; produtor: boolean; total: number }[] {
  const mapa = new Map<string, { valor: string; rotulo: string; produtor: boolean; total: number }>();
  for (const e of EVENTOS_GATILHO) mapa.set(e.valor, { valor: e.valor, rotulo: e.rotulo, produtor: !!e.produtor, total: 0 });
  for (const v of vistos) {
    if (!v.valor || /^webhook_[0-9a-f]{32}$/.test(v.valor)) continue;
    const ant = mapa.get(v.valor);
    mapa.set(v.valor, { valor: v.valor, rotulo: ant?.rotulo ?? rotuloEvento(v.valor), produtor: true, total: Number(v.total) || 0 });
  }
  return [...mapa.values()];
}

export const LISTAS_CONHECIDAS = ["sellflux", "avaliacao", "individual", "pagtrust", "compra"];

export const VARIAVEIS_TEMPLATE = ["{primeiro_nome}", "{nome}", "{telefone}", "{dados.email}", "{dados.produto}"];

const resumoVazio = (): ResumoFluxo => ({ total_inscritos: 0, inscritos_ativos: 0, enviados: 0, respondidos: 0, falhas: 0 });

export function normalizarFluxo(r: Record<string, unknown>): FluxoConstrutor {
  const f = r as unknown as FluxoConstrutor;
  const gatilhos = Array.isArray(r.gatilhos) ? (r.gatilhos as GatilhoFluxo[]) : [];
  return {
    ...f,
    gatilhos,
    config: (r.config && typeof r.config === "object" ? r.config : {}) as ConfigFluxo,
    canvas: (r.canvas && typeof r.canvas === "object" ? r.canvas : {}) as FluxoConstrutor["canvas"],
    pasta_id: (r.pasta_id as string | null) ?? null,
    excluido_em: (r.excluido_em as string | null) ?? null,
    passos: Array.isArray(r.passos) ? (r.passos as Fluxo["passos"]) : [],
    arvore: arvoreDoFluxo({ arvore: r.arvore, passos: Array.isArray(r.passos) ? (r.passos as Fluxo["passos"]) : [] }),
  };
}

// ------------------------------------------------------------------ fonte real

const erroDe = (e: { message?: string } | null, onde: string) => {
  if (e) throw new Error(`${onde}: ${e.message ?? "falha"}`);
};

export const fonteSupabase: FonteFluxos = {
  demo: false,
  async listar() {
    const { data, error } = await db.from("crm_fluxos")
      .select("id, nome, ativo, pasta_id, excluido_em, created_at, updated_at, gatilhos, gatilho_tipo, gatilho_valor, origem_ff_workflow_id")
      .order("updated_at", { ascending: false });
    erroDe(error, "fluxos");
    const resumo = new Map<string, ResumoFluxo>();
    const r = await (db as unknown as { rpc: (n: string) => Promise<{ data: (ResumoFluxo & { fluxo_id: string })[] | null; error: unknown }> }).rpc("crm_fluxos_resumo");
    for (const x of r.data ?? []) resumo.set(x.fluxo_id, {
      total_inscritos: Number(x.total_inscritos), inscritos_ativos: Number(x.inscritos_ativos),
      enviados: Number(x.enviados), respondidos: Number(x.respondidos), falhas: Number(x.falhas),
    });
    return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      id: f.id as string, nome: f.nome as string, ativo: !!f.ativo,
      pasta_id: (f.pasta_id as string) ?? null, excluido_em: (f.excluido_em as string) ?? null,
      created_at: f.created_at as string, updated_at: f.updated_at as string,
      gatilhos: Array.isArray(f.gatilhos) && f.gatilhos.length ? (f.gatilhos as GatilhoFluxo[])
        : f.gatilho_tipo ? [{ tipo: f.gatilho_tipo, valor: f.gatilho_valor ?? "" } as GatilhoFluxo] : [],
      origem_ff_workflow_id: (f.origem_ff_workflow_id as string) ?? null,
      resumo: resumo.get(f.id as string) ?? (r.error ? null : resumoVazio()),
    }));
  },
  async pastas() {
    const { data, error } = await db.from("crm_fluxo_pastas").select("id, nome").order("ordem").order("nome");
    if (error) return [];
    return data ?? [];
  },
  async criarPasta(nome) {
    const { data, error } = await db.from("crm_fluxo_pastas").insert({ nome: nome.trim().slice(0, 60) }).select("id, nome").single();
    erroDe(error, "pasta");
    return data as Pasta;
  },
  async moverPasta(id, pasta) {
    const { error } = await db.from("crm_fluxos").update({ pasta_id: pasta }).eq("id", id);
    erroDe(error, "mover");
  },
  async obter(id) {
    const { data, error } = await db.from("crm_fluxos").select("*").eq("id", id).maybeSingle();
    erroDe(error, "fluxo");
    return data ? normalizarFluxo(data) : null;
  },
  async criar(nome, pasta, modelo) {
    const base = {
      nome: nome.trim() || "Novo fluxo", ativo: false, gatilho_tipo: "evento", gatilho_valor: null, gatilhos: [],
      passos: [], arvore: [], pasta_id: pasta, parar_se_responder: true, permitir_repetir: false,
      config: { hora_inicio: 8, hora_fim: 20, limite_dia: 100 },
    };
    const linha = modelo ? { ...base, ...registroParaSalvar({ ...modelo, nome: nome.trim() || modelo.nome || "Novo fluxo" }), pasta_id: pasta, ativo: false } : base;
    const { data, error } = await db.from("crm_fluxos").insert(linha).select("id").single();
    erroDe(error, "criar");
    return (data as { id: string }).id;
  },
  async salvar(f) {
    const { data, error } = await db.from("crm_fluxos").update(registroParaSalvar(f)).eq("id", f.id).select("updated_at").single();
    erroDe(error, "salvar");
    return (data as { updated_at: string }).updated_at;
  },
  async salvarCanvas(id, canvas) {
    await db.from("crm_fluxos").update({ canvas }).eq("id", id);
  },
  async publicar(id, ativo) {
    const { error } = await db.from("crm_fluxos").update({ ativo }).eq("id", id);
    erroDe(error, ativo ? "publicar" : "voltar para rascunho");
  },
  async excluir(id) {
    const { error } = await db.from("crm_fluxos").update({ excluido_em: new Date().toISOString(), ativo: false }).eq("id", id);
    erroDe(error, "excluir");
  },
  async restaurar(id) {
    const { error } = await db.from("crm_fluxos").update({ excluido_em: null }).eq("id", id);
    erroDe(error, "restaurar");
  },
  async catalogo() {
    const [num, tpl, seg, rot, pas, ag, prof, flx, bl] = await Promise.all([
      db.from("crm_numeros").select("id, apelido, telefone, tipo, ativo").order("ordem"),
      db.from("crm_wa_templates").select("nome, status, corpo, rotulos_variaveis, categoria").order("nome"),
      db.from("crm_segmentos").select("id, nome, filtro, ativo").order("ordem"),
      db.from("crm_roteiros").select("id, nome").order("nome"),
      db.from("crm_roteiro_passos").select("id, roteiro_id, ordem, rotulo").order("ordem"),
      agentesDoCatalogo(),
      db.from("profiles").select("id, full_name").eq("approved", true).order("full_name"),
      db.from("crm_fluxos").select("id, nome").is("excluido_em", null).order("nome"),
      db.from("base_leads").select("origem").limit(1000),
    ]);
    // o builder do postgrest-js não tem .catch (só then): sem o Promise.resolve, o TypeError derrubava o catálogo inteiro
    const evs = await Promise.resolve(rpcDb.rpc("crm_eventos_disponiveis")).catch(() => ({ data: null, error: true }));
    const listas = [...new Set([...LISTAS_CONHECIDAS, ...((bl.data ?? []) as { origem: string }[]).map((x) => x.origem)])].filter(Boolean).sort();
    return {
      numeros: num.data ?? [],
      templates: tpl.data ?? [],
      segmentos: ((seg.data ?? []) as { id: string; nome: string; filtro: { alunas?: string; programa?: string } | null; ativo: boolean }[])
        .filter((s) => s.ativo !== false).map((s) => ({ id: s.id, nome: nomeCompletoSegmento(s.nome, s.filtro), alunas: !!s.filtro?.alunas })),
      listas,
      roteiros: rot.data ?? [],
      passosRoteiro: pas.data ?? [],
      agentes: ag.data ?? [],
      atendentes: ((prof.data ?? []) as { full_name: string }[]).map((p) => p.full_name).filter(Boolean),
      atendentesIds: ((prof.data ?? []) as { id: string; full_name: string }[])
        .filter((p) => p.id && p.full_name).map((p) => ({ id: p.id, nome: p.full_name })),
      fluxos: flx.data ?? [],
      eventosVistos: ((evs.data ?? []) as { valor: string; total: number | string; ultimo: string | null }[])
        .map((e) => ({ valor: e.valor, total: Number(e.total) || 0, ultimo: e.ultimo })),
    };
  },
  async historico(id) {
    const { data, error } = await db.from("crm_fluxo_execucoes").select("*").eq("fluxo_id", id).order("iniciado_em", { ascending: false }).limit(300);
    erroDe(error, "histórico");
    const linhas = (data ?? []) as ExecucaoLinha[];
    const fones = [...new Set(linhas.map((l) => l.contact_phone))];
    const nomes = new Map<string, string>();
    for (let i = 0; i < fones.length; i += 200) {
      const { data: cs } = await db.from("whatsapp_contacts").select("phone, name").in("phone", fones.slice(i, i + 200));
      for (const c of (cs ?? []) as { phone: string; name: string }[]) nomes.set(c.phone, c.name);
    }
    return linhas.map((l) => ({ ...l, nome_contato: nomes.get(l.contact_phone) || null }));
  },
  async logs(id) {
    const { data, error } = await db.from("crm_automacao_log").select("id, contact_phone, canal, tipo, status, detalhe, created_at")
      .eq("fluxo_id", id).order("created_at", { ascending: false }).limit(500);
    erroDe(error, "logs");
    return (data ?? []) as LogLinha[];
  },
  async cancelarExecucao(execId) {
    const { error } = await db.from("crm_fluxo_execucoes").update({ status: "cancelado", motivo: "cancelado na tela" }).eq("id", execId).eq("status", "ativo");
    erroDe(error, "cancelar");
  },
  async entrada(fluxoId, nomeFluxo) {
    const campos = "fluxo_id, id_publico, token, segredo_assinatura, ativo, mapeamento, tags, origem, limite_minuto, total, ultima_amostra, ultima_em, ultimo_status, ultimo_erro";
    const { data, error } = await db.from("crm_fluxo_entradas").select(campos).eq("fluxo_id", fluxoId).maybeSingle();
    if (error) throw new Error(`entrada: ${error.message}`);
    if (data) return normalizarEntrada(data);
    // RLS: só admin insere/lê; quem não é admin recebe 0 linhas e o insert falha (42501)
    const { data: nova, error: e2 } = await db.from("crm_fluxo_entradas").insert({ fluxo_id: fluxoId, origem: origemWebhook(nomeFluxo) }).select(campos).single();
    if (e2) {
      if (["42501", "PGRST301"].includes(String(e2.code)) || /row-level security/i.test(e2.message ?? "")) return null;
      throw new Error(`entrada: ${e2.message}`);
    }
    return normalizarEntrada(nova);
  },
  async salvarEntrada(fluxoId, patch) {
    const { error } = await db.from("crm_fluxo_entradas").update({ ...patch, updated_at: new Date().toISOString() }).eq("fluxo_id", fluxoId);
    erroDe(error, "entrada");
  },
  async novoTokenEntrada(fluxoId) {
    const { data, error } = await rpcDb.rpc("crm_fluxo_entrada_novo_token", { p_fluxo: fluxoId });
    if (error) throw new Error(`token: ${(error as { message?: string }).message ?? "falha"}`);
    return String(data);
  },
  async assinaturaEntrada(fluxoId, ligar) {
    const { data, error } = await rpcDb.rpc("crm_fluxo_entrada_assinatura", { p_fluxo: fluxoId, p_ligar: ligar });
    if (error) throw new Error(`assinatura: ${(error as { message?: string }).message ?? "falha"}`);
    return (data as string | null) ?? null;
  },
  tags: () => fonteTagsSupabase.listar(),
  criarTag: (nome) => fonteTagsSupabase.criar(nome),
};

/** Agentes com id e tipo; banco sem a coluna tipo (migration 20261102100000 pendente) cai em slug/nome/id. */
async function agentesDoCatalogo(): Promise<{ data: AgenteInfo[] | null }> {
  const r = await db.from("crm_ai_agents").select("id, slug, nome, tipo, numero_id").order("nome");
  if (!r.error) return r;
  const semNumero = await db.from("crm_ai_agents").select("id, slug, nome, tipo").order("nome");
  if (!semNumero.error) return semNumero;
  return db.from("crm_ai_agents").select("id, slug, nome").order("nome");
}

const rpcDb = db as unknown as { rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export function normalizarEntrada(r: Record<string, unknown>): EntradaFluxo {
  return {
    ...(r as unknown as EntradaFluxo),
    mapeamento: (r.mapeamento && typeof r.mapeamento === "object" ? r.mapeamento : {}) as MapeamentoEntrada,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    total: Number(r.total) || 0,
    limite_minuto: Number(r.limite_minuto) || 60,
  };
}

// ------------------------------------------------------------------ rótulos

export const ROTULO_GATILHO: Record<GatilhoFluxo["tipo"], string> = {
  tag: "Tag adicionada",
  etapa: "Entrou na etapa",
  evento: "Formulário / evento",
  segmento: "Segmento / base de dados",
  sem_resposta: "Sem resposta há",
  data: "Data / agenda",
  banco: "Novo lead no banco de dados",
  webhook: "Webhook / API (entrada)",
};

export function resumoGatilho(g: GatilhoFluxo, cat?: Pick<CatalogoConstrutor, "segmentos">, etapas: Record<string, string> = {}): string {
  switch (g.tipo) {
    case "tag": return `Tag "${g.valor}"`;
    case "etapa": return `Entrou em ${etapas[g.valor] ?? g.valor}`;
    case "evento": return g.valor ? rotuloEvento(g.valor) : "escolha o evento";
    case "banco": {
      const filtros = [g.niveis?.length ? `nível ${g.niveis.join("/")}` : "", g.origens?.length ? g.origens.join("/") : ""].filter(Boolean).join(" · ");
      return `${ROTULO_FONTE_BANCO[g.fonte]?.rotulo ?? g.fonte}${filtros ? ` · ${filtros}` : ""} · só novos`;
    }
    case "webhook": return "URL própria do fluxo (POST)";
    case "segmento": {
      const nome = g.segmento_id ? (cat?.segmentos.find((s) => s.id === g.segmento_id)?.nome ?? "segmento") : `lista ${g.lista_origem}`;
      return `${nome} · ${g.modo === "todos" ? "todos agora" : "só os novos"}`;
    }
    case "sem_resposta": return `Sem resposta há ${g.horas >= 24 && g.horas % 24 === 0 ? `${g.horas / 24} dia(s)` : `${g.horas} h`}`;
    case "data": {
      const quem = g.segmento_id ? (cat?.segmentos.find((s) => s.id === g.segmento_id)?.nome ?? "segmento") : `tag ${g.tag}`;
      return `${new Date(g.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${quem}`;
    }
  }
}

export const fmtData = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
