// Entrada na sala (verify_jwt = false): confere o token do link mágico e devolve o que a sala
// precisa — webinário, sessão (HLS), ofertas, roteiro do chat. Marca presença.
import { admin, corpoJson, corsHeaders, json } from "../_shared/livesHttp.ts";
import { CAMPOS_OFERTA, inscricaoDoToken } from "../_shared/webinarComum.ts";

const db = admin();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const b = await corpoJson(req, 2048);
  const reg = await inscricaoDoToken(db, b?.token);
  if (!reg) return json({ error: "link inválido" }, 403);

  const [{ data: w }, { data: s }, { data: ofertas }, { data: roteiro }] = await Promise.all([
    db.from("webinars").select("id, slug, titulo, descricao, capa_url, hls_offset_seg, chat_ativo, mostrar_presentes, status").eq("id", reg.webinar_id).single(),
    db.from("webinar_sessions").select("id, inicia_em, status, iniciada_em, encerrada_em, hls_url").eq("id", reg.session_id).single(),
    db.from("webinar_offers").select(CAMPOS_OFERTA).eq("webinar_id", reg.webinar_id).eq("ativo", true).order("ordem"),
    db.from("webinar_chat_script").select("id, aos_seg, autor_nome, texto").eq("webinar_id", reg.webinar_id).order("aos_seg"),
  ]);
  if (!w || w.status === "arquivado") return json({ error: "webinário indisponível" }, 410);

  const agora = new Date().toISOString();
  await db.from("webinar_registrations").update({ ultimo_acesso: agora }).eq("id", reg.id);
  if (s?.status === "ao_vivo") {
    await db.from("webinar_attendance").upsert(
      { session_id: reg.session_id, registration_id: reg.id, ultimo_ping: agora },
      { onConflict: "session_id,registration_id", ignoreDuplicates: false },
    );
  }

  return json({
    webinar: w,
    sessao: s,
    nome: reg.nome.split(" ")[0],
    utm: reg.utm ?? {},
    ofertas: ofertas ?? [],
    roteiro: roteiro ?? [],
    agora,
  });
});
