// instagram-webhook: recebe o Direct da(s) conta(s) conectada(s) (Instagram API with Instagram Login).
//
//  GET  verificação da Meta: hub.mode=subscribe + hub.verify_token == integracao_config.instagram_verify_token
//       -> devolve hub.challenge (texto puro); qualquer outra coisa -> 403.
//  POST eventos: confere X-Hub-Signature-256 (HMAC-SHA256 do corpo CRU com IG_APP_SECRET) ANTES de ler o JSON.
//       Sem assinatura válida -> 401 e nada é gravado. Com assinatura -> grava e devolve 200 rápido
//       (a Meta reenvia o que não recebe 200).
//
// O que grava (ig_contatos / ig_mensagens):
//  - mensagem da pessoa: cria/atualiza o contato (nome, @, foto via GET /<IGSID>), grava a mensagem e
//    atualiza ultima_entrada_em (a janela de 24 h conta daí);
//  - eco (o que a conta mandou, pelo CRM ou pelo app do celular): grava como saída, sem duplicar o que o
//    instagram-send já gravou (índice único no mid);
//  - lida: marca como "read" as saídas até o momento; postback: grava o título do botão como mensagem.
// verify_jwt = false (quem chama é a Meta).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type EventoIG, assinaturaValida, corpoDaMensagem, interpretarWebhook, phoneDoIgsid, respostaVerificacao,
} from "../_shared/instagram.ts";
import { type ContaIg, configIg, contaPorIgId, envIg, graph, prepararEnvIg, tokenDaConta } from "../_shared/instagramDb.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORPO_MAX = 1_000_000;
const PERFIL_VALIDADE_MS = 3 * 24 * 60 * 60 * 1000;

const texto = (t: string, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain" } });

type Contato = { id: string; name: string; username: string | null; avatar_atualizado_em: string | null };

async function garantirContato(conta: ContaIg, igsid: string, entrada: string | null): Promise<Contato | null> {
  const phone = phoneDoIgsid(igsid);
  const { data: existente } = await db.from("ig_contatos")
    .select("id, name, username, avatar_atualizado_em").eq("phone", phone).maybeSingle();
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: agora };
  if (entrada) patch.ultima_entrada_em = entrada;

  // perfil (nome, @, foto): na primeira vez e a cada 3 dias. Falhar aqui não impede gravar a mensagem.
  const velho = !existente?.avatar_atualizado_em || Date.now() - Date.parse(existente.avatar_atualizado_em) > PERFIL_VALIDADE_MS;
  if (velho) {
    try {
      const token = await tokenDaConta(conta);
      const p = await graph(igsid, token, { query: { fields: "name,username,profile_pic,follower_count,is_user_follow_business" } });
      if (p.name) patch.name = String(p.name);
      if (p.username) patch.username = String(p.username);
      if (p.profile_pic) patch.avatar_url = String(p.profile_pic);
      if (typeof p.follower_count === "number") patch.seguidores = p.follower_count;
      if (typeof p.is_user_follow_business === "boolean") patch.segue_voce = p.is_user_follow_business;
      patch.avatar_atualizado_em = agora;
    } catch (e) {
      console.warn("instagram-webhook perfil", e instanceof Error ? e.message : "erro");
    }
  }

  if (existente) {
    // janela só anda pra frente (eventos podem chegar fora de ordem)
    if (entrada) {
      await db.from("ig_contatos").update({ ...patch, ultima_entrada_em: undefined }).eq("id", existente.id);
      await db.from("ig_contatos").update({ ultima_entrada_em: entrada }).eq("id", existente.id)
        .or(`ultima_entrada_em.is.null,ultima_entrada_em.lt.${entrada}`);
    } else {
      await db.from("ig_contatos").update(patch).eq("id", existente.id);
    }
    return existente as Contato;
  }
  const { data: novo, error } = await db.from("ig_contatos").upsert({
    conta_id: conta.id, igsid, phone, stage: "leads", ...patch,
  }, { onConflict: "phone" }).select("id, name, username, avatar_atualizado_em").maybeSingle();
  if (error) {
    console.error("instagram-webhook contato", error.message);
    return null;
  }
  return novo as Contato;
}

