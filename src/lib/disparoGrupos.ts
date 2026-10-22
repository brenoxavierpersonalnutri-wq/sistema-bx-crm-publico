// Disparo em grupo (/crm/disparo-grupos, 20/10/2026): monta o disparo para grupos escolhidos de um número
// e grava em grupos_mensagens (uma linha por campanha, com grupos_alvo). Quem envia é o disparador que já
// existe (grupos-disparo-tick): fila por grupo, intervalo aleatório, allowlist e limites do proxy.
// A parte pura (montarDisparo e validações) é testada em src/test/disparoGrupos.test.ts.
import {
  chamar, chatIdGrupoValido, conviteGrupo, db, podeDisparar, problemasMensagem, TIPOS_COM_MENCAO,
  MSG_NUMERO_NAO_CRIA, type CampanhaGrupos, type NumeroWhatsApp, type PermissaoGrupo, type TipoMensagemGrupo,
} from "@/lib/grupos";

/** Limites do proxy da VPS para envio a grupo, por número (LimitadorGrupo em infra/wa-proxy/lib.mjs). */
export const LIMITE_GRUPO_POR_MINUTO = 6;
export const LIMITE_GRUPO_POR_DIA = 200;
export const INTERVALO_MIN_ENVIO_S = 8;
export const MAX_GRUPOS_POR_DISPARO = 200;
/** Versão mínima da edge grupos-disparo-tick que respeita grupos_alvo (a antiga mandaria para TODOS). */
export const VERSAO_EDGE_MINIMA = 2;

export const TIPOS_DISPARO: TipoMensagemGrupo[] = ["texto", "imagem", "video", "audio", "documento", "enquete"];

export interface AlvoDisparo {
  grupo_id: string;
  campanha_id: string;
  /** número da campanha onde o grupo está cadastrado (null = sessão padrão) */
  numero_id: string | null;
  chat_id: string | null;
  nome: string;
  ativo: boolean;
  permissao: PermissaoGrupo;
  campanha_encerrada?: boolean;
}

export interface MensagemDisparo {
  tipo: TipoMensagemGrupo;
  texto: string | null;
  midia_path: string | null;
  nome_arquivo?: string | null;
  link_preview?: boolean;
  enquete_opcoes?: string[] | null;
  enquete_multipla?: boolean;
  ptt?: boolean;
  mencionar_todos?: boolean;
}

export interface EntradaDisparo {
  numero_id: string | null;
  alvos: AlvoDisparo[];
  /** chat_ids que o CRM grava na allowlist do proxy (grupos de campanhas não encerradas) */
  allowlist: Set<string>;
  mensagem: MensagemDisparo;
  /** "agora" ou ISO da data/hora agendada */
  quando: "agora" | string;
  /** envios a grupo que este número já fez/tem na fila hoje (para o teto de 200/dia) */
  enviosHoje?: number;
  disparoId?: string;
  agora?: Date;
}

export interface LinhaMensagem {
  campanha_id: string;
  agendado_para: string;
  tipo: TipoMensagemGrupo;
  texto: string | null;
  midia_path: string | null;
  nome_arquivo: string | null;
  link_preview: boolean;
  grupos_alvo: string[];
  disparo_id: string;
  enquete_opcoes?: string[];
  enquete_multipla?: boolean;
  ptt?: boolean;
  mencionar_todos?: boolean;
}

export interface Disparo {
  problemas: string[];
  avisos: string[];
  linhas: LinhaMensagem[];
  total: number;
  /** estimativa em minutos para todos os grupos receberem (6/min e 8 s entre envios) */
  duracaoMin: number;
}

