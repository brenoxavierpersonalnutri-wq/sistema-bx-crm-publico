// Pré-carga de /crm/conversas (22/10/2026). Medido no celular (4G, Chrome headless): a primeira página da lista
// só era pedida aos ~2 s, depois de uma fila em série — JS de entrada → perfil/papéis/módulos → chunk do layout →
// chunk do CRM → crm_numeros → crm_conversas_pagina. Aqui, assim que o JS de entrada roda, a mesma consulta que a
// tela faria (crm_numeros e a primeira página com a aba padrão) já sai em paralelo com o resto. A tela pega a
// resposta pronta (uma vez só) e, se algo não bater (outro usuário, números ocultos diferentes), pede de novo.
//
// Segurança: é a MESMA RPC (SECURITY INVOKER) com o JWT da sessão — o RLS (crm_acesso) decide o que volta, como
// antes. Nada é gravado no servidor; a resposta fica só na memória desta aba.
import { supabase } from "@/integrations/supabase/client";
import { carregarLeituras, carregarMarcadas, numeroOcultoEmConversas, type NumeroConversa } from "@/lib/crm/conversas";
import { fonteSupabase } from "@/lib/crm/fonteConversas";
import { CONSULTA_PADRAO, PAGINA_SERVIDOR, type LinhaLista } from "@/lib/crm/listaPaginada";

export const ROTA_CONVERSAS = /^\/crm\/conversas\/?$/;

/** Números ocultos da última visita (por usuário): sem eles a pré-carga teria de esperar crm_numeros. */
const chaveOcultos = (usuario: string) => `crm:conversas:ocultos:${usuario}`;

export function lerOcultosGuardados(usuario: string): string[] | null {
  try {
    const cru = window.localStorage.getItem(chaveOcultos(usuario));
    if (cru === null) return null;
    const arr = JSON.parse(cru);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function guardarOcultos(usuario: string, ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(chaveOcultos(usuario), JSON.stringify([...ids].sort()));
  } catch {
    /* sem storage: a próxima pré-carga espera crm_numeros */
  }
}

/** Mesma forma que a tela usa para comparar (ids ordenados). */
export const assinaturaOcultos = (ids: Iterable<string>) => [...ids].sort().join(",");

export interface PaginaPreCarregada {
  usuario: string;
  /** assinaturaOcultos dos números ocultos com que a página foi pedida. */
  ocultos: string;
  /** null = RPC indisponível (migration não rodou), como em fonteSupabase.paginaConversas. */
  linhas: LinhaLista[] | null;
}

interface PreCarga {
  numeros: Promise<NumeroConversa[]> | null;
  pagina: Promise<PaginaPreCarregada | null> | null;
  iniciadaEm: number;
}

let atual: PreCarga | null = null;
/** Resposta velha não serve: a tela pede de novo. */
const VALIDADE_MS = 60_000;

/** Dispara as consultas da primeira tela de /crm/conversas. Sem sessão ou fora da rota, não faz nada. */
export function iniciarPreCargaConversas(caminho: string = window.location.pathname, fonte = fonteSupabase): void {
  if (!ROTA_CONVERSAS.test(caminho) || atual || !fonte.paginaConversas) return;
  // getSession lê a sessão do aparelho (sem ida ao servidor quando o token está válido)
  const usuario = supabase.auth.getSession().then(({ data }) => data.session?.user?.id ?? null).catch(() => null);
  const numeros = usuario.then((u) => (u && fonte.listarNumeros ? fonte.listarNumeros() : ([] as NumeroConversa[])));
  const pagina = usuario.then(async (u): Promise<PaginaPreCarregada | null> => {
    if (!u) return null;
    const ocultos = lerOcultosGuardados(u) ?? (await numeros).filter(numeroOcultoEmConversas).map((n) => n.id);
    const { leituras, base } = carregarLeituras(u);
    const linhas = await fonte.paginaConversas!({
      leituras, base, marcadas: [...carregarMarcadas(u)], ocultos,
      consulta: CONSULTA_PADRAO, cursor: null, limite: PAGINA_SERVIDOR,
    });
    return { usuario: u, ocultos: assinaturaOcultos(ocultos), linhas };
  }).catch(() => null);
  // falha aqui nunca aparece como erro: a tela faz a consulta dela
  numeros.catch(() => undefined);
  atual = { numeros: numeros.catch(() => [] as NumeroConversa[]), pagina, iniciadaEm: Date.now() };
}

const valida = () => !!atual && Date.now() - atual.iniciadaEm < VALIDADE_MS;

/** crm_numeros já pedido pela pré-carga (uma vez só); null = não há. */
export function tomarNumerosPreCarregados(): Promise<NumeroConversa[]> | null {
  if (!valida() || !atual!.numeros) return null;
  const p = atual!.numeros;
  atual!.numeros = null;
  return p;
}

/** Primeira página já pedida (uma vez só); null = não há. Quem toma confere usuário e ocultos. */
export function tomarPaginaPreCarregada(): Promise<PaginaPreCarregada | null> | null {
  if (!valida() || !atual!.pagina) return null;
  const p = atual!.pagina;
  atual!.pagina = null;
  return p;
}

/** Só para testes. */
export function esquecerPreCarga(): void {
  atual = null;
}
