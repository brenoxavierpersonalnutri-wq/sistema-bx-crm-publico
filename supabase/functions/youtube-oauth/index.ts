// youtube-oauth: "Conectar conta do YouTube" no estúdio de lives (OAuth 2.0 do Google, YouTube Data API v3).
//
// Portas (verify_jwt = false; cada uma confere a própria credencial):
//  POST JSON + JWT de quem tem o módulo lives (usuarioLives):
//    { acao: "iniciar" }               -> { url } do login do Google (state de uso único, 15 min, amarrado ao usuário)
//    { acao: "status" }                -> { credenciais: bool } (o app Google está configurado?) — nunca devolve valor
//    { acao: "desconectar", conta_id } -> revoga no Google, apaga o token e marca desconectado
//  GET ?code&state (volta do login, no popup): troca o code por tokens AQUI, lê o canal (channels.list mine),
//    CIFRA o refresh_token (y1, LIVE_CHAVES_SEGREDO) e grava em yt_contas; depois 302 pra
//    ${LIVE_SITE_URL}/lives/youtube-retorno?youtube=ok|erro, que avisa a janela do estúdio e fecha o popup.
//    O refresh_token e o access_token nunca passam pelo navegador.
//    { acao: "diagnostico" }           -> de onde vêm as credenciais (env/banco), o client_id (público, já vai na URL
//    do login), o redirect_uri e se o Google ACEITA o client secret (troca um code falso: invalid_grant = ok,
//    invalid_client = secret errado). Nunca devolve nem loga o valor do secret. Era GET ?diagnostico=1 sem login
//    (qualquer um fazia a função chamar o Google): agora o GET com ?diagnostico responde 404.
//
// Credenciais do app Google: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no env OU integracao_config 'google_oauth'
// (gravado pelo google-pareamento a partir do cofre da VPS; ninguém cola segredo no painel).
// Redirect URI cadastrado no Google: https://<projeto>.supabase.co/functions/v1/youtube-oauth
import {
  ClienteYouTube, comCredencial, conferirSegredoGoogle, decifrarTokenYt, ehErroDeCliente, ErroGoogle, ESTADO_OAUTH_MS,
  estadoAleatorio, estadoValido, limparCodeGoogle, ESCOPO_YT, cifrarTokenYt, MOTIVO_SEGREDO_INVALIDO, urlAutorizacaoGoogle,
} from "../_shared/youtube.ts";
import { candidatosGoogle, credencialParaLogin, credenciaisGoogle, redirectUriYoutube } from "../_shared/youtubeDb.ts";
import { admin, corpoJson, corsHeaders, json, siteUrl, usuarioLives } from "../_shared/livesHttp.ts";
import { segredoLiveOuNull } from "../_shared/liveSegredo.ts";
import { adicionarContaNasLives } from "../_shared/destinoYtAuto.ts";

const db = admin();

// env LIVE_CHAVES_SEGREDO se existir; senão integracao_config 'live_chaves_segredo' (gerado no banco)
const segredo = async () => (await segredoLiveOuNull(db)) ?? "";

function voltar(status: "ok" | "erro", motivo?: string): Response {
  const u = new URL(`${siteUrl()}/lives/youtube-retorno`);
  u.searchParams.set("youtube", status);
  if (motivo) u.searchParams.set("motivo", motivo.slice(0, 160));
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store" } });
}

