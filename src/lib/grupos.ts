// Módulo Grupos do CRM (substitui o SendFlow): tipos, acesso às tabelas e chamadas da edge function.
// Tabelas da migration 20261024130000 (ainda fora do types.ts gerado): acesso via `db`.
import { supabase } from "@/integrations/supabase/client";
export {
  escolherGrupo,
  ocupacao,
  slugDe,
  slugValido,
  linkConviteValido,
  chatIdGrupoValido,
  problemasMensagem,
  resumoEnvios,
  utmDaUrl,
  LIMITE_PADRAO,
  LIMITE_WHATSAPP_GRUPO,
  INTERVALO_PADRAO,
  TIPOS_MENSAGEM,
  TIPOS_COM_MENCAO,
  intervaloEfetivo,
  vagas,
  precisaNovoGrupo,
  nomeNovoGrupo,
  nomeGrupoDaCampanha,
  travaCriacao,
  inicioDoDiaSP,
  PAUSA_ENTRE_CRIACOES_MS,
  TETO_CRIACOES_DIA_POR_NUMERO,
  FALHAS_PARA_ALERTA,
  telefoneAdmin,
  textoBoasVindas,
  rotuloRelativo,
  offsetDe,
  escolherGrupoModo,
  escolherGrupoSplit,
  ocupacaoPct,
  pesoValido,
  numeroCriaGrupo,
  permissaoGrupo,
  podeConfigurar,
  podeDisparar,
  ROTULO_PERMISSAO,
  MSG_NUMERO_NAO_CRIA,
  MODOS_DISTRIBUICAO,
  type ModoDistribuicao,
  type PermissaoGrupo,
  type GrupoDaCampanha,
  type TipoMensagemGrupo,
} from "../../supabase/functions/_shared/grupos.ts";
import type { GrupoDaCampanha, ModoDistribuicao, TipoMensagemGrupo } from "../../supabase/functions/_shared/grupos.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any; storage: typeof supabase.storage };

export const BUCKET_MIDIA = "grupos-midia";
export const URL_BASE_LINK = "https://equipe.brenoxavier.com.br";

export interface CampanhaGrupos {
  id: string;
  nome: string;
  slug: string;
  numero_id: string | null;
  limite_por_grupo: number;
  tag: string;
  link_pausado: boolean;
  disparos_pausados: boolean;
  encerrada: boolean;
  /** URL para quando o link está PAUSADO (desde 21/10/2026 lotado nunca usa: o CRM cria o próximo grupo). */
  url_lotado: string | null;
  intervalo_min_s: number;
  intervalo_max_s: number;
  created_at: string;
  // Fluxo de Grupo (migration 20261106100000). auto_criar: legado, sempre true desde 20261122100000 (a tela não usa)
  auto_criar?: boolean;
  prefixo_nome?: string;
  proximo_numero?: number;
  descricao_grupo?: string | null;
  foto_path?: string | null;
  admins_telefones?: string[];
  so_admins_enviam?: boolean;
  so_admins_editam?: boolean;
  folga_vagas?: number;
  max_grupos?: number;
  data_evento?: string | null;
  teto_por_minuto?: number;
  boas_vindas_ligada?: boolean;
  boas_vindas_texto?: string | null;
  boas_vindas_mencionar?: boolean;
  boas_vindas_intervalo_min?: number;
  // Disparo em grupo (migration 20261108110000)
  avulsa?: boolean;
  modo_distribuicao?: ModoDistribuicao;
  criacao_agendada_para?: string | null;
  // painel (migration 20261110100000)
  projeto?: string | null;
  // estado da criação (migration 20261122100000; a edge grupos-disparo-tick grava)
  criacao_bloqueio?: string | null;
  criacao_bloqueio_em?: string | null;
  criacao_retomar_em?: string | null;
  criacao_falhas_seguidas?: number;
  criacao_ultimo_erro?: string | null;
  updated_at?: string;
}

export interface GrupoLinha extends GrupoDaCampanha {
  campanha_id: string;
  nome: string;
  participantes_em: string | null;
  created_at: string;
  criado_pelo_crm?: boolean;
  entradas?: number;
  saidas?: number;
  travado?: boolean | null;
  // migration 20261108110000
  importado?: boolean;
  sou_admin?: boolean | null;
  anuncio?: boolean | null;
  permissao_em?: string | null;
}

export interface CriacaoGrupo {
  id: string;
  numero: number;
  nome: string;
  chat_id: string | null;
  etapa: string;
  status: "criando" | "ok" | "erro" | "abandonada";
  erro: string | null;
  avisos: string[];
  tentativas: number;
  created_at: string;
}

