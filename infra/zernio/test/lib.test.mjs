// node --test infra/zernio/test/
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  validarPublicacao, montarPostZernio, interpretarPost, interpretarErroHttp, assinaturaOk, nomeArquivo, corsCabecalhos,
} from "../lib.mjs";

const AGORA = Date.parse("2026-10-21T15:00:00Z");
const base = {
  card_ref: "breno-fit|viral|abc",
  perfil: "breno-fit",
  card_texto: "Magra não é definida",
  conta_id: "65f1c0a9e2b5af0012ab34cd",
  conta_nome: "brenoxavier",
  tipo: "feed",
  legenda: "legenda",
  midias: [{ url: "https://media.zernio.com/temp/a.jpg", tipo: "image" }],
  agendar_para: "2026-10-22T12:00:00-03:00",
};
const com = (o) => ({ ...base, ...o });

test("valida feed agendado e normaliza a data para UTC", () => {
  const r = validarPublicacao(base, AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.valor.agendado_para, "2026-10-22T15:00:00.000Z");
  assert.equal(r.valor.agora, false);
});

test("recusa horário no passado (a Zernio publicaria na hora)", () => {
  const r = validarPublicacao(com({ agendar_para: "2026-10-21T11:59:00-03:00" }), AGORA);
  assert.equal(r.ok, false);
  assert.match(r.erro, /2 minutos no futuro/);
});

test("recusa horário a menos de 2 minutos e sem fuso", () => {
  assert.equal(validarPublicacao(com({ agendar_para: new Date(AGORA + 60_000).toISOString() }), AGORA).ok, false);
  assert.match(validarPublicacao(com({ agendar_para: "2026-10-22T12:00:00" }), AGORA).erro, /sem fuso/);
  assert.equal(validarPublicacao(com({ agendar_para: "2027-06-01T12:00:00Z" }), AGORA).ok, false); // > 120 dias
});

test("sem data = postar agora", () => {
  const r = validarPublicacao(com({ agendar_para: null }), AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.valor.agora, true);
  assert.equal(r.valor.agendado_para, null);
});

test("regras de mídia por tipo", () => {
  const vid = { url: "https://x.com/v.mp4", tipo: "video" };
  const img = { url: "https://x.com/i.jpg", tipo: "image" };
  assert.equal(validarPublicacao(com({ tipo: "feed", midias: [vid] }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "feed", midias: [img, img] }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "reels", midias: [img] }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "reels", midias: [vid] }), AGORA).ok, true);
  assert.equal(validarPublicacao(com({ tipo: "carrossel", midias: [img] }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "carrossel", midias: [img, vid, img] }), AGORA).ok, true);
  assert.equal(validarPublicacao(com({ tipo: "carrossel", midias: Array(11).fill(img) }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "story", midias: [vid] }), AGORA).ok, true);
  assert.equal(validarPublicacao(com({ midias: [{ url: "http://x.com/i.jpg", tipo: "image" }] }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ midias: [{ url: "javascript:alert(1)", tipo: "image" }] }), AGORA).ok, false);
});

test("recusa conta fora do formato, tipo desconhecido e legenda longa", () => {
  assert.equal(validarPublicacao(com({ conta_id: "../accounts" }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ tipo: "tiktok" }), AGORA).ok, false);
  assert.equal(validarPublicacao(com({ legenda: "x".repeat(2201) }), AGORA).ok, false);
});

test("story não leva legenda", () => {
  const r = validarPublicacao(com({ tipo: "story", legenda: "ignorada" }), AGORA);
  assert.equal(r.valor.legenda, null);
});

test("monta o post da Zernio: agendado, nunca publishNow, metadata com o id do CRM", () => {
  const v = validarPublicacao(base, AGORA).valor;
  const p = montarPostZernio(v, "11111111-1111-1111-1111-111111111111", AGORA);
  assert.deepEqual(p.platforms, [{ platform: "instagram", accountId: base.conta_id }]);
  assert.equal(p.scheduledFor, "2026-10-22T15:00:00.000Z");
  assert.equal(p.publishNow, undefined);
  assert.equal(p.content, "legenda");
  assert.deepEqual(p.mediaItems, [{ type: "image", url: base.midias[0].url }]);
  assert.equal(p.metadata.crm_publicacao_id, "11111111-1111-1111-1111-111111111111");
});

