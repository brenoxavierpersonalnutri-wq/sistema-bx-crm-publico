// Fonte de dados da visão "Conversas": a interface que a tela usa e a implementação real
// (Supabase: tabelas whatsapp_contacts / whatsapp_messages, Realtime e as edge functions
// whatsapp-send, whatsapp-send-media e whatsapp-import-history que o chat antigo já usava).
// A rota de desenvolvimento /dev/crm-conversas passa uma fonte fictícia com a mesma interface.
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { envioManual, pastaDoContato } from "@/lib/crm/envioGrupo";
import type { ContatoCRM, Leituras, MensagemCRM, NumeroConversa, ResumoConversa } from "@/lib/crm/conversas";
import type { ConsultaLista, ContadoresLista, CursorLista, LinhaLista } from "@/lib/crm/listaPaginada";

export interface EventosFonte {
  onMensagem: (m: MensagemCRM, evento: "INSERT" | "UPDATE") => void;
  onContato: (c: ContatoCRM, evento: "INSERT" | "UPDATE" | "DELETE") => void;
}

export interface FonteConversas {
  usuarioId(): Promise<string>;
  listarContatos(): Promise<ContatoCRM[]>;
  /** Janela das mensagens mais recentes de todos os contatos (prévia e não lidas da lista). `limite`: menos que o padrão. */
  mensagensRecentes(limite?: number): Promise<MensagemCRM[]>;
  /**
   * Lista paginada pelo servidor (RPC crm_conversas_pagina, migration 20261126100000). Uma página da consulta
   * (`consulta` + `cursor`), o que mudou desde `desde` (delta), ou as conversas de `chaves`.
   * null = RPC indisponível (migration não rodou): a tela volta ao carregamento completo de antes.
   */
  paginaConversas?(p: PedidoPagina): Promise<LinhaLista[] | null>;
  /** Contadores das abas (crm_conversas_contadores). null = indisponível. */
  contadoresConversas?(p: PedidoContadores): Promise<ContadoresLista | null>;
  /**
   * Canais que não paginam no servidor (Instagram Direct): contatos e mensagens recentes inteiros, como antes.
   * Só a lista paginada usa; no carregamento completo eles já vêm em listarContatos/mensagensRecentes.
   */
  canaisCompletos?(): Promise<{ contatos: ContatoCRM[]; mensagens: MensagemCRM[] }>;
  /**
   * Última mensagem real e não lidas de CADA contato com conversa (RPC crm_conversas_ultimas).
   * null = indisponível (migration não rodou): a lista ordena pela janela de mensagens recentes.
   */
  resumoConversas?(leituras: Leituras, base: string | null): Promise<ResumoConversa[] | null>;
  /** Números do WhatsApp (crm_numeros) para o seletor do topo e o selo de cada conversa. */
  listarNumeros?(): Promise<NumeroConversa[]>;
  /**
   * Página de um contato, da mais nova para a mais antiga; `antesDe` pagina para trás.
   * `numeroId`: só as mensagens daquele número (a mesma pessoa em outro número é outra conversa).
   */
  mensagensDoContato(phone: string, limite: number, antesDe?: string, numeroId?: string | null): Promise<MensagemCRM[]>;
  /**
   * Links assinados que chegaram depois da página (21/10/2026): mensagensDoContato devolve na hora, sem esperar
   * a assinatura da mídia, e entrega as mensagens já com o link por aqui.
   */
  ouvirMidiasAssinadas?(fn: (msgs: MensagemCRM[]) => void): () => void;
  assinar(eventos: EventosFonte): () => void;
  /** `numeroId`: responde pelo MESMO número da conversa (sem ele, o padrão). */
  enviarTexto(phone: string, texto: string, numeroId?: string | null): Promise<void>;
  /** `ptt`: nota de voz gravada no CRM (Ogg/Opus) — chega como bolha de microfone no WhatsApp. */
  enviarMidia(phone: string, arquivo: File, legenda: string, opcoes?: { ptt?: boolean; numeroId?: string | null }): Promise<void>;
  /** Mídia que já está num link (roteiro): manda sem subir de novo. */
  enviarMidiaUrl?(
    phone: string,
    midia: { url: string; tipo: "image" | "audio" | "document" | "video"; nome?: string; ptt?: boolean },
    legenda: string,
    numeroId?: string | null,
  ): Promise<void>;
  /** `limite`: quantas das mais recentes pedir ao WhatsApp (até 2000); `semMidia`: só metadado (baixa ao abrir). */
  importarHistorico(phone: string, numeroId?: string | null, opcoes?: { limite?: number; semMidia?: boolean }): Promise<number>;
  /** Conversas recentes do celular (contatos e grupos) com as fotos; devolve o resumo. `numeroId`: de qual número. */
  sincronizarConversas?(numeroId?: string | null): Promise<{ chats: number; imported: number; fotos: number; aviso?: string }>;
  atualizarContato(id: string, patch: Partial<Pick<ContatoCRM, "stage" | "ai_pausado">>): Promise<void>;
  /**
   * Mídia sob demanda (18/10/2026): baixa o arquivo de uma mensagem importada só com metadado
   * (whatsapp-import-history { midia_de }) e devolve o link assinado; null = o WhatsApp não entregou.
   */
  baixarMidia?(msg: MensagemCRM): Promise<string | null>;
  /** Tamanho de um arquivo remoto (documento); null quando não dá pra saber. */
  tamanhoArquivo?(url: string): Promise<number | null>;
  /** Backfill de TODAS as conversas do WhatsApp (whatsapp-backfill), com progresso. */
  backfill?: {
    /** `numeroId`: o job daquele número (um por número); sem ele, o do número padrão. */
    status(numeroId?: string | null): Promise<JobBackfill | null>;
    /** `completo`: histórico completo do número (sem janela de dias, até 2000 por conversa, sem mídia). */
    iniciar(numeroId?: string | null, opcoes?: { completo?: boolean }): Promise<JobBackfill | null>;
    cancelar(numeroId?: string | null): Promise<JobBackfill | null>;
    pausar?(numeroId?: string | null): Promise<JobBackfill | null>;
    retomar?(numeroId?: string | null): Promise<JobBackfill | null>;
  };
}

