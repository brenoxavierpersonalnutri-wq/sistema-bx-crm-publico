// Banco de dados do CRM (/crm/banco): segmentos = listas prontas definidas por FILTRO sobre a visão
// base_leads_unificada (uma linha por pessoa). Lógica pura, testada em src/test/crmSegmentos.test.ts.
//
// As definições moram em public.crm_segmentos (migration 20261026120000). Enquanto a tabela não existir
// no banco, a tela usa SEGMENTOS_PADRAO (mesmo seed da migration), só leitura.

import type { FiltroSegmento } from "../../../supabase/functions/_shared/segmentoFiltro.ts";
export {
  aplicarFiltro,
  limparBusca,
  type ConsultaFiltravel,
  type FiltroSegmento,
  type FiltrosTela,
  type ProgramaAluna,
  PROGRAMAS_ALUNA,
} from "../../../supabase/functions/_shared/segmentoFiltro.ts";
import { PROGRAMAS_ALUNA, type ProgramaAluna } from "../../../supabase/functions/_shared/segmentoFiltro.ts";

/**
 * De-para padrão de alunas.programa (src/lib/alunaTypes.ts) para os 3 programas vendidos. Mesmo seed de
 * public.crm_alunas_programa_mapa (migration 20261031100000), que é a fonte da verdade no banco; aqui só serve
 * para o caminho antigo (sem a RPC). consultoria_slim e slim_definida não caem em nenhum: ficam só em "Todas".
 */
export const VALORES_PROGRAMA: Record<ProgramaAluna, string[]> = {
  mgmd: ["menos_gordura"],
  elite: ["elite"],
  plataforma: ["plataforma_magra"],
};
export const ROTULO_PROGRAMA: Record<ProgramaAluna, string> = { mgmd: "MGMD", elite: "ELITE", plataforma: "PLATAFORMA" };

/** Gatilho de fluxo/automação que "pertence" ao segmento (mostrado dentro dele com ligado/desligado). */
export interface GatilhoSegmento {
  tipo: "evento" | "tag" | "etapa";
  valor: string;
}

export interface Segmento {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  filtro: FiltroSegmento;
  gatilhos: GatilhoSegmento[];
  ordem: number;
  ativo: boolean;
  /** veio do seed embutido (tabela crm_segmentos ainda não criada) */
  provisorio?: boolean;
}

const seg = (slug: string, nome: string, ordem: number, filtro: FiltroSegmento, gatilhos: GatilhoSegmento[] = [], descricao: string | null = null): Segmento => ({
  id: `seed-${slug}`, slug, nome, descricao, filtro, gatilhos, ordem, ativo: true, provisorio: true,
});

const ABANDONO_TAGS = ["abandonou-carrinho", "aguardando-pagamento", "desafio-carrinho-abandonado", "lowticket-carrinho-abandonado"];

/** Mesmo seed da migration 20261026120000_crm_segmentos.sql (alunas com a regra da 20261029110000). */
export const SEGMENTOS_PADRAO: Segmento[] = [
  seg("todos", "Todos os leads", 10, {}, [], "Uma linha por pessoa, juntando todas as fontes."),
  seg("avaliacao-qualificados", "Avaliação qualificados", 20, { origens: ["avaliacao"], niveis: ["A", "B", "C", "D"] },
    [{ tipo: "evento", valor: "lead_qualificado" }, { tipo: "tag", valor: "lead-qualificado-avaliacao" }],
    "Formulário da avaliação com nível A a D."),
  seg("avaliacao-desqualificados", "Avaliação desqualificados", 30, { origens: ["avaliacao"], niveis: ["DQ"] }, [], "Formulário da avaliação com nível DQ."),
  seg("individual", "Individual", 40, { origens: ["individual"] }, [], "Formulário da consultoria individual."),
  seg("ex-alunas", "Ex-alunas", 50, { alunas: "ex" }, [],
    "Já teve cadastro na Gestão de Alunas ou consulta convertida (fechou, sem reembolso) no Monitoramento das Consultas, e hoje não tem plano vigente."),
  seg("alunas-ativas", "Alunas ativas — Todas", 60, { alunas: "ativas" }, [],
    "Gestão de Alunas (sem as de teste) com vencimento do plano hoje ou depois (horário de Brasília), todos os programas. Uma linha por pessoa (telefone)."),
  seg("alunas-ativas-mgmd", "MGMD", 61, { alunas: "ativas", programa: "mgmd" }, [], "Alunas ativas do programa MGMD (Gestão de Alunas, programa menos_gordura)."),
  seg("alunas-ativas-elite", "ELITE", 62, { alunas: "ativas", programa: "elite" }, [], "Alunas ativas do programa ELITE (Gestão de Alunas, programa elite)."),
  seg("alunas-ativas-plataforma", "PLATAFORMA", 63, { alunas: "ativas", programa: "plataforma" }, [], "Alunas ativas da PLATAFORMA (Gestão de Alunas, programa plataforma_magra)."),
  seg("compradores-pagtrust", "Compradores PagTrust", 70, { origens: ["pagtrust", "compra"], comprador: true },
    [{ tipo: "evento", valor: "pagtrust_desafio_compra_aprovada" }, { tipo: "evento", valor: "pagtrust_lowticket_compra_aprovada" }]),
  seg("abandono-pix", "Abandonou carrinho / Pix não pago", 80, { tags: ABANDONO_TAGS, comprador: false },
    [{ tipo: "evento", valor: "pagtrust_desafio_carrinho_abandonado" }, { tipo: "evento", valor: "pagtrust_lowticket_carrinho_abandonado" }]),
  seg("sellflux", "SellFlux", 90, { origens: ["sellflux"] }, [], "Contatos importados do SellFlux."),
];