async function callback(url: URL): Promise<Response> {
  if (url.searchParams.get("error")) return voltar("erro", url.searchParams.get("error") === "access_denied" ? "login cancelado" : "o Google recusou o login");
  const code = limparCodeGoogle(url.searchParams.get("code"));
  const state = url.searchParams.get("state");
  if (!code || !estadoValido(state)) return voltar("erro", "retorno do login inválido");

  // state de uso único: apaga e confere no mesmo passo
  const { data: est } = await db.from("yt_oauth_estados").delete().eq("state", state).select("user_id, criado_em").maybeSingle();
  if (!est || Date.now() - Date.parse(est.criado_em as string) > ESTADO_OAUTH_MS) return voltar("erro", "login expirado, tente de novo");

  const cands = await candidatosGoogle(db);
  if (!cands.length) return voltar("erro", "app Google sem credenciais (ver checklist)");
  const seg = await segredo();
  if (seg.length < 32) return voltar("erro", "segredo das lives ausente (rode a migration 20261103110000)");

  try {
    // env primeiro; se o Google recusar o cliente (secret errado), tenta o par do banco antes de desistir
    const { valor: t } = await comCredencial(cands, (cred) => ClienteYouTube.trocarCode(cred, code, redirectUriYoutube()));
    if (!t.escopos.includes(ESCOPO_YT)) return voltar("erro", "faltou autorizar o acesso ao YouTube");
    const canal = await new ClienteYouTube(t.accessToken).canal();
    if (!canal) return voltar("erro", "esta conta Google não tem canal no YouTube");

    const { data: antiga } = await db.from("yt_contas").select("id, refresh_token_cifrado, status").eq("canal_id", canal.id).maybeSingle();
    const refreshCifrado = t.refreshToken ? await cifrarTokenYt(t.refreshToken, seg) : (antiga?.refresh_token_cifrado as string | null) ?? null;
    if (!refreshCifrado) return voltar("erro", "o Google não devolveu o refresh token: remova o acesso do app na conta Google e conecte de novo");

    const { error } = await db.from("yt_contas").upsert({
      canal_id: canal.id,
      titulo: canal.titulo.slice(0, 200),
      foto_url: canal.foto,
      refresh_token_cifrado: refreshCifrado,
      escopos: t.escopos,
      status: "conectado",
      ultimo_erro: null,
      conectado_por: est.user_id,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "canal_id" });
    if (error) return voltar("erro", "não salvou a conta no banco (rodou a migration do YouTube?)");
    // conta nova (ou que estava desconectada): vira destino nas lives em rascunho/agendadas sem YouTube
    // só quando é o único canal conectado: com mais de um, o destino automático segue o canal PADRÃO
    const { count: outros } = await db.from("yt_contas").select("id", { count: "exact", head: true }).eq("status", "conectado").neq("canal_id", canal.id);
    if ((!antiga || antiga.status !== "conectado") && !outros) {
      const { data: c } = await db.from("yt_contas").select("id, titulo, status").eq("canal_id", canal.id).maybeSingle();
      if (c) await adicionarContaNasLives(db, c).catch((e) => console.error("youtube-oauth: destino automático", e instanceof Error ? e.message : e));
    }
    return voltar("ok", canal.titulo);
  } catch (e) {
    const msg = ehErroDeCliente(e) ? MOTIVO_SEGREDO_INVALIDO : e instanceof ErroGoogle ? `Google: ${e.message}` : "falha ao conectar";
    console.error("youtube-oauth callback", e instanceof ErroGoogle ? `${e.status} ${e.razao}` : "erro", `fontes=${cands.map((c) => c.fonte).join(",")}`);
    return voltar("erro", msg);
  }
}

async function diagnostico(): Promise<Response> {
  // só pela tela (acaoTela, JWT de quem tem o módulo lives)
  const redirect = redirectUriYoutube();
  const cands = await candidatosGoogle(db);
  const fontes = await Promise.all(cands.map(async (c) => ({
    fonte: c.fonte,
    client_id: c.cred.clientId,
    segredo: await conferirSegredoGoogle(c.cred, redirect),
  })));
  console.log("youtube-oauth diagnostico", fontes.map((f) => `${f.fonte}:${f.segredo}`).join(" ") || "sem credenciais");
  return json({ ok: true, redirect_uri: redirect, credenciais: fontes.length > 0, fontes });
}

