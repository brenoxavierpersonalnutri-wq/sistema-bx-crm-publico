import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN not configured");

    const WABA_ID = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
    if (!WABA_ID) throw new Error("WHATSAPP_BUSINESS_ACCOUNT_ID not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch {}

    const sinceDate = body.since ? new Date(body.since) : new Date("2026-01-01");
    const untilDate = body.until ? new Date(body.until) : new Date();
    
    const startTs = Math.floor(sinceDate.getTime() / 1000);
    const endTs = Math.floor(untilDate.getTime() / 1000);

    const monthNames: Record<number, string> = {
      0: "Jan", 1: "Fev", 2: "Mar", 3: "Abr", 4: "Mai", 5: "Jun",
      6: "Jul", 7: "Ago", 8: "Set", 9: "Out", 10: "Nov", 11: "Dez",
    };

    const monthlyResults: Record<string, { cost: number; sent: number; received: number }> = {};

    const convUrl = `https://graph.facebook.com/v21.0/${WABA_ID}?fields=conversation_analytics.start(${startTs}).end(${endTs}).granularity(MONTHLY)&access_token=${META_ACCESS_TOKEN}`;
    const convResp = await fetch(convUrl);
    const convData = await convResp.json();

    if (convData.conversation_analytics?.data) {
      for (const entry of convData.conversation_analytics.data) {
        if (entry.data_points) {
          for (const point of entry.data_points) {
            const d = new Date(point.start * 1000);
            const key = `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
            if (!monthlyResults[key]) monthlyResults[key] = { cost: 0, sent: 0, received: 0 };
            monthlyResults[key].cost += point.cost || 0;
            monthlyResults[key].sent += point.conversation || 0;
          }
        }
      }
    }

    const msgUrl = `https://graph.facebook.com/v21.0/${WABA_ID}?fields=analytics.start(${startTs}).end(${endTs}).granularity(MONTHLY)&access_token=${META_ACCESS_TOKEN}`;
    const msgResp = await fetch(msgUrl);
    const msgData = await msgResp.json();

    if (msgData.analytics?.data_points) {
      for (const point of msgData.analytics.data_points) {
        const d = new Date(point.start * 1000);
        const key = `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
        if (!monthlyResults[key]) monthlyResults[key] = { cost: 0, sent: 0, received: 0 };
        monthlyResults[key].sent += point.sent || 0;
        monthlyResults[key].received += point.received || 0;
      }
    }

    for (const [month, stats] of Object.entries(monthlyResults)) {
      await supabase.from("monthly_data").update({
        whatsapp_cost: stats.cost,
        whatsapp_messages_sent: stats.sent,
        whatsapp_messages_received: stats.received,
        updated_at: new Date().toISOString(),
      }).eq("month", month);
    }

    return new Response(JSON.stringify({ success: true, data: monthlyResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-whatsapp-analytics error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