/** Leituras e marcas do usuário: o servidor conta as não lidas com elas (ficam no localStorage). */
export interface LeiturasDoUsuario {
  leituras: Leituras;
  base: string | null;
  marcadas: string[];
  /** Números fora de /crm/conversas (Grupos 1): o servidor já não manda. */
  ocultos: string[];
}

export interface PedidoPagina extends LeiturasDoUsuario {
  consulta?: ConsultaLista;
  cursor?: CursorLista | null;
  desde?: string | null;
  chaves?: string[] | null;
  limite?: number;
}

export interface PedidoContadores extends LeiturasDoUsuario {
  numeroId: string | null;
  atendente: ConsultaLista["atendente"];
}

export interface JobBackfill {
  id: string;
  status: "listando" | "importando" | "pausado" | "concluido" | "cancelado" | "erro";
  /** Histórico completo (migration 20261101110000); sem a coluna, undefined. */
  completo?: boolean;
  total_chats: number;
  chats_feitos: number;
  chats_erro: number;
  msgs_importadas: number;
  midias: number;
  por_chat: number;
  aviso: string | null;
  criado_em: string;
  concluido_em: string | null;
}

// ---- mídia no bucket privado: link assinado na leitura (1 h), com cache por caminho
const BUCKET_MIDIA = "whatsapp-media";
const VALIDADE_LINK_S = 3600;
const linksAssinados = new Map<string, { url: string; ate: number }>();

/** Só os links que já estão no cache (síncrono, sem rede). */
export function assinarDoCache<T extends Pick<MensagemCRM, "media_path" | "media_url">>(msgs: T[]): T[] {
  const agora = Date.now();
  return msgs.map((m) => {
    if (!m.media_path || m.media_url) return m;
    const l = linksAssinados.get(m.media_path);
    return l && l.ate > agora + 60_000 ? { ...m, media_url: l.url } : m;
  });
}

const ouvintesAssinatura = new Set<(msgs: MensagemCRM[]) => void>();