async function acaoTela(req: Request): Promise<Response> {
  const user = await usuarioLives(req);
  if (!user) return json({ error: "sem acesso ao módulo lives" }, 403);
  const b = await corpoJson(req);
  if (!b) return json({ error: "corpo inválido" }, 400);

  if (b.acao === "status") return json({ ok: true, credenciais: !!(await credenciaisGoogle(db)) });

  if (b.acao === "diagnostico") return await diagnostico();

  if (b.acao === "iniciar") {
    const cred = await credencialParaLogin(db);
    if (!cred) return json({ error: "O app do Google ainda não está configurado (client ID/secret). Siga o checklist do YouTube no README de lives." }, 412);
    if ((await segredo()).length < 32) return json({ error: "Segredo das lives ausente: rode a migration 20261103110000 (live_chaves_segredo)." }, 500);
    await db.from("yt_oauth_estados").delete().lt("criado_em", new Date(Date.now() - ESTADO_OAUTH_MS).toISOString());
    const state = estadoAleatorio(24);
    const { error } = await db.from("yt_oauth_estados").insert({ state, user_id: user.id });
    if (error) return json({ error: "Banco sem a migration do YouTube (20261027100000)." }, 500);
    return json({ ok: true, url: urlAutorizacaoGoogle({ clientId: cred.clientId, redirectUri: redirectUriYoutube(), state }) });
  }

  if (b.acao === "definir-padrao") {
    // canal padrão do destino automático (só um; o índice único da migração 20261110120000 garante)
    const contaId = String(b.conta_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(contaId)) return json({ error: "conta_id inválido" }, 400);
    const { data: conta } = await db.from("yt_contas").select("id, status").eq("id", contaId).maybeSingle();
    if (!conta || conta.status !== "conectado") return json({ error: "canal não está conectado" }, 400);
    const { error: e1 } = await db.from("yt_contas").update({ padrao: false }).eq("padrao", true).neq("id", contaId);
    if (e1) return json({ error: `${e1.message} (rodou a migração 20261110120000?)` }, 400);
    const { error: e2 } = await db.from("yt_contas").update({ padrao: true }).eq("id", contaId);
    if (e2) return json({ error: e2.message }, 400);
    return json({ ok: true });
  }

  if (b.acao === "desconectar") {
    const contaId = String(b.conta_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(contaId)) return json({ error: "conta_id inválido" }, 400);
    const { data: conta } = await db.from("yt_contas").select("id, refresh_token_cifrado").eq("id", contaId).maybeSingle();
    if (!conta) return json({ error: "conta não encontrada" }, 404);
    let revogado = false;
    if (conta.refresh_token_cifrado) {
      try {
        revogado = await ClienteYouTube.revogar(await decifrarTokenYt(conta.refresh_token_cifrado as string, await segredo()));
      } catch {
        revogado = false;
      }
    }
    await db.from("yt_contas").update({
      refresh_token_cifrado: null, status: "desconectado", stream_id: null,
      ultimo_erro: revogado ? null : "token apagado aqui; confira em myaccount.google.com > Segurança > Apps com acesso",
      atualizado_em: new Date().toISOString(),
    }).eq("id", contaId);
    // desconectado não é padrão (separado: sem a migração 20261110120000 a coluna não existe e só este passo falha)
    await db.from("yt_contas").update({ padrao: false }).eq("id", contaId).then(() => null, () => null);
    return json({ ok: true, revogado });
  }

  return json({ error: "ação desconhecida" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      if (u.searchParams.has("diagnostico")) return json({ error: "não encontrado" }, 404); // virou POST autenticado
      return await callback(u);
    }
    if (req.method === "POST") return await acaoTela(req);
    return json({ error: "método não suportado" }, 405);
  } catch (e) {
    console.error("youtube-oauth", e instanceof Error ? e.message.slice(0, 120) : "erro");
    return json({ error: "erro interno" }, 500);
  }
});
