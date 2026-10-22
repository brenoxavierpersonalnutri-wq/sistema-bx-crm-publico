// Presença (verify_jwt = false): a sala chama a cada 30 s. Atualiza o último ping, soma o tempo
// assistido e devolve o estado vivo: status/HLS da sessão, ofertas, mensagem fixada e presentes.
import { admin, corpoJson, corsHeaders, json } from "../_shared/livesHttp.ts";
import { CAMPOS_OFERTA, inscricaoDoToken } from "../_shared/webinarComum.ts";

const db = admin();
const JANELA_SEG = 75;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const b = await corpoJson(req, 2048);
  const reg = await inscricaoDoToken(db, b?.token);
  if (!reg) return json({ error: "link inválido" }, 403);

  const { data: s } = await db.from("webinar_sessions").select("id, status, inicia_em, iniciada_em, encerrada_em, hls_url").eq("id", reg.session_id).single();
  const agora = Date.now();

  if (s?.status === "ao_vivo") {
    const { data: at } = await db.from("webinar_attendance").select("id, ultimo_ping, segundos_assistidos").eq("session_id", s.id).eq("registration_id", reg.id).maybeSingle();
    const delta = at ? Math.min(45, Math.max(0, Math.round((agora - Date.parse(at.ultimo_ping)) / 1000))) : 0;
    const linha = {
      session_id: s.id,
      registration_id: reg.id,
      ultimo_ping: new Date(agora).toISOString(),
      segundos_assistidos: (at?.segundos_assistidos ?? 0) + delta,
      ...(b?.clicou_oferta === true ? { clicou_oferta: true } : {}),
    };
    await db.from("webinar_attendance").upsert(linha, { onConflict: "session_id,registration_id" });
  }

  const [{ count }, { data: ofertas }, { data: fixada }] = await Promise.all([
    db.from("webinar_attendance").select("id", { count: "exact", head: true }).eq("session_id", reg.session_id)
      .gte("ultimo_ping", new Date(agora - JANELA_SEG * 1000).toISOString()),
    db.from("webinar_offers").select(CAMPOS_OFERTA).eq("webinar_id", reg.webinar_id).eq("ativo", true).order("ordem"),
    db.from("webinar_chat_messages").select("id, autor_nome, texto, papel").eq("session_id", reg.session_id)
      .eq("fixada", true).eq("oculta", false).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return json({ sessao: s, presentes: count ?? 0, ofertas: ofertas ?? [], fixada: fixada ?? null, agora: new Date(agora).toISOString() });
});
