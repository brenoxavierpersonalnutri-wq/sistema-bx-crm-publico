// Hook único das etapas do CRM (kanban, roteiros, fluxos, automações, dashboard). Lê public.crm_etapas
// (migration 20261101100000) e cai nas 5 de sempre se a tabela ainda não existir ou a leitura falhar,
// para a tela não quebrar antes da migration.
//
// Estado em módulo (uma leitura para a tela toda) + useSyncExternalStore: qualquer componente que chama
// useEtapas() re-renderiza quando a lista muda (ex.: depois de salvar em "Configurar etapas").
// Também alimenta o registro de slugs válidos de _shared/etapas.ts (validarFluxo/validarAutomacao) e o
// mapa NOMES_ETAPAS (helpers puros que mostram o nome da etapa).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ETAPAS_SISTEMA,
  type Etapa,
  colunasDoKanban,
  definirEtapasValidas,
  normalizarEtapas,
} from "../../supabase/functions/_shared/etapas.ts";

export type { Etapa };

/** Nome por slug, sempre atualizado (inclui arquivadas). Objeto estável: helpers fora de componente leem daqui. */
export const NOMES_ETAPAS: Record<string, string> = Object.fromEntries(ETAPAS_SISTEMA.map((e) => [e.slug, e.nome]));

interface EstadoEtapas {
  etapas: Etapa[];
  carregado: boolean;
  /** null = ainda não sabe; false = tabela não existe (migration pendente) ou leitura falhou. */
  tabelaOk: boolean | null;
}

let estado: EstadoEtapas = { etapas: normalizarEtapas(null), carregado: false, tabelaOk: null };
let emAndamento: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function publicar(novo: EstadoEtapas) {
  estado = novo;
  for (const k of Object.keys(NOMES_ETAPAS)) delete NOMES_ETAPAS[k];
  for (const e of novo.etapas) NOMES_ETAPAS[e.slug] = e.nome;
  definirEtapasValidas(novo.etapas.map((e) => e.slug));
  ouvintes.forEach((f) => f());
}

/** Relê crm_etapas. Erro ou tabela vazia/ausente: mantém as 5 de sempre (tabelaOk = false). */
export function recarregarEtapas(): Promise<void> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    try {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string) => PromiseLike<{ data: unknown; error: unknown }> } };
      })
        .from("crm_etapas")
        .select("slug, nome, cor, ordem, ativo, sistema")
        .order("ordem");
      const ok = !error && Array.isArray(data) && data.length > 0;
      publicar({ etapas: normalizarEtapas(ok ? data : null), carregado: true, tabelaOk: ok });
    } catch {
      publicar({ etapas: normalizarEtapas(null), carregado: true, tabelaOk: false });
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}

/** Só para testes: volta ao estado inicial (ou injeta uma lista). */
export function __definirEtapasParaTeste(etapas: Etapa[] | null) {
  publicar({ etapas: normalizarEtapas(etapas), carregado: etapas !== null, tabelaOk: etapas !== null ? true : null });
}

const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};
const ler = () => estado;

export interface Coluna {
  id: string;
  title: string;
  cor: string;
}
const paraColuna = (e: Etapa): Coluna => ({ id: e.slug, title: e.nome, cor: e.cor });

export function useEtapas() {
  const s = useSyncExternalStore(assinar, ler, ler);
  useEffect(() => {
    if (!estado.carregado) void recarregarEtapas();
  }, []);
  return useMemo(() => {
    const ativas = s.etapas.filter((e) => e.ativo);
    return {
      /** Todas (ativas e arquivadas), na ordem. */
      etapas: s.etapas,
      /** Só as ativas: o que aparece em seletores. */
      ativas,
      /** Formato antigo do KANBAN_COLUMNS ({ id, title }) + cor, só ativas. */
      colunas: ativas.map(paraColuna),
      /** Slugs válidos em gatilho/ação/filtro (inclui arquivadas). */
      slugs: s.etapas.map((e) => e.slug),
      nomeEtapa: (slug: string | null | undefined) => (slug ? s.etapas.find((e) => e.slug === slug)?.nome ?? slug : ""),
      /** Colunas do quadro: ativas + arquivadas/desconhecidas que ainda têm contato. */
      colunasKanban: (stagesPresentes: Iterable<string>) => colunasDoKanban(s.etapas, stagesPresentes).map(paraColuna),
      carregado: s.carregado,
      tabelaOk: s.tabelaOk,
      recarregar: recarregarEtapas,
    };
  }, [s]);
}
