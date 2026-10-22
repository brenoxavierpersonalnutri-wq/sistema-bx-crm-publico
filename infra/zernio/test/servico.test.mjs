// Teste de ponta a ponta do serviço contra uma Zernio FALSA e um Supabase FALSO (nada sai desta máquina).
// node --test infra/zernio/test/
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { criarServico } from "../server.mjs";

const CHAVE = "sk_teste_zernio_" + "k".repeat(40);
const SYNC = "s".repeat(64);
const WEBHOOK = "w".repeat(48);
const ANON = "anon.publica.teste";
const TOKEN_EDITORA = "tok-editora-" + "e".repeat(30);
const TOKEN_ADMIN = "tok-admin-" + "a".repeat(30);
const TOKEN_SEM = "tok-semacesso-" + "x".repeat(30);
const UID = { [TOKEN_EDITORA]: "c0000000-0000-0000-0000-00000000000e", [TOKEN_ADMIN]: "c0000000-0000-0000-0000-00000000000a", [TOKEN_SEM]: "c0000000-0000-0000-0000-000000000005" };
const CONTA = "65f1c0a9e2b5af0012ab34cd";
const CONTA_INATIVA = "65f1c0a9e2b5af0012ab34ce";
const ORIGEM = "https://equipe.brenoxavier.com.br";

// ------------------------------------------------------------------ Zernio + Supabase + armazenamento falsos
function falso() {
  const st = {
    chamadas: [], linhas: new Map(), hash: null, postsZernio: new Map(), falhar500: 0, respostaPost: null, upload: null, seq: 0,
  };
  const srv = http.createServer(async (req, res) => {
    const partes = [];
    for await (const p of req) partes.push(p);
    const corpo = Buffer.concat(partes);
    const url = new URL(req.url, "http://x");
    const j = () => { try { return JSON.parse(corpo.toString()); } catch { return null; } };
    st.chamadas.push({ metodo: req.method, caminho: url.pathname, busca: url.search, cab: req.headers, corpo: j(), bytes: corpo.length });
    const enviar = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const bearer = (req.headers.authorization || "").replace("Bearer ", "");

    // --- armazenamento (presigned PUT)
    if (url.pathname === "/upload/bucket/arquivo") {
      st.upload = { bytes: corpo.length, tipo: req.headers["content-type"], tam: req.headers["content-length"] };
      res.writeHead(200); return res.end();
    }
    // --- Zernio
    if (url.pathname.startsWith("/z/")) {
      if (bearer !== CHAVE) return enviar(401, { error: "Invalid API key" });
      const zp = url.pathname.slice(2);
      if (req.method === "GET" && zp === "/v1/accounts") {
        return enviar(200, { hasAnalyticsAccess: false, accounts: [
          { _id: CONTA, platform: "instagram", profileId: "p1", username: "brenoxavier", displayName: "Breno", isActive: true, accessToken: "NAO-PODE-VAZAR" },
          { _id: CONTA_INATIVA, platform: "instagram", profileId: "p1", username: "gabi", isActive: false },
          { _id: "65f1c0a9e2b5af0012ab34cf", platform: "twitter", profileId: "p1", username: "x", isActive: true },
        ] });
      }
      if (req.method === "POST" && zp === "/v1/posts") {
        if (st.falhar500 > 0) { st.falhar500--; return enviar(502, { error: "bad gateway" }); }
        if (st.respostaPost) return enviar(st.respostaPost.status, st.respostaPost.corpo);
        const id = (++st.seq).toString(16).padStart(24, "0");
        const b = j();
        const post = { _id: id, status: "scheduled", scheduledFor: b.scheduledFor, platforms: [{ platform: "instagram", accountId: { _id: b.platforms[0].accountId }, status: "pending" }] };
        st.postsZernio.set(id, post);
        return enviar(201, { post, message: "Post scheduled successfully" });
      }
      const m = /^\/v1\/posts\/([a-f0-9]{24})$/.exec(zp);
      if (m && req.method === "GET") { const p = st.postsZernio.get(m[1]); return p ? enviar(200, { post: p }) : enviar(404, { error: "not found" }); }
      if (m && req.method === "DELETE") { st.postsZernio.delete(m[1]); return enviar(200, { message: "Post deleted successfully" }); }
      if (req.method === "POST" && zp === "/v1/media/presign") {
        return enviar(200, { uploadUrl: `http://127.0.0.1:${srv.address().port}/upload/bucket/arquivo`, publicUrl: `https://media.zernio.com/temp/${j().filename}`, key: "temp/x", expiresIn: 3600 });
      }
      return enviar(404, { error: "rota falsa inexistente" });
    }
    // --- Supabase
    if (req.headers.apikey !== ANON) return enviar(401, { message: "no apikey" });
    if (url.pathname === "/auth/v1/user") return UID[bearer] ? enviar(200, { id: UID[bearer] }) : enviar(401, { message: "invalid JWT" });
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    const a = j() || {};
    const segredoOk = () => st.hash && crypto.createHash("sha256").update(a.p_segredo || "").digest("hex") === st.hash;
    if (rpc) {
      switch (rpc[1]) {
        case "conteudo_meu_acesso":
          if (!UID[bearer]) return enviar(401, {});
          return enviar(200, { aprovado: true, admin: bearer === TOKEN_ADMIN, conteudo: bearer !== TOKEN_SEM });
        case "conteudo_zernio_estado":
          return enviar(200, !st.hash ? "vazio" : segredoOk() ? "ok" : "diferente");
        case "conteudo_zernio_parear":
          if (bearer !== TOKEN_ADMIN) return enviar(403, { message: "só admin" });
          if (st.hash) return enviar(200, "ja_pareado");
          st.hash = a.p_hash; return enviar(200, "ok");
        case "conteudo_pub_criar": {
          if (!UID[bearer] || bearer === TOKEN_SEM) return enviar(403, { message: "sem acesso" });
          const id = crypto.randomUUID();
          st.linhas.set(id, { id, ...a.p, status: "enviando", zernio_post_id: null, criado_por: UID[bearer], criado_em: new Date().toISOString() });
          return enviar(200, id);
        }
        case "conteudo_pub_sincronizar": {
          if (!segredoOk()) return enviar(403, { message: "segredo" });
          const l = a.p_id ? st.linhas.get(a.p_id) : [...st.linhas.values()].find((x) => x.zernio_post_id === a.p_zernio_post_id);
          if (!l) return enviar(200, false);
          Object.assign(l, { status: a.p_status, zernio_post_id: l.zernio_post_id || a.p_zernio_post_id, link_post: a.p_link || l.link_post, erro: a.p_erro });
          return enviar(200, true);
        }
        case "conteudo_pub_pendentes":
          if (!segredoOk()) return enviar(403, { message: "segredo" });
          return enviar(200, [...st.linhas.values()].filter((l) => ["enviando", "agendado", "publicando"].includes(l.status)));
      }
    }
    if (url.pathname === "/rest/v1/conteudo_publicacoes") {
      if (!UID[bearer] || bearer === TOKEN_SEM) return enviar(200, []);
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      const l = st.linhas.get(id);
      return enviar(200, l ? [l] : []);
    }
    return enviar(404, { message: "supabase falso: rota inexistente" });
  });
  return { srv, st };
}

