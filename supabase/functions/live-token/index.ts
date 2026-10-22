// Token de acesso ao LiveKit para quem entra numa sala de live.
//
// Três portas (verify_jwt = false; cada uma confere a própria credencial):
//  { room_id }  + JWT de usuário com módulo lives -> produtor: publica, fica no palco, vê bastidores;
//  { convite }  token do link de convite (só o hash está no banco) -> convidado, entra nos bastidores;
//  { render }   token de leitura assinado (tokenRender) -> participante oculto, só assiste
//               (prévia do que sai na transmissão; o Egress usa o token que ele mesmo gera).
import { conferirTokenRender, sha256Hex, tokenAleatorio, tokenLiveKit, tokenRender } from "../_shared/liveCrypto.ts";
import { criarSala, envLiveKit } from "../_shared/livekitApi.ts";
import { admin, corpoJson, corsHeaders, json, siteUrl, usuarioLives } from "../_shared/livesHttp.ts";
import { metadataDaSala } from "../_shared/livesCena.ts";
import { segredoLiveOuNull } from "../_shared/liveSegredo.ts";

const db = admin();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const body = await corpoJson(req);
  if (!body) return json({ error: "corpo inválido" }, 400);

  let lk: Awaited<ReturnType<typeof envLiveKit>>;
  try {
    lk = await envLiveKit();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  // env LIVE_CHAVES_SEGREDO se existir; senão integracao_config 'live_chaves_segredo'
  const segredo = (await segredoLiveOuNull(db)) ?? "";

  // ---------------------------------------------------------------- produtor
  if (typeof body.room_id === "string") {
    const user = await usuarioLives(req);
    if (!user) return json({ error: "sem acesso ao módulo lives" }, 403);
    const { data: sala } = await db.from("live_rooms").select("*").eq("id", body.room_id).maybeSingle();
    if (!sala) return json({ error: "sala não encontrada" }, 404);
    try {
      await criarSala(sala.livekit_room, await metadataDaSala(db, sala.id));
    } catch (_) {
      // sala já existe ou servidor fora: o join cria a sala de qualquer jeito
    }
    const identity = `prod_${user.id.slice(0, 8)}_${tokenAleatorio(3)}`;
    const token = await tokenLiveKit({
      apiKey: lk.apiKey,
      apiSecret: lk.apiSecret,
      identity,
      // nome exibido escolhido na pré-sala (opcional); sem ele, o nome do cadastro
      name: typeof body.nome === "string" && body.nome.trim() ? body.nome.trim().slice(0, 60) : user.nome,
      grant: { room: sala.livekit_room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
      attributes: { stage: "1", stage_ordem: "0", papel: "produtor" },
    });
    const render = segredo.length >= 32 ? await tokenRender(sala.id, segredo) : null;
    return json({
      url: lk.wsUrl,
      token,
      identity,
      sala: sala.livekit_room,
      render_url: render ? `${siteUrl()}/lives/render/${sala.id}?t=${encodeURIComponent(render)}` : null,
    });
  }

  // ---------------------------------------------------------------- convidado
  if (typeof body.convite === "string") {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(body.convite)) return json({ error: "convite inválido" }, 400);
    const hash = await sha256Hex(body.convite);
    const { data: conv } = await db
      .from("live_invites")
      .select("id, room_id, nome_convidado, expira_em, revogado")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!conv || conv.revogado || Date.parse(conv.expira_em) < Date.now()) {
      return json({ error: "convite inválido ou expirado" }, 403);
    }
    const { data: sala } = await db.from("live_rooms").select("livekit_room, titulo, status").eq("id", conv.room_id).maybeSingle();
    if (!sala || sala.status === "encerrada") return json({ error: "esta live já foi encerrada" }, 410);
    const nome = typeof body.nome === "string" && body.nome.trim() ? body.nome.trim().slice(0, 60) : conv.nome_convidado;
    const identity = `conv_${conv.id.slice(0, 8)}_${tokenAleatorio(3)}`;
    const token = await tokenLiveKit({
      apiKey: lk.apiKey,
      apiSecret: lk.apiSecret,
      identity,
      name: nome,
      ttlSeg: 4 * 3600,
      grant: { room: sala.livekit_room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
      attributes: { stage: "0", papel: "convidado" },
    });
    await db.from("live_invites").update({ usado_em: new Date().toISOString() }).eq("id", conv.id).is("usado_em", null);
    return json({ url: lk.wsUrl, token, identity, titulo: sala.titulo });
  }

  // ---------------------------------------------------------------- render (leitura)
  if (typeof body.render === "string") {
    const roomId = segredo.length >= 32 ? await conferirTokenRender(body.render, segredo) : null;
    if (!roomId) return json({ error: "token de leitura inválido ou vencido" }, 403);
    const { data: sala } = await db.from("live_rooms").select("livekit_room").eq("id", roomId).maybeSingle();
    if (!sala) return json({ error: "sala não encontrada" }, 404);
    const token = await tokenLiveKit({
      apiKey: lk.apiKey,
      apiSecret: lk.apiSecret,
      identity: `ver_${tokenAleatorio(6)}`,
      ttlSeg: 2 * 3600,
      grant: { room: sala.livekit_room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, hidden: true },
    });
    return json({ url: lk.wsUrl, token });
  }

  return json({ error: "informe room_id, convite ou render" }, 400);
});
