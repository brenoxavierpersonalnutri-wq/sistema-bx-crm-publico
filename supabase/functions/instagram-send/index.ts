// instagram-send: responde no Direct pelo CRM (texto, imagem, áudio, vídeo, PDF).
//
// POST JSON + JWT de usuário aprovado (verify_jwt = false, conferido aqui):
//   { phone: "ig:<IGSID>", texto?: string, midia?: { url, tipo: image|audio|video|document, nome?, mime?, tamanho? }, legenda?: string }
//
// Janela (regra da Meta, _shared/instagram.ts decidirJanela):
//   - até 24 h da ÚLTIMA mensagem da pessoa: envio normal (messaging_type RESPONSE);
//   - de 24 h a 7 dias: só com a tag HUMAN_AGENT, e só se integracao_config.instagram_human_agent = 'sim'
//     (o dono liga depois que a Meta aprovar o recurso Human Agent no App Review);
//   - fora disso: 409 { error, fora_da_janela: true } com o aviso pro atendente. Nada vai pra Meta.
// Texto acima de 1000 bytes vira várias mensagens. Legenda de mídia vai como texto logo depois
// (o Direct não tem legenda em anexo). Cada mensagem enviada é gravada em ig_mensagens com o mid.
// Permissões do CRM (22/11/2026): área/número/ação conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type ConteudoEnvio, type TipoMidiaCRM,
  corpoEnvio, decidirJanela, dividirTexto, igsidDoPhone, validarMidia,
} from "../_shared/instagram.ts";
import { prepararEnvIg, type ContaIg, configIg, corsIg, graph, jsonIg, mensagemErroEnvio, tokenDaConta } from "../_shared/instagramDb.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TIPOS: TipoMidiaCRM[] = ["image", "audio", "video", "document"];

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function usuarioAprovado(req: Request): Promise<{ id: string; cli: any } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const cli = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await cli.auth.getUser();
  if (!user) return null;
  const { data: aprovado } = await db.rpc("is_approved", { _user_id: user.id });
  return aprovado ? { id: user.id, cli } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsIg });
  if (req.method !== "POST") return jsonIg({ error: "método não suportado" }, 405);
  const usuario = await usuarioAprovado(req);
  if (!usuario) return jsonIg({ error: "Unauthorized" }, 401);
  // Direct não tem número do WhatsApp: vale a área Conversas "editar" + a ação "enviar"
  const acesso = await conferirAcessoCrm(usuario.cli, { area: "conversas", acao: "conversas.enviar" });
  if (!acesso.ok) return jsonIg({ error: acesso.erro }, acesso.status);
  await prepararEnvIg(db);

  const corpo = (await req.json().catch(() => ({}))) as {
    phone?: string; texto?: string; legenda?: string;
    midia?: { url?: string; tipo?: string; nome?: string; mime?: string; tamanho?: number };
  };
  const phone = String(corpo.phone ?? "");
  const igsid = igsidDoPhone(phone);
  if (!igsid) return jsonIg({ error: "Conversa do Instagram inválida." }, 400);

  // monta a fila do que vai sair
  const fila: ConteudoEnvio[] = [];
  if (corpo.midia) {
    const tipo = String(corpo.midia.tipo ?? "") as TipoMidiaCRM;
    const url = String(corpo.midia.url ?? "");
    if (!TIPOS.includes(tipo) || !/^https:\/\//.test(url)) return jsonIg({ error: "Mídia inválida (precisa de link https)." }, 400);
    const motivo = validarMidia(tipo, { mime: corpo.midia.mime, nome: corpo.midia.nome || url.split("?")[0], tamanho: corpo.midia.tamanho });
    if (motivo) return jsonIg({ error: motivo }, 422);
    fila.push({ midia: { tipo, url } });
  }
  for (const t of dividirTexto(String(corpo.texto ?? corpo.legenda ?? ""))) fila.push({ texto: t });
  if (!fila.length) return jsonIg({ error: "Nada para enviar." }, 400);

  const { data: contato } = await db.from("ig_contatos")
    .select("id, conta_id, ultima_entrada_em").eq("phone", phone).maybeSingle();
  if (!contato) return jsonIg({ error: "Contato do Instagram não encontrado." }, 404);
  const { data: conta } = await db.from("ig_contas")
    .select("id, ig_user_id, username, token_cifrado, token_expira_em, status").eq("id", contato.conta_id).maybeSingle();
  if (!conta || conta.status !== "conectado") return jsonIg({ error: "Instagram desconectado. Conecte de novo na Central." }, 409);

  const humanAgent = (await configIg(db, "instagram_human_agent")) === "sim";
  const janela = decidirJanela(contato.ultima_entrada_em, new Date(), humanAgent);
  if (!janela.pode || !janela.modo) return jsonIg({ error: janela.aviso, fora_da_janela: true }, 409);

  let token: string;
  try {
    token = await tokenDaConta(conta as ContaIg);
  } catch {
    return jsonIg({ error: "Token do Instagram ilegível. Conecte de novo na Central." }, 409);
  }

  const enviados: string[] = [];
  for (const item of fila) {
    try {
      const r = await graph("me/messages", token, { metodo: "POST", corpo: corpoEnvio(igsid, item, janela.modo) });
      const mid = String(r.message_id ?? "") || null;
      if (mid) enviados.push(mid);
      const linha = {
        conta_id: conta.id, contato_id: contato.id, contact_phone: phone, direction: "outbound", sender_type: "human",
        body: "texto" in item ? item.texto : "",
        media_url: "midia" in item ? item.midia.url : null,
        media_type: "midia" in item ? item.midia.tipo : null,
        file_name: "midia" in item ? corpo.midia?.nome ?? null : null,
        mime_type: "midia" in item ? corpo.midia?.mime ?? null : null,
        message_id: mid, status: "sent", tag: janela.modo === "human_agent" ? "HUMAN_AGENT" : null, enviado_por: usuario.id,
      };
      // se o eco do webhook chegou antes, completa a linha dele (sender_type human, link da mídia)
      const { error } = await db.from("ig_mensagens").upsert(linha, { onConflict: "message_id" });
      if (error) console.error("instagram-send gravar", error.message);
    } catch (e) {
      const msg = mensagemErroEnvio(e);
      await db.from("ig_mensagens").insert({
        conta_id: conta.id, contato_id: contato.id, contact_phone: phone, direction: "outbound", sender_type: "human",
        body: "texto" in item ? item.texto : "", media_url: "midia" in item ? item.midia.url : null,
        media_type: "midia" in item ? item.midia.tipo : null, status: "failed", erro: msg, enviado_por: usuario.id,
      });
      return jsonIg({ error: msg, enviados: enviados.length }, 502);
    }
  }
  await db.from("ig_contatos").update({ updated_at: new Date().toISOString() }).eq("id", contato.id);
  return jsonIg({ ok: true, enviados: enviados.length, modo: janela.modo, janela_ate: janela.ate, aviso: janela.aviso });
});
