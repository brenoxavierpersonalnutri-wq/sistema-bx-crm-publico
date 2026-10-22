import { supabase } from '@/integrations/supabase/client';

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  insights?: {
    data: Array<{
      impressions: string;
      clicks: string;
      spend: string;
      ctr: string;
      cpc: string;
      reach: string;
      frequency: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
  };
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  creative?: {
    id: string;
    name: string;
    thumbnail_url: string;
  };
  insights?: {
    data: Array<{
      impressions: string;
      clicks: string;
      spend: string;
      ctr: string;
      cpc: string;
      reach: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
  };
}

export interface MetaDayInsight {
  date_start: string;
  date_stop: string;
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
  reach: string;
  actions?: Array<{ action_type: string; value: string }>;
}

type MetaResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const META_CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min
const RATE_LIMIT_CACHE_TTL = 3 * 60 * 1000; // cache rate-limit failures for 3 min

const callMetaApi = async <T>(adAccountId: string, action: string, dateFrom?: string, dateTo?: string): Promise<MetaResponse<T>> => {
  const cacheKey = `${adAccountId}:${action}:${dateFrom}:${dateTo}`;
  const cached = META_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as MetaResponse<T>;
  }

  const { data, error } = await supabase.functions.invoke('meta-ads', {
    body: { adAccountId, action, dateFrom, dateTo },
  });

  if (error) {
    const context = (error as any)?.context;
    let errorMessage = error.message;

    if (context instanceof Response) {
      try {
        const body = await context.json();
        errorMessage = body?.error || error.message;
      } catch {
        errorMessage = error.message;
      }
    } else if (typeof context === 'string') {
      try {
        const parsed = JSON.parse(context);
        errorMessage = parsed?.error || error.message;
      } catch {
        errorMessage = context || error.message;
      }
    }

    // On rate limit, cache the failure to prevent retries
    if (errorMessage.toLowerCase().includes('request limit reached')) {
      console.warn(`Meta API rate limited for ${action}. Will retry in ${RATE_LIMIT_CACHE_TTL / 1000}s.`);
      const failResult: MetaResponse<T> = { success: false, error: 'Rate limit - aguarde alguns minutos' };
      META_CACHE.set(cacheKey, { data: failResult, ts: Date.now() - (CACHE_TTL - RATE_LIMIT_CACHE_TTL) });
      return failResult;
    }

    return { success: false, error: errorMessage };
  }

  const result = data as MetaResponse<T>;
  META_CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
};

export const metaApi = {
  getCampaigns: (adAccountId: string, dateFrom?: string, dateTo?: string) => callMetaApi<MetaCampaign[]>(adAccountId, 'campaigns', dateFrom, dateTo),
  getAdsets: (adAccountId: string, dateFrom?: string, dateTo?: string) => callMetaApi<any[]>(adAccountId, 'adsets', dateFrom, dateTo),
  getAds: (adAccountId: string, dateFrom?: string, dateTo?: string) => callMetaApi<MetaAd[]>(adAccountId, 'ads', dateFrom, dateTo),
  getAccountInsights: (adAccountId: string, dateFrom?: string, dateTo?: string) => callMetaApi<MetaDayInsight[]>(adAccountId, 'account_insights', dateFrom, dateTo),
};

export const getConversions = (actions?: Array<{ action_type: string; value: string }>): number => {
  if (!actions) return 0;
  const convAction = actions.find(
    (a) => a.action_type === 'offsite_conversion.fb_pixel_purchase' || 
           a.action_type === 'purchase' ||
           a.action_type === 'omni_purchase'
  );
  if (convAction) return parseInt(convAction.value);
  const leadAction = actions.find(
    (a) => a.action_type === 'lead' || a.action_type === 'complete_registration'
  );
  return leadAction ? parseInt(leadAction.value) : 0;
};

export const getTotalActions = (actions?: Array<{ action_type: string; value: string }>): number => {
  if (!actions) return 0;
  return actions.reduce((sum, a) => sum + parseInt(a.value), 0);
};
