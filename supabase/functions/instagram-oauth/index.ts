// instagram-oauth: "Conectar Instagram" na Central de Automação (Business Login for Instagram).
//
// Portas (verify_jwt = false; cada uma confere a própria credencial):
//  POST JSON + JWT de usuário aprovado:
//    { acao: "iniciar" }            -> { url } do login da Meta (state de uso único, 15 min, amarrado ao usuário)
//    { acao: "renovar", conta_id }  -> renova o token longo (60 dias)
//    { acao: "reassinar", conta_id }-> assina de novo o webhook da conta (POST /me/subscribed_apps)
//    { acao: "desconectar", conta_id } -> apaga o token e marca desconectado (admin)
//  GET ?code&state (volta do login): troca o code pelo token curto, depois pelo longo, lê /me, CIFRA o token,
//    grava em ig_contas, assina o webhook e redireciona pra /crm/central?instagram=ok|erro. O token
//    nunca passa pelo navegador.
//  POST form signed_request (?evento=desautorizar | excluir): callbacks da Meta de desautorização e de
//    exclusão de dados, assinados com o app secret.
//
//  POST JSON { acao: "status" } + JWT de usuário aprovado -> { configurado, faltam[] } (a tela avisa o que falta).
//  POST ?evento=parear (sem JWT): a VPS entrega UMA vez IG_APP_ID/IG_APP_SECRET (molde do live-pareamento:
//    IP da VPS + uso único + HMAC com o wa_proxy_secret + nonce único). Grava integracao_config 'instagram_app'.
//    Rearmar: SELECT public.instagram_pareamento_reabrir();
//
// Credenciais: Deno.env (IG_APP_ID, IG_APP_SECRET, IG_TOKEN_SEGREDO) tem prioridade; na falta, integracao_config
// ('instagram_app' do pareamento, 'instagram_token_segredo' gerado no banco). CRM_URL opcional.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CAMPOS_WEBHOOK, ESTADO_OAUTH_MS, URL_TOKEN_CURTO, GRAPH_IG,
  cifrarToken, estadoAleatorio, estadoValido, faltamPermissoes, hmacSha256Hex, iguaisTempoConstante, limparCode,
  urlAutorizacao,
} from "../_shared/instagram.ts";
import { corsIg, envIg, ErroGraph, graph, jsonIg, prepararEnvIg, tokenDaConta } from "../_shared/instagramDb.ts";
import { faltasConfigIg, statusGravacaoIg, validarCorpoIg } from "../_shared/pareamentoIg.ts";
import { origemPermitida } from "../_shared/pareamentoWa.ts";
import { CABECALHO_ASSINATURA, CABECALHO_NONCE, CABECALHO_TS, conferirAssinatura, CORPO_MAX, hashCurto } from "../_shared/pareamentoLive.ts";
import { segredoWa } from "../_shared/segredosWa.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function voltar(status: "ok" | "erro", motivo?: string): Response {
  const u = new URL(`${envIg().urlCrm}/crm/central`);
  u.searchParams.set("instagram", status);
  if (motivo) u.searchParams.set("motivo", motivo.slice(0, 160));
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store" } });
}

async function usuarioAprovado(req: Request): Promise<{ id: string; admin: boolean } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const cli = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await cli.auth.getUser();
  if (!user) return null;
  const { data: aprovado } = await db.rpc("is_approved", { _user_id: user.id });
  if (!aprovado) return null;
  const { data: admin } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return { id: user.id, admin: admin === true };
}

