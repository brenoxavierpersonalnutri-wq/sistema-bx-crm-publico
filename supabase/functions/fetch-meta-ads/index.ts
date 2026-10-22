const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const monthRanges: Record<string, { since: string; until: string }> = {
  "Jan/26": { since: "2026-01-01", until: "2026-01-31" },
  "Fev/26": { since: "2026-02-01", until: "2026-02-28" },
  "Mar/26": { since: "2026-03-01", until: "2026-03-31" },
  "Abr/26": { since: "2026-04-01", until: "2026-04-30" },
  "Mai/26": { since: "2026-05-01", until: "2026-05-31" },
  "Jun/26": { since: "2026-06-01", until: "2026-06-30" },
  "Jul/26": { since: "2026-07-01", until: "2026-07-31" },
  "Ago/26": { since: "2026-08-01", until: "2026-08-31" },
  "Set/26": { since: "2026-09-01", until: "2026-09-30" },
  "Out/26": { since: "2026-10-01", until: "2026-10-31" },
  "Nov/26": { since: "2026-11-01", until: "2026-11-30" },
  "Dez/26": { since: "2026-12-01", until: "2026-12-31" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN not configured");

    const META_AD_ACCOUNT_ID = Deno.env.get("META_AD_ACCOUNT_ID");
    if (!META_AD_ACCOUNT_ID) throw new Error("META_AD_ACCOUNT_ID not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch {}

    const customSince = body.since;
    const customUntil = body.until;

    const accountId = META_AD_ACCOUNT_ID.startsWith("act_") ? META_AD_ACCOUNT_ID : `act_${META_AD_ACCOUNT_ID}`;

    if (customSince && customUntil) {
      const url = `https://graph.facebook.com/v22.0/${accountId}/insights?fields=spend,impressions,clicks&time_range={"since":"${customSince}","until":"${customUntil}"}&access_token=${META_ACCESS_TOKEN}`;
      console.log("Fetching Meta API (custom range)");
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.error) {
        return new Response(JSON.stringify({ success: false, error: data.error.message || data.error }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let totalSpend = 0;
      if (data.data && data.data.length > 0) {
        totalSpend = parseFloat(data.data[0].spend) || 0;
      }

      const dailyUrl = `https://graph.facebook.com/v22.0/${accountId}/insights?fields=spend&time_range={"since":"${customSince}","until":"${customUntil}"}&time_increment=monthly&access_token=${META_ACCESS_TOKEN}`;
      const dailyResp = await fetch(dailyUrl);
      const dailyData = await dailyResp.json();

      const monthlySpend: Record<string, number> = {};
      if (dailyData.data) {
        const monthNames: Record<number, string> = {
          1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
          7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
        };
        for (const entry of dailyData.data) {
          const month = parseInt(entry.date_start.split("-")[1]);
          const year = entry.date_start.split("-")[0].slice(2);
          const key = `${monthNames[month]}/${year}`;
          monthlySpend[key] = (monthlySpend[key] || 0) + (parseFloat(entry.spend) || 0);
        }
      }

      for (const [month, spend] of Object.entries(monthlySpend)) {
        if (spend > 0) {
          await supabase.from("monthly_data").update({ trafego: spend, updated_at: new Date().toISOString() }).eq("month", month);
        }
      }

      return new Response(JSON.stringify({ success: true, total_spend: totalSpend, monthly: monthlySpend }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: fetch all months
    const results: Record<string, number> = {};
    for (const [month, range] of Object.entries(monthRanges)) {
      try {
        const url = `https://graph.facebook.com/v22.0/${accountId}/insights?fields=spend&time_range={"since":"${range.since}","until":"${range.until}"}&access_token=${META_ACCESS_TOKEN}`;
        const resp = await fetch(url);
        const data = await resp.json();
        results[month] = data.data?.[0] ? parseFloat(data.data[0].spend) || 0 : 0;
      } catch (e) {
        console.error(`Error fetching ${month}:`, e);
        results[month] = 0;
      }
    }

    for (const [month, spend] of Object.entries(results)) {
      if (spend > 0) {
        await supabase.from("monthly_data").update({ trafego: spend, updated_at: new Date().toISOString() }).eq("month", month);
      }
    }

    return new Response(JSON.stringify({ success: true, data: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-meta-ads error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