/** Normaliza o que vem do banco (jsonb solto) para Segmento. */
export function normalizarSegmento(r: Record<string, unknown>): Segmento | null {
  if (typeof r.id !== "string" || typeof r.nome !== "string") return null;
  const f = (r.filtro && typeof r.filtro === "object" ? r.filtro : {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : undefined);
  const filtro: FiltroSegmento = {};
  if (lista(f.origens)?.length) filtro.origens = lista(f.origens);
  if (lista(f.niveis)?.length) filtro.niveis = lista(f.niveis);
  if (lista(f.tags)?.length) filtro.tags = lista(f.tags);
  if (typeof f.comprador === "boolean") filtro.comprador = f.comprador;
  if (f.alunas === "ativas" || f.alunas === "ex") filtro.alunas = f.alunas;
  if (filtro.alunas && PROGRAMAS_ALUNA.includes(f.programa as ProgramaAluna)) filtro.programa = f.programa as ProgramaAluna;
  const gatilhos = (Array.isArray(r.gatilhos) ? r.gatilhos : []).filter(
    (g): g is GatilhoSegmento => !!g && typeof g === "object" && ["evento", "tag", "etapa"].includes((g as GatilhoSegmento).tipo) && typeof (g as GatilhoSegmento).valor === "string",
  );
  return {
    id: r.id,
    slug: typeof r.slug === "string" ? r.slug : r.id,
    nome: r.nome,
    descricao: typeof r.descricao === "string" ? r.descricao : null,
    filtro,
    gatilhos,
    ordem: typeof r.ordem === "number" ? r.ordem : 1000,
    ativo: r.ativo !== false,
  };
}

export interface RegistroGatilho {
  id: string;
  nome: string;
  ativo?: boolean;
  gatilho_tipo?: string;
  gatilho_valor?: string | null;
}

/** Fluxos/automações cujo gatilho é um dos gatilhos do segmento (ou uma das tags do filtro). */
export function ligadosAoSegmento<T extends RegistroGatilho>(s: Segmento, registros: T[]): T[] {
  const chaves = new Set(s.gatilhos.map((g) => `${g.tipo}:${g.valor}`));
  (s.filtro.tags ?? []).forEach((t) => chaves.add(`tag:${t}`));
  return registros.filter((r) => r.gatilho_tipo && r.gatilho_valor && chaves.has(`${r.gatilho_tipo}:${r.gatilho_valor}`));
}

/**
 * Regra dos recortes de alunas, que saem do SISTEMA DO FITNESS e não da base de leads. Fonte da verdade:
 * public.crm_alunas_recorte (migration 20261029110000, testada em supabase/tests/banco-segmentos).
 * Mostrada em texto pequeno no cabeçalho do segmento.
 */
export const REGRA_ALUNAS: Record<"ativas" | "ex", string> = {
  ativas:
    "Regra: cadastro na Gestão de Alunas, fora as de teste, com vencimento do plano hoje ou depois (horário de Brasília). " +
    "O status ativa/inativa não entra, igual à aba Ativos do painel da Gestão de Alunas. Uma linha por pessoa (mesmo telefone; sem telefone, mesmo nome), com o vencimento mais distante.",
  ex:
    "Regra: já teve cadastro na Gestão de Alunas (fora as de teste) ou tem consulta marcada como convertida, sem reembolso, " +
    "no Monitoramento das Consultas, e hoje não é aluna ativa. Mesma pessoa = mesmo telefone ou mesmo nome; uma linha por pessoa.",
};

/** Regra mostrada no cabeçalho do segmento de alunas (com o programa, quando houver). */
export function regraAlunas(f: FiltroSegmento): string {
  if (!f.alunas) return "";
  const base = REGRA_ALUNAS[f.alunas];
  if (!f.programa) return base;
  return `${base} Programa ${ROTULO_PROGRAMA[f.programa]}: alunas.programa = ${VALORES_PROGRAMA[f.programa].join(" ou ")} (de-para no banco).`;
}

/** Nome do segmento fora do Banco de dados (ex.: seletor de gatilho), onde "MGMD" sozinho fica ambíguo. */
export function nomeCompletoSegmento(nome: string, f: { alunas?: string; programa?: string } | null | undefined): string {
  return f?.alunas === "ativas" && f.programa ? `Alunas ativas — ${nome}` : nome;
}

/** De onde veio cada ex-aluna (coluna origens no recorte de alunas). */
export const ROTULO_FONTE_ALUNA: Record<string, string> = {
  "gestao-alunas": "Gestão de Alunas",
  "consulta-fechou": "Consulta convertida",
};

/** Hoje no horário de Brasília (AAAA-MM-DD). */
export function hojeBRT(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
