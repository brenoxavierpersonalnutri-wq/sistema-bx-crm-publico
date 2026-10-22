import { supabase } from '@/integrations/supabase/client';
import { calcularMetricasPorVariacao, type BeaconDoRotador, type MetricaDaVariacao } from '@/lib/pageMetrics';
import type { RotatorMetaConfig } from '@/lib/rotatorMeta';
import { calcularResultadosPorVariacao, totaisDosResultados, type EventoDoRotador } from '@/lib/rotatorResultados';
import {
  pedidosAtribuidos,
  resumirSemVersao,
  totaisComSemVersao,
  type TotaisDoTeste,
  type VendaSemVersao,
} from '@/lib/rotatorSemVersao';

export type ConversionRule =
  | { type: 'pixel' }
  | { type: 'url_contains'; value: string }
  | { type: 'url_equals'; value: string };

export interface RotatorLink {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  conversion_rule?: ConversionRule | null;
  /** Conta e campanhas do Meta que mandam tráfego para o /r/:slug (ver lib/rotatorMeta). */
  meta_config?: RotatorMetaConfig | null;
  /** Otimização automática (migration 20261016180000_rotator_otimizacao). Ausente = migration não rodou. */
  otim_ativa?: boolean;
  otim_min_visitas?: number;
  otim_min_compras?: number;
  otim_piso?: number | string;
  otim_teto?: number | string;
  otim_recalculado_em?: string | null;
  otim_fase?: string | null;
}

export type ParametrosOtimizacaoDb = {
  otim_ativa: boolean;
  otim_min_visitas: number;
  otim_min_compras: number;
  otim_piso: number;
  otim_teto: number;
};

export interface RotatorDestination {
  id: string;
  rotator_id: string;
  url: string;
  label: string;
  weight: number;
  created_at: string;
  /** Peso digitado no painel enquanto a otimização está ligada (o weight vira o da IA). */
  peso_manual?: number | null;
  otim_peso?: number | string | null;
  otim_prob_melhor?: number | string | null;
  otim_status?: string | null;
}

export interface RotatorStats {
  destination_id: string;
  label: string;
  url: string;
  weight: number;
  clicks: number;
  checkouts: number;
  purchases: number;
  revenue: number;
  avg_ticket: number;
  conversion_rate: number;
  checkout_rate: number;
}