async function assinarWebhook(token: string): Promise<boolean> {
  try {
    const r = await graph("me/subscribed_apps", token, { metodo: "POST", query: { subscribed_fields: CAMPOS_WEBHOOK.join(",") } });
    return r.success === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ volta do login

async function callback(url: URL): Promise<Response> {
  const env = envIg();
  if (url.searchParams.get("error")) return voltar("erro", url.searchParams.get("error_description") || "login cancelado");
  const code = limparCode(url.searchParams.get("code"));
  const state = url.searchParams.get("state");
  if (!code || !estadoValido(state)) return voltar("erro", "retorno do login inválido");
  const faltamCfg = faltasConfigIg(env);
  if (faltamCfg.length) return voltar("erro", `Instagram ainda não configurado: falta ${faltamCfg.join(" e ")}`);

  // state de uso único: apaga e confere no mesmo passo
  const { data: est } = await db.from("ig_oauth_estados").delete().eq("state", state).select("user_id, criado_em").maybeSingle();
  if (!est || Date.now() - Date.parse(est.criado_em as string) > ESTADO_OAUTH_MS) return voltar("erro", "login expirado, tente de novo");

  try {
    // 1) code -> token curto
    const form = new URLSearchParams({
      client_id: env.appId, client_secret: env.appSecret, grant_type: "authorization_code",
      redirect_uri: env.redirectUri, code,
    });
    const r1 = await fetch(URL_TOKEN_CURTO, { method: "POST", body: form });
    const j1 = (await r1.json().catch(() => ({}))) as Record<string, unknown>;
    const d1 = (Array.isArray(j1.data) ? j1.data[0] : j1) as Record<string, unknown> | undefined;
    const curto = String(d1?.access_token ?? "");
    if (!r1.ok || !curto) return voltar("erro", String((j1 as { error_message?: string }).error_message ?? "a Meta não devolveu o token"));
    const faltam = faltamPermissoes(d1?.permissions as string | string[] | undefined);
    if (faltam.length) return voltar("erro", `faltou autorizar: ${faltam.join(", ")}`);

    // 2) token curto -> longo (60 dias)
    const u2 = new URL(`${GRAPH_IG}/access_token`);
    u2.searchParams.set("grant_type", "ig_exchange_token");
    u2.searchParams.set("client_secret", env.appSecret);
    u2.searchParams.set("access_token", curto);
    const r2 = await fetch(u2);
    const j2 = (await r2.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r2.ok || !j2.access_token) return voltar("erro", "não consegui o token de longa duração");
    const longo = j2.access_token;
    const expira = new Date(Date.now() + (Number(j2.expires_in) || 5_184_000) * 1000).toISOString();

    // 3) quem é a conta
    const me = await graph("me", longo, { query: { fields: "user_id,username,name,profile_picture_url,account_type" } });
    const igUserId = String(me.user_id ?? "");
    if (!igUserId) return voltar("erro", "a Meta não devolveu o id da conta");

    const webhook = await assinarWebhook(longo);
    const { error } = await db.from("ig_contas").upsert({
      ig_user_id: igUserId,
      ig_app_user_id: String(me.id ?? ""),
      username: String(me.username ?? ""),
      nome: String(me.name ?? ""),
      foto_url: (me.profile_picture_url as string | undefined) ?? null,
      token_cifrado: await cifrarToken(longo, env.segredoToken),
      token_expira_em: expira,
      permissoes: String(d1?.permissions ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      status: "conectado",
      webhook_assinado: webhook,
      ultimo_erro: webhook ? null : "webhook não assinado: confira se o app está em modo Live",
      conectado_por: est.user_id,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "ig_user_id" });
    if (error) return voltar("erro", "não salvou a conta no banco");
    return voltar("ok", `@${String(me.username ?? "")}${webhook ? "" : " (webhook pendente)"}`);
  } catch (e) {
    return voltar("erro", e instanceof ErroGraph ? `Meta: ${e.message}` : "falha ao conectar");
  }
}

// ------------------------------------------------------------------ callbacks assinados da Meta

async function lerSignedRequest(req: Request, segredo: string): Promise<Record<string, unknown> | null> {
  const form = await req.formData().catch(() => null);
  const sr = String(form?.get("signed_request") ?? "");
  const [sig, payload] = sr.split(".");
  if (!sig || !payload || !segredo) return null;
  const esperado = await hmacSha256Hex(payload, segredo);
  const sigHex = [...atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (sig.length % 4)) % 4))]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (!iguaisTempoConstante(esperado, sigHex)) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4)));
  } catch {
    return null;
  }
}

