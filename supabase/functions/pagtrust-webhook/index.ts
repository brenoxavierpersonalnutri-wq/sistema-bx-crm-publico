import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { registrarCompraDoRotador } from "./rotatorVenda.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const monthNames: Record<number, string> = {
  1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
  7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
};

const approvedStatuses = new Set([
  "approved",
  "aprovado",
  "paid",
  "pago",
  "completed",
  "completo",
  "confirmed",
  "confirmado",
  "purchase_approved",
]);

const refundStatuses = new Set([
  "refunded",
  "reembolsado",
  "refund",
  "reembolso",
  "chargeback",
  "purchase_refunded",
  "purchase_chargeback",
]);

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.includes(",")
      ? value.replace(/\./g, "").replace(",", ".")
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

function getPagTrustStatus(payload: any): string {
  return String(
    payload.status ??
      payload.transaction?.status ??
      payload.sale?.status ??
      payload.payment?.status ??
      payload.data?.purchase?.status ??
      payload.event ??
      ""
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
        (commission: any) => String(commission?.source ?? "").toUpperCase() === "PRODUCER"
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

function getPagTrustDate(payload: any): string | number | null {
  return (
    payload.date ??
    payload.created_at ??
    payload.sale?.date ??
    payload.sale?.created_at ??
    payload.transaction?.date ??
    payload.transaction?.created_at ??
    payload.payment?.date ??
    payload.purchase?.date ??
    payload.data?.purchase?.approved_date ??
    payload.data?.purchase?.order_date ??
    payload.creation_date ??
    null
  );
}

function parseEventDate(rawDate: string | number | null): Date | null {
  if (!rawDate) {
    return null;
  }

  const parsedDate = typeof rawDate === "number"
    ? new Date(rawDate)
    : new Date(rawDate);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identifica conta via query param: ?account=3 (default = 1)
    const url = new URL(req.url);
    const accountParam = url.searchParams.get("account") || "1";
    const sourceLabel = accountParam === "1" ? "PAGTRUST" : `PAGTRUST_${accountParam}`;

    const payload = await req.json();
    console.log(`PagTrust webhook received [account=${accountParam}, source=${sourceLabel}]:`, JSON.stringify(payload));

    const status = getPagTrustStatus(payload);
    const isApproved = approvedStatuses.has(status);
    const isRefund = refundStatuses.has(status);

    if (!isApproved && !isRefund) {
      console.log(`Ignoring webhook with status: ${status}`);
      return new Response(JSON.stringify({ success: true, message: "Status ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const grossValue = getPagTrustGrossValue(payload);
    const netValue = getPagTrustNetValue(payload);

    if (grossValue <= 0) {
      console.log("No valid value found in payload");
      return new Response(JSON.stringify({ success: true, message: "No value found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawDate = getPagTrustDate(payload);
    const parsedDate = parseEventDate(rawDate);
    const saleDate = parsedDate ?? new Date();

    // Adjust to Brazil time roughly
    saleDate.setHours(saleDate.getHours() - 3);

    const monthNum = saleDate.getMonth() + 1;
    const year = saleDate.getFullYear().toString().slice(2);
    const monthKey = `${monthNames[monthNum]}/${year}`;

    const effectiveGross = isRefund ? -grossValue : grossValue;
    const effectiveNet = isRefund ? -(netValue || grossValue) : (netValue || grossValue);

    console.log(`Processing ${isRefund ? "refund" : "sale"}: gross=${grossValue}, net=${netValue}, status=${status}, month=${monthKey}`);

    // Registra evento bruto em sales_events para o card de fontes/webhook
    try {
      const { data: anyProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("approved", true)
        .limit(1)
        .single();
      if (anyProfile?.id) {
        await supabase.from("sales_events").insert({
          profile_id: anyProfile.id,
          source: sourceLabel,
          value: effectiveGross,
          customer_email: payload.data?.buyer?.email || payload.customer?.email || null,
          customer_phone: payload.data?.buyer?.checkout_full_phone || payload.customer?.phone || null,
        });
      }
    } catch (e) {
      console.error("Failed to insert sales_events:", e);
    }

    // Teste de página: venda com marcador do rotador vira 'purchase' da variação. Nunca lança.
    if (isApproved) {
      const rotador = await registrarCompraDoRotador(supabase, payload, grossValue);
      console.log(`[rotator] ${JSON.stringify(rotador)}`);
    }

    const { data: existing, error: fetchError } = await supabase
      .from("monthly_data")
      .select("faturamento, comissao")
      .eq("month", monthKey)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        const { error: insertError } = await supabase
          .from("monthly_data")
          .insert({
            month: monthKey,
            faturamento: Math.max(0, effectiveGross),
            comissao: Math.max(0, effectiveNet),
          });

        if (insertError) {
          return new Response(JSON.stringify({ success: false, error: insertError.message }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        return new Response(JSON.stringify({ success: false, error: fetchError.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const newFaturamento = Math.max(0, (Number(existing.faturamento) || 0) + effectiveGross);
      const newComissao = Math.max(0, (Number(existing.comissao) || 0) + effectiveNet);
      const { error: updateError } = await supabase
        .from("monthly_data")
        .update({
          faturamento: newFaturamento,
          comissao: newComissao,
          updated_at: new Date().toISOString()
        })
        .eq("month", monthKey);

      if (updateError) {
        return new Response(JSON.stringify({ success: false, error: updateError.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`Successfully updated ${monthKey}: faturamento=${effectiveGross}, comissao=${effectiveNet}`);
    return new Response(JSON.stringify({ success: true, month: monthKey, grossValue, netValue, status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pagtrust-webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});