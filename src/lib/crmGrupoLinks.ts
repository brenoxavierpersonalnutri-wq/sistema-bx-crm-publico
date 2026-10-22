// Links curtos públicos do CRM (tabela crm_grupo_links, migration 20261104100000):
//   /grupo/<slug> → convite de grupo do WhatsApp (tipo "grupo")
//   /ir/<slug>    → outro destino https (tipo "link"), ex.: /ir/feedback
// A página pública chama a RPC crm_grupo_link_abrir (SECURITY DEFINER, role anon): devolve a url se
// o link estiver ativo e conta o clique. A tabela ainda não está no types.ts gerado: acesso via `db`.
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };

export const DOMINIO_LINKS = "equipe.brenoxavier.com.br";

export type TipoLinkCurto = "grupo" | "link";

export interface LinkCurto {
  slug: string;
  nome: string;
  tipo: TipoLinkCurto;
  url: string | null;
  ativo: boolean;
  cliques: number;
  updated_at: string;
}

export type ResultadoAbrir =
  | { tipo: "ok"; url: string }
  | { tipo: "indisponivel" }
  | { tipo: "erro"; mensagem: string };

/** Prefixo da rota pública de cada tipo. */
export function rotaDoTipo(tipo: TipoLinkCurto): "grupo" | "ir" {
  return tipo === "grupo" ? "grupo" : "ir";
}

/** URL curta mostrada/copiada no CRM, ex.: equipe.brenoxavier.com.br/grupo/mgmd */
export function urlCurta(slug: string, tipo: TipoLinkCurto, comProtocolo = false): string {
  const base = `${DOMINIO_LINKS}/${rotaDoTipo(tipo)}/${slug}`;
  return comProtocolo ? `https://${base}` : base;
}

/** Slug aceito pela tabela: minúsculo, letras/números/hífen, até 60. */
export function slugLinkValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug);
}

/** Mesma regra do CHECK da tabela: https:// sem espaço. */
export function urlDestinoValida(url: string): boolean {
  return /^https:\/\/\S+$/.test(url.trim());
}

/** Grupo de WhatsApp precisa ser um convite chat.whatsapp.com (aviso na tela, não trava no banco). */
export function pareceConviteWhatsApp(url: string): boolean {
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/.test(url.trim());
}

/**
 * Problema que impede salvar, ou null. Ativo exige url; url, se houver, precisa ser https://.
 */
export function problemaLink(l: { tipo: TipoLinkCurto; url: string | null; ativo: boolean }): string | null {
  const url = l.url?.trim() || null;
  if (url && !urlDestinoValida(url)) return "O link precisa começar com https://";
  if (l.ativo && !url) return "Cole o link antes de ativar";
  return null;
}

/** Aviso que não impede salvar: grupo cujo link não é convite do WhatsApp. */
export function avisoLink(l: { tipo: TipoLinkCurto; url: string | null }): string | null {
  const url = l.url?.trim();
  if (url && l.tipo === "grupo" && urlDestinoValida(url) && !pareceConviteWhatsApp(url)) {
    return "Não parece convite de grupo (https://chat.whatsapp.com/...). Salva assim mesmo.";
  }
  return null;
}

export async function abrirLinkCurto(slug: string, tipo: TipoLinkCurto): Promise<ResultadoAbrir> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!slugLinkValido(s)) return { tipo: "indisponivel" };
  const { data, error } = await db.rpc("crm_grupo_link_abrir", { p_slug: s, p_tipo: tipo });
  if (error) return { tipo: "erro", mensagem: error.message };
  if (typeof data === "string" && urlDestinoValida(data)) return { tipo: "ok", url: data.trim() };
  return { tipo: "indisponivel" };
}

export async function listarLinksCurtos(): Promise<{ dados: LinkCurto[]; erro: string | null }> {
  const { data, error } = await db.from("crm_grupo_links").select("*").order("tipo").order("slug");
  return { dados: (data ?? []) as LinkCurto[], erro: error?.message ?? null };
}

export async function salvarLinkCurto(l: Pick<LinkCurto, "slug" | "url" | "ativo" | "nome">): Promise<string | null> {
  const { error } = await db
    .from("crm_grupo_links")
    .update({ url: l.url?.trim() || null, ativo: l.ativo, nome: l.nome })
    .eq("slug", l.slug);
  return error?.message ?? null;
}

export async function criarLinkCurto(l: Pick<LinkCurto, "slug" | "nome" | "tipo">): Promise<string | null> {
  const { error } = await db.from("crm_grupo_links").insert({ slug: l.slug, nome: l.nome, tipo: l.tipo, url: null, ativo: false });
  return error?.message ?? null;
}
