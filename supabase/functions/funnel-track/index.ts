import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const urlObj = new URL(req.url);
    const method = req.method;
    
    // Extract basic info depending on request type
    let token, event_type;
    
    if (method === 'GET') {
      token = urlObj.searchParams.get('token');
      event_type = urlObj.searchParams.get('event_type');
    } else {
      // POST requests will be parsed later, but we need a peek or just read the whole thing now
      // Actually, since Request body can only be read once, let's clone or read it all now.
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // We need to parse body for POST right here to get the token
    let payload: any = {};
    if (method === 'POST') {
      payload = await req.json();
      token = payload.token;
      event_type = payload.event_type;
    }

    if (event_type === 'click' && method === 'GET') {
      const targetUrls = urlObj.searchParams.get('urls')?.split(',') || [];
      
      if (targetUrls.length === 0) {
        return new Response('No URLs provided', { status: 400 });
      }

      let randomUrl = targetUrls[0];
      
      const weightsStr = urlObj.searchParams.get('weights');
      if (weightsStr) {
        const weights = weightsStr.split(',').map(Number);
        if (weights.length === targetUrls.length) {
          // Weighted randomization
          const rand = Math.random() * 100;
          let cumulative = 0;
          for (let i = 0; i < weights.length; i++) {
            cumulative += weights[i];
            if (rand <= cumulative) {
              randomUrl = targetUrls[i];
              break;
            }
          }
        } else {
          // Fallback to even random
          randomUrl = targetUrls[Math.floor(Math.random() * targetUrls.length)];
        }
      } else {
        // Legacy fallback
        randomUrl = targetUrls[Math.floor(Math.random() * targetUrls.length)];
      }

      if (!randomUrl.startsWith('http://') && !randomUrl.startsWith('https://')) {
        randomUrl = 'https://' + randomUrl;
      }

      const clickId = crypto.randomUUID();
      
      const finalUrl = new URL(randomUrl);
      finalUrl.searchParams.set('bx_click', clickId);
      finalUrl.searchParams.set('utm_source', urlObj.searchParams.get('utm_source') || '');
      finalUrl.searchParams.set('utm_medium', urlObj.searchParams.get('utm_medium') || '');
      finalUrl.searchParams.set('utm_campaign', urlObj.searchParams.get('utm_campaign') || '');
      finalUrl.searchParams.set('utm_content', urlObj.searchParams.get('utm_content') || '');
      
      return Response.redirect(finalUrl.toString(), 302);
    }

    // Get the profile ID from the token (Only needed for POST tracking)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tracking_token', token)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid tracking token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normal Tracking Flow (POST from track.js)
    const sessionId = payload.session_id;
    const pageUrl = payload.url;
    const ref = payload.referrer;
    const utmSrc = payload.utm_source;
    const utmMed = payload.utm_medium;
    const utmCmp = payload.utm_campaign;
    const utmCnt = payload.utm_content;
    const utmTrm = payload.utm_term;
    const fbCid = payload.fbclid;
    const bxClick = payload.bx_click;
    const val = payload.value;
    const emailStr = payload.email;
    const phoneStr = payload.phone;

    if (event_type === 'page_view') {
      const { error } = await supabase.from('page_views').insert({
        profile_id: profile.id,
        session_id: sessionId,
        url: pageUrl,
        referrer: ref,
        utm_source: utmSrc,
        utm_medium: utmMed,
        utm_campaign: utmCmp,
        utm_content: utmCnt,
        utm_term: utmTrm,
        fbclid: fbCid
      });

      if (error) throw error;
    } else if (event_type?.toLowerCase() === 'lead') {
       // Save to leads_tracking
       const { error } = await supabase.from('leads_tracking').insert({
         profile_id: profile.id,
         click_id: bxClick || sessionId,
         email: emailStr || null,
         phone: phoneStr || null,
         utm_campaign: utmCmp,
         utm_content: utmCnt,
         utm_medium: utmMed,
         utm_source: utmSrc,
         page_url: pageUrl
       });
       
       if (error) throw error;
    } else {
      const { error } = await supabase.from('tracking_events').insert({
        profile_id: profile.id,
        session_id: sessionId,
        event_name: event_type,
        page_url: pageUrl,
        value: val || 0
      });

      if (error) throw error;
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Funnel Track Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
