// Link público de grupos (/g/<slug> e /r/grupo-<x>): chama a RPC grupos_resolver_link, que escolhe
// o grupo com vaga, conta o clique e registra o lead quando vem ?tel=. Sem login (role anon).
//
// Lotado (21/10/2026): o CRM SEMPRE cria o próximo grupo. A RPC devolve um token de espera (o clique fica
// 'aguardando', com UTM e telefone) e a página consulta a cada 3 s com o token, sem criar clique novo; quando o
// grupo novo tem convite, o mesmo clique vira 'grupo' e a página redireciona. Lotado nunca usa url_lotado: essa
// URL só vale para link pausado.
import { supabase } from "@/integrations/supabase/client";
import { utmDaUrl } from "../../supabase/functions/_shared/grupos.ts";

export type ResultadoLink =
  | { tipo: "grupo"; url: string }
  | { tipo: "aguardando"; espera: string | null }
  | { tipo: "pausado"; url: string | null }
  | { tipo: "nao_encontrada" }
  | { tipo: "erro"; mensagem: string };

export const ESPERA_INTERVALO_MS = 3_000;
export const ESPERA_LIMITE_MS = 60_000;

/** Telefone vindo da URL: ?tel=, ?telefone=, ?whatsapp= ou ?phone=. */
export function telefoneDaUrl(search: string): string | null {
  const p = new URLSearchParams(search);
  for (const k of ["tel", "telefone", "whatsapp", "phone"]) {
    const v = p.get(k);
    if (v && /\d{8,}/.test(v.replace(/\D/g, ""))) return v.slice(0, 30);
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resposta da RPC -> resultado da página. Lotado (versão nova ou antiga da RPC) é sempre espera. */
export function interpretarRespostaLink(data: unknown): ResultadoLink {
  const r = (data ?? {}) as { url?: string | null; erro?: string; espera?: unknown; aguardando?: boolean };
  if (r.erro === "nao_encontrada") return { tipo: "nao_encontrada" };
  if (r.erro === "lotado" || r.aguardando === true) {
    return { tipo: "aguardando", espera: typeof r.espera === "string" && UUID.test(r.espera) ? r.espera : null };
  }
  if (r.erro === "pausado") return { tipo: "pausado", url: r.url && /^https:\/\//.test(r.url) ? r.url : null };
  if (r.url && /^https:\/\/chat\.whatsapp\.com\//.test(r.url)) return { tipo: "grupo", url: r.url };
  return { tipo: "erro", mensagem: "resposta inesperada" };
}

export async function resolverLinkGrupo(slug: string, search: string, espera: string | null = null): Promise<ResultadoLink> {
  const p = new URLSearchParams(search);
  const args: Record<string, unknown> = {
    p_slug: slug.toLowerCase(),
    p_tel: telefoneDaUrl(search),
    p_nome: p.get("nome")?.slice(0, 120) ?? null,
    p_email: p.get("email")?.slice(0, 200) ?? null,
    p_utm: utmDaUrl(search),
  };
  // consulta de quem espera: só o token (UTM e telefone já estão no clique)
  if (espera) Object.assign(args, { p_tel: null, p_nome: null, p_email: null, p_utm: {}, p_espera: espera });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (a: Record<string, unknown>) => (supabase as any).rpc("grupos_resolver_link", a);
  let { data, error } = await rpc(args);
  // banco sem a migration 20261122100000 não conhece p_espera: consulta como antes
  if (error && espera && /p_espera|function|schema cache/i.test(error.message ?? "")) {
    const { p_espera: _ignorado, ...semToken } = args;
    ({ data, error } = await rpc(semToken));
  }
  if (error) return { tipo: "erro", mensagem: error.message };
  return interpretarRespostaLink(data);
}

export type EstadoEspera =
  | { fase: "abrindo" }
  | { fase: "preparando" }
  | { fase: "tempo_esgotado" }
  | { fase: "fim"; resultado: ResultadoLink };

/**
 * Abre o link e, se lotado, espera o grupo novo: consulta a cada `intervaloMs` com o token, até `limiteMs`.
 * `onEstado` recebe cada fase (a página mostra). Relógio e resolver injetáveis para teste.
 */
export async function abrirComEspera(opcoes: {
  slug: string;
  search: string;
  onEstado: (e: EstadoEspera) => void;
  vivo?: () => boolean;
  resolver?: typeof resolverLinkGrupo;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  intervaloMs?: number;
  limiteMs?: number;
  inicial?: ResultadoLink;
}): Promise<EstadoEspera> {
  const {
    slug, search, onEstado, vivo = () => true, resolver = resolverLinkGrupo,
    dormir = (ms) => new Promise((r) => setTimeout(r, ms)), agora = () => Date.now(),
    intervaloMs = ESPERA_INTERVALO_MS, limiteMs = ESPERA_LIMITE_MS,
  } = opcoes;
  const emitir = (e: EstadoEspera) => { if (vivo()) onEstado(e); return e; };
  let r = opcoes.inicial ?? (emitir({ fase: "abrindo" }), await resolver(slug, search));
  if (r.tipo !== "aguardando") return emitir({ fase: "fim", resultado: r });

  const inicio = agora();
  let espera = r.espera;
  emitir({ fase: "preparando" });
  while (vivo()) {
    if (agora() - inicio + intervaloMs > limiteMs) return emitir({ fase: "tempo_esgotado" });
    await dormir(intervaloMs);
    if (!vivo()) break;
    r = await resolver(slug, search, espera);
    if (r.tipo === "aguardando") { espera = r.espera ?? espera; continue; }
    // erro de rede no meio da espera: continua tentando até o limite
    if (r.tipo === "erro") continue;
    return emitir({ fase: "fim", resultado: r });
  }
  return { fase: "tempo_esgotado" };
}
