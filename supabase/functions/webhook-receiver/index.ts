import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { registrarCompraDoRotador } from './rotatorVenda.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const approvedPagTrustStatuses = new Set([
  'approved',
  'aprovado',
  'paid',
  'pago',
  'completed',
  'completo',
  'confirmed',
  'confirmado',
  'purchase_approved',
]);

const refundStatuses = new Set([
  'refunded',
  'reembolsado',
  'refund',
  'reembolso',
  'chargeback',
  'purchase_refunded',
  'purchase_chargeback',
]);

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.includes(',')
      ? value.replace(/\./g, '').replace(',', '.')
      : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getFirstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = parseNumericValue(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return 0;
}

function isPagTrustPayload(payload: any): boolean {
  return Boolean(
    payload.orderId ||
    payload.creation_date ||
    payload.version === '2.0.0' ||
    payload.data?.commissions ||
    payload.data?.purchase?.full_price?.value ||
    payload.data?.purchase?.status
  );
}

function getPagTrustStatus(payload: any): string {
  return String(
    payload.status ??
      payload.transaction?.status ??
      payload.sale?.status ??
      payload.payment?.status ??
      payload.data?.purchase?.status ??
      payload.event ??
      ''
  ).toLowerCase();
}

function getPagTrustGrossValue(payload: any): number {
  return getFirstNumber(
    payload.value,
    payload.amount,
    payload.sale?.value,
    payload.sale?.amount,
    payload.sale?.total,
    payload.transaction?.value,
    payload.transaction?.amount,
    payload.transaction?.total,
    payload.payment?.value,
    payload.payment?.amount,
    payload.purchase?.value,
    payload.purchase?.amount,
    payload.data?.purchase?.full_price?.value,
    payload.data?.purchase?.original_offer_price?.value,
    payload.data?.purchase?.price?.value,
    payload.price,
    payload.total,
  );
}

function getPagTrustNetValue(payload: any): number {
  const producerCommission = Array.isArray(payload.data?.commissions)
    ? payload.data.commissions.find(
        (commission: any) => String(commission?.source ?? '').toUpperCase() === 'PRODUCER'
      )?.value
    : undefined;

  return getFirstNumber(
    payload.net_value,
    payload.liquid_value,
    payload.net_amount,
    payload.liquid_amount,
    payload.sale?.net_value,
    payload.sale?.liquid_value,
    payload.sale?.net_amount,
    payload.transaction?.net_value,
    payload.transaction?.liquid_value,
    payload.payment?.net_value,
    payload.payment?.liquid_value,
    payload.purchase?.net_value,
    payload.commission_value,
    payload.seller_value,
    payload.seller_amount,
    producerCommission,
    payload.data?.purchase?.price?.price,
    payload.data?.purchase?.price?.value,
  );
}

