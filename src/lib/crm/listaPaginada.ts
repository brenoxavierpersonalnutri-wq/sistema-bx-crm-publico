// Lista de /crm/conversas paginada pelo servidor (21/10/2026): regras puras, sem React nem Supabase.
// A primeira carga traz só as 60 conversas mais recentes (RPC crm_conversas_pagina), o resto vem ao rolar ou
// buscar, por cursor (ordem da última mensagem, id). Os contadores das abas vêm de crm_conversas_contadores.
// A lista que ficou em cache (localStorage, por usuário) aparece na hora e é trocada pela do servidor.
import type { FiltroAtendente } from "@/lib/crm/departamentos";
import {
  chaveConversa,
  type ContatoCRM,
  type Conversa,
  type FiltroConversa,
  type MensagemCRM,
  type ResumoConversa,
} from "@/lib/crm/conversas";

/** Quantas conversas cada página do servidor traz. */
export const PAGINA_SERVIDOR = 60;

/** O que a tela está pedindo agora (seletor de número, filtro Atendente, aba e busca). */
export interface ConsultaLista {
  numeroId: string | null;
  atendente: FiltroAtendente;
  filtro: FiltroConversa;
  busca: string;
}

export const CONSULTA_PADRAO: ConsultaLista = { numeroId: null, atendente: "todos", filtro: "tudo", busca: "" };

/** Uma linha de crm_conversas_pagina. */
export interface LinhaLista {
  contato: ContatoCRM;
  ultima: MensagemCRM | null;
  nao_lidas: number;
  /** ultima_msg_em do contato (a ordem); null = sem conversa. */
  ordem_em: string | null;
  /** now() do servidor naquela consulta: base do próximo delta. */
  consultado_em?: string | null;
}

export interface CursorLista { em: string; id: string }

/** Contadores das abas (crm_conversas_contadores). */
export interface ContadoresLista {
  naoLidas: number;
  semConversa: number;
  porDepartamento: Record<string, number>;
  tags: string[];
  etapas: string[];
}

/** Estado de uma consulta: quem o servidor confirmou, até onde a lista já foi e se acabou. */
export interface PaginaConsulta {
  ids: ReadonlySet<string>;
  cursor: CursorLista | null;
  /** ordem da última linha recebida: abaixo dela a tela ainda não sabe o que existe. "" = já chegou nas sem conversa. */
  fronteira: string | null;
  fim: boolean;
  carregando: boolean;
}

/** Chave da consulta (a busca entra normalizada: "Ana " e "ana" são a mesma página). */
export function chaveConsulta(c: ConsultaLista): string {
  return JSON.stringify([c.numeroId ?? "", c.atendente, c.filtro, c.busca.trim().toLowerCase()]);
}

/** Cursor da próxima página: a última linha recebida (sem conversa = -infinity, como no banco). */
export function cursorDe(linhas: LinhaLista[]): CursorLista | null {
  const u = linhas[linhas.length - 1];
  return u ? { em: u.ordem_em ?? "-infinity", id: u.contato.id } : null;
}