async function montar({ semChave = false } = {}) {
  const f = falso();
  await new Promise((ok) => f.srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${f.srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zcred-"));
  fs.writeFileSync(path.join(dir, "zernio.key"), semChave ? "" : CHAVE + "\n");
  fs.writeFileSync(path.join(dir, "sync.secret"), SYNC);
  fs.writeFileSync(path.join(dir, "webhook.secret"), WEBHOOK);
  fs.writeFileSync(path.join(dir, "anon.key"), ANON);
  const s = criarServico({ zernioBase: `${base}/z`, supabaseUrl: base, credDir: dir, origens: [ORIGEM] });
  await new Promise((ok) => s.server.listen(0, "127.0.0.1", ok));
  const svc = `http://127.0.0.1:${s.server.address().port}`;
  const pedir = (metodo, caminho, { token, corpo, cab = {} } = {}) => fetch(`${svc}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined && !Buffer.isBuffer(corpo) ? { "content-type": "application/json" } : {}), ...cab },
    body: corpo === undefined ? undefined : Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo),
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null), cab: r.headers }));
  const fechar = async () => { await s.parar(); await new Promise((ok) => f.srv.close(ok)); fs.rmSync(dir, { recursive: true, force: true }); };
  return { f, s, pedir, fechar };
}

const daquiA = (min) => new Date(Date.now() + min * 60_000).toISOString();
const pub = (o = {}) => ({
  card_ref: "breno-fit|viral|abc", perfil: "breno-fit", card_texto: "Magra não é definida", conta_id: CONTA, tipo: "feed",
  legenda: "teste", midias: [{ url: "https://media.zernio.com/temp/a.jpg", tipo: "image" }], agendar_para: daquiA(60), ...o,
});

// Captura o log: nenhum segredo pode aparecer nele.
const logs = [];
const logOriginal = console.log;
test.before(() => { console.log = (...a) => { logs.push(a.join(" ")); }; });
test.after(() => {
  console.log = logOriginal;
  const tudo = logs.join("\n");
  for (const s of [CHAVE, SYNC, WEBHOOK, TOKEN_EDITORA, TOKEN_ADMIN, "NAO-PODE-VAZAR"]) assert.equal(tudo.includes(s), false, "segredo no log");
});

test("saúde, CORS e rotas internas", async () => {
  const t = await montar();
  try {
    const s = await t.pedir("GET", "/saude");
    assert.equal(s.status, 200);
    assert.equal(s.corpo.chave_zernio, true);
    const pre = await fetch(`http://127.0.0.1:${t.s.server.address().port}/v1/publicar`, { method: "OPTIONS", headers: { origin: ORIGEM } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), ORIGEM);
    const ruim = await fetch(`http://127.0.0.1:${t.s.server.address().port}/v1/publicar`, { method: "OPTIONS", headers: { origin: "https://malicioso.com" } });
    assert.equal(ruim.status, 403);
    assert.equal(ruim.headers.get("access-control-allow-origin"), null);
    const interno = await t.pedir("GET", "/interno/contas", { cab: { "x-forwarded-for": "1.2.3.4" } });
    assert.equal(interno.status, 404, "/interno só sem X-Forwarded-For (o Caddy sempre põe)");
    const local = await t.pedir("GET", "/interno/contas");
    assert.equal(local.status, 200);
    assert.equal(local.corpo.total, 2);
  } finally { await t.fechar(); }
});

test("contas: exige login e acesso; devolve só Instagram, sem token", async () => {
  const t = await montar();
  try {
    assert.equal((await t.pedir("GET", "/v1/contas")).status, 401);
    assert.equal((await t.pedir("GET", "/v1/contas", { token: "tok-invalido-" + "z".repeat(30) })).status, 401);
    const sem = await t.pedir("GET", "/v1/contas", { token: TOKEN_SEM });
    assert.equal(sem.status, 403);
    assert.match(sem.corpo.erro, /acesso/);
    const r = await t.pedir("GET", "/v1/contas", { token: TOKEN_EDITORA });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.contas.map((c) => [c.usuario, c.ativa]), [["brenoxavier", true], ["gabi", false]]);
    assert.equal(JSON.stringify(r.corpo).includes("NAO-PODE-VAZAR"), false);
    const z = t.f.st.chamadas.find((c) => c.caminho === "/z/v1/accounts");
    assert.equal(z.busca, "?platform=instagram");
    assert.equal(z.cab.authorization, `Bearer ${CHAVE}`);
  } finally { await t.fechar(); }
});

