// APOSENTADA em 17/10/2026. Listava grupos pela UazAPI (/chat/find) para o disparo em grupos,
// que já tinha saído da tela em 16/10/2026. Com o OpenWA não há disparo em grupo (risco de ban):
// a função só responde 410 (Gone). O código antigo está no git.
import { respostaUazapiAposentada } from "../_shared/waProxy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return respostaUazapiAposentada(corsHeaders);
});