/** Junta uma página nova ao estado da consulta. */
export function avancarPagina(atual: PaginaConsulta | undefined, linhas: LinhaLista[], limite: number): PaginaConsulta {
  const ids = new Set(atual?.ids ?? []);
  for (const l of linhas) ids.add(l.contato.id);
  const ultima = linhas[linhas.length - 1];
  return {
    ids,
    cursor: cursorDe(linhas) ?? atual?.cursor ?? null,
    fronteira: ultima ? ultima.ordem_em ?? "" : atual?.fronteira ?? null,
    fim: linhas.length < limite,
    carregando: false,
  };
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * A conversa pode aparecer nesta consulta? O servidor confirmou (ids), ou é mais recente que a última linha
 * recebida (chegou pelo Realtime / delta). Abaixo da fronteira ela espera a próxima página, para a lista
 * nunca mostrar uma conversa velha com um buraco antes dela.
 */
export function dentroDaFronteira(c: Pick<Conversa, "contato" | "ordem">, pagina: PaginaConsulta | null | undefined): boolean {
  if (!pagina || pagina.fim || pagina.fronteira === null) return true;
  if (pagina.ids.has(c.contato.id)) return true;
  if (!c.ordem) return false;
  if (pagina.fronteira === "") return true;
  return ms(c.ordem) >= ms(pagina.fronteira);
}

/** Resumo (última + não lidas) por chave da conversa, a partir das linhas da página. */
export function resumoDaLinha(l: LinhaLista): ResumoConversa | null {
  if (!l.ultima?.created_at) return null;
  return { contact_phone: l.contato.phone, numero_id: l.contato.numero_id ?? null, ultima: l.ultima, nao_lidas: Number(l.nao_lidas) || 0 };
}

/** Maior consultado_em das linhas, menos 30 s (transação que gravou antes e terminou depois): base do delta. */
export function proximoDesde(linhas: LinhaLista[], atual: string | null): string | null {
  let maior = 0;
  for (const l of linhas) if (l.consultado_em) maior = Math.max(maior, ms(l.consultado_em));
  if (!maior) return atual;
  const novo = new Date(maior - 30_000).toISOString();
  return atual && ms(atual) > ms(novo) ? atual : novo;
}

// ---------- cache da lista (localStorage, por usuário) ----------

const VERSAO_CACHE = 1;
const chaveCache = (usuario: string) => `crm:conversas:lista:v${VERSAO_CACHE}:${usuario}`;
/** Quantas conversas guardar: o que cabe na primeira tela com folga. */
export const TAMANHO_CACHE = PAGINA_SERVIDOR;

export interface ItemCache { contato: ContatoCRM; ultima: MensagemCRM | null; naoLidas: number }

/** Guarda as primeiras conversas (já ordenadas). Falha de storage (cheio, modo privado) não quebra a tela. */
export function salvarCacheLista(usuario: string, conversas: Conversa[], agora: Date = new Date()): void {
  try {
    const itens: ItemCache[] = conversas.slice(0, TAMANHO_CACHE).map((c) => ({
      // link assinado vence em 1 h: não guarda (a prévia não precisa dele)
      contato: c.contato,
      ultima: c.ultima ? { ...c.ultima, media_url: c.ultima.media_path ? null : c.ultima.media_url ?? null } : null,
      naoLidas: c.naoLidas,
    }));
    window.localStorage.setItem(chaveCache(usuario), JSON.stringify({ salvoEm: agora.toISOString(), itens }));
  } catch {
    /* sem cache: a lista só aparece quando o servidor responder */
  }
}

export function lerCacheLista(usuario: string): ItemCache[] {
  try {
    const obj = JSON.parse(window.localStorage.getItem(chaveCache(usuario)) ?? "null") as { itens?: unknown } | null;
    if (!obj || !Array.isArray(obj.itens)) return [];
    return (obj.itens as ItemCache[]).filter((i) => i && i.contato && typeof i.contato.id === "string" && typeof i.contato.phone === "string");
  } catch {
    return [];
  }
}

/** Itens do cache no formato do estado do hook (contatos, resumos por chave e mensagens). */
export function sementeDoCache(itens: ItemCache[]): { contatos: ContatoCRM[]; resumos: ResumoConversa[]; mensagens: MensagemCRM[] } {
  const contatos: ContatoCRM[] = [];
  const resumos: ResumoConversa[] = [];
  const mensagens: MensagemCRM[] = [];
  for (const i of itens) {
    contatos.push(i.contato);
    if (!i.ultima?.created_at) continue;
    if ((i.contato.canal ?? "whatsapp") === "whatsapp" && !i.contato.phone.startsWith("ig:")) {
      resumos.push({ contact_phone: i.contato.phone, numero_id: i.contato.numero_id ?? null, ultima: i.ultima, nao_lidas: i.naoLidas });
    } else {
      mensagens.push(i.ultima);
    }
  }
  return { contatos, resumos, mensagens };
}

/** Chave do resumo (a mesma de montarConversas). */
export const chaveDoResumo = (r: ResumoConversa): string => chaveConversa({ phone: r.contact_phone, numero_id: r.numero_id });