test("publicar antes do pareamento: recusa; admin pareia com sha256 do segredo", async () => {
  const t = await montar();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 503);
    assert.match(r.corpo.erro, /pareado/);
    assert.equal(t.f.st.chamadas.some((c) => c.caminho === "/z/v1/posts"), false, "nada foi para a Zernio");
    await t.pedir("GET", "/v1/contas", { token: TOKEN_ADMIN });
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(t.f.st.hash, crypto.createHash("sha256").update(SYNC).digest("hex"));
    const parear = t.f.st.chamadas.find((c) => c.caminho === "/rest/v1/rpc/conteudo_zernio_parear");
    assert.equal(parear.corpo.p_segredo, undefined, "o segredo em si nunca vai para o banco");
  } finally { await t.fechar(); }
});

async function montarPareado(o) {
  const t = await montar(o);
  t.f.st.hash = crypto.createHash("sha256").update(SYNC).digest("hex");
  return t;
}

test("publicar agendado: grava com o JWT do usuário, manda à Zernio com Idempotency-Key e sincroniza", async () => {
  const t = await montarPareado();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.status, "agendado");
    const criar = t.f.st.chamadas.find((c) => c.caminho === "/rest/v1/rpc/conteudo_pub_criar");
    assert.equal(criar.cab.authorization, `Bearer ${TOKEN_EDITORA}`, "cria com o JWT do próprio usuário");
    const post = t.f.st.chamadas.find((c) => c.caminho === "/z/v1/posts" && c.metodo === "POST");
    assert.equal(post.cab["idempotency-key"], r.corpo.id);
    assert.equal(post.corpo.publishNow, undefined);
    assert.equal(post.corpo.platforms[0].accountId, CONTA);
    assert.ok(Date.parse(post.corpo.scheduledFor) > Date.now() + 50 * 60_000);
    assert.equal(post.corpo.metadata.crm_publicacao_id, r.corpo.id);
    const linha = t.f.st.linhas.get(r.corpo.id);
    assert.equal(linha.status, "agendado");
    assert.equal(linha.zernio_post_id, r.corpo.zernio_post_id);
    assert.equal(linha.conta_nome, "brenoxavier", "nome da conta vem da Zernio, não do navegador");
  } finally { await t.fechar(); }
});

