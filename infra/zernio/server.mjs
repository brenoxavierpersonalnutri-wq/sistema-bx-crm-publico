// headturbo-zernio: ponte CRM (equipe.brenoxavier.com.br) -> Zernio, para publicar e agendar no Instagram.
// Node 22, só a biblioteca padrão. Roda na VPS como serviço systemd (headturbo-zernio.service), atrás do Caddy em
// https://SEU_VPS/zernio/*. Ver README.md.
//
// Segredos: chegam como credenciais do systemd (LoadCredential) em $CREDENTIALS_DIRECTORY, nunca em argumento,
// variável de ambiente, log ou repositório:
//   zernio.key     chave da API da Zernio (vem do cofre do kit; vazio = serviço no ar, publicação recusada com 503)
//   sync.secret    segredo do serviço junto ao banco (o banco guarda só o sha256; ver a migration)
//   webhook.secret segredo HMAC do webhook da Zernio
//   anon.key       anon key PÚBLICA do Supabase (a mesma do front; arquivo só por conveniência)
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validarPublicacao, montarPostZernio, interpretarPost, interpretarErroHttp, assinaturaOk, sha256hex,
  corsCabecalhos, nomeArquivo, resumirConta, ehUuid, MIME_ACEITOS,
} from "./lib.mjs";

const UPLOAD_MAX = 1024 * 1024 * 1024; // 1 GiB
const JSON_MAX = 256 * 1024;

function lerArquivo(dir, nome) {
  try {
    return fs.readFileSync(path.join(dir, nome), "utf8").trim();
  } catch {
    return "";
  }
}

function log(...partes) {
  // Nunca recebe token, chave nem corpo de requisição: só nomes, ids e status.
  console.log(new Date().toISOString(), ...partes);
}