/** Preenche media_url das mensagens que só têm media_path (um pedido pro lote inteiro). */
export async function assinarMidias<T extends Pick<MensagemCRM, "media_path" | "media_url">>(msgs: T[]): Promise<T[]> {
  const agora = Date.now();
  const faltam = [...new Set(msgs
    .filter((m) => m.media_path && !m.media_url)
    .map((m) => m.media_path as string)
    .filter((p) => (linksAssinados.get(p)?.ate ?? 0) <= agora + 60_000))];
  if (faltam.length) {
    const { data } = await supabase.storage.from(BUCKET_MIDIA).createSignedUrls(faltam, VALIDADE_LINK_S);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl) linksAssinados.set(d.path, { url: d.signedUrl, ate: agora + VALIDADE_LINK_S * 1000 });
    }
  }
  return msgs.map((m) => {
    if (!m.media_path || m.media_url) return m;
    const l = linksAssinados.get(m.media_path);
    return l ? { ...m, media_url: l.url } : m;
  });
}

// whatsapp_contacts.tags / ai_* ainda não estão no types.ts gerado
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const COLUNAS_MSG_BASE =
  "id, contact_phone, body, caption, created_at, direction, sender_type, status, media_url, media_type, mime_type, file_name, message_id";
// author_* chegam com a migration 20261022100000; sem ela, a leitura cai nas colunas antigas
const COLUNAS_MSG_GRUPO = `${COLUNAS_MSG_BASE}, author_name, author_phone, author_id`;
// media_path/media_status chegam com a migration 20261025100000
const COLUNAS_MSG_COMPLETA = `${COLUNAS_MSG_GRUPO}, media_path, media_status`;
// numero_id chega com a migration 20261028100000 (conversa por número)
const COLUNAS_MSG_NUMERO = `${COLUNAS_MSG_COMPLETA}, numero_id`;
let colunasMsg = COLUNAS_MSG_NUMERO;
const colunaInexistente = (e: unknown) =>
  !!e && typeof e === "object" && ((e as { code?: string }).code === "42703" || /author_(name|phone|id)|media_(path|status)|numero_id|ocultar_em_conversas|sessao_openwa/.test(String((e as { message?: string }).message)));
/** Próximo conjunto de colunas quando o banco ainda não tem as mais novas. */
const colunasAnteriores = (c: string) =>
  c === COLUNAS_MSG_NUMERO ? COLUNAS_MSG_COMPLETA : c === COLUNAS_MSG_COMPLETA ? COLUNAS_MSG_GRUPO : COLUNAS_MSG_BASE;
/** Filtro por número só quando o banco tem a coluna (senão, a conversa é só pelo telefone, como antes). */
const temColunaNumero = () => colunasMsg === COLUNAS_MSG_NUMERO;
const JANELA_RECENTES = 2000;
const PAGINA_RESUMO = 1000; // teto de linhas do PostgREST por pedido
/** RPC ausente (migration 20261027120000 pendente): cai no fallback sem tentar a cada 30 s. */
let resumoIndisponivel = false;
/** RPC da lista paginada ausente (migration 20261126100000 pendente): a tela usa o carregamento completo. */
let paginaIndisponivel = false;
const rpcInexistente = (e: unknown) =>
  !!e && typeof e === "object" && ["PGRST202", "42883", "PGRST204"].includes(String((e as { code?: string }).code));
const PAGINA_CONTATOS = 1000;
const TETO_CONTATOS = 10_000;

