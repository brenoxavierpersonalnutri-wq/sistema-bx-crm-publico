import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let slug: string | null = null;
    let isJsonRequest = false;

    const url = new URL(req.url);
    slug = url.searchParams.get('slug');

    if (!slug && req.method === 'POST') {
      try {
        const body = await req.json();
        slug = body.slug;
        isJsonRequest = true;
      } catch {}
    }

    if (!slug) {
      return new Response(JSON.stringify({ error: 'slug is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: rotator, error: rotatorErr } = await supabase
      .from('rotator_links')
      .select('id')
      .eq('slug', slug)
      .single();

    if (rotatorErr || !rotator) {
      return new Response(JSON.stringify({ error: 'Rotador não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: destinations } = await supabase
      .from('rotator_destinations')
      .select('id, url, weight')
      .eq('rotator_id', rotator.id);

    if (!destinations || destinations.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum destino configurado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const totalWeight = destinations.reduce((sum: number, d: any) => sum + d.weight, 0);
    let rand = Math.random() * totalWeight;
    let selected = destinations[0];
    for (const dest of destinations) {
      rand -= dest.weight;
      if (rand <= 0) {
        selected = dest;
        break;
      }
    }

    const clickId = crypto.randomUUID();

    await supabase.from('rotator_clicks').insert({
      rotator_id: rotator.id,
      destination_id: selected.id,
      click_id: clickId,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '',
      user_agent: req.headers.get('user-agent') || '',
      referer: req.headers.get('referer') || '',
    });

    const destUrl = new URL(selected.url);
    destUrl.searchParams.set('cm_click', clickId);
    const redirectUrl = destUrl.toString();

    if (isJsonRequest) {
      return new Response(JSON.stringify({ redirect_url: redirectUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, 'Location': redirectUrl },
    });
  } catch (error) {
    console.error('Redirect error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
