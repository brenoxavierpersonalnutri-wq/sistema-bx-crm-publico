// Webhooks do Cloudflare Stream (verify_jwt = false). Duas origens, um segredo (CF_STREAM_WEBHOOK_SECRET):
//  - Notificações "Stream Live Input" (conectou/desconectou/erro): header cf-webhook-auth = segredo
//    configurado no destino de webhook das Notifications;
//  - Webhook de vídeo (gravação pronta): header Webhook-Signature "time=..,sig1=.." (HMAC-SHA256).
import { iguaisTempoConstante, webhookCfStreamValido } from "../_shared/liveCrypto.ts";
import { admin, json } from "../_shared/livesHttp.ts";

const db = admin();

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const segredo = Deno.env.get("CF_STREAM_WEBHOOK_SECRET") ?? "";
  if (segredo.length < 16) return json({ error: "CF_STREAM_WEBHOOK_SECRET não configurado" }, 500);
  const corpo = await req.text();
  if (corpo.length > 262_144) return json({ error: "grande demais" }, 413);

  const assinatura = req.headers.get("Webhook-Signature");
  const auth = req.headers.get("cf-webhook-auth");
  const ok = assinatura
    ? await webhookCfStreamValido(corpo, assinatura, segredo)
    : !!auth && iguaisTempoConstante(auth, segredo);
  if (!ok) return json({ error: "assinatura inválida" }, 401);

  let ev: any;
  try {
    ev = JSON.parse(corpo);
  } catch {
    return json({ error: "json" }, 400);
  }

  // Notificação de live input
  const tipo = String(ev?.data?.event_type ?? "");
  const inputId = ev?.data?.input_id;
  if (inputId && tipo.startsWith("live_input.")) {
    await db.from("live_rooms").update({ cf_conectado: tipo === "live_input.connected" }).eq("cf_live_input_uid", inputId);
    return json({ ok: true });
  }

  // Vídeo pronto (gravação automática do live input)
  if (ev?.uid && ev?.liveInput && ev?.readyToStream) {
    await db.from("live_rooms").update({ cf_ultima_gravacao: String(ev.uid) }).eq("cf_live_input_uid", ev.liveInput);
  }
  return json({ ok: true });
});
