// Edge Function: gateway-webhook
// Recebe callbacks da InfinitePay e VALIDA via /payment_check antes de marcar como pago.
// Sempre responde 200 OK em < 1s para não dar pistas a atacantes e evitar retries indevidos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HANDLE = Deno.env.get("INFINITEPAY_HANDLE") ?? "";
const BASE_URL = (Deno.env.get("INFINITEPAY_BASE_URL") ?? "https://api.checkout.infinitepay.io").replace(/\/$/, "");

const OK = () => new Response(JSON.stringify({ received: true }), {
  status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function fetchWithTimeout(url: string, init: RequestInit, ms = 800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let payload: any = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const transaction_nsu = payload.transaction_nsu ?? null;
  const order_nsu = payload.order_nsu ?? null;
  const invoice_slug = payload.invoice_slug ?? payload.slug ?? null;

  console.log("[gateway-webhook] recebido:", JSON.stringify({ transaction_nsu, order_nsu, invoice_slug }));

  // Log do payload bruto (sempre)
  const logBase = {
    payload, transaction_nsu, order_nsu,
    validation_result: "pending",
    notes: null as string | null,
  };

  // Sem dados mínimos → suspeito
  if (!transaction_nsu || !order_nsu) {
    await supabase.from("gateway_webhook_logs").insert({
      ...logBase, validation_result: "suspicious", notes: "payload sem transaction_nsu/order_nsu",
    });
    return OK();
  }

  // Idempotência: já marcamos esse transaction_nsu como pago?
  const { data: existing } = await supabase
    .from("gateway_transacoes")
    .select("id, status")
    .eq("transaction_nsu", transaction_nsu)
    .maybeSingle();

  if (existing?.status === "pago") {
    await supabase.from("gateway_webhook_logs").insert({
      ...logBase, validation_result: "duplicate", notes: "transaction_nsu já processado",
    });
    return OK();
  }

  // Validação dupla obrigatória — chama /payment_check
  let checkResp: any = null;
  let checkStatus = 0;
  try {
    const r = await fetchWithTimeout(`${BASE_URL}/payment_check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: HANDLE, order_nsu, transaction_nsu, slug: invoice_slug }),
    }, 800);
    checkStatus = r.status;
    checkResp = await r.json().catch(() => ({}));
  } catch (e) {
    console.error("[gateway-webhook] /payment_check erro:", e);
    await supabase.from("gateway_webhook_logs").insert({
      ...logBase, validation_result: "error", notes: `payment_check falhou: ${String(e)}`,
    });
    return OK();
  }

  if (checkStatus < 200 || checkStatus >= 300 || !checkResp?.paid) {
    await supabase.from("gateway_webhook_logs").insert({
      ...logBase, validation_result: "suspicious",
      notes: `payment_check status=${checkStatus} paid=${checkResp?.paid}`,
    });
    return OK();
  }

  // Confirmado → atualiza transação (match por order_nsu)
  const paidAmount = checkResp.paid_amount != null
    ? Number(checkResp.paid_amount) / 100
    : (payload.paid_amount != null ? Number(payload.paid_amount) / 100 : null);

  const { error: updErr } = await supabase
    .from("gateway_transacoes")
    .update({
      status: "pago",
      transaction_nsu,
      invoice_slug,
      receipt_url: payload.receipt_url ?? null,
      capture_method: checkResp.capture_method ?? payload.capture_method ?? null,
      paid_amount: paidAmount,
      pago_em: new Date().toISOString(),
    })
    .eq("order_nsu", order_nsu);

  if (updErr) {
    console.error("[gateway-webhook] update falhou:", updErr);
    await supabase.from("gateway_webhook_logs").insert({
      ...logBase, validation_result: "error", notes: `update falhou: ${updErr.message}`,
    });
    return OK();
  }

  await supabase.from("gateway_webhook_logs").insert({
    ...logBase, validation_result: "confirmed", notes: "pagamento confirmado",
  });

  return OK();
});
