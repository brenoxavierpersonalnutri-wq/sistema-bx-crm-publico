// live-pareamento — a VPS entrega ao CRM, UMA ÚNICA VEZ, LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET,
// pra ninguém colar segredo no painel. Grava em integracao_config chave 'livekit' (JSON); as funções
// de lives leem de lá quando não há secret no env (_shared/livekitApi.ts, envLiveKit).
//
// Quem chama: /usr/local/sbin/headturbo-live-parear, na VPS (infra/livekit/headturbo-live-parear).
// verify_jwt = false (a VPS não tem login). Travas, nesta ordem (ver _shared/pareamentoLive.ts):
//   1. origem: cf-connecting-ip === 203.0.113.10 (origemPermitida, a mesma regra do wa-proxy-pareamento) -> 403;
//   2. uso único: já existe valor e o dono não rearmou -> 410 (para sempre);
//   3. HMAC-SHA256 com o wa_proxy_secret efetivo sobre `${ts}.${nonce}.${corpo}`, janela 5 min -> 401;
//   4. a SQL live_pareamento_gravar refaz 2 e recusa nonce repetido (409) num bloco atômico.
// Resposta de sucesso: só { ok, hash } (12 hex do sha256 do valor gravado). Nunca loga valor.
//
// Rearmar (o dono no SQL, ou um admin logado):  SELECT public.live_pareamento_reabrir();
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { origemPermitida } from "../_shared/pareamentoWa.ts";
import {
  CABECALHO_ASSINATURA,
  CABECALHO_NONCE,
  CABECALHO_TS,
  conferirAssinatura,
  CORPO_MAX,
  hashCurto,
  statusDaGravacao,
  validarCorpo,
} from "../_shared/pareamentoLive.ts";
import { segredoWa } from "../_shared/segredosWa.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ live_pareamento: o }));

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    await req.body?.cancel().catch(() => {});
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. origem
  const origem = origemPermitida((n) => req.headers.get(n));
  if (!origem.ok) {
    await req.body?.cancel().catch(() => {});
    log({ recusado: 403, motivo: origem.motivo, vistos: origem.vistos });
    return json({ error: "origem recusada" }, 403);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    // 2. uso único (checagem barata; a SQL refaz dentro do lock)
    const { data: aceita, error: errEstado } = await db.rpc("live_pareamento_aceita");
    if (errEstado) throw new Error(errEstado.message);
    if (aceita !== true) {
      await req.body?.cancel().catch(() => {});
      log({ recusado: 410 });
      return json({ error: "já pareado" }, 410);
    }

    const corpo = await req.text();
    if (corpo.length > CORPO_MAX) return json({ error: "corpo grande demais" }, 413);

    // 3. assinatura
    const segredo = await segredoWa("WA_PROXY_SECRET");
    const nonce = req.headers.get(CABECALHO_NONCE);
    const ass = await conferirAssinatura(
      segredo,
      { ts: req.headers.get(CABECALHO_TS), nonce, assinatura: req.headers.get(CABECALHO_ASSINATURA) },
      corpo,
      Date.now(),
    );
    if (!ass.ok) {
      log({ recusado: 401, motivo: ass.motivo });
      return json({ error: ass.motivo }, 401);
    }

    const v = validarCorpo(corpo);
    if (!v.ok) {
      log({ recusado: 400, motivo: v.motivo });
      return json({ error: v.motivo }, 400);
    }

    // 4. grava (atômico: nonce único + uso único)
    const ip = origem.vistos.length ? origem.vistos[0].split("=")[1] : "?";
    const { data: r, error: errGrava } = await db.rpc("live_pareamento_gravar", { p_valor: v.valor, p_nonce: nonce, p_ip: ip });
    if (errGrava) throw new Error(errGrava.message);
    const st = statusDaGravacao(r);
    if (st.status !== 200) {
      log({ recusado: st.status, motivo: st.motivo });
      return json({ error: st.motivo }, st.status);
    }
    const hash = await hashCurto(v.valor);
    log({ gravado: true, hash, vistos: origem.vistos });
    return json({ ok: true, hash });
  } catch (e) {
    console.error("live-pareamento:", e instanceof Error ? e.message : e);
    return json({ error: "erro interno" }, 500);
  }
});