function parseEventDate(rawDate: string | number | null | undefined): Date | null {
  if (!rawDate) {
    return null;
  }

  const parsedDate = typeof rawDate === 'number'
    ? new Date(rawDate)
    : new Date(rawDate);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getEventDate(payload: any): Date {
  const rawDate =
    payload.date ??
    payload.created_at ??
    payload.sale?.date ??
    payload.sale?.created_at ??
    payload.transaction?.date ??
    payload.transaction?.created_at ??
    payload.payment?.date ??
    payload.purchase?.date ??
    payload.purchase?.approved_date ??
    payload.data?.purchase?.approved_date ??
    payload.data?.purchase?.order_date ??
    payload.creation_date ??
    null;

  return parseEventDate(rawDate) ?? new Date();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const urlObj = new URL(req.url);
    const token = urlObj.searchParams.get('token');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing token in URL params' }), { status: 400, headers: corsHeaders });
    }

    const payloadText = await req.text();
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400, headers: corsHeaders });
    }

    let email = null;
    let phone = null;
    let value = 0;
    let netValue = 0;
    let platform = 'DESCONHECIDO';
    let status = '';

    if (isPagTrustPayload(payload)) {
      platform = 'PAGTRUST';
      status = getPagTrustStatus(payload);

      email = payload.data?.buyer?.email || payload.customer?.email || payload.cliente?.email || payload.email || null;
      phone = payload.data?.buyer?.checkout_full_phone || payload.data?.buyer?.checkout_phone || payload.customer?.phone || payload.cliente?.telefone || payload.phone || null;
      value = getPagTrustGrossValue(payload);
      netValue = getPagTrustNetValue(payload);
    }
    // === HOTMART DETECT ===
    else if (payload.hottok || payload.event === 'PURCHASE_APPROVED' || payload.event === 'APPROVED' || payload.status === 'approved') {
      platform = 'HOTMART';
      status = payload.event || payload.status;

      email = payload.data?.buyer?.email || payload.buyer?.email || payload.email || null;
      value = getFirstNumber(payload.data?.purchase?.price?.value, payload.purchase?.price?.value, payload.price);
      netValue = value;
    }
    // === KIWIFY DETECT ===
    else if (payload.webhook_event_type || payload.order_status) {
      platform = 'KIWIFY';
      status = payload.order_status || payload.webhook_event_type;

      email = payload.Customer?.email || payload.customer?.email || null;
      phone = payload.Customer?.mobile || payload.customer?.mobile || null;

      value = getFirstNumber(payload.Commissions?.charge_amount, payload.order_amount, payload.amount);
      netValue = getFirstNumber(payload.Commissions?.my_commission, value);
    }

    console.log(`[WEBHOOK] Received from ${platform}. Status: ${status}. Email: ${email}. Value: ${value}. Net: ${netValue}`);

    const isApprovedHotmart = platform === 'HOTMART' && ['PURCHASE_APPROVED', 'APPROVED', 'approved'].includes(status);
    const isApprovedKiwify = platform === 'KIWIFY' && status === 'paid';
    const isApprovedPagtrust = platform === 'PAGTRUST' && approvedPagTrustStatuses.has(status);
    const isApproved = isApprovedHotmart || isApprovedKiwify || isApprovedPagtrust;
    const isRefund = refundStatuses.has(status);

    if (!isApproved && !isRefund) {
      return new Response(JSON.stringify({ message: `Ignored status ${status} from ${platform}` }), { headers: corsHeaders });
    }

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: 'No identification found (email/phone) in approved purchase' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('tracking_token', token)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: 'Invalid tracking token' }), { status: 401, headers: corsHeaders });
    }

    let leadMatch = null;

    if (email) {
      const { data: leadsByEmail } = await supabase
        .from('leads_tracking')
        .select('id, utm_campaign, created_at')
        .eq('profile_id', profile.id)
        .ilike('email', email)
        .order('created_at', { ascending: false })
        .limit(1);

      if (leadsByEmail && leadsByEmail.length > 0) leadMatch = leadsByEmail[0];
    }

    if (!leadMatch && phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length > 6) {
        const { data: leadsByPhone } = await supabase
          .from('leads_tracking')
          .select('id, utm_campaign, created_at')
          .eq('profile_id', profile.id)
          .ilike('phone', `%${cleanPhone}%`)
          .order('created_at', { ascending: false })
          .limit(1);

        if (leadsByPhone && leadsByPhone.length > 0) leadMatch = leadsByPhone[0];
      }
    }

    const { error: insertError } = await supabase.from('sales_events').insert({
      profile_id: profile.id,
      lead_id: leadMatch ? leadMatch.id : null,
      value: Number(value),
      source: platform,
      customer_email: email,
      customer_phone: phone
    });

    if (insertError) throw insertError;

    console.log(`[WEBHOOK] Sale recorded. Source: ${platform}. Value: ${value}. Net: ${netValue}. Matched Lead: ${leadMatch ? 'YES' : 'NO'}`);

    // Teste de página: venda com marcador do rotador vira 'purchase' da variação. Nunca lança.
    if (isApproved) {
      const rotador = await registrarCompraDoRotador(supabase, payload, Number(value));
      console.log(`[rotator] ${JSON.stringify(rotador)}`);
    }

    // Low-ticket consultations are NOT auto-created here.
    // Leads must go through the full flow: form → qualification → /agendar → book.

    try {
      const eventDate = getEventDate(payload);
      eventDate.setHours(eventDate.getHours() - 3);

      const ptBRMonthMap: Record<number, string> = {
        0: 'Jan', 1: 'Fev', 2: 'Mar', 3: 'Abr', 4: 'Mai', 5: 'Jun',
        6: 'Jul', 7: 'Ago', 8: 'Set', 9: 'Out', 10: 'Nov', 11: 'Dez',
      };
      const monthStr = ptBRMonthMap[eventDate.getMonth()];
      const yearStr = eventDate.getFullYear().toString().slice(2);
      const currentMonthKey = `${monthStr}/${yearStr}`;

      const effectiveValue = isRefund ? -Number(value) : Number(value);
      const effectiveNet = isRefund ? -Number(netValue || value) : Number(netValue || value);

      const { data: existingMonth, error: fetchErr } = await supabase
        .from('monthly_data')
        .select('faturamento, comissao')
        .eq('month', currentMonthKey)
        .single();

      if (fetchErr && fetchErr.code === 'PGRST116') {
        const { error: insertMonthError } = await supabase.from('monthly_data').insert({
          month: currentMonthKey,
          faturamento: Math.max(0, effectiveValue),
          comissao: Math.max(0, effectiveNet),
        });

        if (insertMonthError) throw insertMonthError;
        console.log(`[WEBHOOK] Created new monthly_data for ${currentMonthKey} with faturamento=${effectiveValue}, comissao=${effectiveNet}`);
      } else if (fetchErr) {
        throw fetchErr;
      } else if (existingMonth) {
        const newTotal = Math.max(0, Number(existingMonth.faturamento) + effectiveValue);
        const newComissao = Math.max(0, Number(existingMonth.comissao) + effectiveNet);

        const { error: updateMonthError } = await supabase.from('monthly_data')
          .update({
            faturamento: newTotal,
            comissao: newComissao,
            updated_at: new Date().toISOString(),
          })
          .eq('month', currentMonthKey);

        if (updateMonthError) throw updateMonthError;
        console.log(`[WEBHOOK] Updated monthly_data for ${currentMonthKey}: faturamento=${newTotal}, comissao=${newComissao}`);
      }
    } catch (e) {
      console.error('[WEBHOOK] Error updating monthly_data:', e);
    }

    return new Response(
      JSON.stringify({ success: true, matched_lead: !!leadMatch, platform, value, netValue }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});