export function criarServico(cfg) {
  const c = {
    zernioBase: "https://zernio.com/api",
    supabaseUrl: "https://SEU_PROJECT_REF.supabase.co",
    origens: ["https://equipe.brenoxavier.com.br"],
    pollMs: 60_000,
    credDir: process.env.CREDENTIALS_DIRECTORY || "/etc/headturbo-zernio",
    timeoutMs: 30_000,
    ...Object.fromEntries(Object.entries(cfg || {}).filter(([, v]) => v !== undefined)),
  };
  const cred = (nome) => lerArquivo(c.credDir, nome);
  const chaveZernio = () => cred("zernio.key");
  const segredoSync = () => cred("sync.secret");
  const segredoWebhook = () => cred("webhook.secret");
  const anon = () => cred("anon.key");

  // ------------------------------------------------------------------ HTTP de saída
  async function chamar(url, opcoes = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opcoes.timeoutMs || c.timeoutMs);
    try {
      const r = await fetch(url, { ...opcoes, signal: ctl.signal });
      const texto = await r.text();
      let corpo = null;
      try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = { error: texto.slice(0, 300) }; }
      return { status: r.status, corpo };
    } catch (e) {
      return { status: 0, corpo: { error: e.name === "AbortError" ? "tempo esgotado" : "sem conexão" } };
    } finally {
      clearTimeout(t);
    }
  }

  function zernio(metodo, caminho, corpo, extras = {}) {
    const chave = chaveZernio();
    if (!chave) return Promise.resolve({ status: 503, corpo: { error: "chave da Zernio não instalada na VPS" }, semChave: true });
    return chamar(`${c.zernioBase}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", ...extras },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      timeoutMs: 60_000,
    });
  }

  function rpc(nome, args, token) {
    const a = anon();
    return chamar(`${c.supabaseUrl}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: a, authorization: `Bearer ${token || a}`, "content-type": "application/json" },
      body: JSON.stringify(args || {}),
    });
  }

  // ------------------------------------------------------------------ quem é o usuário
  const cacheAuth = new Map(); // sha256(token) -> { uid, admin, ate }
  async function autenticar(req) {
    const h = req.headers.authorization || "";
    const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(h);
    if (!m) return { erro: 401, msg: "faça login no CRM" };
    const token = m[1];
    const k = sha256hex(token);
    const cache = cacheAuth.get(k);
    if (cache && cache.ate > Date.now()) return { token, ...cache };
    const u = await chamar(`${c.supabaseUrl}/auth/v1/user`, { headers: { apikey: anon(), authorization: `Bearer ${token}` } });
    if (u.status !== 200 || !ehUuid(u.corpo?.id)) return { erro: 401, msg: "sessão expirada: entre de novo no CRM" };
    const a = await rpc("conteudo_meu_acesso", {}, token);
    if (a.status !== 200 || !a.corpo) return { erro: 503, msg: "não consegui conferir seu acesso (a migration do Conteúdo foi aplicada?)" };
    if (!a.corpo.aprovado) return { erro: 403, msg: "seu usuário ainda não foi aprovado" };
    if (!a.corpo.conteudo) return { erro: 403, msg: "seu usuário não tem acesso à publicação do Conteúdo" };
    const info = { uid: u.corpo.id, admin: !!a.corpo.admin, ate: Date.now() + 60_000 };
    if (cacheAuth.size > 500) cacheAuth.clear();
    cacheAuth.set(k, info);
    return { token, ...info };
  }

  // ------------------------------------------------------------------ pareamento com o banco
  let pareado = false;
  async function conferirPareamento(tokenAdmin) {
    if (pareado) return true;
    const seg = segredoSync();
    if (!seg) return false;
    const e = await rpc("conteudo_zernio_estado", { p_segredo: seg });
    if (e.status === 200 && e.corpo === "ok") { pareado = true; return true; }
    if (e.status === 200 && e.corpo === "vazio" && tokenAdmin) {
      const p = await rpc("conteudo_zernio_parear", { p_hash: sha256hex(seg) }, tokenAdmin);
      log("pareamento com o banco:", p.status, typeof p.corpo === "string" ? p.corpo : "");
      if (p.status === 200 && p.corpo === "ok") { pareado = true; return true; }
    }
    if (e.status === 200 && e.corpo === "diferente") log("pareamento: o banco tem OUTRO segredo (rode SELECT public.conteudo_zernio_reabrir(); como admin)");
    return false;
  }

  async function sincronizar(id, zernioId, estado) {
    const r = await rpc("conteudo_pub_sincronizar", {
      p_segredo: segredoSync(), p_id: id || null, p_zernio_post_id: zernioId || null,
      p_status: estado.status, p_link: estado.link || null, p_erro: estado.erro || null,
    });
    if (r.status !== 200) log("sincronizar falhou:", r.status, id || zernioId);
    return r.status === 200;
  }

  // ------------------------------------------------------------------ contas
  let cacheContas = null;
  async function contasInstagram(forcar = false) {
    if (!forcar && cacheContas && cacheContas.ate > Date.now()) return cacheContas.r;
    const r = await zernio("GET", "/v1/accounts?platform=instagram");
    if (r.status === 200 && Array.isArray(r.corpo?.accounts)) {
      const contas = r.corpo.accounts.filter((a) => a.platform === "instagram").map(resumirConta);
      const res = { status: 200, contas };
      cacheContas = { r: res, ate: Date.now() + 60_000 };
      return res;
    }
    return { status: r.semChave ? 503 : 502, erro: r.semChave ? r.corpo.error : interpretarErroHttp(r.status, r.corpo) };
  }

  // ------------------------------------------------------------------ rotas
  function responder(res, status, corpo, cab = {}) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cab });
    res.end(JSON.stringify(corpo));
  }

  function lerCorpo(req, max) {
    return new Promise((resolve, reject) => {
      const partes = [];
      let total = 0;
      req.on("data", (p) => {
        total += p.length;
        if (total > max) { reject(Object.assign(new Error("grande"), { http: 413 })); req.destroy(); return; }
        partes.push(p);
      });
      req.on("end", () => resolve(Buffer.concat(partes)));
      req.on("error", reject);
    });
  }

  async function lerJson(req) {
    const buf = await lerCorpo(req, JSON_MAX);
    try { return JSON.parse(buf.toString("utf8")); } catch { throw Object.assign(new Error("json"), { http: 400 }); }
  }

  const porUsuario = new Map(); // uid -> [timestamps] (limite de publicações por hora)
  function dentroDoLimite(uid, max = 30) {
    const agora = Date.now();
    const lista = (porUsuario.get(uid) || []).filter((t) => t > agora - 3600_000);
    if (lista.length >= max) return false;
    lista.push(agora);
    porUsuario.set(uid, lista);
    return true;
  }

  async function rotaPublicar(req, res, cab) {
    const u = await autenticar(req);
    if (u.erro) return responder(res, u.erro, { erro: u.msg }, cab);
    const entrada = await lerJson(req);
    const v = validarPublicacao(entrada);
    if (!v.ok) return responder(res, 400, { erro: v.erro }, cab);
    if (!chaveZernio()) return responder(res, 503, { erro: "chave da Zernio não instalada na VPS" }, cab);
    if (!(await conferirPareamento(u.admin ? u.token : null))) {
      return responder(res, 503, { erro: "serviço ainda não pareado com o banco: abra o Conteúdo uma vez logado como admin" }, cab);
    }
    const contas = await contasInstagram();
    if (contas.status !== 200) return responder(res, contas.status, { erro: contas.erro }, cab);
    const conta = contas.contas.find((x) => x.id === v.valor.conta_id);
    if (!conta) return responder(res, 400, { erro: "essa conta não está conectada na Zernio como Instagram" }, cab);
    if (!conta.ativa) return responder(res, 400, { erro: `a conta @${conta.usuario || "?"} precisa ser reconectada na Zernio` }, cab);
    if (!dentroDoLimite(u.uid)) return responder(res, 429, { erro: "limite de 30 publicações por hora por usuário" }, cab);

    const valor = { ...v.valor, conta_nome: conta.usuario || v.valor.conta_nome };
    const criado = await rpc("conteudo_pub_criar", { p: valor }, u.token);
    if (criado.status !== 200 || !ehUuid(criado.corpo)) {
      log("conteudo_pub_criar falhou:", criado.status);
      return responder(res, criado.status === 403 ? 403 : 502, { erro: criado.corpo?.message || "não consegui registrar a publicação no banco" }, cab);
    }
    const id = criado.corpo;
    const corpo = montarPostZernio(valor, id);
    // Idempotency-Key = id da linha: se a rede cair e o mesmo envio for repetido, a Zernio devolve o post original.
    let r = await zernio("POST", "/v1/posts", corpo, { "idempotency-key": id });
    if (r.status === 0 || r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await zernio("POST", "/v1/posts", corpo, { "idempotency-key": id });
    }
    const post = r.corpo?.post;
    let estado;
    if ((r.status === 200 || r.status === 201 || r.status === 207) && post) {
      // 207 = criado mas a publicação imediata não fechou: post.status diz se falhou (failed) ou se a Zernio repete (scheduled).
      estado = interpretarPost(post) || { status: "agendado", link: null, erro: null };
    } else {
      estado = { status: "erro", link: null, erro: interpretarErroHttp(r.status, r.corpo) };
    }
    const zid = typeof post?._id === "string" ? post._id : null;
    await sincronizar(id, zid, estado);
    log("publicar:", id, "zernio", r.status, "->", estado.status);
    return responder(res, estado.status === "erro" ? 422 : 200, { id, zernio_post_id: zid, ...estado }, cab);
  }

  async function rotaCancelar(req, res, cab) {
    const u = await autenticar(req);
    if (u.erro) return responder(res, u.erro, { erro: u.msg }, cab);
    const { id } = await lerJson(req);
    if (!ehUuid(id)) return responder(res, 400, { erro: "id inválido" }, cab);
    // Lê com o token do próprio usuário: a RLS decide se ele enxerga a linha.
    const l = await chamar(`${c.supabaseUrl}/rest/v1/conteudo_publicacoes?id=eq.${id}&select=id,status,zernio_post_id`, {
      headers: { apikey: anon(), authorization: `Bearer ${u.token}` },
    });
    const linha = Array.isArray(l.corpo) ? l.corpo[0] : null;
    if (!linha) return responder(res, 404, { erro: "publicação não encontrada" }, cab);
    if (linha.status !== "agendado" && linha.status !== "enviando") {
      return responder(res, 409, { erro: `não dá para cancelar: está ${linha.status}` }, cab);
    }
    if (!(await conferirPareamento(u.admin ? u.token : null))) return responder(res, 503, { erro: "serviço não pareado com o banco" }, cab);
    if (linha.zernio_post_id) {
      const r = await zernio("DELETE", `/v1/posts/${encodeURIComponent(linha.zernio_post_id)}`);
      if (r.status !== 200 && r.status !== 404) {
        return responder(res, 502, { erro: r.status === 400 ? "a Zernio já publicou esse post (não dá para cancelar)" : interpretarErroHttp(r.status, r.corpo) }, cab);
      }
    }
    await sincronizar(id, null, { status: "cancelado", link: null, erro: null });
    log("cancelar:", id);
    return responder(res, 200, { id, status: "cancelado" }, cab);
  }

  const eventosVistos = new Set();
  async function rotaWebhook(req, res) {
    const cru = await lerCorpo(req, JSON_MAX);
    if (!assinaturaOk(cru, req.headers["x-zernio-signature"], segredoWebhook())) {
      return responder(res, 401, { erro: "assinatura inválida" });
    }
    let ev;
    try { ev = JSON.parse(cru.toString("utf8")); } catch { return responder(res, 400, { erro: "json" }); }
    const idEvento = String(req.headers["x-zernio-event-id"] || ev.id || "");
    if (idEvento && eventosVistos.has(idEvento)) return responder(res, 200, { ok: true, repetido: true });
    if (idEvento) { eventosVistos.add(idEvento); if (eventosVistos.size > 2000) eventosVistos.clear(); }
    responder(res, 200, { ok: true }); // responde antes do trabalho lento (a Zernio espera 2xx em até 5 s)
    if (ev.test || !/^post\.(scheduled|published|failed|partial|cancelled)$/.test(ev.event || "")) return;
    const estado = interpretarPost(ev.post);
    if (!estado) return;
    const crmId = ev.post?.metadata?.crm_publicacao_id;
    if (await conferirPareamento(null)) await sincronizar(ehUuid(crmId) ? crmId : null, ev.post?.id || null, estado);
    log("webhook:", ev.event, ehUuid(crmId) ? crmId : ev.post?.id, "->", estado.status);
  }

  async function rotaMidia(req, res, cab, url) {
    const u = await autenticar(req);
    if (u.erro) return responder(res, u.erro, { erro: u.msg }, cab);
    const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const tipo = MIME_ACEITOS[mime];
    if (!tipo) return responder(res, 415, { erro: "formato não aceito (JPG, PNG, WEBP, MP4 ou MOV)" }, cab);
    const tam = Number(req.headers["content-length"]);
    if (!Number.isInteger(tam) || tam <= 0) return responder(res, 411, { erro: "tamanho do arquivo ausente" }, cab);
    if (tam > UPLOAD_MAX) return responder(res, 413, { erro: "arquivo acima de 1 GB" }, cab);
    const nome = nomeArquivo(decodeURIComponent(String(req.headers["x-nome-arquivo"] || url.searchParams.get("nome") || "")), mime);
    const p = await zernio("POST", "/v1/media/presign", { filename: nome, contentType: mime, size: tam });
    if (p.status !== 200 || !p.corpo?.uploadUrl || !p.corpo?.publicUrl) {
      return responder(res, p.semChave ? 503 : 502, { erro: p.semChave ? p.corpo.error : interpretarErroHttp(p.status, p.corpo) }, cab);
    }
    const destino = new URL(p.corpo.uploadUrl);
    const mod = destino.protocol === "https:" ? https : http;
    const st = await new Promise((resolve) => {
      const put = mod.request(destino, { method: "PUT", headers: { "content-type": mime, "content-length": tam }, timeout: 15 * 60_000 }, (r) => {
        r.resume();
        r.on("end", () => resolve(r.statusCode));
      });
      put.on("error", () => resolve(0));
      put.on("timeout", () => { put.destroy(); resolve(0); });
      req.on("aborted", () => { put.destroy(); resolve(-1); });
      req.pipe(put);
    });
    if (st === -1) return; // o navegador desistiu
    if (st < 200 || st >= 300) return responder(res, 502, { erro: `o armazenamento da Zernio recusou o arquivo (HTTP ${st})` }, cab);
    log("midia:", tipo, tam, "bytes");
    return responder(res, 200, { url: p.corpo.publicUrl, tipo }, cab);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const cab = corsCabecalhos(req.headers.origin, c.origens);
    try {
      if (req.method === "OPTIONS") { res.writeHead(cab["access-control-allow-origin"] ? 204 : 403, cab); return res.end(); }
      if (req.method === "GET" && url.pathname === "/saude") {
        return responder(res, 200, { ok: true, chave_zernio: !!chaveZernio(), pareado }, cab);
      }
      if (req.method === "GET" && url.pathname === "/v1/contas") {
        const u = await autenticar(req);
        if (u.erro) return responder(res, u.erro, { erro: u.msg }, cab);
        conferirPareamento(u.admin ? u.token : null).catch(() => {});
        const r = await contasInstagram(url.searchParams.get("forcar") === "1");
        return responder(res, r.status, r.status === 200 ? { contas: r.contas } : { erro: r.erro }, cab);
      }
      if (req.method === "POST" && url.pathname === "/v1/publicar") return await rotaPublicar(req, res, cab);
      if (req.method === "POST" && url.pathname === "/v1/cancelar") return await rotaCancelar(req, res, cab);
      if (req.method === "POST" && url.pathname === "/v1/midia") return await rotaMidia(req, res, cab, url);
      if (req.method === "POST" && url.pathname === "/webhook") return await rotaWebhook(req, res);
      // Só de dentro da VPS (o Caddy não repassa /interno e sempre põe X-Forwarded-For): prova de conexão, só leitura.
      if (req.method === "GET" && url.pathname === "/interno/contas" && !req.headers["x-forwarded-for"]) {
        const r = await contasInstagram(true);
        return responder(res, r.status, r.status === 200 ? { total: r.contas.length, contas: r.contas.map((x) => ({ usuario: x.usuario, ativa: x.ativa })) } : { erro: r.erro });
      }
      return responder(res, 404, { erro: "rota inexistente" }, cab);
    } catch (e) {
      if (res.headersSent) return;
      if (e.http) return responder(res, e.http, { erro: e.http === 413 ? "corpo grande demais" : "corpo inválido" }, cab);
      log("erro interno:", e.message);
      return responder(res, 500, { erro: "erro interno" }, cab);
    }
  });

  // ------------------------------------------------------------------ consulta periódica (sem webhook também funciona)
  let rodada = 0;
  let timer = null;
  async function sincronizarPendentes() {
    rodada++;
    if (!chaveZernio() || !(await conferirPareamento(null))) return { conferidos: 0 };
    const p = await rpc("conteudo_pub_pendentes", { p_segredo: segredoSync() });
    if (p.status !== 200 || !Array.isArray(p.corpo)) return { conferidos: 0 };
    const agora = Date.now();
    let conferidos = 0;
    for (const l of p.corpo) {
      const vence = l.agendado_para ? Date.parse(l.agendado_para) : agora;
      const devido = vence <= agora + 2 * 60_000 || l.status === "publicando";
      if (!l.zernio_post_id) {
        // Sem id da Zernio depois de 15 min: o envio caiu no meio. Não reenvia sozinho (poderia duplicar).
        if (l.status === "enviando" && Date.parse(l.criado_em) < agora - 15 * 60_000) {
          await sincronizar(l.id, null, { status: "erro", link: null, erro: "o envio foi interrompido; confira no painel da Zernio antes de enviar de novo" });
        }
        continue;
      }
      if (!devido && rodada % 30 !== 0) continue; // agendados distantes: a cada ~30 min
      const r = await zernio("GET", `/v1/posts/${encodeURIComponent(l.zernio_post_id)}`);
      conferidos++;
      if (r.status === 404) { await sincronizar(l.id, null, { status: "cancelado", link: null, erro: null }); continue; }
      if (r.status !== 200 || !r.corpo?.post) continue;
      const estado = interpretarPost(r.corpo.post);
      if (estado && estado.status !== l.status) await sincronizar(l.id, null, estado);
    }
    return { conferidos };
  }

  function iniciarConsulta() {
    const passo = async () => {
      try { await sincronizarPendentes(); } catch (e) { log("consulta periódica:", e.message); }
      timer = setTimeout(passo, c.pollMs);
    };
    timer = setTimeout(passo, 5_000);
  }

  function parar() {
    if (timer) clearTimeout(timer);
    return new Promise((ok) => server.close(() => ok()));
  }

  return { server, sincronizarPendentes, iniciarConsulta, parar, conferirPareamento };
}

// ------------------------------------------------------------------ execução direta
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const origens = (process.env.ZERNIO_CORS_ORIGENS || "https://equipe.brenoxavier.com.br").split(",").map((s) => s.trim()).filter(Boolean);
  const s = criarServico({
    origens,
    zernioBase: process.env.ZERNIO_BASE || undefined,
    supabaseUrl: process.env.SUPABASE_URL || undefined,
    pollMs: Number(process.env.ZERNIO_POLL_MS) || undefined,
  });
  const porta = Number(process.env.PORTA || 7891);
  const endereco = process.env.ENDERECO || "127.0.0.1";
  s.server.requestTimeout = 0; // upload grande; cada rota tem o próprio limite
  s.server.listen(porta, endereco, () => log(`headturbo-zernio ouvindo em ${endereco}:${porta}`));
  s.iniciarConsulta();
  const sair = () => s.parar().then(() => process.exit(0));
  process.on("SIGTERM", sair);
  process.on("SIGINT", sair);
}