test("publicar: passado, conta inativa, conta de outra rede e usuário sem acesso nunca chegam à Zernio", async () => {
  const t = await montarPareado();
  try {
    const passado = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub({ agendar_para: daquiA(-5) }) });
    assert.equal(passado.status, 400);
    const inativa = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub({ conta_id: CONTA_INATIVA }) });
    assert.equal(inativa.status, 400);
    assert.match(inativa.corpo.erro, /reconectada/);
    const tw = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub({ conta_id: "65f1c0a9e2b5af0012ab34cf" }) });
    assert.equal(tw.status, 400);
    const sem = await t.pedir("POST", "/v1/publicar", { token: TOKEN_SEM, corpo: pub() });
    assert.equal(sem.status, 403);
    const anon = await t.pedir("POST", "/v1/publicar", { corpo: pub() });
    assert.equal(anon.status, 401);
    assert.equal(t.f.st.chamadas.some((c) => c.caminho === "/z/v1/posts"), false);
    assert.equal(t.f.st.linhas.size, 0);
  } finally { await t.fechar(); }
});

test("publicar agora: agenda para daqui a ~60 s (nunca publishNow)", async () => {
  const t = await montarPareado();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub({ agendar_para: null }) });
    assert.equal(r.status, 200);
    const post = t.f.st.chamadas.find((c) => c.caminho === "/z/v1/posts");
    const dt = Date.parse(post.corpo.scheduledFor) - Date.now();
    assert.ok(dt > 45_000 && dt <= 61_000, `scheduledFor a ${dt} ms`);
    assert.equal(post.corpo.publishNow, undefined);
  } finally { await t.fechar(); }
});

test("Zernio 5xx: repete UMA vez com a mesma Idempotency-Key", async () => {
  const t = await montarPareado();
  try {
    t.f.st.falhar500 = 1;
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 200);
    const posts = t.f.st.chamadas.filter((c) => c.caminho === "/z/v1/posts");
    assert.equal(posts.length, 2);
    assert.equal(posts[0].cab["idempotency-key"], posts[1].cab["idempotency-key"]);
  } finally { await t.fechar(); }
});

test("Zernio recusa (conta desconectada): erro legível no card", async () => {
  const t = await montarPareado();
  try {
    t.f.st.respostaPost = { status: 403, corpo: { error: "Account is disconnected", code: "ACCOUNT_DISCONNECTED" } };
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 422);
    assert.match(r.corpo.erro, /reconecte o Instagram/);
    assert.equal(t.f.st.linhas.get(r.corpo.id).status, "erro");
  } finally { await t.fechar(); }
});

test("Zernio 207 com post failed: erro com a mensagem da plataforma", async () => {
  const t = await montarPareado();
  try {
    t.f.st.respostaPost = { status: 207, corpo: { post: { _id: "f".repeat(24), status: "failed", platforms: [{ platform: "instagram", status: "failed", errorMessage: "Media aspect ratio not supported", errorCategory: "user_content" }] }, error: "All platforms failed" } };
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 422);
    assert.match(r.corpo.erro, /aspect ratio/);
  } finally { await t.fechar(); }
});

test("sem chave da Zernio: 503 claro, nada gravado", async () => {
  const t = await montarPareado({ semChave: true });
  try {
    const s = await t.pedir("GET", "/saude");
    assert.equal(s.corpo.chave_zernio, false);
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    assert.equal(r.status, 503);
    assert.match(r.corpo.erro, /chave da Zernio/);
    assert.equal(t.f.st.linhas.size, 0);
  } finally { await t.fechar(); }
});

test("cancelar: DELETE na Zernio e status cancelado; não cancela publicado", async () => {
  const t = await montarPareado();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    const c = await t.pedir("POST", "/v1/cancelar", { token: TOKEN_EDITORA, corpo: { id: r.corpo.id } });
    assert.equal(c.status, 200);
    const del = t.f.st.chamadas.find((x) => x.metodo === "DELETE");
    assert.equal(del.caminho, `/z/v1/posts/${r.corpo.zernio_post_id}`);
    assert.equal(t.f.st.linhas.get(r.corpo.id).status, "cancelado");
    const de_novo = await t.pedir("POST", "/v1/cancelar", { token: TOKEN_EDITORA, corpo: { id: r.corpo.id } });
    assert.equal(de_novo.status, 409);
    const sem = await t.pedir("POST", "/v1/cancelar", { token: TOKEN_SEM, corpo: { id: r.corpo.id } });
    assert.equal(sem.status, 403);
    const lixo = await t.pedir("POST", "/v1/cancelar", { token: TOKEN_EDITORA, corpo: { id: "1 or 1=1" } });
    assert.equal(lixo.status, 400);
  } finally { await t.fechar(); }
});