/** RPC sem tipo gerado (as novas não estão no types.ts). */
const rpc = (f: string, a: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc(f, a);

async function acaoBackfill(acao: string, numeroId?: string | null, extra: Record<string, unknown> = {}): Promise<JobBackfill | null> {
  const { data, error } = await supabase.functions.invoke("whatsapp-backfill", {
    body: { acao, ...extra, ...(numeroId ? { numero_id: numeroId } : {}) },
  });
  if (error) throw error;
  return (data?.job ?? null) as JobBackfill | null;
}

/** Resposta da importação "lista primeiro" no formato que a tela mostra (aviso quando veio parcial/lento). */
export function resumoTrazerConversas(data: Record<string, unknown> | null | undefined): { chats: number; imported: number; fotos: number; aviso?: string } {
  const d = data ?? {};
  const aviso = typeof d.aviso === "string" ? d.aviso
    : d.modo === "lento" ? "modo lento: o proxy da VPS ainda não tem a rota chats-recentes"
    : d.parcial ? "parte das conversas não coube no tempo; rode de novo para completar"
    : undefined;
  return {
    chats: Number(d.chats ?? 0),
    imported: Number(d.imported ?? 0),
    fotos: Number(d.fotos ?? 0),
    ...(aviso ? { aviso } : {}),
  };
}

/**
 * Lista primeiro (18/10/2026): as ~80 conversas mais recentes do número com as últimas 20 mensagens de cada,
 * texto e horário reais, numa chamada (whatsapp-import-history modo "recentes"). Mídia fica sob demanda.
 */
export async function trazerConversasRecentes(numeroId?: string | null) {
  const { data, error } = await supabase.functions.invoke("whatsapp-import-history", {
    body: { modo: "recentes", chats: 80, por_chat: 20, ...(numeroId ? { numero_id: numeroId } : {}) },
  });
  if (error) throw await erroDaImportacao(error);
  return resumoTrazerConversas(data);
}

/**
 * Erro da whatsapp-import-history com o texto que a função devolveu (20/10/2026). O invoke entrega o non-2xx como
 * FunctionsHttpError com a Response em error.context; sem ler o corpo o toast mostrava só
 * "Edge Function returned a non-2xx status code". `transitorio` = vale tentar de novo daqui a pouco
 * (timeout do WhatsApp sincronizando, limite de leitura, proxy fora por instantes).
 */
export class ErroImportacao extends Error {
  constructor(message: string, public status: number | null, public motivo: string | null) {
    super(message);
    this.name = "ErroImportacao";
  }
  get transitorio() {
    return this.motivo === "timeout" || this.motivo === "limite" || this.status === 504 || this.status === 429 || this.status === 502;
  }
}

export async function erroDaImportacao(error: unknown): Promise<ErroImportacao> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    const resp = ctx as Response;
    const status = typeof resp.status === "number" ? resp.status : null;
    const corpo = await resp.clone().json().catch(async () => {
      const t = await resp.text().catch(() => "");
      return t ? { error: t.slice(0, 300) } : null;
    });
    const msg = corpo && typeof corpo.error === "string" && corpo.error.trim()
      ? corpo.error.trim()
      : `A função respondeu ${status ?? "erro"} sem explicar o motivo.`;
    return new ErroImportacao(msg, status, corpo && typeof corpo.motivo === "string" ? corpo.motivo : null);
  }
  const msg = error instanceof Error && error.message ? error.message : "Falha ao trazer as conversas.";
  return new ErroImportacao(msg, null, null);
}

/**
 * Ao conectar: tenta já e, se o erro for transitório (o número acabou de conectar e o WhatsApp ainda sincroniza),
 * espera e tenta UMA vez mais. `aoEsperar` avisa a tela antes da espera.
 */
export async function trazerConversasAoConectar(
  numeroId: string,
  opcoes: { esperaMs?: number; aoEsperar?: (e: ErroImportacao) => void; trazer?: typeof trazerConversasRecentes; dormir?: (ms: number) => Promise<void> } = {},
) {
  const trazer = opcoes.trazer ?? trazerConversasRecentes;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    return await trazer(numeroId);
  } catch (e) {
    if (!(e instanceof ErroImportacao) || !e.transitorio) throw e;
    opcoes.aoEsperar?.(e);
    await dormir(opcoes.esperaMs ?? 60_000);
    return trazer(numeroId);
  }
}

