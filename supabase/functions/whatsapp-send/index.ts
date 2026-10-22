import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Envia texto pelo OpenWA (VPS), via proxy assinado. Único provedor desde 17/10/2026.
// numero_id (17/10/2026): responde pelo MESMO número da conversa (crm_numeros -> sessão do OpenWA).
// Sem numero_id = número padrão (closer), como antes. Oficial/desativado/sem ponte: 409 com o motivo.
import { ErroProxy } from "../_shared/waProxy.ts";
import { chamarProxyNaSessao, sessaoEnvio } from "../_shared/waNumero.ts";
// Grupo (…@g.us) só com manual: true (atendente na tela Conversas), pela rota manual do proxy (sem allowlist).
import { avisoLimite, destinoEnvio } from "../_shared/envioGrupoManual.ts";
// Humano respondeu pelo CRM: pausa o robô de IA nesta conversa (18/10/2026).
import { pausarPorHumano } from "../_shared/roboPausa.ts";
// Permissões do CRM (22/11/2026): número/área/atendente conferidos no banco com o JWT de quem envia.
import { conferirAcessoCrm, marcarAtendenteSeVazio } from "../_shared/acessoCrm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { phone, message, numero_id, manual } = await req.json();
    const numeroId = typeof numero_id === "string" && /^[0-9a-f-]{36}$/i.test(numero_id) ? numero_id : null;
    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: "phone and message required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const destino = destinoEnvio(phone, manual);
    if ("erro" in destino) {
      return new Response(JSON.stringify({ error: destino.erro }), {
        status: destino.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const grupo = destino.tipo === "grupo";
    // telefone: 10 a 15 dígitos com 55; grupo: o próprio JID (é a chave do contato no CRM)
    const number = destino.tipo === "grupo" ? destino.chatId : destino.numero;

    // sem número = o padrão (closer): o banco resolve e confere do mesmo jeito
    const acesso = await conferirAcessoCrm(supabase, { conversa: { numeroId, phone: number }, acao: "conversas.enviar" });
    if (!acesso.ok) {
      return new Response(JSON.stringify({ error: acesso.erro }), {
        status: acesso.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentId: string | null = null;

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const alvo = await sessaoEnvio(serviceSupabase, numeroId);
    if ("recusa" in alvo) {
      return new Response(JSON.stringify({ error: `Não dá pra responder por este número: ${alvo.recusa}` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const r = grupo
        ? await chamarProxyNaSessao("send-group-manual-text", { chatId: number, text: String(message) }, alvo.sessao)
        : await chamarProxyNaSessao("send-text", { phone: number, text: String(message) }, alvo.sessao);
      sentId = r?.messageId ? String(r.messageId) : null;
    } catch (e) {
      const status = e instanceof ErroProxy ? e.status : 0;
      console.error("OpenWA proxy error:", status);
      return new Response(
        JSON.stringify({
          error: status === 429 ? avisoLimite(grupo)
            : status === 503 ? `Sem ponte para este número: ${String(e instanceof ErroProxy ? e.detalhe : "")}`.slice(0, 300)
            : "Failed to send message",
          detail: e instanceof ErroProxy ? e.detalhe : undefined,
        }),
        { status: status === 429 ? 429 : status === 503 ? 409 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log outbound message (no número da conversa)
    // insert simples: o índice único de message_id é parcial e o ON CONFLICT do upsert não casa.
    // 23505 = o eco do openwa-webhook (message.sent) chegou antes; a linha já existe.
    const { error: erroLog } = await serviceSupabase.from("whatsapp_messages").insert({
      ...(numeroId ? { numero_id: numeroId } : {}),
      contact_phone: number,
      direction: "outbound",
      sender_type: "user",
      body: message,
      message_id: sentId,
    });
    if (erroLog && erroLog.code !== "23505") console.error("whatsapp-send: log falhou", erroLog.message);
    if (!grupo) await pausarPorHumano(serviceSupabase, numeroId, number, "mensagem manual pelo CRM");
    // quem respondeu vira o atendente, se a conversa ainda não tem (nunca troca sozinho)
    await marcarAtendenteSeVazio(supabase, numeroId, number);


    return new Response(
      JSON.stringify({ ok: true, messageId: sentId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("whatsapp-send error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
