// Estúdio React: opções da montagem (o que vai no pedido para a VPS) e o que cabe nas colunas de conteudo_reacts.
import type { Layout, ProjetoReact } from "./api";

export interface OpcoesMontagem { layout: Layout; legenda: boolean; cortar_silencio: boolean; ia: boolean; duracao_max: number; modelo: string }

/** Padrão: tela dividida, legenda nativa, cortar silêncios e Edição com IA ligados, até 90 s. */
export const OP_PADRAO: OpcoesMontagem = { layout: "dividido", legenda: true, cortar_silencio: true, ia: true, duracao_max: 90, modelo: "nativo" };
export const DURACOES = [30, 45, 60, 90, 120, 180];

/** Só as colunas que a tabela conteudo_reacts sempre teve (as da IA vão por atualizarColunasIA). */
export const colunasOp = (op: OpcoesMontagem) => ({ layout: op.layout, legenda: op.legenda, cortar_silencio: op.cortar_silencio });

export const opcoesDoProjeto = (p: ProjetoReact): OpcoesMontagem => ({
  layout: p.layout, legenda: p.legenda, cortar_silencio: p.cortar_silencio,
  ia: p.edicao_ia ?? true, duracao_max: p.duracao_max_seg ? Number(p.duracao_max_seg) : 90,
  modelo: p.modelo_edicao || "nativo",
});

export function resumoOpcoes(op: OpcoesMontagem): string {
  return [
    op.layout === "dividido" ? "Tela dividida" : "Tela cheia nos longos",
    op.legenda ? "legenda" : "sem legenda",
    op.cortar_silencio ? "sem silêncios" : "com silêncios",
    op.ia ? `IA até ${op.duracao_max} s` : "sem IA",
    op.modelo && op.modelo !== "nativo" ? `modelo ${op.modelo}` : "",
  ].filter(Boolean).join(" · ");
}