test("webhook: assinatura obrigatória, publica com link, ignora repetido", async () => {
  const t = await montarPareado();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub() });
    const ev = { id: "evt-1", event: "post.published", timestamp: new Date().toISOString(), post: { id: r.corpo.zernio_post_id, content: "", status: "published", scheduledFor: "", metadata: { crm_publicacao_id: r.corpo.id }, platforms: [{ platform: "instagram", status: "published", publishedUrl: "https://www.instagram.com/p/OK/" }] } };
    const cru = Buffer.from(JSON.stringify(ev));
    const sig = crypto.createHmac("sha256", WEBHOOK).update(cru).digest("hex");
    const falsa = await t.pedir("POST", "/webhook", { corpo: cru, cab: { "content-type": "application/json", "x-zernio-signature": "0".repeat(64) } });
    assert.equal(falsa.status, 401);
    const semAss = await t.pedir("POST", "/webhook", { corpo: cru, cab: { "content-type": "application/json" } });
    assert.equal(semAss.status, 401);
    assert.equal(t.f.st.linhas.get(r.corpo.id).status, "agendado");
    const ok = await t.pedir("POST", "/webhook", { corpo: cru, cab: { "content-type": "application/json", "x-zernio-signature": sig, "x-zernio-event-id": "evt-1" } });
    assert.equal(ok.status, 200);
    await new Promise((x) => setTimeout(x, 150));
    const l = t.f.st.linhas.get(r.corpo.id);
    assert.equal(l.status, "publicado");
    assert.equal(l.link_post, "https://www.instagram.com/p/OK/");
    const rep = await t.pedir("POST", "/webhook", { corpo: cru, cab: { "content-type": "application/json", "x-zernio-signature": sig, "x-zernio-event-id": "evt-1" } });
    assert.equal(rep.corpo.repetido, true);
  } finally { await t.fechar(); }
});

test("consulta periódica: agendado vencido vira publicado com link", async () => {
  const t = await montarPareado();
  try {
    const r = await t.pedir("POST", "/v1/publicar", { token: TOKEN_EDITORA, corpo: pub({ agendar_para: null }) });
    const p = t.f.st.postsZernio.get(r.corpo.zernio_post_id);
    p.status = "published";
    p.platforms[0] = { platform: "instagram", status: "published", platformPostUrl: "https://www.instagram.com/p/POLL/" };
    const res = await t.s.sincronizarPendentes();
    assert.equal(res.conferidos, 1);
    const l = t.f.st.linhas.get(r.corpo.id);
    assert.equal(l.status, "publicado");
    assert.equal(l.link_post, "https://www.instagram.com/p/POLL/");
  } finally { await t.fechar(); }
});

test("upload de mídia: presign na Zernio e PUT do arquivo inteiro com Content-Length", async () => {
  const t = await montarPareado();
  try {
    const arquivo = crypto.randomBytes(300_000);
    const r = await t.pedir("POST", "/v1/midia", { token: TOKEN_EDITORA, corpo: arquivo, cab: { "content-type": "image/png", "x-nome-arquivo": encodeURIComponent("Capa Reels.png") } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.tipo, "image");
    assert.equal(r.corpo.url, "https://media.zernio.com/temp/Capa-Reels.png");
    const pre = t.f.st.chamadas.find((c) => c.caminho === "/z/v1/media/presign");
    assert.deepEqual(pre.corpo, { filename: "Capa-Reels.png", contentType: "image/png", size: 300_000 });
    assert.deepEqual(t.f.st.upload, { bytes: 300_000, tipo: "image/png", tam: "300000" });
    const pdf = await t.pedir("POST", "/v1/midia", { token: TOKEN_EDITORA, corpo: Buffer.from("x"), cab: { "content-type": "application/pdf" } });
    assert.equal(pdf.status, 415);
    const anon = await t.pedir("POST", "/v1/midia", { corpo: arquivo, cab: { "content-type": "image/png" } });
    assert.equal(anon.status, 401);
  } finally { await t.fechar(); }
});
