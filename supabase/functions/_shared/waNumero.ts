// Número do WhatsApp de cada conversa (crm_numeros) e a sessão do OpenWA dele, só Deno (17/10/2026).
// whatsapp_contacts/whatsapp_messages têm numero_id (migration 20261028100000): responder, baixar mídia,
// importar e fazer backfill vão pela sessão DAQUELE número, nunca pela padrão por engano.
//
// Contrato com a ponte da VPS: _shared/numerosWa.ts (a sessão padrão não vai no corpo; outra sessão só
// com WA_PROXY_MULTISESSAO ligado, senão recusa ANTES da rede com o motivo).
import { chamarProxy, ErroProxy } from "./waProxy.ts";
import { corpoComSessao, sessaoParaEnvio, SESSAO_PADRAO, type NumeroWebhook } from "./numerosWa.ts";
import { multisessaoLigada } from "./multisessaoWa.ts";

// cliente do supabase-js; tipado solto para não puxar os tipos gerados no Deno
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface NumeroCrm extends NumeroWebhook {
  apelido: string;
  ativo: boolean;
}

const TTL_MS = 60 * 1000;
let cache: { lista: NumeroCrm[]; ate: number } | null = null;

/** Todos os números (cache de 60 s por instância). Sem a coluna nova, tenta sem ela. */
export async function carregarNumeros(db: Db, forcar = false): Promise<NumeroCrm[]> {
  if (!forcar && cache && cache.ate > Date.now()) return cache.lista;
  let { data, error } = await db.from("crm_numeros")
    .select("id, chave, apelido, tipo, sessao_openwa, telefone, ativo, openwa_session_id")
    .order("ordem", { ascending: true });
  if (error && (error.code === "42703" || /openwa_session_id/.test(String(error.message)))) {
    ({ data, error } = await db.from("crm_numeros")
      .select("id, chave, apelido, tipo, sessao_openwa, telefone, ativo").order("ordem", { ascending: true }));
  }
  if (error) throw new Error(`crm_numeros: ${error.message}`);
  const lista = ((data ?? []) as NumeroCrm[]).map((n) => ({ ...n, openwa_session_id: n.openwa_session_id ?? null }));
  cache = { lista, ate: Date.now() + TTL_MS };
  return lista;
}

export function esquecerNumeros() {
  cache = null;
}

/** Nome da sessão padrão da ponte (secret WA_SESSAO_PADRAO; padrão "closer"). */
export const sessaoPadrao = () => (Deno.env.get("WA_SESSAO_PADRAO") || SESSAO_PADRAO).trim().toLowerCase();

export async function numeroPadrao(db: Db): Promise<NumeroCrm | null> {
  const p = sessaoPadrao();
  return (await carregarNumeros(db)).find((n) => n.tipo === "openwa" && n.sessao_openwa === p) ?? null;
}

export async function numeroPorId(db: Db, id: string | null | undefined): Promise<NumeroCrm | null> {
  if (!id) return null;
  const lista = await carregarNumeros(db);
  return lista.find((n) => n.id === id) ?? (await carregarNumeros(db, true)).find((n) => n.id === id) ?? null;
}

/**
 * Sessão para LER (mídia, histórico, foto, nomes) de um número: a sessao_openwa dele, mesmo desativado
 * (ler não arrisca o número). null = sessão padrão (numero_id vazio ou o próprio padrão).
 */
export async function sessaoLeitura(db: Db, numeroId: string | null | undefined): Promise<string | null> {
  const n = await numeroPorId(db, numeroId);
  if (!n || n.tipo !== "openwa" || !n.sessao_openwa) return null;
  return n.sessao_openwa === sessaoPadrao() ? null : n.sessao_openwa;
}

/** Sessão para ENVIAR por um número: oficial ou desativado recusa (com o motivo). */
export async function sessaoEnvio(db: Db, numeroId: string | null | undefined): Promise<{ sessao: string | null } | { recusa: string }> {
  if (!numeroId) return { sessao: null };
  const n = await numeroPorId(db, numeroId);
  if (!n) return { recusa: "número da conversa não está mais em crm_numeros" };
  return sessaoParaEnvio(n);
}

/** Corpo com `sessao` para a ponte; sessão sem ponte = ErroProxy 503 antes da rede. */
export async function corpoNaSessao<T extends Record<string, unknown>>(corpo: T, sessao: string | null | undefined): Promise<Record<string, unknown>> {
  const r = corpoComSessao(corpo, sessao, { padrao: sessaoPadrao(), multisessao: await multisessaoLigada() });
  if (!r.corpo) throw new ErroProxy(503, r.decisao.modo === "indisponivel" ? r.decisao.motivo : "sessão indisponível");
  return r.corpo;
}

/** chamarProxy na sessão do número (null/padrão = a chamada de sempre, sem o campo). */
export async function chamarProxyNaSessao(
  rota: string,
  corpo: Record<string, unknown>,
  sessao: string | null | undefined,
  opcoes: { binario?: boolean; timeoutMs?: number } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return chamarProxy(rota, await corpoNaSessao(corpo, sessao), opcoes);
}