async function eventoMeta(req: Request, evento: string): Promise<Response> {
  const dados = await lerSignedRequest(req, envIg().appSecret);
  if (!dados) return jsonIg({ error: "assinatura inválida" }, 401);
  const userId = String(dados.user_id ?? "");
  const filtro = db.from("ig_contas").update({ token_cifrado: null, status: "desconectado", ultimo_erro: `Meta: ${evento}`, atualizado_em: new Date().toISOString() });
  if (userId) await filtro.or(`ig_user_id.eq.${userId.replace(/[^0-9]/g, "")},ig_app_user_id.eq.${userId.replace(/[^0-9]/g, "")}`);
  if (evento === "excluir") {
    const codigo = estadoAleatorio(12);
    return jsonIg({ url: `${envIg().urlCrm}/privacidade?pedido=${codigo}`, confirmation_code: codigo });
  }
  return jsonIg({ ok: true });
}

// ------------------------------------------------------------------ pareamento VPS -> CRM (IG_APP_ID/IG_APP_SECRET)

const logPar = (o: Record<string, unknown>) => console.log(JSON.stringify({ instagram_pareamento: o }));

async function parear(req: Request): Promise<Response> {
  const origem = origemPermitida((n) => req.headers.get(n));
  if (!origem.ok) {
    await req.body?.cancel().catch(() => {});
    logPar({ recusado: 403, motivo: origem.motivo, vistos: origem.vistos });
    return jsonIg({ error: "origem recusada" }, 403);
  }
  const { data: aceita, error: errEstado } = await db.rpc("instagram_pareamento_aceita");
  if (errEstado) throw new Error(errEstado.message);
  if (aceita !== true) {
    await req.body?.cancel().catch(() => {});
    logPar({ recusado: 410 });
    return jsonIg({ error: "já pareado" }, 410);
  }
  const corpo = await req.text();
  if (corpo.length > CORPO_MAX) return jsonIg({ error: "corpo grande demais" }, 413);
  const nonce = req.headers.get(CABECALHO_NONCE);
  const ass = await conferirAssinatura(
    await segredoWa("WA_PROXY_SECRET"),
    { ts: req.headers.get(CABECALHO_TS), nonce, assinatura: req.headers.get(CABECALHO_ASSINATURA) },
    corpo,
    Date.now(),
  );
  if (!ass.ok) {
    logPar({ recusado: 401, motivo: ass.motivo });
    return jsonIg({ error: ass.motivo }, 401);
  }
  const v = validarCorpoIg(corpo);
  if (!v.ok) {
    logPar({ recusado: 400, motivo: v.motivo });
    return jsonIg({ error: v.motivo }, 400);
  }
  const ip = origem.vistos.length ? origem.vistos[0].split("=")[1] : "?";
  const { data: r, error: errGrava } = await db.rpc("instagram_pareamento_gravar", { p_valor: v.valor, p_nonce: nonce, p_ip: ip });
  if (errGrava) throw new Error(errGrava.message);
  const st = statusGravacaoIg(r);
  if (st.status !== 200) {
    logPar({ recusado: st.status, motivo: st.motivo });
    return jsonIg({ error: st.motivo }, st.status);
  }
  const hash = await hashCurto(v.valor);
  logPar({ gravado: true, hash, vistos: origem.vistos });
  return jsonIg({ ok: true, hash });
}

// ------------------------------------------------------------------ ações da tela

