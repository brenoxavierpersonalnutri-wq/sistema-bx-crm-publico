// Filtro de SEGMENTO sobre public.base_leads_unificada (uma linha por pessoa): regra pura, sem Deno e sem banco.
// Usada pela tela do Banco de dados (src/lib/crm/segmentos.ts reexporta) e pelo motor dos fluxos
// (crm-automacoes, gatilho "segmento"). Movida para cá em 17/10/2026 sem mudar o comportamento.

export interface FiltroSegmento {
  /** a pessoa tem PELO MENOS uma destas origens (base_leads.origem) */
  origens?: string[];
  /** nível do formulário de avaliação (A, B, C, D, DQ) */
  niveis?: string[];
  /** a pessoa tem PELO MENOS uma destas tags */
  tags?: string[];
  /** true = comprou (compra, aluna, PagTrust comprador); false = nunca comprou */
  comprador?: boolean;
  /** recorte pela gestão de alunas (tabela alunas): plano vigente ou não */
  alunas?: "ativas" | "ex";
  /** só junto de `alunas`: programa vendido (de-para em public.crm_alunas_programa_mapa, migration 20261031100000) */
  programa?: ProgramaAluna;
}

/** Os 3 programas vendidos que viram segmento de alunas. */
export type ProgramaAluna = "mgmd" | "elite" | "plataforma";
export const PROGRAMAS_ALUNA: ProgramaAluna[] = ["mgmd", "elite", "plataforma"];

/** Construtor de consulta mínimo (o do supabase-js satisfaz). */
export interface ConsultaFiltravel<Q> {
  overlaps(coluna: string, valor: string[]): Q;
  in(coluna: string, valor: string[]): Q;
  eq(coluna: string, valor: unknown): Q;
  not(coluna: string, operador: string, valor: string): Q;
  ilike(coluna: string, valor: string): Q;
  or(filtros: string): Q;
  gte(coluna: string, valor: string): Q;
  lte(coluna: string, valor: string): Q;
}

export interface FiltrosTela {
  busca?: string;
  de?: string; // AAAA-MM-DD (BRT)
  ate?: string;
  comTelefone?: boolean;
  tag?: string;
  /** grafias gravadas da tag escolhida (seletor de tags); sem isto, só a própria tag */
  tagVariantes?: string[];
  /** produto mais recente da pessoa (exato; coluna produto da migration 20261122150000) */
  produto?: string;
}

/** Texto seguro dentro de um filtro .or() do PostgREST (sem vírgula, parêntese, aspas, curinga). */
export function limparBusca(t: string): string {
  return t.replace(/[,()"'*%\\]/g, " ").trim().slice(0, 60);
}

/**
 * Aplica o filtro do segmento + os filtros da tela sobre base_leads_unificada.
 * `excluirTelefones` = alunas ativas no recorte "ex" (a lista vem da tabela alunas).
 */
export function aplicarFiltro<Q extends ConsultaFiltravel<Q>>(q: Q, f: FiltroSegmento, tela: FiltrosTela = {}, excluirTelefones: string[] = []): Q {
  let r = q;
  if (f.origens?.length) r = r.overlaps("origens", f.origens);
  if (f.niveis?.length) r = r.in("nivel", f.niveis);
  if (f.tags?.length) r = r.overlaps("tags", f.tags);
  if (typeof f.comprador === "boolean") r = r.eq("comprador", f.comprador);
  if (excluirTelefones.length) r = r.not("telefone_e164", "in", `(${excluirTelefones.map((t) => `"${t}"`).join(",")})`);
  if (tela.comTelefone) r = r.not("telefone_e164", "is", "null");
  if (tela.tag) r = r.overlaps("tags", tela.tagVariantes?.length ? tela.tagVariantes : [tela.tag]);
  if (tela.produto) r = r.eq("produto", tela.produto);
  if (tela.de) r = r.gte("ultima_entrada", new Date(`${tela.de}T00:00:00-03:00`).toISOString());
  if (tela.ate) r = r.lte("ultima_entrada", new Date(`${tela.ate}T23:59:59-03:00`).toISOString());
  const b = limparBusca(tela.busca ?? "");
  if (b) {
    const digitos = b.replace(/\D/g, "");
    const partes = [`nome.ilike.*${b}*`, `email.ilike.*${b}*`];
    if (digitos.length >= 4) partes.push(`telefone_e164.ilike.*${digitos}*`);
    r = r.or(partes.join(","));
  }
  return r;
}