export const fonteSupabase: FonteConversas = {
  async usuarioId() {
    // getSession lê a sessão local (sem ida ao servidor como o getUser): a lista em cache aparece na hora.
    // O id só separa o que fica no localStorage; quem decide o que a pessoa vê é o RLS no banco.
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
    const { data: u } = await supabase.auth.getUser();
    return u.user?.id ?? "anonimo";
  },

  async listarContatos() {
    const todos: ContatoCRM[] = [];
    for (let de = 0; de < TETO_CONTATOS; de += PAGINA_CONTATOS) {
      const { data, error } = await db
        .from("whatsapp_contacts")
        .select("*")
        .order("updated_at", { ascending: false })
        .range(de, de + PAGINA_CONTATOS - 1);
      if (error) throw error;
      todos.push(...((data ?? []) as ContatoCRM[]));
      if (!data || data.length < PAGINA_CONTATOS) break;
    }
    return todos;
  },

  async mensagensRecentes(limite) {
    const ler = () => supabase
      .from("whatsapp_messages")
      .select(colunasMsg)
      .order("created_at", { ascending: false })
      .limit(Math.min(limite ?? JANELA_RECENTES, JANELA_RECENTES));
    let { data, error } = await ler();
    while (error && colunasMsg !== COLUNAS_MSG_BASE && colunaInexistente(error)) {
      colunasMsg = colunasAnteriores(colunasMsg);
      ({ data, error } = await ler());
    }
    if (error) throw error;
    return (data ?? []) as unknown as MensagemCRM[];
  },

  async resumoConversas(leituras, base) {
    if (resumoIndisponivel) return null;
    const todos: ResumoConversa[] = [];
    for (let de = 0; de < TETO_CONTATOS; de += PAGINA_RESUMO) {
      const { data, error } = await (supabase as unknown as {
        rpc: (f: string, a: Record<string, unknown>) => { range: (a: number, b: number) => Promise<{ data: unknown; error: unknown }> };
      }).rpc("crm_conversas_ultimas", { p_base: base, p_leituras: leituras }).range(de, de + PAGINA_RESUMO - 1);
      if (error) {
        if (rpcInexistente(error)) { resumoIndisponivel = true; return null; }
        throw error;
      }
      const linhas = (data ?? []) as { contact_phone: string; numero_id?: string | null; ultima: MensagemCRM; nao_lidas: number }[];
      for (const l of linhas) {
        if (l?.ultima) {
          todos.push({ contact_phone: l.contact_phone, numero_id: l.numero_id ?? null, ultima: l.ultima, nao_lidas: Number(l.nao_lidas) || 0 });
        }
      }
      if (linhas.length < PAGINA_RESUMO) break;
    }
    return todos;
  },

  async paginaConversas(p) {
    if (paginaIndisponivel) return null;
    const c = p.consulta;
    const { data, error } = await rpc("crm_conversas_pagina", {
      p_base: p.base,
      p_leituras: p.leituras,
      p_marcadas: p.marcadas,
      p_ocultos: p.ocultos,
      p_numero_id: c?.numeroId ?? null,
      p_atendente: c?.atendente ?? "todos",
      p_filtro: c?.filtro ?? "tudo",
      p_busca: c?.busca.trim() || null,
      p_cursor_em: p.cursor?.em ?? null,
      p_cursor_id: p.cursor?.id ?? null,
      p_desde: p.desde ?? null,
      p_chaves: p.chaves?.length ? p.chaves : null,
      p_limite: p.limite ?? 60,
    });
    if (error) {
      if (rpcInexistente(error)) { paginaIndisponivel = true; return null; }
      throw error;
    }
    return ((data ?? []) as LinhaLista[]).filter((l) => l?.contato?.id).map((l) => ({
      contato: l.contato,
      ultima: l.ultima ?? null,
      nao_lidas: Number(l.nao_lidas) || 0,
      ordem_em: l.ordem_em ?? null,
      consultado_em: l.consultado_em ?? null,
    }));
  },

  async contadoresConversas(p) {
    if (paginaIndisponivel) return null;
    const { data, error } = await rpc("crm_conversas_contadores", {
      p_base: p.base,
      p_leituras: p.leituras,
      p_marcadas: p.marcadas,
      p_ocultos: p.ocultos,
      p_numero_id: p.numeroId,
      p_atendente: p.atendente,
    });
    if (error) {
      if (rpcInexistente(error)) return null;
      throw error;
    }
    const d = (data ?? {}) as { nao_lidas?: number; sem_conversa?: number; por_departamento?: Record<string, number>; tags?: string[]; etapas?: string[] };
    return {
      naoLidas: Number(d.nao_lidas) || 0,
      semConversa: Number(d.sem_conversa) || 0,
      porDepartamento: d.por_departamento ?? {},
      tags: Array.isArray(d.tags) ? d.tags : [],
      etapas: Array.isArray(d.etapas) ? d.etapas : [],
    };
  },

  async listarNumeros() {
    const ler = (cols: string) => db.from("crm_numeros").select(cols).order("ordem", { ascending: true });
    let { data, error } = await ler("id, chave, apelido, telefone, tipo, ativo, sessao_openwa, ocultar_em_conversas");
    // banco sem a coluna nova (migration ainda não rodada): lê sem ela; o front cai para a sessão grupos-N
    if (error && colunaInexistente(error)) ({ data, error } = await ler("id, chave, apelido, telefone, tipo, ativo, sessao_openwa"));
    if (error && colunaInexistente(error)) ({ data, error } = await ler("id, chave, apelido, telefone, tipo, ativo"));
    if (error) return []; // tabela ainda não existe: tela sem seletor de número
    return ((data ?? []) as NumeroConversa[]).filter((n) => n.tipo !== "oficial");
  },

  async mensagensDoContato(phone, limite, antesDe, numeroId) {
    const ler = () => {
      let q = supabase
        .from("whatsapp_messages")
        .select(colunasMsg)
        .eq("contact_phone", phone)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (numeroId && temColunaNumero()) q = q.eq("numero_id" as never, numeroId as never);
      if (antesDe) q = q.lt("created_at", antesDe);
      return q;
    };
    let { data, error } = await ler();
    while (error && colunasMsg !== COLUNAS_MSG_BASE && colunaInexistente(error)) {
      colunasMsg = colunasAnteriores(colunasMsg);
      ({ data, error } = await ler());
    }
    if (error) throw error;
    // a conversa abre já com o que tem link em cache; o resto assina em segundo plano (21/10/2026: esperar a
    // assinatura somava mais uma ida ao servidor antes de qualquer mensagem aparecer)
    const brutas = (data ?? []) as unknown as MensagemCRM[];
    const prontas = assinarDoCache(brutas);
    if (prontas.some((m) => m.media_path && !m.media_url)) {
      assinarMidias(brutas)
        .then((assinadas) => {
          const com = assinadas.filter((m) => m.media_path && m.media_url);
          if (com.length) ouvintesAssinatura.forEach((fn) => fn(com));
        })
        .catch(() => undefined);
    }
    return prontas;
  },

  ouvirMidiasAssinadas(fn) {
    ouvintesAssinatura.add(fn);
    return () => { ouvintesAssinatura.delete(fn); };
  },

  assinar({ onMensagem, onContato }) {
    // mídia que acabou de chegar ao bucket (UPDATE com media_path) já vai com o link assinado
    const entregar = (m: MensagemCRM, ev: "INSERT" | "UPDATE") => {
      if (m.media_path && !m.media_url) {
        assinarMidias([m]).then(([x]) => onMensagem(x, ev)).catch(() => onMensagem(m, ev));
      } else onMensagem(m, ev);
    };
    const canal = supabase
      .channel(`crm_conversas_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, (p) =>
        entregar(p.new as MensagemCRM, "INSERT"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_messages" }, (p) =>
        entregar(p.new as MensagemCRM, "UPDATE"))
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_contacts" }, (p) => {
        const ev = p.eventType as "INSERT" | "UPDATE" | "DELETE";
        onContato((ev === "DELETE" ? p.old : p.new) as ContatoCRM, ev);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  },

  async enviarTexto(phone, texto, numeroId) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sessão expirada. Faça login novamente.");
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const resp = await buscarComLimite(`https://${projectId}.supabase.co/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ phone, message: texto, ...(numeroId ? { numero_id: numeroId } : {}), ...envioManual(phone) }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(r.error || "Falha ao enviar");
  },

  async enviarMidia(phone, file, legenda, opcoes) {
    if (file.size > 16 * 1024 * 1024) throw new Error("O WhatsApp aceita no máximo 16 MB. Escolha um arquivo menor.");
    const tipo = file.type.startsWith("image/") ? "image"
      : file.type.startsWith("video/") ? "video"
      : file.type.startsWith("audio/") ? "audio" : "document";
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
    const caminho = `${pastaDoContato(phone)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(caminho, file, { contentType: (opcoes?.ptt ? "audio/ogg" : file.type) || undefined, upsert: false });
    if (upErr) throw upErr;
    const { data: assinado, error: signErr } = await supabase.storage
      .from("whatsapp-media")
      .createSignedUrl(caminho, 60 * 60 * 24 * 365 * 5);
    if (signErr || !assinado?.signedUrl) throw signErr || new Error("Falha ao gerar link do arquivo");
    const { error } = await supabase.functions.invoke("whatsapp-send-media", {
      body: {
        phone, url: assinado.signedUrl, tipo, legenda, file_name: file.name,
        ...(opcoes?.ptt ? { ptt: true } : {}),
        ...(opcoes?.numeroId ? { numero_id: opcoes.numeroId } : {}),
        ...envioManual(phone),
      },
    });
    if (error) throw error;
  },

  async enviarMidiaUrl(phone, midia, legenda, numeroId) {
    const { error } = await supabase.functions.invoke("whatsapp-send-media", {
      body: {
        phone, url: midia.url, tipo: midia.tipo, legenda, file_name: midia.nome || undefined, ...(midia.ptt ? { ptt: true } : {}),
        ...(numeroId ? { numero_id: numeroId } : {}), ...envioManual(phone),
      },
    });
    if (error) throw error;
  },

  async importarHistorico(phone, numeroId, opcoes) {
    const { data, error } = await supabase.functions.invoke("whatsapp-import-history", {
      body: {
        phone, limit: opcoes?.limite ?? 300, ...(opcoes?.semMidia ? { sem_midia: true, fotos: false } : {}),
        ...(numeroId ? { numero_id: numeroId } : {}),
      },
    });
    if (error) throw await erroDaImportacao(error);
    return Number(data?.imported ?? 0);
  },

  async sincronizarConversas(numeroId) {
    return trazerConversasRecentes(numeroId);
  },

  async atualizarContato(id, patch) {
    const { error } = await db
      .from("whatsapp_contacts")
      .update({ ...patch, ...(patch.stage ? { updated_at: new Date().toISOString() } : {}) })
      .eq("id", id);
    if (error) throw error;
  },

  backfill: {
    async status(numeroId) {
      let q = db.from("whatsapp_backfill_jobs").select("*");
      if (numeroId) q = q.eq("numero_id", numeroId);
      let { data, error } = await q.order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (error && numeroId) {
        // sem a coluna numero_id ainda: o último de todos
        ({ data, error } = await db.from("whatsapp_backfill_jobs").select("*")
          .order("criado_em", { ascending: false }).limit(1).maybeSingle());
      }
      if (error) return null; // migration ainda não rodou
      return (data ?? null) as JobBackfill | null;
    },
    iniciar: (numeroId, opcoes) => acaoBackfill("iniciar", numeroId, opcoes?.completo ? { completo: true } : {}),
    cancelar: (numeroId) => acaoBackfill("cancelar", numeroId),
    pausar: (numeroId) => acaoBackfill("pausar", numeroId),
    retomar: (numeroId) => acaoBackfill("retomar", numeroId),
  },

  async baixarMidia(msg) {
    if (!msg.message_id) return null;
    const { data, error } = await supabase.functions.invoke("whatsapp-import-history", { body: { midia_de: msg.message_id } });
    if (error) throw error;
    const caminho = typeof data?.media_path === "string" ? data.media_path : null;
    if (!caminho) return null;
    const [assinada] = await assinarMidias([{ media_path: caminho, media_url: null }]);
    return assinada?.media_url ?? null;
  },

  async tamanhoArquivo(url) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      const n = Number(r.headers.get("content-length"));
      return r.ok && n > 0 ? n : null;
    } catch {
      return null;
    }
  },
};
