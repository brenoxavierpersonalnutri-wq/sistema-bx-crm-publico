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
  "approved", "aprovado", "paid", "pago", "completed", "completo",
  "confirmed", "confirmado", "purchase_approved",
]);

const refundStatuses = new Set([
  "refunded", "reembolsado", "refund", "reembolso", "chargeback",
  "purchase_refunded", "purchase_chargeback",
]);

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getFirstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = parseNumericValue(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function getStatus(payload: any): string {
  return String(
    payload.status ?? payload.transaction?.status ?? payload.sale?.status ??
    payload.payment?.status ?? payload.data?.purchase?.status ?? payload.event ?? ""
  ).toLowerCase();
}

function getGrossValue(payload: any): number {
  return getFirstNumber(
    payload.value, payload.amount,
    payload.sale?.value, payload.sale?.amount, payload.sale?.total,
    payload.transaction?.value, payload.transaction?.amount, payload.transaction?.total,
    payload.payment?.value, payload.payment?.amount,
    payload.purchase?.value, payload.purchase?.amount,
    payload.data?.purchase?.full_price?.value,
    payload.data?.purchase?.original_offer_price?.value,
    payload.data?.purchase?.price?.value,
    payload.price, payload.total,
  );
}

function getNetValue(payload: any): number {
  const producerCommission = Array.isArray(payload.data?.commissions)
    ? payload.data.commissions.find(
        (c: any) => String(c?.source ?? "").toUpperCase() === "PRODUCER"
      )?.value
    : undefined;
  return getFirstNumber(
    payload.net_value, payload.liquid_value, payload.net_amount, payload.liquid_amount,
    payload.sale?.net_value, payload.sale?.liquid_value, payload.sale?.net_amount,
    payload.transaction?.net_value, payload.transaction?.liquid_value,
    payload.payment?.net_value, payload.payment?.liquid_value,
    payload.purchase?.net_value, payload.commission_value,
    payload.seller_value, payload.seller_amount,
    producerCommission,
    payload.data?.purchase?.price?.price,
    payload.data?.purchase?.price?.value,
  );
}

function getEventDate(payload: any): Date {
  const raw = payload.date ?? payload.created_at ?? payload.sale?.date ??
    payload.sale?.created_at ?? payload.transaction?.date ?? payload.transaction?.created_at ??
    payload.payment?.date ?? payload.purchase?.date ??
    payload.data?.purchase?.approved_date ?? payload.data?.purchase?.order_date ??
    payload.creation_date ?? null;
  if (!raw) return new Date();
  const d = typeof raw === "number" ? new Date(raw) : new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function getCustomer(payload: any): { email: string | null; phone: string | null } {
  const email = payload.customer?.email ?? payload.buyer?.email ?? payload.data?.buyer?.email ?? payload.email ?? null;
  const phone = payload.customer?.phone ?? payload.buyer?.phone ?? payload.data?.buyer?.checkout_phone ?? payload.phone ?? null;
  return { email: email ? String(email) : null, phone: phone ? String(phone) : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const payload = await req.json();
    console.log("PagTrust-2 webhook received:", JSON.stringify(payload));

    const status = getStatus(payload);
    const isApproved = approvedStatuses.has(status);
    const isRefund = refundStatuses.has(status);

    if (!isApproved && !isRefund) {
      return new Response(JSON.stringify({ success: true, message: "Status ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const grossValue = getGrossValue(payload);
    const netValue = getNetValue(payload);

    if (grossValue <= 0) {
      return new Response(JSON.stringify({ success: true, message: "No value" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const saleDate = getEventDate(payload);
    saleDate.setHours(saleDate.getHours() - 3);
    const monthNum = saleDate.getMonth() + 1;
    const year = saleDate.getFullYear().toString().slice(2);
    const monthKey = `${monthNames[monthNum]}/${year}`;

    const effectiveGross = isRefund ? -grossValue : grossValue;
    const effectiveNet = isRefund ? -(netValue || grossValue) : (netValue || grossValue);

    // Insert sales event tagged with PAGTRUST_2 source
    const { email, phone } = getCustomer(payload);
    if (!isRefund) {
      // Find any approved profile to attach
      const { data: anyProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("approved", true)
        .limit(1)
        .maybeSingle();

      if (anyProfile) {
        await supabase.from("sales_events").insert({
          profile_id: anyProfile.id,
          source: "PAGTRUST_2",
          value: grossValue,
          customer_email: email,
          customer_phone: phone,
          created_at: saleDate.toISOString(),
        });
      }

      // Teste de página: venda com marcador do rotador vira 'purchase' da variação. Nunca lança.
      const rotador = await registrarCompraDoRotador(supabase, payload, grossValue);
      console.log(`[rotator] ${JSON.stringify(rotador)}`);
    }

    // Update monthly_data totals
    const { data: existing, error: fetchError } = await supabase
      .from("monthly_data")
      .select("faturamento, comissao")
      .eq("month", monthKey)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      return new Response(JSON.stringify({ success: false, error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!existing) {
      await supabase.from("monthly_data").insert({
        month: monthKey,
        faturamento: Math.max(0, effectiveGross),
        comissao: Math.max(0, effectiveNet),
      });
    } else {
      const newFat = Math.max(0, (Number(existing.faturamento) || 0) + effectiveGross);
      const newCom = Math.max(0, (Number(existing.comissao) || 0) + effectiveNet);
      await supabase
        .from("monthly_data")
        .update({ faturamento: newFat, comissao: newCom, updated_at: new Date().toISOString() })
        .eq("month", monthKey);
    }

    return new Response(JSON.stringify({ success: true, month: monthKey, grossValue, netValue, status, source: "PAGTRUST_2" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pagtrust-webhook-2 error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
