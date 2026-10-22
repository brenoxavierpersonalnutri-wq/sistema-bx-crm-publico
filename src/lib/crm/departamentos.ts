// Departamentos (abas de /crm/conversas e colunas do Kanban) e atendente da conversa. Puro: sem banco.
// Banco: crm_departamentos (migration 20261123100000) e whatsapp_contacts.departamento_id / atendente_id.
import type { ContatoCRM } from "@/lib/crm/conversas";

export interface Departamento {
  id: string;
  nome: string;
  cor: string;
  ativo: boolean;
  ordem: number;
  /** 'manual' = conversas com departamento_id dele · 'ia' = IA atendendo (regra, sem etiqueta) */
  regra: "manual" | "ia";
  /** não pode ser excluído (o "Em atendimento com IA") */
  fixo: boolean;
  /** veio da etapa do funil com este slug: mover para cá também muda a etapa */
  etapa_origem?: string | null;
}

export interface Atendente { id: string; nome: string }

type ContatoAtendimento = Pick<ContatoCRM, "ai_agent_slug" | "ai_pausado"> & {
  atendente_id?: string | null;
  departamento_id?: string | null;
  is_group?: boolean | null;
  phone?: string;
};

/** IA atendendo: agente preenchido e não pausado (mesma regra de quemAtende / selo "IA atendendo"). */
export const iaAtendendo = (c: Pick<ContatoCRM, "ai_agent_slug" | "ai_pausado">): boolean => !!c.ai_agent_slug && !c.ai_pausado;

/**
 * A conversa está nesta aba/coluna? A da IA é regra; as manuais excluem quem está com a IA (a conversa aparece
 * em "Em atendimento com IA" até um humano assumir, e volta para a coluna dela depois).
 */
export function conversaNoDepartamento(c: ContatoAtendimento, d: Pick<Departamento, "id" | "regra">): boolean {
  if (d.regra === "ia") return iaAtendendo(c);
  return !iaAtendendo(c) && c.departamento_id === d.id;
}

export const ordenarDepartamentos = <T extends Pick<Departamento, "ordem" | "nome">>(lista: T[]): T[] =>
  [...lista].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

/** Arrastar a aba `de` para a posição da aba `para`: devolve a lista na nova ordem com `ordem` 10, 20, 30... */
export function reordenar<T extends { id: string; ordem: number }>(lista: T[], de: string, para: string): T[] {
  const i = lista.findIndex((d) => d.id === de);
  const j = lista.findIndex((d) => d.id === para);
  if (i < 0 || j < 0 || i === j) return lista;
  const nova = [...lista];
  const [item] = nova.splice(i, 1);
  nova.splice(j, 0, item);
  return nova.map((d, k) => ({ ...d, ordem: (k + 1) * 10 }));
}

// ---------------------------------------------------------------------------------------- filtro Atendente
export type FiltroAtendente = "todos" | "sem" | "ia" | `u:${string}`;

export function casaAtendente(c: ContatoAtendimento, filtro: FiltroAtendente): boolean {
  if (filtro === "todos") return true;
  if (filtro === "ia") return iaAtendendo(c);
  if (filtro === "sem") return !c.atendente_id && !iaAtendendo(c);
  return c.atendente_id === filtro.slice(2);
}

export function rotuloAtendente(atendentes: Atendente[], id: string | null | undefined): string {
  if (!id) return "Sem atendente";
  return atendentes.find((a) => a.id === id)?.nome ?? "Usuário removido";
}

// ------------------------------------------------------------------------------------- importar a lista
export interface LinhaImportacao { nome: string; cor?: string; ativo?: boolean; origem_id?: string }

/**
 * Lista colada na tela (vinda da SellFlux): JSON (array de {nome, cor?, ativo?, id?}) ou uma por linha,
 * "Nome" ou "Nome;#cor". Ignora vazias e repetidas (sem caixa/acento); nome até 60.
 */
export function lerListaDepartamentos(texto: string): LinhaImportacao[] {
  const t = texto.trim();
  if (!t) return [];
  let brutas: LinhaImportacao[] = [];
  if (t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as unknown[];
      brutas = j.flatMap((x) => {
        if (typeof x === "string") return [{ nome: x }];
        if (!x || typeof x !== "object") return [];
        const o = x as Record<string, unknown>;
        const nome = String(o.nome ?? o.name ?? "").trim();
        return nome ? [{
          nome,
          ...(typeof o.cor === "string" || typeof o.color === "string" ? { cor: String(o.cor ?? o.color) } : {}),
          ...(typeof o.ativo === "boolean" ? { ativo: o.ativo } : {}),
          ...(o.id != null || o.origem_id != null ? { origem_id: String(o.origem_id ?? o.id) } : {}),
        }] : [];
      });
    } catch {
      brutas = [];
    }
  } else {
    brutas = t.split(/\r?\n/).map((l) => {
      const [nome, cor] = l.split(/[;\t]/).map((s) => s.trim());
      return cor ? { nome, cor } : { nome };
    });
  }
  const vistos = new Set<string>();
  const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return brutas
    .map((l) => ({ ...l, nome: l.nome.slice(0, 60), ...(l.cor && /^#[0-9a-f]{6}$/i.test(l.cor) ? { cor: l.cor } : { cor: undefined }) }))
    .filter((l) => {
      if (!l.nome) return false;
      const k = chave(l.nome);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .map(({ cor, ...resto }) => (cor ? { ...resto, cor } : resto));
}

export const CORES_DEPARTAMENTO = ["#64748b", "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0891b2"];