export interface MensagemAgendada {
  id: string;
  campanha_id: string;
  agendado_para: string;
  tipo: TipoMensagemGrupo;
  texto: string | null;
  midia_path: string | null;
  nome_arquivo: string | null;
  link_preview: boolean;
  status: "agendada" | "enviando" | "concluida" | "cancelada" | "erro";
  motivo: string | null;
  total_grupos: number;
  enviados: number;
  falhas: number;
  iniciado_em: string | null;
  concluido_em: string | null;
  relativo_evento?: boolean;
  offset_min?: number | null;
  enquete_opcoes?: string[] | null;
  enquete_multipla?: boolean;
  ptt?: boolean;
  mencionar_todos?: boolean;
  grupos_alvo?: string[] | null;
  disparo_id?: string | null;
}

export interface EnvioGrupo {
  id: string;
  mensagem_id: string;
  grupo_id: string;
  status: "pendente" | "enviando" | "enviado" | "falhou" | "cancelado";
  proximo_em: string;
  enviado_em: string | null;
  erro: string | null;
}

export interface NumeroWhatsApp {
  id: string;
  rotulo: string;
  /** crm_numeros.sessao_openwa ("grupos-1" = número que cria grupo) */
  sessao?: string | null;
}

/** Link público da campanha. Slug "grupo-x" também funciona em /r/grupo-x (template do Full Funnel). */
export const linkPublico = (slug: string) => `${URL_BASE_LINK}/g/${slug}`;

/**
 * Números da Central (crm_numeros, /crm/central). Se a tabela ainda não existir no banco,
 * devolve [] e a campanha usa a sessão padrão do proxy.
 */
export async function listarNumeros(): Promise<NumeroWhatsApp[]> {
  // só números do OpenWA ativos: o oficial não entra em grupo (template do Full Funnel)
  const { data, error } = await db.from("crm_numeros").select("id, apelido, tipo, ativo, ordem, sessao_openwa")
    .eq("tipo", "openwa").eq("ativo", true).order("ordem").limit(50);
  if (error || !Array.isArray(data)) return [];
  return data.map((n: { id: string; apelido: string; sessao_openwa?: string | null }) => ({
    id: String(n.id), rotulo: n.apelido || String(n.id), sessao: n.sessao_openwa ?? null,
  }));
}

export async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("grupos-disparo-tick", { body: corpo });
  if (error) {
    // o corpo de erro da função vem em error.context (Response)
    let msg = error.message;
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) msg = j.error;
    } catch { /* mantém a mensagem padrão */ }
    throw new Error(msg);
  }
  return data as T;
}

export const listarGruposDaSessao = (numeroId: string | null) =>
  chamar<{ grupos: { chatId: string; name: string | null }[] }>({ modo: "listar_grupos", numero_id: numeroId });

export const infoGrupo = (chatId: string, numeroId: string | null) =>
  chamar<{ chatId: string; name: string | null; participants: number | null }>({ modo: "info_grupo", chat_id: chatId, numero_id: numeroId });

/** Link de convite do grupo pela sessão (o número precisa ser admin do grupo). */
export const conviteGrupo = (chatId: string, numeroId: string | null) =>
  chamar<{ inviteLink: string }>({ modo: "convite_grupo", chat_id: chatId, numero_id: numeroId });

/** Cria (ou retoma) o próximo grupo da campanha agora, pelo número dela. */
export const criarGrupoAgora = (campanhaId: string) =>
  chamar<{ ok: boolean; resultado: string }>({ modo: "criar_grupo", campanha_id: campanhaId });

export const recontarCampanha = (campanhaId: string) =>
  chamar<{ recontados: number }>({ modo: "recontar", campanha_id: campanhaId });

/** Sobe o arquivo para o bucket privado; devolve o caminho gravado na mensagem. */
export async function subirMidia(campanhaId: string, arquivo: File): Promise<string> {
  const ext = (arquivo.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const caminho = `${campanhaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from(BUCKET_MIDIA).upload(caminho, arquivo, {
    contentType: arquivo.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return caminho;
}

/** Tipo de mensagem a partir do MIME do arquivo. */
export function tipoDoArquivo(mime: string): TipoMensagemGrupo {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "documento";
}

export const ROTULO_STATUS: Record<MensagemAgendada["status"], string> = {
  agendada: "Agendada",
  enviando: "Enviando",
  concluida: "Concluída",
  cancelada: "Cancelada",
  erro: "Erro",
};
