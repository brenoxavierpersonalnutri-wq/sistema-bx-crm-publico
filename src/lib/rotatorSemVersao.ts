// =============================================================
// Vendas do teste SEM versão (tabela rotator_vendas_sem_versao).
//
// Venda aprovada do produto que a PagTrust mostra, mas que chegou sem o
// marcador cm_vN_<clique>: não se sabe de qual página veio. Ela entra só no
// TOTAL do teste (cards Conversões e Receita, ROAS e CPA do bloco do Meta).
// As linhas por variação não mudam.
//
// Não conta duas vezes: se o mesmo order_id existir como compra atribuída
// (rotator_events 'purchase', lançada à mão ou pelo webhook com marcador),
// a venda sem versão é ignorada. A view do banco já marca "atribuida"; aqui
// conferimos de novo contra os pedidos que o painel carregou.
// =============================================================
import type { EventoDoRotador } from "@/lib/rotatorResultados";

export interface VendaSemVersao {
  id: string;
  rotator_link_id: string;
  order_id: string;
  value: number | string;
  sold_at: string;
  source: string;
  note: string | null;
  /** true quando o mesmo pedido já é compra de uma variação (não soma no total). */
  atribuida?: boolean | null;
}

export interface ResumoSemVersao {
  /** Vendas que somam no total do teste. */
  purchases: number;
  revenue: number;
  /** Vendas cadastradas mas ignoradas porque o pedido já está numa variação. */
  ignoradas: number;
}

export interface TotaisDoTeste {
  clicks: number;
  checkouts: number;
  purchases: number;
  revenue: number;
  avg_ticket: number;
  conversion_rate: number;
  checkout_rate: number;
  /** Só as compras atribuídas às variações (soma da tabela). */
  purchases_atribuidas: number;
  revenue_atribuida: number;
  sem_versao: ResumoSemVersao;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Pedidos que já são compra de alguma variação do teste. */
export function pedidosAtribuidos(eventos: Pick<EventoDoRotador, "event_type" | "order_id">[]): Set<string> {
  const s = new Set<string>();
  for (const e of eventos) {
    if (e.event_type === "purchase" && e.order_id) s.add(String(e.order_id).trim());
  }
  return s;
}

/** A venda sem versão soma no total? Não, se o pedido já está numa variação. */
export function contaNoTotal(v: Pick<VendaSemVersao, "order_id" | "atribuida">, atribuidos: Set<string>): boolean {
  if (v.atribuida) return false;
  return !atribuidos.has(String(v.order_id).trim());
}

export function resumirSemVersao(vendas: VendaSemVersao[], atribuidos: Set<string>): ResumoSemVersao {
  const r: ResumoSemVersao = { purchases: 0, revenue: 0, ignoradas: 0 };
  const vistos = new Set<string>();
  for (const v of vendas) {
    const pedido = String(v.order_id).trim();
    if (!contaNoTotal(v, atribuidos)) {
      r.ignoradas += 1;
      continue;
    }
    if (vistos.has(pedido)) continue; // o banco tem índice único; aqui é só cinto de segurança
    vistos.add(pedido);
    r.purchases += 1;
    r.revenue += Math.max(0, numero(v.value));
  }
  r.revenue = Math.round(r.revenue * 100) / 100;
  return r;
}

/**
 * Totais do teste inteiro = compras das variações + vendas sem versão.
 * Conversão do teste = compras totais ÷ visitas.
 */
export function totaisComSemVersao(
  base: { clicks: number; checkouts: number; purchases: number; revenue: number; checkout_rate: number },
  sem: ResumoSemVersao,
): TotaisDoTeste {
  const purchases = base.purchases + sem.purchases;
  const revenue = Math.round((base.revenue + sem.revenue) * 100) / 100;
  return {
    clicks: base.clicks,
    checkouts: base.checkouts,
    checkout_rate: base.checkout_rate,
    purchases,
    revenue,
    avg_ticket: purchases > 0 ? revenue / purchases : 0,
    conversion_rate: base.clicks > 0 ? (purchases / base.clicks) * 100 : 0,
    purchases_atribuidas: base.purchases,
    revenue_atribuida: base.revenue,
    sem_versao: sem,
  };
}

/** "36,98", "R$ 1.234,56", "17" ou "17.5" → número; inválido ou negativo → null. */
export function lerValorBR(texto: string): number | null {
  let s = String(texto ?? "").replace(/R\$\s*/i, "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null;
}

/** Código do pedido como a tabela aceita: sem espaço nas pontas, 1 a 200 caracteres. */
export function lerPedido(texto: string): string | null {
  const s = String(texto ?? "").trim();
  return s && s.length <= 200 ? s : null;
}