async function acaoTela(req: Request): Promise<Response> {
  const usuario = await usuarioAprovado(req);
  if (!usuario) return jsonIg({ error: "Unauthorized" }, 401);
  const corpo = (await req.json().catch(() => ({}))) as { acao?: string; conta_id?: string };
  const env = envIg();

  if (corpo.acao === "status") {
    const faltam = faltasConfigIg(env);
    const { error: semTabela } = await db.from("ig_oauth_estados").select("state", { head: true, count: "exact" }).limit(1);
    if (semTabela) faltam.unshift("rodar a migration do Instagram no banco (20261026100000)");
    return jsonIg({ configurado: faltam.length === 0, faltam });
  }

  if (corpo.acao === "iniciar") {
    const faltam = faltasConfigIg(env);
    if (faltam.length) return jsonIg({ error: `Instagram ainda não configurado: falta ${faltam.join(" e ")}.`, faltam }, 412);
    await db.from("ig_oauth_estados").delete().lt("criado_em", new Date(Date.now() - ESTADO_OAUTH_MS).toISOString());
    const state = estadoAleatorio(24);
    const { error } = await db.from("ig_oauth_estados").insert({ state, user_id: usuario.id });
    if (error) return jsonIg({ error: "Instagram ainda não configurado: falta rodar a migration do Instagram no banco (20261026100000).", faltam: ["migration"] }, 412);
    return jsonIg({ url: urlAutorizacao({ appId: env.appId, redirectUri: env.redirectUri, state }) });
  }

  const contaId = String(corpo.conta_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(contaId)) return jsonIg({ error: "conta_id inválido" }, 400);
  const { data: conta } = await db.from("ig_contas")
    .select("id, ig_user_id, username, token_cifrado, token_expira_em, status").eq("id", contaId).maybeSingle();
  if (!conta) return jsonIg({ error: "conta não encontrada" }, 404);

  if (corpo.acao === "desconectar") {
    if (!usuario.admin) return jsonIg({ error: "só admin desconecta" }, 403);
    await db.from("ig_contas").update({ token_cifrado: null, status: "desconectado", webhook_assinado: false, atualizado_em: new Date().toISOString() }).eq("id", contaId);
    return jsonIg({ ok: true });
  }

  try {
    const token = await tokenDaConta(conta);
    if (corpo.acao === "renovar") {
      const u = new URL(`${GRAPH_IG}/refresh_access_token`);
      u.searchParams.set("grant_type", "ig_refresh_token");
      u.searchParams.set("access_token", token);
      const r = await fetch(u);
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (!r.ok || !j.access_token) return jsonIg({ error: "a Meta não renovou (token precisa ter 24 h e não estar vencido)" }, 502);
      await db.from("ig_contas").update({
        token_cifrado: await cifrarToken(j.access_token, env.segredoToken),
        token_expira_em: new Date(Date.now() + (Number(j.expires_in) || 5_184_000) * 1000).toISOString(),
        status: "conectado", ultimo_erro: null, atualizado_em: new Date().toISOString(),
      }).eq("id", contaId);
      return jsonIg({ ok: true });
    }
    if (corpo.acao === "reassinar") {
      const ok = await assinarWebhook(token);
      await db.from("ig_contas").update({
        webhook_assinado: ok, ultimo_erro: ok ? null : "webhook não assinado: confira se o app está em modo Live",
        atualizado_em: new Date().toISOString(),
      }).eq("id", contaId);
      return jsonIg({ ok });
    }
  } catch (e) {
    return jsonIg({ error: e instanceof ErroGraph ? `Meta: ${e.message}` : "falhou" }, 502);
  }
  return jsonIg({ error: "ação desconhecida" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsIg });
  const url = new URL(req.url);
  const evento = url.searchParams.get("evento");
  try {
    if (req.method === "POST" && evento === "parear") return await parear(req);
    await prepararEnvIg(db);
    if (req.method === "GET") return await callback(url);
    if (req.method === "POST" && (evento === "desautorizar" || evento === "excluir")) return await eventoMeta(req, evento);
    if (req.method === "POST") return await acaoTela(req);
    return jsonIg({ error: "método não suportado" }, 405);
  } catch (e) {
    console.error("instagram-oauth", e instanceof Error ? e.message : "erro");
    return jsonIg({ error: "erro interno" }, 500);
  }
});