export const rotatorApi = {
  async getAll(): Promise<RotatorLink[]> {
    const { data, error } = await (supabase as any)
      .from('rotator_links')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getOne(id: string): Promise<RotatorLink | null> {
    const { data, error } = await (supabase as any)
      .from('rotator_links')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data;
  },

  async create(name: string, slug: string): Promise<RotatorLink> {
    const { data, error } = await (supabase as any)
      .from('rotator_links')
      .insert({ name, slug })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateConversionRule(id: string, rule: ConversionRule): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_links')
      .update({ conversion_rule: rule })
      .eq('id', id);
    if (error) throw error;
  },

  async updateMetaConfig(id: string, config: RotatorMetaConfig | null): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_links')
      .update({ meta_config: config })
      .eq('id', id);
    if (error) throw error;
  },

  /** Liga/desliga e parâmetros. O gatilho no banco recalcula os pesos na hora. */
  async updateOtimizacao(id: string, params: ParametrosOtimizacaoDb): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_links')
      .update(params)
      .eq('id', id);
    if (error) throw error;
  },

  async recalcularOtimizacao(id: string): Promise<unknown> {
    const { data, error } = await (supabase as any).rpc('rotator_otimizar', { p_rotator: id, p_forcar: true });
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_links')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async getDestinations(rotatorId: string): Promise<RotatorDestination[]> {
    const { data, error } = await (supabase as any)
      .from('rotator_destinations')
      .select('*')
      .eq('rotator_id', rotatorId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async addDestination(rotatorId: string, url: string, label: string, weight: number): Promise<RotatorDestination> {
    const { data, error } = await (supabase as any)
      .from('rotator_destinations')
      .insert({ rotator_id: rotatorId, url, label, weight })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async removeDestination(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_destinations')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * Cliques do rotador (contagem por HEAD, sem teto de linhas) e eventos de
   * cada variação. Eventos vêm da view rotator_events_por_destino (paginada);
   * se a view ainda não existir no banco, cai no caminho antigo, em lotes.
   */
  async getStats(rotatorId: string): Promise<RotatorStats[]> {
    return (await this.getStatsComEventos(rotatorId)).stats;
  },

  async getStatsComEventos(rotatorId: string): Promise<{ stats: RotatorStats[]; eventos: EventoDoRotador[] }> {
    const { data: link } = await (supabase as any)
      .from('rotator_links')
      .select('conversion_rule')
      .eq('id', rotatorId)
      .single();
    const rule: ConversionRule | null = link?.conversion_rule ?? null;

    const destinations = await this.getDestinations(rotatorId);
    if (destinations.length === 0) return { stats: [], eventos: [] };

    const counts = await Promise.all(
      destinations.map(async (d) => {
        const { count, error } = await (supabase as any)
          .from('rotator_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('destination_id', d.id);
        if (error) throw error;
        return [d.id, count ?? 0] as const;
      }),
    );

    let eventos: EventoDoRotador[];
    try {
      eventos = await this.getEventsViaView(rotatorId);
    } catch {
      eventos = await this.getEventsLegacy(rotatorId);
    }

    return { stats: calcularResultadosPorVariacao(destinations, Object.fromEntries(counts), eventos, rule), eventos };
  },

  async getEventsViaView(rotatorId: string): Promise<EventoDoRotador[]> {
    const out: EventoDoRotador[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 500_000; from += PAGE) {
      const { data, error } = await (supabase as any)
        .from('rotator_events_por_destino')
        .select('destination_id, click_id, event_type, value, page_url, order_id')
        .eq('rotator_id', rotatorId)
        .order('event_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  },

  /** Sem a view: cliques paginados e eventos em lotes de click_id (URL curta). */
  async getEventsLegacy(rotatorId: string): Promise<EventoDoRotador[]> {
    const destinoDoClique = new Map<string, string>();
    const PAGE = 1000;
    for (let from = 0; from < 500_000; from += PAGE) {
      const { data, error } = await (supabase as any)
        .from('rotator_clicks')
        .select('id, destination_id, click_id')
        .eq('rotator_id', rotatorId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const c of data || []) destinoDoClique.set(c.click_id, c.destination_id);
      if (!data || data.length < PAGE) break;
    }

    const ids = Array.from(destinoDoClique.keys());
    const out: EventoDoRotador[] = [];
    const LOTE = 150;
    for (let i = 0; i < ids.length; i += LOTE) {
      const { data, error } = await (supabase as any)
        .from('rotator_events')
        .select('*')
        .in('click_id', ids.slice(i, i + LOTE));
      if (error) throw error;
      for (const e of data || []) {
        out.push({ ...e, destination_id: destinoDoClique.get(e.click_id) ?? '' });
      }
    }
    return out;
  },

  /**
   * Linhas por variação + totais do teste inteiro. Os totais (compras,
   * receita, conversão) somam as vendas sem versão que não estão atribuídas;
   * as linhas por variação não mudam. Se a tabela de vendas sem versão ainda
   * não existir no banco, os totais ficam só com as atribuídas.
   */
  async getTotalStats(rotatorId: string): Promise<{ stats: RotatorStats[]; totals: TotaisDoTeste }> {
    const [{ stats, eventos }, vendas] = await Promise.all([
      this.getStatsComEventos(rotatorId),
      this.getVendasSemVersao(rotatorId).catch(() => [] as VendaSemVersao[]),
    ]);
    const sem = resumirSemVersao(vendas, pedidosAtribuidos(eventos));
    return { stats, totals: totaisComSemVersao(totaisDosResultados(stats), sem) };
  },

  /** Vendas sem versão do teste (view com a flag "atribuida"), da mais recente para a mais antiga. */
  async getVendasSemVersao(rotatorId: string): Promise<VendaSemVersao[]> {
    const { data, error } = await (supabase as any)
      .from('rotator_vendas_sem_versao_painel')
      .select('id, rotator_link_id, order_id, value, sold_at, source, note, atribuida')
      .eq('rotator_link_id', rotatorId)
      .order('sold_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    return data || [];
  },

  async addVendaSemVersao(
    rotatorId: string,
    venda: { order_id: string; value: number; sold_at: string; note?: string | null },
  ): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_vendas_sem_versao')
      .insert({
        rotator_link_id: rotatorId,
        order_id: venda.order_id.trim(),
        value: venda.value,
        sold_at: venda.sold_at,
        source: 'manual-painel',
        note: venda.note?.trim() || null,
      });
    if (error) {
      if (error.code === '23505') throw new Error(`O pedido ${venda.order_id.trim()} já está cadastrado.`);
      throw error;
    }
  },

  async removeVendaSemVersao(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('rotator_vendas_sem_versao')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * Conexão e velocidade por variação (beacon das páginas). Contagem de
   * cliques por HEAD (sem teto de linhas) e beacons paginados de 1000 em 1000.
   */
  async getPageMetrics(rotatorId: string): Promise<MetricaDaVariacao[]> {
    const destinations = await this.getDestinations(rotatorId);

    const counts = await Promise.all(
      destinations.map(async (d) => {
        const { count, error } = await (supabase as any)
          .from('rotator_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('destination_id', d.id);
        if (error) throw error;
        return [d.id, count ?? 0] as const;
      }),
    );

    const beacons: BeaconDoRotador[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 200_000; from += PAGE) {
      const { data, error } = await (supabase as any)
        .from('rotator_page_beacons')
        .select('destination_id, cm_click, kind, nav, ttfb_ms, render_ms, lcp_ms, created_at')
        .eq('rotator_id', rotatorId)
        .order('beacon_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      beacons.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    return calcularMetricasPorVariacao(destinations, Object.fromEntries(counts), beacons);
  },

  getRedirectUrl(slug: string): string {
    return `${window.location.origin}/r/${slug}`;
  },

  getTrackingPixelSnippet(slug: string): string {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const baseUrl = `https://${projectId}.supabase.co/functions/v1/rotator-track`;
    return `<!-- BXMetrics Tracking Pixel -->
<script>
(function(){
  var STORAGE_KEY = 'cm_click_id';
  var COOKIE_NAME = 'cm_click';

  // Detecta domínio raiz (ex.: .brenoxavier.com.br) para compartilhar entre subdomínios
  function rootDomain(){
    var host = location.hostname;
    if (/^[0-9.]+$/.test(host) || host === 'localhost') return null;
    var parts = host.split('.');
    if (parts.length <= 2) return '.' + host;
    return '.' + parts.slice(-2).join('.');
  }
  function setCookie(name, value){
    var d = rootDomain();
    var base = name + '=' + encodeURIComponent(value) + '; Max-Age=' + (60*60*24*90) + '; Path=/; SameSite=Lax';
    if (location.protocol === 'https:') base += '; Secure';
    try { document.cookie = base + (d ? '; Domain=' + d : ''); } catch(e){}
    try { document.cookie = base; } catch(e){}
  }
  function getCookie(name){
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  var params = new URLSearchParams(window.location.search);
  var clickId = params.get('cm_click');
  try {
    if (clickId) {
      localStorage.setItem(STORAGE_KEY, clickId);
      setCookie(COOKIE_NAME, clickId);
    } else {
      clickId = getCookie(COOKIE_NAME) || localStorage.getItem(STORAGE_KEY);
      if (clickId) {
        try { localStorage.setItem(STORAGE_KEY, clickId); } catch(e){}
        setCookie(COOKIE_NAME, clickId);
      }
    }
  } catch(e){}
  if (!clickId) return;
  window.CM_CLICK_ID = clickId;
  function send(eventType, value){
    try {
      fetch('${baseUrl}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ click_id: clickId, event_type: eventType, value: value || 0, page_url: window.location.href })
      });
    } catch(e){}
  }
  window.cmTrack = send;
  // Auto pageview — usado pela regra de conversão por URL (ex.: URL contém "agendar")
  send('pageview');
})();
</script>

<!-- Manual: checkout page -->
<!-- <script>cmTrack('checkout');</script> -->

<!-- Manual: thank-you page with purchase value -->
<!-- <script>cmTrack('purchase', 97.00);</script> -->`;
  },
};