test("postar agora = scheduledFor daqui a 60 s; story e reels levam platformSpecificData", () => {
  const agora = montarPostZernio(validarPublicacao(com({ agendar_para: null }), AGORA).valor, "x", AGORA);
  assert.equal(agora.scheduledFor, new Date(AGORA + 60_000).toISOString());
  const st = montarPostZernio(validarPublicacao(com({ tipo: "story", midias: [{ url: "https://x.com/v.mp4", tipo: "video" }] }), AGORA).valor, "x", AGORA);
  assert.deepEqual(st.platforms[0].platformSpecificData, { contentType: "story" });
  assert.equal(st.content, undefined);
  const rl = montarPostZernio(validarPublicacao(com({ tipo: "reels", midias: [{ url: "https://x.com/v.mp4", tipo: "video" }] }), AGORA).valor, "x", AGORA);
  assert.deepEqual(rl.platforms[0].platformSpecificData, { shareToFeed: true });
});

test("interpreta o post da Zernio (GET e webhook)", () => {
  assert.deepEqual(interpretarPost({ status: "scheduled", platforms: [{ platform: "instagram", status: "pending" }] }), { status: "agendado", link: null, erro: null });
  assert.deepEqual(interpretarPost({ status: "published", platforms: [{ platform: "instagram", status: "published", platformPostUrl: "https://www.instagram.com/p/A/" }] }), { status: "publicado", link: "https://www.instagram.com/p/A/", erro: null });
  assert.equal(interpretarPost({ status: "published", platforms: [{ platform: "instagram", status: "published", publishedUrl: "https://www.instagram.com/p/B/" }] }).link, "https://www.instagram.com/p/B/");
  const f = interpretarPost({ status: "failed", platforms: [{ platform: "instagram", status: "failed", errorMessage: "Instagram access token has expired.", errorCategory: "auth_expired" }] });
  assert.equal(f.status, "erro");
  assert.match(f.erro, /reconecte o Instagram/);
  assert.match(f.erro, /token has expired/);
  assert.equal(interpretarPost({ status: "failed", platforms: [{ platform: "instagram", status: "failed", error: "falhou x" }] }).erro, "falhou x");
  assert.equal(interpretarPost({ status: "cancelled", platforms: [] }).status, "cancelado");
  assert.equal(interpretarPost({ status: "publishing", platforms: [] }).status, "publicando");
  assert.equal(interpretarPost({ status: "algo-novo" }), null);
});

test("erro HTTP legível", () => {
  assert.match(interpretarErroHttp(403, { code: "ACCOUNT_DISCONNECTED", error: "x" }), /reconecte/);
  assert.match(interpretarErroHttp(401, {}), /chave da Zernio/);
  assert.match(interpretarErroHttp(429, {}), /25 posts por hora/);
  assert.match(interpretarErroHttp(409, { error: "This exact content" }), /duplicado/);
  assert.match(interpretarErroHttp(0, { error: "tempo esgotado" }), /HTTP 0/);
});

test("assinatura do webhook: HMAC-SHA256 hex do corpo cru", () => {
  const corpo = Buffer.from('{"id":"e1","event":"post.published"}');
  const sig = crypto.createHmac("sha256", "segredo").update(corpo).digest("hex");
  assert.equal(assinaturaOk(corpo, sig, "segredo"), true);
  assert.equal(assinaturaOk(corpo, sig, "outro"), false);
  assert.equal(assinaturaOk(Buffer.from(corpo.toString() + " "), sig, "segredo"), false);
  assert.equal(assinaturaOk(corpo, "sha256=" + sig, "segredo"), false);
  assert.equal(assinaturaOk(corpo, sig, ""), false);
  assert.equal(assinaturaOk(corpo, undefined, "segredo"), false);
});

test("nome de arquivo seguro e CORS só para origem permitida", () => {
  assert.equal(nomeArquivo("Vídeo Reels FINAL!!.MOV", "video/quicktime"), "Video-Reels-FINAL.mov");
  assert.equal(nomeArquivo("../../etc/passwd", "image/png"), "etc-passwd.png");
  assert.equal(corsCabecalhos("https://equipe.brenoxavier.com.br", ["https://equipe.brenoxavier.com.br"])["access-control-allow-origin"], "https://equipe.brenoxavier.com.br");
  assert.deepEqual(corsCabecalhos("https://malicioso.com", ["https://equipe.brenoxavier.com.br"]), {});
});
