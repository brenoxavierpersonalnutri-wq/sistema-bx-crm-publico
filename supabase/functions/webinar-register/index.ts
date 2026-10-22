// Inscrição pública no webinário (verify_jwt = false). Devolve o link mágico da sala.
// Corpo: { slug, session_id?, nome, email, whatsapp?, utm?, site? }  (site = honeypot, tem que vir vazio)
// Reinscrição com o mesmo e-mail na mesma sessão devolve o mesmo link (não duplica nem reenvia lembrete).
import { sha256Hex, tokenInscricao } from "../_shared/liveCrypto.ts";
import { admin, corpoJson, corsHeaders, json, siteUrl } from "../_shared/livesHttp.ts";
import { normalizarWhatsapp, segredoInscricao } from "../_shared/webinarComum.ts";

const db = admin();
// Anti-abuso: cada inscrição com WhatsApp vira mensagem do NOSSO número. Sem limite, um robô
// inscreveria telefones de estranhos e queimaria o número. Teto por IP (hash, sem guardar o IP).
const MAX_POR_IP_HORA = 5;
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const b = await corpoJson(req, 8192);
  if (!b) return json({ error: "corpo inválido" }, 400);
  if (b.site) return json({ ok: true }); // robô

  const slug = String(b.slug ?? "").toLowerCase();
  const nome = String(b.nome ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase();
  const whatsapp = b.whatsapp ? normalizarWhatsapp(b.whatsapp) : null;
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return json({ error: "webinário inválido" }, 400);
  if (nome.length < 2) return json({ error: "informe seu nome" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json({ error: "e-mail inválido" }, 400);
  if (b.whatsapp && !whatsapp) return json({ error: "WhatsApp inválido (DDD + número)" }, 400);

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  const ipHash = ip ? await sha256Hex(`${ip}|${await segredoInscricao(db)}`) : null;
  if (ipHash) {
    const { count } = await db.from("webinar_registrations").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= MAX_POR_IP_HORA) return json({ error: "muitas inscrições deste endereço; tente mais tarde" }, 429);
  }

  const { data: w } = await db.from("webinars").select("id, slug").eq("slug", slug).eq("status", "publicado").maybeSingle();
  if (!w) return json({ error: "webinário não encontrado" }, 404);

  let sq = db.from("webinar_sessions").select("id, inicia_em, status").eq("webinar_id", w.id).neq("status", "encerrada");
  if (typeof b.session_id === "string") sq = sq.eq("id", b.session_id);
  const { data: sessoes } = await sq.order("inicia_em").limit(1);
  const sessao = sessoes?.[0];
  if (!sessao) return json({ error: "nenhuma sessão aberta para inscrição" }, 409);

  const utmIn = (b.utm && typeof b.utm === "object" ? b.utm : {}) as Record<string, unknown>;
  const utm = Object.fromEntries(
    UTM.filter((k) => typeof utmIn[k] === "string").map((k) => [k, String(utmIn[k]).slice(0, 200)]),
  );

  let { data: reg } = await db.from("webinar_registrations").select("id").eq("session_id", sessao.id).eq("email", email).maybeSingle();
  if (!reg) {
    const ins = await db
      .from("webinar_registrations")
      .insert({ webinar_id: w.id, session_id: sessao.id, nome, email, whatsapp, utm, ip_hash: ipHash })
      .select("id")
      .single();
    if (ins.error && ins.error.code !== "23505") return json({ error: "não foi possível inscrever" }, 500);
    reg = ins.data ?? (await db.from("webinar_registrations").select("id").eq("session_id", sessao.id).eq("email", email).single()).data;
  }
  if (!reg) return json({ error: "não foi possível inscrever" }, 500);

  const token = await tokenInscricao(reg.id, await segredoInscricao(db));
  return json({
    ok: true,
    token,
    inicia_em: sessao.inicia_em,
    sala_url: `${siteUrl()}/w/${w.slug}/sala?r=${encodeURIComponent(token)}`,
  });
});
