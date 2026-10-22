// wa-proxy-pareamento — entrega à VPS, UMA ÚNICA VEZ, os dois segredos da integração WhatsApp
// (WA_PROXY_SECRET e OPENWA_WEBHOOK_SECRET), pra ninguém precisar copiar e colar valor.
//
// Quem chama: /usr/local/sbin/headturbo-wa-parear, na VPS (infra/wa-proxy/headturbo-wa-parear).
// verify_jwt = false (a VPS não tem login). As travas (ver _shared/pareamentoWa.ts):
//   - janela: integracao_config.wa_pareamento_aberto_ate (a migration abre 30 min);
//   - uso único: wa_pareado_em gravado num UPDATE atômico (wa_pareamento_consumir); depois -> 410 sempre;
//   - origem: cf-connecting-ip === IP da VPS (203.0.113.10); XFF/x-real-ip só vão pro log.
// Devolve os valores EFETIVOS (secret da função, se existir; senão o gerado no banco), os mesmos
// que openwa-webhook e o cliente do proxy usam. Nunca loga valor; loga data, motivo e os IPs vistos.
//
// Reabrir (o dono, no SQL, se a janela passou sem parear ou se precisar parear de novo):
//   SELECT public.wa_pareamento_reabrir(30);   -- minutos
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decidirPareamento, origemPermitida } from "../_shared/pareamentoWa.ts";
import { segredoWa } from "../_shared/segredosWa.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  await req.body?.cancel().catch(() => {});

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const { data: estado, error: errEstado } = await db.rpc("wa_pareamento_estado");
    if (errEstado) throw new Error(errEstado.message);
    const linha = Array.isArray(estado) ? estado[0] : estado;
    const origem = origemPermitida((n) => req.headers.get(n));
    const decisao = decidirPareamento(
      { abertoAte: linha?.aberto_ate ?? null, pareadoEm: linha?.pareado_em ?? null },
      origem,
      Date.now(),
    );
    if (decisao.status !== 200) {
      console.log(JSON.stringify({ pareamento: "recusado", status: decisao.status, motivo: decisao.motivo, origem: origem.motivo, vistos: origem.vistos }));
      return json({ error: decisao.motivo }, decisao.status);
    }

    // valores efetivos ANTES de consumir: se faltar algum, não queima o uso único
    const proxySecret = await segredoWa("WA_PROXY_SECRET");
    const webhookSecret = await segredoWa("OPENWA_WEBHOOK_SECRET");
    if (proxySecret.length < 32 || webhookSecret.length < 32) {
      console.log(JSON.stringify({ pareamento: "sem segredos no banco" }));
      return json({ error: "segredos ainda não gerados (rode a migration)" }, 503);
    }

    const ip = origem.vistos.length ? origem.vistos[0].split("=")[1] : "?";
    const { data: consumiu, error: errConsumo } = await db.rpc("wa_pareamento_consumir", { p_ip: ip });
    if (errConsumo) throw new Error(errConsumo.message);
    if (consumiu !== true) {
      // outra chamada levou antes (corrida) ou a janela fechou entre a leitura e o UPDATE
      console.log(JSON.stringify({ pareamento: "corrida perdida" }));
      return json({ error: "já pareado" }, 410);
    }

    console.log(JSON.stringify({ pareamento: "entregue", vistos: origem.vistos }));
    return json({ wa_proxy_secret: proxySecret, openwa_webhook_secret: webhookSecret });
  } catch (e) {
    console.error("wa-proxy-pareamento:", e instanceof Error ? e.message : e);
    return json({ error: "erro interno" }, 500);
  }
});
