// Etapas do CRM (kanban), configuráveis desde 18/10/2026 (tabela public.crm_etapas, migration 20261101100000).
// Regras puras, sem Deno e sem banco: usadas pela tela (hook useEtapas) e pelas edge functions (crm-automacoes,
// ai-agent-simular). Antes disso as 5 etapas eram fixas em 4 lugares; elas continuam aqui como fallback, para
// nada quebrar antes da migration ou se a leitura da tabela falhar.

export interface Etapa {
  slug: string;
  nome: string;
  cor: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
}

/** As 5 etapas de sempre (slugs reais do banco). São "sistema": renomeia e reordena, não apaga nem arquiva. */
export const ETAPAS_SISTEMA: Etapa[] = [
  { slug: "leads", nome: "Leads", cor: "#64748b", ordem: 1, ativo: true, sistema: true },
  { slug: "contato", nome: "Em Contato", cor: "#3b82f6", ordem: 2, ativo: true, sistema: true },
  { slug: "agendado", nome: "Agendado", cor: "#f59e0b", ordem: 3, ativo: true, sistema: true },
  { slug: "compareceu", nome: "Compareceu", cor: "#8b5cf6", ordem: 4, ativo: true, sistema: true },
  { slug: "fechou", nome: "Fechou", cor: "#22c55e", ordem: 5, ativo: true, sistema: true },
];
export const SLUGS_SISTEMA = ETAPAS_SISTEMA.map((e) => e.slug);

/** Mesmo formato do CHECK da tabela. */
export const SLUG_ETAPA_RE = /^[a-z0-9][a-z0-9_]{0,39}$/;
export const COR_RE = /^#[0-9a-fA-F]{6}$/;

