// Tags que já existem no sistema (RPC crm_tags_existentes: contatos do WhatsApp, base de leads, fluxos,
// segmentos e o catálogo crm_tags) + "Criar tag" (RPC crm_tag_criar, normaliza no banco também).
// Regras puras (filtrar/ordenar/normalizar) testadas em src/test/crmTags.test.ts.
import { supabase } from "@/integrations/supabase/client";
import { normalizarTag } from "../../../supabase/functions/_shared/automacoes.ts";

export interface TagExistente { tag: string; uso: number; variantes?: string[] }

export interface FonteTags {
  listar(): Promise<TagExistente[]>;
  criar(nome: string): Promise<string>;
}

const rpc = supabase as unknown as { rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

let cache: { em: number; lista: TagExistente[] } | null = null;
const VALIDADE_MS = 60_000;

export const fonteTagsSupabase: FonteTags = {
  async listar() {
    if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.lista;
    const { data, error } = await rpc.rpc("crm_tags_existentes");
    if (error) throw new Error(error.message);
    const lista = ((data ?? []) as { tag: string; uso: number | string; variantes?: string[] | null }[])
      .map((x) => ({ tag: x.tag, uso: Number(x.uso) || 0, variantes: Array.isArray(x.variantes) ? x.variantes : [x.tag] }));
    cache = { em: Date.now(), lista };
    return lista;
  },
  async criar(nome) {
    const t = normalizarTag(nome);
    if (!t) throw new Error("tag vazia");
    const { data, error } = await rpc.rpc("crm_tag_criar", { p_nome: t });
    if (error) throw new Error(error.message);
    const criada = String(data ?? t);
    if (cache && !cache.lista.some((x) => x.tag === criada)) cache.lista = [...cache.lista, { tag: criada, uso: 0 }];
    return criada;
  },
};

/** Opções do seletor: busca (sem acento, por pedaço), mais usadas primeiro; inclui as já escolhidas. */
export function filtrarTags(lista: TagExistente[], busca: string, escolhidas: string[] = [], max = 80): TagExistente[] {
  const b = normalizarTag(busca);
  const mapa = new Map<string, TagExistente>();
  for (const x of lista) {
    const t = normalizarTag(x.tag);
    if (!t) continue;
    const ant = mapa.get(t);
    mapa.set(t, { tag: t, uso: (ant?.uso ?? 0) + (Number(x.uso) || 0) });
  }
  for (const t of escolhidas.map(normalizarTag).filter(Boolean)) if (!mapa.has(t)) mapa.set(t, { tag: t, uso: 0 });
  return [...mapa.values()]
    .filter((x) => !b || x.tag.includes(b))
    .sort((a, c) => (b ? Number(c.tag.startsWith(b)) - Number(a.tag.startsWith(b)) : 0) || c.uso - a.uso || a.tag.localeCompare(c.tag))
    .slice(0, max);
}

/** "+ Criar tag" aparece quando a busca normalizada não é uma tag que já existe. */
export function podeCriarTag(lista: TagExistente[], busca: string): string | null {
  const t = normalizarTag(busca);
  if (!t) return null;
  return lista.some((x) => normalizarTag(x.tag) === t) ? null : t;
}

/**
 * Grafias gravadas de fato para as tags escolhidas (filtro exato do Banco: "nivel-A" e "nivel-a" são valores
 * diferentes na coluna). Sempre inclui a própria tag normalizada.
 */
export function variantesDasTags(lista: TagExistente[], escolhidas: string[]): string[] {
  const saida = new Set<string>();
  for (const t of escolhidas.map(normalizarTag).filter(Boolean)) {
    saida.add(t);
    for (const x of lista) if (normalizarTag(x.tag) === t) for (const v of x.variantes ?? [x.tag]) saida.add(v);
  }
  return [...saida];
}

/** Mantém a grafia original das tags que continuam (tag antiga "Comprou" não vira "comprou" só por abrir o seletor). */
export function mesclarTags(atuais: string[], escolhidas: string[]): string[] {
  const alvo = new Set(escolhidas.map(normalizarTag).filter(Boolean));
  const ficam = atuais.filter((t) => alvo.has(normalizarTag(t)));
  const ja = new Set(ficam.map(normalizarTag));
  return [...ficam, ...[...alvo].filter((t) => !ja.has(t))];
}

export { normalizarTag };