const uuid = () =>
  (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

/** Minutos para N grupos receberem com o ritmo do proxy (o 1º sai na hora). */
export function duracaoEstimadaMin(n: number): number {
  if (n <= 1) return 0;
  const porMinuto = Math.min(LIMITE_GRUPO_POR_MINUTO, Math.floor(60 / INTERVALO_MIN_ENVIO_S));
  return Math.ceil((n - 1) / porMinuto);
}

/**
 * Valida e monta o disparo. Nada é gravado aqui: devolve as linhas de grupos_mensagens (uma por campanha
 * envolvida, com grupos_alvo) e a lista de problemas (vazia = pode gravar).
 */
export function montarDisparo(e: EntradaDisparo): Disparo {
  const agora = e.agora ?? new Date();
  const problemas: string[] = [];
  const avisos: string[] = [];
  const m = e.mensagem;

  if (!e.numero_id) problemas.push("Escolha o número que dispara.");
  if (!TIPOS_DISPARO.includes(m.tipo)) problemas.push("Tipo de mensagem não vale para disparo.");

  // grupos: sem repetição, todos do mesmo número, cadastrados (allowlist), ativos e com permissão
  const vistos = new Set<string>();
  const alvos: AlvoDisparo[] = [];
  for (const a of e.alvos) {
    const chave = a.chat_id ?? a.grupo_id;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push(a);
  }
  if (!alvos.length) problemas.push("Escolha pelo menos 1 grupo.");
  if (alvos.length > MAX_GRUPOS_POR_DISPARO) problemas.push(`No máximo ${MAX_GRUPOS_POR_DISPARO} grupos por disparo.`);
  for (const a of alvos) {
    const nome = a.nome || a.chat_id || "grupo";
    if (e.numero_id && a.numero_id !== e.numero_id) problemas.push(`"${nome}" está numa campanha de outro número.`);
    if (!chatIdGrupoValido(a.chat_id)) problemas.push(`"${nome}" não tem id (@g.us): não recebe disparo.`);
    else if (!e.allowlist.has(a.chat_id!)) problemas.push(`"${nome}" está fora da allowlist do proxy (cadastre o grupo numa campanha ativa).`);
    if (!a.ativo) problemas.push(`"${nome}" está desativado na campanha.`);
    if (a.campanha_encerrada) problemas.push(`"${nome}" é de uma campanha encerrada.`);
    if (!podeDisparar(a.permissao)) problemas.push(`"${nome}": só admins enviam e o número não é admin.`);
    else if (a.permissao === "desconhecida") avisos.push(`"${nome}": permissão não lida (leia as permissões antes, se der).`);
  }

  // limite diário do número (o proxy recusa o que passar; melhor avisar antes)
  const hoje = Math.max(0, e.enviosHoje ?? 0);
  if (alvos.length && hoje + alvos.length > LIMITE_GRUPO_POR_DIA) {
    problemas.push(`Passa o limite de ${LIMITE_GRUPO_POR_DIA} envios a grupo por dia neste número (hoje: ${hoje}, este disparo: ${alvos.length}).`);
  }

  const agendado = e.quando === "agora" ? agora.toISOString() : e.quando;
  const opcoes = (m.enquete_opcoes ?? []).map((o) => o.trim()).filter(Boolean);
  const mencionar = Boolean(m.mencionar_todos) && TIPOS_COM_MENCAO.includes(m.tipo);
  const ptt = m.tipo === "audio" && Boolean(m.ptt);
  problemas.push(...problemasMensagem({
    tipo: m.tipo, texto: m.texto, midia_path: m.midia_path, nome_arquivo: m.nome_arquivo,
    agendado_para: agendado, enquete_opcoes: opcoes, ptt, mencionar_todos: mencionar,
  }, agora));
  if (e.quando !== "agora") {
    const t = Date.parse(e.quando);
    if (Number.isFinite(t) && t - agora.getTime() > 60 * 86_400_000) problemas.push("Agende no máximo 60 dias à frente.");
  }

  const total = alvos.length;
  const duracaoMin = duracaoEstimadaMin(total);
  if (total > 1) avisos.push(`Sai grupo a grupo: ${total} grupos levam cerca de ${duracaoMin} min (até ${LIMITE_GRUPO_POR_MINUTO}/min, ${INTERVALO_MIN_ENVIO_S} s entre envios).`);

  if (problemas.length) return { problemas: [...new Set(problemas)], avisos, linhas: [], total, duracaoMin };

  const disparoId = e.disparoId ?? uuid();
  const porCampanha = new Map<string, string[]>();
  for (const a of alvos) porCampanha.set(a.campanha_id, [...(porCampanha.get(a.campanha_id) ?? []), a.grupo_id]);
  const texto = m.tipo === "audio" ? null : (m.texto ?? "").trim() || null;
  const comMidia = ["imagem", "video", "audio", "documento"].includes(m.tipo);
  const linhas: LinhaMensagem[] = [...porCampanha].map(([campanha_id, ids]) => ({
    campanha_id,
    agendado_para: agendado,
    tipo: m.tipo,
    texto,
    midia_path: comMidia ? m.midia_path : null,
    nome_arquivo: m.tipo === "documento" ? (m.nome_arquivo ?? null) : null,
    link_preview: m.link_preview !== false,
    grupos_alvo: ids,
    disparo_id: disparoId,
    ...(m.tipo === "enquete" ? { enquete_opcoes: opcoes, enquete_multipla: Boolean(m.enquete_multipla) } : {}),
    ...(ptt ? { ptt: true } : {}),
    ...(mencionar ? { mencionar_todos: true } : {}),
  }));
  return { problemas: [], avisos, linhas, total, duracaoMin };
}

/** Status agregado de um disparo (várias linhas de grupos_mensagens com o mesmo disparo_id). */
export function statusDoDisparo(ms: { status: string }[]): "agendada" | "enviando" | "concluida" | "cancelada" | "erro" | "parcial" {
  const s = new Set(ms.map((m) => m.status));
  if (s.has("enviando")) return "enviando";
  if (s.has("agendada")) return "agendada";
  if (s.size === 1) return [...s][0] as "concluida" | "cancelada" | "erro";
  return "parcial";
}

// ------------------------------------------------------------------ campanha e criação

export const nomeDoNumero = (numeros: NumeroWhatsApp[], id: string | null) =>
  id ? numeros.find((n) => n.id === id)?.rotulo ?? "número" : "sessão padrão";

export const rotuloCampanha = (c: CampanhaGrupos, numeros: NumeroWhatsApp[]) =>
  c.avulsa ? `Avulsos · ${nomeDoNumero(numeros, c.numero_id)}` : `${c.nome} · ${nomeDoNumero(numeros, c.numero_id)}`;


/** Problemas do agendamento de criação (vazio = ok). */
export function problemasAgendarCriacao(quando: string, criaGrupo: boolean, campanha: Pick<CampanhaGrupos, "prefixo_nome" | "admins_telefones">, agora = new Date()): string[] {
  const p: string[] = [];
  if (!criaGrupo) p.push(MSG_NUMERO_NAO_CRIA);
  if (!(campanha.admins_telefones ?? []).length) p.push("Cadastre pelo menos 1 admin na aba Campanhas (o WhatsApp não cria grupo só com o número).");
  const t = new Date(quando).getTime();
  if (!Number.isFinite(t)) p.push("Data/hora inválida.");
  else if (t < agora.getTime() - 60_000) p.push("Data/hora já passou.");
  return p;
}


// ------------------------------------------------------------------ rede (tela)

/** A edge publicada já entende grupos_alvo? (edge velha mandaria a mensagem para TODOS os grupos da campanha) */
export async function edgeSuportaDisparo(): Promise<boolean> {
  try {
    const r = await chamar<{ versao?: number }>({ modo: "versao" });
    return (r?.versao ?? 0) >= VERSAO_EDGE_MINIMA;
  } catch {
    return false;
  }
}

export interface PermissaoLida {
  chatId: string;
  name?: string | null;
  participants?: number | null;
  souAdmin?: boolean | null;
  announce?: boolean | null;
  locked?: boolean | null;
  erro?: string;
}

/** Só leitura: group-info de até 20 grupos pelo número (admin? só admins enviam?). */
export const lerPermissoes = (numeroId: string | null, chatIds: string[]) =>
  chamar<{ grupos: PermissaoLida[] }>({ modo: "permissoes", numero_id: numeroId, chat_ids: chatIds.slice(0, 20) });

export interface AcoesGrupo {
  nome?: string;
  descricao?: string;
  foto_path?: string;
  so_admins_enviam?: boolean;
  so_admins_editam?: boolean;
  promover?: string[];
}

/** Aplica nome/descrição/foto/ajustes/admins em UM grupo (o número precisa ser admin dele). */
export const configurarGrupo = (grupoId: string, acoes: AcoesGrupo) =>
  chamar<{ ok: boolean; feito: string[]; erros: string[] }>({ modo: "configurar_grupo", grupo_id: grupoId, acoes });

/**
 * Refaz SÓ a etapa admins de um grupo criado pelo CRM: adiciona os admins da campanha que não estão no grupo e
 * promove (ação real no WhatsApp). `texto` diz, por número, o que deu certo ou por que falhou.
 */
export const refazerAdmins = (criacaoId: string) =>
  chamar<{ ok: boolean; texto: string }>({ modo: "refazer_admins", criacao_id: criacaoId });

/** Problemas das ações de configuração antes de mandar (vazio = ok). */
export function problemasConfiguracao(a: AcoesGrupo): string[] {
  const p: string[] = [];
  const algo = (a.nome && a.nome.trim()) || a.descricao !== undefined || a.foto_path
    || a.so_admins_enviam !== undefined || a.so_admins_editam !== undefined || (a.promover && a.promover.length);
  if (!algo) p.push("Escolha pelo menos uma alteração.");
  if (a.nome !== undefined && a.nome.trim().length > 100) p.push("Nome passa de 100 caracteres.");
  if (a.descricao !== undefined && a.descricao.length > 1024) p.push("Descrição passa de 1024 caracteres.");
  if (a.promover && a.promover.length > 10) p.push("No máximo 10 admins por vez.");
  return p;
}

/** Campanha "Avulsos" do número (cria na primeira vez). */
export async function campanhaAvulsa(numeroId: string | null): Promise<string> {
  const { data, error } = await db.rpc("grupos_campanha_avulsa", { p_numero: numeroId });
  if (error || !data) throw new Error(error?.message ?? "não deu para abrir a campanha Avulsos (rode a migration 20261108110000)");
  return String(data);
}

export interface GrupoParaImportar {
  chatId: string;
  name: string | null;
  souAdmin?: boolean | null;
  announce?: boolean | null;
}

/**
 * Vincula grupos que já existem no WhatsApp do número a uma campanha. Admin: tenta pegar o convite (entra no
 * link /g/ da campanha); sem admin, entra sem convite (recebe disparo, fica fora do link). A allowlist do proxy
 * é regravada pelo disparador a partir dos grupos cadastrados.
 */
export async function importarGrupos(campanhaId: string, numeroId: string | null, grupos: GrupoParaImportar[]) {
  const { data: atuais } = await db.from("grupos_campanha_grupos").select("chat_id, ordem").eq("campanha_id", campanhaId);
  const ja = new Set((atuais ?? []).map((g: { chat_id: string | null }) => g.chat_id).filter(Boolean));
  let ordem = (atuais ?? []).reduce((mx: number, g: { ordem: number }) => Math.max(mx, g.ordem), -1) + 1;
  const resultado: { chatId: string; ok: boolean; motivo?: string; comLink?: boolean }[] = [];
  for (const g of grupos) {
    if (!chatIdGrupoValido(g.chatId)) { resultado.push({ chatId: g.chatId, ok: false, motivo: "id inválido" }); continue; }
    if (ja.has(g.chatId)) { resultado.push({ chatId: g.chatId, ok: false, motivo: "já está na campanha" }); continue; }
    let link: string | null = null;
    if (g.souAdmin) {
      try { link = (await conviteGrupo(g.chatId, numeroId)).inviteLink; } catch { link = null; }
    }
    const { error } = await db.from("grupos_campanha_grupos").insert({
      campanha_id: campanhaId, ordem, nome: (g.name ?? "").slice(0, 120), link_convite: link, chat_id: g.chatId,
      importado: true, sou_admin: g.souAdmin ?? null, anuncio: g.announce ?? null,
      permissao_em: g.souAdmin === undefined ? null : new Date().toISOString(),
    });
    if (error) { resultado.push({ chatId: g.chatId, ok: false, motivo: error.message }); continue; }
    ordem++;
    ja.add(g.chatId);
    resultado.push({ chatId: g.chatId, ok: true, comLink: Boolean(link) });
  }
  return resultado;
}

/** Envios a grupo deste número hoje (BRT): já enviados + na fila para hoje. Aproximação para o teto de 200/dia. */
export async function enviosDeHoje(campanhaIds: string[]): Promise<number> {
  if (!campanhaIds.length) return 0;
  const brt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const inicio = new Date(`${brt}T03:00:00.000Z`).toISOString();
  const { data: ms } = await db.from("grupos_mensagens").select("id").in("campanha_id", campanhaIds).gte("agendado_para", inicio).limit(500);
  const ids = (ms ?? []).map((m: { id: string }) => m.id);
  if (!ids.length) return 0;
  const { count } = await db.from("grupos_envios").select("id", { count: "exact", head: true })
    .in("mensagem_id", ids).in("status", ["pendente", "enviando", "enviado"]);
  return count ?? 0;
}