async function gravarEvento(conta: ContaIg, e: EventoIG): Promise<void> {
  const phone = phoneDoIgsid(e.igsid);
  if (e.tipo === "mensagem" || e.tipo === "eco") {
    const contato = await garantirContato(conta, e.igsid, e.tipo === "mensagem" ? e.em : null);
    const anexo = e.anexos.find((a) => a.url && a.tipo !== "link") ?? e.anexos[0] ?? null;
    const linha = {
      conta_id: conta.id,
      contato_id: contato?.id ?? null,
      contact_phone: phone,
      direction: e.tipo === "mensagem" ? "inbound" : "outbound",
      sender_type: e.tipo === "mensagem" ? "lead" : "user",
      body: corpoDaMensagem(e) || (anexo && anexo.tipo === "link" && anexo.url ? anexo.url : ""),
      media_url: anexo && anexo.tipo !== "link" ? anexo.url : null,
      media_type: anexo && anexo.tipo !== "link" ? anexo.tipo : null,
      message_id: e.mid,
      status: e.tipo === "mensagem" ? "delivered" : "sent",
      created_at: e.em,
    };
    // mid único: eco do que o instagram-send já gravou não duplica
    const { error } = await db.from("ig_mensagens").upsert(linha, { onConflict: "message_id", ignoreDuplicates: true });
    if (error) console.error("instagram-webhook msg", error.message);
    // mais de um anexo (ex.: várias fotos): uma linha por anexo extra
    for (const [i, a] of e.anexos.filter((x) => x !== anexo && x.url && x.tipo !== "link").entries()) {
      await db.from("ig_mensagens").upsert(
        { ...linha, body: "", media_url: a.url, media_type: a.tipo, message_id: `${e.mid}#${i + 2}` },
        { onConflict: "message_id", ignoreDuplicates: true },
      );
    }
    return;
  }
  if (e.tipo === "apagada") {
    await db.from("ig_mensagens").update({ body: "Mensagem apagada", media_url: null, media_type: null }).eq("message_id", e.mid);
    return;
  }
  if (e.tipo === "lida") {
    const ate = e.watermark ? new Date(Number(e.watermark) < 1e12 ? Number(e.watermark) * 1000 : Number(e.watermark)).toISOString() : e.em;
    await db.from("ig_mensagens").update({ status: "read" })
      .eq("contact_phone", phone).eq("direction", "outbound").neq("status", "failed").lte("created_at", ate);
    return;
  }
  if (e.tipo === "postback") {
    const contato = await garantirContato(conta, e.igsid, e.em);
    await db.from("ig_mensagens").upsert({
      conta_id: conta.id, contato_id: contato?.id ?? null, contact_phone: phone, direction: "inbound", sender_type: "lead",
      body: e.titulo ? `[botão] ${e.titulo}` : `[botão] ${e.payload}`, message_id: e.mid ?? `pb-${e.igsid}-${e.em}`,
      status: "delivered", created_at: e.em,
    }, { onConflict: "message_id", ignoreDuplicates: true });
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const desafio = respostaVerificacao(url.searchParams, await configIg(db, "instagram_verify_token"));
    return desafio ? texto(desafio) : texto("forbidden", 403);
  }
  if (req.method !== "POST") return texto("method not allowed", 405);

  await prepararEnvIg(db);
  const segredo = envIg().appSecret;
  if (!segredo) return texto("not configured", 503);
  const cru = new Uint8Array(await req.arrayBuffer());
  if (cru.byteLength > CORPO_MAX) return texto("too large", 413);
  if (!(await assinaturaValida(cru, req.headers.get("x-hub-signature-256"), segredo))) return texto("invalid signature", 401);

  let corpo: unknown;
  try {
    corpo = JSON.parse(new TextDecoder().decode(cru));
  } catch {
    return texto("bad json", 400);
  }
  const eventos = interpretarWebhook(corpo);
  const contas = new Map<string, ContaIg | null>();
  for (const e of eventos) {
    if (!contas.has(e.contaIgId)) contas.set(e.contaIgId, await contaPorIgId(db, e.contaIgId));
    const conta = contas.get(e.contaIgId);
    if (!conta) continue; // conta que não está conectada no CRM: ignora
    try {
      await gravarEvento(conta, e);
    } catch (err) {
      console.error("instagram-webhook evento", e.tipo, err instanceof Error ? err.message : "erro");
    }
  }
  return texto("EVENT_RECEIVED");
});
