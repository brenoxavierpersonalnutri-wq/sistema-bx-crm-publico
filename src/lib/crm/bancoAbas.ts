// Banco de dados do CRM (/crm/banco) com 3 abas: Pessoas (uma linha por pessoa, cópia materializada),
// Registros (public.base_leads crua, uma linha por origem) e Importar CSV. "Base de leads" (/crm/base-leads)
// deixou de ser tela própria e redireciona para a aba Registros. Lógica pura, testada em src/test/bancoAbas.test.ts.
import { limparBusca } from "../../../supabase/functions/_shared/segmentoFiltro.ts";

export type AbaBanco = "pessoas" | "registros" | "importar";
export const ABAS_BANCO: { id: AbaBanco; rotulo: string }[] = [
  { id: "pessoas", rotulo: "Pessoas" },
  { id: "registros", rotulo: "Registros" },
  { id: "importar", rotulo: "Importar CSV" },
];

/** ?aba= da URL; qualquer outra coisa (ou nada) = Pessoas. */
export function abaDaUrl(valor: string | null | undefined): AbaBanco {
  return valor === "registros" || valor === "importar" ? valor : "pessoas";
}

/** Para onde vai quem abre o endereço antigo /crm/base-leads. */
export const DESTINO_BASE_LEADS = "/crm/banco?aba=registros";

/** Nome legível da origem gravada em base_leads.origem. */
export const ROTULO_ORIGEM: Record<string, string> = {
  avaliacao: "Formulário de avaliação",
  individual: "Formulário individual",
  agendamento: "Agendamento",
  compra: "Compra",
  aluna: "Aluna",
  crm_whatsapp: "WhatsApp",
  sellflux: "SellFlux (CSV)",
  pagtrust: "PagTrust (CSV)",
  grupo_whatsapp: "Link de grupo",
};
export function rotuloOrigem(origem: string | null | undefined): string {
  const o = origem ?? "";
  if (o.startsWith("webhook:")) return `Webhook (${o.slice("webhook:".length)})`;
  return ROTULO_ORIGEM[o] ?? o;
}

/** Linha de whatsapp_contacts criada pelo "Enviar para o kanban" (a mesma da antiga Base de leads). */
export interface ContatoKanban {
  phone: string;
  name: string;
  stage: "leads";
  source: "base_leads";
}

/** Um contato por telefone (só dígitos), na ordem em que aparecem; quem não tem telefone fica de fora. */
export function contatosParaKanban(pessoas: { telefone_e164: string | null; nome: string | null }[]): ContatoKanban[] {
  const porFone = new Map<string, ContatoKanban>();
  for (const p of pessoas) {
    const phone = (p.telefone_e164 ?? "").replace(/\D/g, "");
    if (phone.length < 10 || porFone.has(phone)) continue;
    porFone.set(phone, { phone, name: p.nome?.trim() ?? "", stage: "leads", source: "base_leads" });
  }
  return [...porFone.values()];
}

/** Filtros da aba Registros (paginação no servidor, sobre public.base_leads). */
export interface FiltrosRegistros {
  origem?: string;
  tag?: string;
  /** grafias gravadas da tag escolhida (o filtro do banco é exato) */
  tagVariantes?: string[];
  produto?: string;
  de?: string; // AAAA-MM-DD (BRT), sobre criado_origem
  ate?: string;
  comTelefone?: boolean;
  busca?: string;
}

/** Construtor mínimo (o do supabase-js satisfaz). */
export interface ConsultaRegistros<Q> {
  eq(coluna: string, valor: unknown): Q;
  overlaps(coluna: string, valor: string[]): Q;
  not(coluna: string, operador: string, valor: string | null): Q;
  gte(coluna: string, valor: string): Q;
  lte(coluna: string, valor: string): Q;
  or(filtros: string): Q;
}

export function aplicarFiltrosRegistros<Q extends ConsultaRegistros<Q>>(q: Q, f: FiltrosRegistros): Q {
  let r = q;
  if (f.origem) r = r.eq("origem", f.origem);
  if (f.tag) r = r.overlaps("tags", f.tagVariantes?.length ? f.tagVariantes : [f.tag]);
  if (f.produto) r = r.eq("produto", f.produto);
  if (f.comTelefone) r = r.not("telefone_e164", "is", null);
  if (f.de) r = r.gte("criado_origem", new Date(`${f.de}T00:00:00-03:00`).toISOString());
  if (f.ate) r = r.lte("criado_origem", new Date(`${f.ate}T23:59:59.999-03:00`).toISOString());
  const b = limparBusca(f.busca ?? "");
  if (b) {
    const digitos = b.replace(/\D/g, "");
    const partes = [`nome.ilike.*${b}*`, `email.ilike.*${b}*`];
    if (digitos.length >= 4) partes.push(`telefone_e164.ilike.*${digitos}*`);
    r = r.or(partes.join(","));
  }
  return r;
}