/** Slug a partir do nome ("Pós-venda 2" -> "pos_venda_2"), sem colidir com os existentes. */
export function slugDeEtapa(nome: string, existentes: string[] = []): string {
  const base = String(nome ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34) || "etapa";
  const usados = new Set(existentes);
  if (!usados.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!usados.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now() % 100000}`;
}

/** Linhas do banco -> lista ordenada e saneada. Lista vazia/inválida = as 5 de sempre. */
export function normalizarEtapas(linhas: unknown): Etapa[] {
  if (!Array.isArray(linhas)) return ETAPAS_SISTEMA.map((e) => ({ ...e }));
  const vistas = new Set<string>();
  const out: Etapa[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    const slug = String(l?.slug ?? "");
    if (!SLUG_ETAPA_RE.test(slug) || vistas.has(slug)) continue;
    vistas.add(slug);
    out.push({
      slug,
      nome: String(l.nome ?? "").trim() || slug,
      cor: COR_RE.test(String(l.cor ?? "")) ? String(l.cor) : "#64748b",
      ordem: Number.isFinite(Number(l.ordem)) ? Number(l.ordem) : 0,
      ativo: l.ativo !== false,
      sistema: l.sistema === true,
    });
  }
  if (!out.length) return ETAPAS_SISTEMA.map((e) => ({ ...e }));
  return out.sort((a, b) => a.ordem - b.ordem || a.slug.localeCompare(b.slug));
}

// Registro do processo: quais slugs valem nas validações (automações, fluxos, agente). Começa com as 5 de sempre;
// a tela (useEtapas) e o motor (crm-automacoes, a cada chamada) trocam pelo que está em crm_etapas.
// Vale QUALQUER etapa existente (ativa ou arquivada): arquivar uma etapa não pode desligar em silêncio o fluxo
// que ainda aponta para ela.
let registro: string[] = [...SLUGS_SISTEMA];

export function definirEtapasValidas(slugs: string[] | null | undefined): void {
  const ok = [...new Set((slugs ?? []).filter((s) => SLUG_ETAPA_RE.test(String(s))))];
  registro = ok.length ? ok : [...SLUGS_SISTEMA];
}
export const etapasValidas = (): string[] => registro;
export const ehEtapaValida = (s: unknown, lista: string[] = registro): boolean => lista.includes(String(s ?? ""));

/** Erros ao salvar uma etapa na tela (lista vazia = pode salvar). */
export function validarEtapa(e: Partial<Etapa>, outras: Etapa[] = []): string[] {
  const erros: string[] = [];
  const nome = String(e.nome ?? "").trim();
  if (!nome) erros.push("Dê um nome à etapa.");
  else if (nome.length > 40) erros.push("Nome com no máximo 40 caracteres.");
  if (!SLUG_ETAPA_RE.test(String(e.slug ?? ""))) erros.push("Identificador inválido.");
  if (!COR_RE.test(String(e.cor ?? ""))) erros.push("Cor inválida.");
  const mesmoNome = outras.some((o) => o.slug !== e.slug && o.nome.trim().toLowerCase() === nome.toLowerCase());
  if (nome && mesmoNome) erros.push("Já existe uma etapa com esse nome.");
  return erros;
}

/** Pode arquivar? Etapa sistema nunca; com contatos, só depois de movê-los. */
export function motivoNaoArquivar(e: Pick<Etapa, "sistema" | "nome">, contatos: number): string | null {
  if (e.sistema) return `"${e.nome}" é uma etapa padrão: pode renomear e reordenar, mas não arquivar.`;
  if (contatos > 0) return `"${e.nome}" tem ${contatos} contato${contatos > 1 ? "s" : ""}. Mova para outra etapa antes de arquivar.`;
  return null;
}

/** Nova ordem depois de mover a etapa `slug` uma posição para cima (-1) ou para baixo (+1). */
export function moverEtapa(lista: Etapa[], slug: string, delta: -1 | 1): Etapa[] {
  const l = [...lista].sort((a, b) => a.ordem - b.ordem);
  const i = l.findIndex((e) => e.slug === slug);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= l.length) return l.map((e, k) => ({ ...e, ordem: k + 1 }));
  [l[i], l[j]] = [l[j], l[i]];
  return l.map((e, k) => ({ ...e, ordem: k + 1 }));
}

/** Colunas do kanban: ativas + arquivadas que ainda têm contato (para ninguém sumir do quadro). */
export function colunasDoKanban(etapas: Etapa[], stagesPresentes: Iterable<string> = []): Etapa[] {
  const presentes = new Set(stagesPresentes);
  const conhecidas = new Set(etapas.map((e) => e.slug));
  const cols = etapas.filter((e) => e.ativo || presentes.has(e.slug));
  // stage que não existe em crm_etapas (dado antigo): coluna própria no fim, com o slug como nome
  let ordem = (cols.at(-1)?.ordem ?? 0) + 1;
  for (const s of presentes) {
    if (s && !conhecidas.has(s)) cols.push({ slug: s, nome: s, cor: "#94a3b8", ordem: ordem++, ativo: false, sistema: false });
  }
  return cols;
}

/** Cliente mínimo (supabase-js) para ler crm_etapas sem depender do Deno aqui. */
interface ClienteEtapas {
  from(t: string): { select(c: string): PromiseLike<{ data: unknown; error: { message: string } | null }> };
}

/**
 * Lê crm_etapas e atualiza o registro de slugs válidos. Tabela ausente (antes da migration) ou erro de leitura:
 * mantém as 5 de sempre e devolve null. Edge functions chamam a cada requisição (isolate pode ser reaproveitado).
 */
export async function carregarEtapasValidas(db: ClienteEtapas): Promise<string[] | null> {
  try {
    const { data, error } = await db.from("crm_etapas").select("slug");
    if (error || !Array.isArray(data) || !data.length) {
      definirEtapasValidas(null);
      return null;
    }
    definirEtapasValidas((data as { slug: string }[]).map((r) => r.slug));
    return etapasValidas();
  } catch {
    definirEtapasValidas(null);
    return null;
  }
}
