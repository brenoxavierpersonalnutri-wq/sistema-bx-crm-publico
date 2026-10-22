const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const META_API_BASE = 'https://graph.facebook.com/v22.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawAccessToken = Deno.env.get('META_ACCESS_TOKEN');
    const accessToken = rawAccessToken
      ?.trim()
      .replace(/^Bearer\s+/i, '')
      .replace(/^['"]|['"]$/g, '');

    if (!accessToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'META_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const adAccountId = body.adAccountId || Deno.env.get('META_AD_ACCOUNT_ID');
    const { action, dateFrom, dateTo } = body;

    if (!adAccountId) {
      return new Response(
        JSON.stringify({ success: false, error: 'adAccountId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    // Build URL manually to avoid encoding issues with Meta field expansion syntax
    const fetchMetaRaw = async (path: string, fieldsStr: string, extraParams: Record<string, string> = {}) => {
      let url = `${META_API_BASE}/${path}?fields=${fieldsStr}&access_token=${accessToken}`;
      for (const [key, value] of Object.entries(extraParams)) {
        url += `&${key}=${encodeURIComponent(value)}`;
      }
      const response = await fetch(url);
      return response.json();
    };

    // Fetch ALL pages from Meta API (handles pagination)
    const fetchAllPages = async (path: string, fieldsStr: string, extraParams: Record<string, string> = {}) => {
      let url = `${META_API_BASE}/${path}?fields=${fieldsStr}&access_token=${accessToken}`;
      for (const [key, value] of Object.entries(extraParams)) {
        url += `&${key}=${encodeURIComponent(value)}`;
      }
      
      let allData: any[] = [];
      let nextUrl: string | null = url;
      let pageCount = 0;
      const MAX_PAGES = 20;

      while (nextUrl && pageCount < MAX_PAGES) {
        const response = await fetch(nextUrl);
        const json = await response.json();
        
        if (json.error) {
          return { error: json.error, data: allData };
        }
        
        if (json.data) {
          allData = allData.concat(json.data);
        }
        
        nextUrl = json.paging?.next || null;
        pageCount++;
      }
      
      console.log(`Fetched ${allData.length} items in ${pageCount} page(s) for ${path}`);
      return { data: allData };
    };

    // For nested insights field expansion, embed the time_range directly in the syntax
    // This avoids URL encoding breaking the {}/() chars
    let insightsTimeFilter = '';
    if (dateFrom && dateTo) {
      insightsTimeFilter = `.time_range({"since":"${dateFrom}","until":"${dateTo}"})`;
    } else {
      insightsTimeFilter = `.date_preset(last_30d)`;
    }

    // For top-level insights endpoint (account_insights), use regular query params
    const dateParams: Record<string, string> = {};
    if (dateFrom && dateTo) {
      dateParams.time_range = JSON.stringify({ since: dateFrom, until: dateTo });
    } else {
      dateParams.date_preset = 'last_30d';
    }

    if (action === 'campaigns') {
      const fields = `id,name,status,objective,daily_budget,lifetime_budget,insights${insightsTimeFilter}{impressions,clicks,spend,actions,ctr,cpc,cpp,reach,frequency}`;
      const campaigns = await fetchAllPages(`${accountId}/campaigns`, fields, { limit: '25' });
      if (campaigns.error) {
        return new Response(JSON.stringify({ success: false, error: campaigns.error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: campaigns.data || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'adsets') {
      const fields = `id,name,status,campaign_id,daily_budget,insights${insightsTimeFilter}{impressions,clicks,spend,actions,ctr,cpc,reach}`;
      const adsets = await fetchAllPages(`${accountId}/adsets`, fields, { limit: '25' });
      if (adsets.error) {
        return new Response(JSON.stringify({ success: false, error: adsets.error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: adsets.data || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'ads') {
      const fields = `id,name,status,campaign_id,creative{thumbnail_url},insights${insightsTimeFilter}{impressions,clicks,spend,actions,ctr,cpc,reach}`;
      const ads = await fetchAllPages(`${accountId}/ads`, fields, { limit: '25' });
      if (ads.error) {
        return new Response(JSON.stringify({ success: false, error: ads.error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: ads.data || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'account_insights') {
      // Account insights with time_increment uses standard URL params (no field expansion)
      // Need pagination for daily breakdowns spanning long periods
      let insightsUrl = `${META_API_BASE}/${accountId}/insights?fields=impressions,clicks,spend,actions,ctr,cpc,cpp,reach,frequency&time_increment=1&access_token=${accessToken}`;
      if (dateFrom && dateTo) {
        insightsUrl += `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}`;
      } else {
        insightsUrl += `&date_preset=last_30d`;
      }
      
      let allInsights: any[] = [];
      let nextUrl: string | null = insightsUrl;
      let pageCount = 0;
      while (nextUrl && pageCount < 20) {
        const response = await fetch(nextUrl);
        const json = await response.json();
        if (json.error) {
          return new Response(JSON.stringify({ success: false, error: json.error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (json.data) allInsights = allInsights.concat(json.data);
        nextUrl = json.paging?.next || null;
        pageCount++;
      }
      console.log(`Fetched ${allInsights.length} insight rows in ${pageCount} page(s)`);
      return new Response(JSON.stringify({ success: true, data: allInsights }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
