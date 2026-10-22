// Worker do robô de atendimento por IA (18/10/2026). Chamado pelo pg_cron (public.crm_ai_robo_tick, 1/min, só
// quando há item vencido na crm_ai_fila) com o header x-ai-robo-segredo = integracao_config.ai_robo_segredo.
// Pega as rajadas de mensagens vencidas (debounce), gera a resposta com o Claude e envia pelo número da conversa
// com ritmo humano. A lógica está em _shared/roboAtendimento.ts; banco e WhatsApp em _shared/roboAtendimentoDb.ts.
// Nada sai enquanto crm_numeros.robo_ia_ligado = false (padrão): sem chave ligada, a fila nem enche.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rodarTick } from "../_shared/roboAtendimentoDb.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const recebido = req.headers.get("x-ai-robo-segredo") ?? "";
  const { data } = await db.from("integracao_config").select("valor").eq("chave", "ai_robo_segredo").maybeSingle();
  const segredo = String(data?.valor ?? "");
  if (!segredo || !recebido || !iguais(recebido, segredo)) return json({ error: "Unauthorized" }, 401);
  try {
    const r = await rodarTick(db);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("ai-robo-tick:", e instanceof Error ? e.message : e);
    return json({ error: "erro interno" }, 500);
  }
});
