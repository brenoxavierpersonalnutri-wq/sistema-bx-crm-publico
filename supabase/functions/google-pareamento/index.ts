// google-pareamento — a VPS entrega ao CRM, UMA ÚNICA VEZ, o GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET do app
// OAuth do YouTube (que o Breno guardou no cofre com guardar-chave.sh --levar-vps), pra ninguém colar
// segredo no painel. Grava em integracao_config chave 'google_oauth' (JSON {client_id, client_secret});
// youtube-oauth e live-control leem de lá quando não há secret no env (_shared/youtubeDb.ts).
//
// Mesmo molde e mesmas travas do live-pareamento (lógica compartilhada em _shared/pareamentoLive.ts):
//   1. origem: cf-connecting-ip === IP da VPS (origemPermitida) -> 403;
//   2. uso único: já existe valor e o dono não rearmou -> 410;
//   3. HMAC-SHA256 com o wa_proxy_secret sobre `${ts}.${nonce}.${corpo}`, janela 5 min -> 401;
//   4. a SQL google_pareamento_gravar refaz 2 e recusa nonce repetido (409), atômica.
// Quem chama: infra/google/headturbo-google-parear (root, na VPS). Resposta: só { ok, hash }.
// Rearmar (trocou o client secret):  SELECT public.google_pareamento_reabrir();
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { origemPermitida } from "../_shared/pareamentoWa.ts";
import {
  CABECALHO_ASSINATURA, CABECALHO_NONCE, CABECALHO_TS, conferirAssinatura, CORPO_MAX, hashCurto, statusDaGravacao,
} from "../_shared/pareamentoLive.ts";
import { validarCorpoGoogle } from "../_shared/youtube.ts";
import { segredoWa } from "../_shared/segredosWa.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ google_pareamento: o }));

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    await req.body?.cancel().catch(() => {});
    return json({ error: "Method not allowed" }, 405);
  }

  const origem = origemPermitida((n) => req.headers.get(n));
  if (!origem.ok) {
    await req.body?.cancel().catch(() => {});
    log({ recusado: 403, motivo: origem.motivo, vistos: origem.vistos });
    return json({ error: "origem recusada" }, 403);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const { data: aceita, error: errEstado } = await db.rpc("google_pareamento_aceita");
    if (errEstado) throw new Error(errEstado.message);
    if (aceita !== true) {
      await req.body?.cancel().catch(() => {});
      log({ recusado: 410 });
      return json({ error: "já pareado" }, 410);
    }

    const corpo = await req.text();
    if (corpo.length > CORPO_MAX) return json({ error: "corpo grande demais" }, 413);

    const nonce = req.headers.get(CABECALHO_NONCE);
    const ass = await conferirAssinatura(
      await segredoWa("WA_PROXY_SECRET"),
      { ts: req.headers.get(CABECALHO_TS), nonce, assinatura: req.headers.get(CABECALHO_ASSINATURA) },
      corpo,
      Date.now(),
    );
    if (!ass.ok) {
      log({ recusado: 401, motivo: ass.motivo });
      return json({ error: ass.motivo }, 401);
    }

    const v = validarCorpoGoogle(corpo);
    if (!v.ok) {
      log({ recusado: 400, motivo: v.motivo });
      return json({ error: v.motivo }, 400);
    }

    const ip = origem.vistos.length ? origem.vistos[0].split("=")[1] : "?";
    const { data: r, error: errGrava } = await db.rpc("google_pareamento_gravar", { p_valor: v.valor, p_nonce: nonce, p_ip: ip });
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
    console.error("google-pareamento:", e instanceof Error ? e.message : e);
    return json({ error: "erro interno" }, 500);
  }
});
