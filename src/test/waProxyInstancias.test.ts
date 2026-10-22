// wa-proxy com DUAS instâncias do OpenWA (19/10/2026, modelo híbrido): a principal (whatsapp-web.js) e a de grupos
// (Baileys, sessão grupos-1). Unidade de baseDaSessao/semSuporteNoMotor e ponta a ponta: sobe o server.mjs de verdade
// contra dois OpenWA falsos e confere que cada sessão vai para a SUA instância, com a SUA chave, e que o 501 do
// Baileys (sem histórico ao vivo) não quebra history, chats-recentes nem media-id.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  baseDaSessao, sessoesComBasePropria, semSuporteNoMotor, hmacHex, textoCanonico,
} from "../../infra/wa-proxy/lib.mjs";

const PADRAO = "http://headturbo-openwa-api:2785/api";

describe("wa-proxy: base do OpenWA por sessão", () => {
  const env = {
    OPENWA_BASE_GRUPOS_1: "http://headturbo-openwa-grupos-api:2785/api/",
    OPENWA_BASE_RUIM: "http://user:senha@x/api",
    OPENWA_BASE_VAZIA: "  ",
  };
  it("sessão padrão e extra sem variável ficam na base padrão (comportamento de antes)", () => {
    expect(baseDaSessao(null, env, PADRAO)).toBe(PADRAO);
    expect(baseDaSessao("comercial-fit-2", env, PADRAO)).toBe(PADRAO);
    expect(baseDaSessao("vazia", env, PADRAO)).toBe(PADRAO);
  });
  it("extra com OPENWA_BASE_<NOME> vai para a instância própria (sem barra final)", () => {
    expect(baseDaSessao("grupos-1", env, PADRAO)).toBe("http://headturbo-openwa-grupos-api:2785/api");
  });
  it("variável inválida ou nome inválido = null (503 só nela, nunca cai na instância errada)", () => {
    expect(baseDaSessao("ruim", env, PADRAO)).toBeNull();
    expect(baseDaSessao("../x", env, PADRAO)).toBeNull();
    expect(baseDaSessao("q", { OPENWA_BASE_Q: "ftp://x/api" }, PADRAO)).toBeNull();
    expect(baseDaSessao("q", { OPENWA_BASE_Q: "http://x/api?k=1" }, PADRAO)).toBeNull();
  });
  it("lista só as sessões com instância própria válida", () => {
    expect(sessoesComBasePropria(new Set(["grupos-1", "comercial-fit-2", "ruim"]), env, PADRAO)).toEqual(["grupos-1"]);
    expect(sessoesComBasePropria(new Set(["x"]), { OPENWA_BASE_X: PADRAO }, PADRAO)).toEqual([]);
  });
  it("501 é o único status de 'motor sem suporte'", () => {
    expect(semSuporteNoMotor(501)).toBe(true);
    for (const s of [200, 404, 500, 502, 503]) expect(semSuporteNoMotor(s)).toBe(false);
  });
});

type Pedido = { inst: string; metodo: string; url: string; chave: string };

/** OpenWA falso: registra cada pedido (instância, rota, chave) e responde conforme a rota. */
function openwaFalso(nome: string, sessoes: { id: string; name: string }[], historico501: boolean, log: Pedido[]) {
  return http.createServer((req, res) => {
    log.push({ inst: nome, metodo: req.method ?? "", url: req.url ?? "", chave: String(req.headers["x-api-key"] ?? "") });
    const json = (st: number, corpo: unknown) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
    const u = req.url ?? "";
    if (u === "/api/sessions") return json(200, sessoes);
    if (/\/sessions\/[^/]+$/.test(u)) return json(200, { status: nome === "grupos" ? "qr_ready" : "ready", phone: null });
    if (/\/history/.test(u)) {
      if (historico501) return json(501, { statusCode: 501, message: "Message history is not supported by the baileys engine" });
      return json(200, [{ id: "m1", body: "oi", fromMe: false, timestamp: 1, type: "chat" }]);
    }
    if (/\/messages\/[^/]+\/[^/]+\/media$/.test(u) || /\/media\//.test(u)) return json(404, { message: "not found" });
    if (/\/sessions\/id-lenta\/chats/.test(u)) { setTimeout(() => json(200, []), 1_500); return; }
    if (/\/chats/.test(u)) return json(200, [{ id: "5531999990000@c.us", name: "A", timestamp: 10, isGroup: false }]);
    return json(404, { message: "rota falsa" });
  });
}

const ouvir = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

describe("wa-proxy ponta a ponta: duas instâncias", () => {
  const SEGREDO = randomBytes(32).toString("hex");
  const log: Pedido[] = [];
  const principal = openwaFalso("principal", [{ id: "id-closer", name: "closer" }, { id: "id-fit", name: "comercial-fit-2" }, { id: "id-lenta", name: "lenta" }], false, log);
  const grupos = openwaFalso("grupos", [{ id: "id-grupos", name: "grupos-1" }], true, log);
  let proxy: ChildProcess;
  let portaProxy = 0;
  let dados = "";

  beforeAll(async () => {
    const pp = await ouvir(principal);
    const pg = await ouvir(grupos);
    portaProxy = await new Promise<number>((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
    dados = mkdtempSync(path.join(tmpdir(), "wa-proxy-teste-"));
    proxy = spawn(process.execPath, [path.resolve(__dirname, "../../infra/wa-proxy/server.mjs")], {
      env: {
        PATH: process.env.PATH, PORT: String(portaProxy), DATA_DIR: dados, WA_PROXY_SECRET: SEGREDO,
        OPENWA_BASE: `http://127.0.0.1:${pp}/api`, OPENWA_OPERATOR_KEY: "chave-closer", OPENWA_SESSION_NAME: "closer",
        OPENWA_SESSOES_EXTRAS: "comercial-fit-2,grupos-1,quebrada,lenta",
        OPENWA_OPERATOR_KEY_LENTA: "chave-lenta",
        // tetos encurtados: a lista da sessão "lenta" leva 1,5 s no OpenWA falso
        OPENWA_TIMEOUT_LISTA_RECENTES_MS: "500",
        OPENWA_OPERATOR_KEY_COMERCIAL_FIT_2: "chave-fit",
        OPENWA_OPERATOR_KEY_GRUPOS_1: "chave-grupos",
        OPENWA_BASE_GRUPOS_1: `http://127.0.0.1:${pg}/api`,
        OPENWA_OPERATOR_KEY_QUEBRADA: "chave-q",
        OPENWA_BASE_QUEBRADA: "nao-e-url",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    await new Promise<void>((ok, falha) => {
      const t = setTimeout(() => falha(new Error(`proxy não subiu: ${saida}`)), 8000);
      proxy.stdout!.on("data", (c) => { saida += c; if (saida.includes("\"inicio\"")) { clearTimeout(t); ok(); } });
    });
    const inicio = JSON.parse(saida.split("\n").find((l) => l.includes("\"inicio\""))!);
    expect(inicio.sessoesComInstanciaPropria).toEqual(["grupos-1"]);
    expect(inicio.sessoesComInstanciaInvalida).toEqual(["quebrada"]);
    expect(inicio.pronto).toBe(true);
  });

  afterAll(() => {
    proxy?.kill("SIGTERM");
    principal.close();
    grupos.close();
    if (dados) rmSync(dados, { recursive: true, force: true });
  });

  async function chamar(rota: string, corpo: Record<string, unknown>, assinar = true) {
    const texto = JSON.stringify(corpo);
    const caminho = `/v1/${rota}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (assinar) {
      headers["x-wa-timestamp"] = ts;
      headers["x-wa-nonce"] = nonce;
      headers["x-wa-signature"] = hmacHex(SEGREDO, textoCanonico(ts, nonce, "POST", caminho, texto));
    }
    const r = await fetch(`http://127.0.0.1:${portaProxy}${caminho}`, { method: "POST", headers, body: texto });
    const corpoResp = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.arrayBuffer();
    return { status: r.status, corpo: corpoResp as Record<string, unknown> | unknown[], headers: r.headers };
  }

  it("sem assinatura: 401 (nada chega a nenhum OpenWA)", async () => {
    const antes = log.length;
    const r = await chamar("status", {}, false);
    expect(r.status).toBe(401);
    expect(log.length).toBe(antes);
  });

  it("sessão padrão (closer) continua na instância principal com a chave padrão", async () => {
    log.length = 0;
    const r = await chamar("status", {});
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ status: "ready", phone: null });
    expect(log.every((p) => p.inst === "principal" && p.chave === "chave-closer")).toBe(true);
  });

  it("extra sem base própria (comercial-fit-2) continua na principal com a SUA chave", async () => {
    log.length = 0;
    const r = await chamar("status", { sessao: "comercial-fit-2" });
    expect(r.status).toBe(200);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((p) => p.inst === "principal" && p.chave === "chave-fit")).toBe(true);
    expect(log.some((p) => p.url.includes("/sessions/id-fit"))).toBe(true);
  });

  it("grupos-1 vai SÓ para a instância Baileys, com a chave dela (status e QR)", async () => {
    log.length = 0;
    const st = await chamar("status", { sessao: "grupos-1" });
    expect(st.status).toBe(200);
    expect(st.corpo).toEqual({ status: "qr_ready", phone: null });
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((p) => p.inst === "grupos" && p.chave === "chave-grupos")).toBe(true);
    expect(log.some((p) => p.url === "/api/sessions/id-grupos")).toBe(true);
  });

  it("base inválida: 503 só naquela sessão, sem chamar nenhuma instância", async () => {
    log.length = 0;
    const r = await chamar("status", { sessao: "quebrada" });
    expect(r.status).toBe(503);
    expect(log.length).toBe(0);
  });

  it("history com 501 do Baileys: 200 com lista vazia (sem histórico, não falha)", async () => {
    const r = await chamar("history", { sessao: "grupos-1", chatId: "120363000000000001@g.us", limit: 50 });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual([]);
    expect(r.headers.get("x-sem-historico")).toBe("1");
  });

  it("history na principal segue igual (mensagens reais)", async () => {
    const r = await chamar("history", { phone: "5531999990000", limit: 10 });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.corpo) && r.corpo.length).toBe(1);
  });

  it("chats-recentes com 501 no histórico: conversas sem mensagens e parcial=false", async () => {
    const r = await chamar("chats-recentes", { sessao: "grupos-1", limit: 5, porChat: 5 });
    expect(r.status).toBe(200);
    const c = r.corpo as { itens: { mensagens: unknown[] }[]; parcial: boolean };
    expect(c.parcial).toBe(false);
    expect(c.itens.every((i) => Array.isArray(i.mensagens) && i.mensagens.length === 0)).toBe(true);
  });

  it("media-id: sem arquivo e histórico 501 = 404 sem-historico (final, sem 5xx pra retry)", async () => {
    log.length = 0;
    const r = await chamar("media-id", { sessao: "grupos-1", chatId: "5531999990000@c.us", messageId: "true_5531999990000@c.us_ABCDEF0123456789" });
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ error: "sem-historico" });
    expect(log.every((p) => p.inst === "grupos")).toBe(true);
  });

  it("chats-recentes com OpenWA lento (sincronizando): 504 com o motivo legível, não 502 'falha no proxy'", async () => {
    const r = await chamar("chats-recentes", { sessao: "lenta", limit: 5, porChat: 5 });
    expect(r.status).toBe(504);
    const c = r.corpo as { error: string; motivo: string };
    expect(c.motivo).toBe("timeout");
    expect(c.error).toMatch(/sincronizando/);
  });

  it("chats-recentes do closer (sessão padrão) segue na principal e responde 200", async () => {
    log.length = 0;
    const r = await chamar("chats-recentes", { limit: 5, porChat: 5 });
    expect(r.status).toBe(200);
    expect((r.corpo as { itens: unknown[] }).itens.length).toBe(1);
    expect(log.every((p) => p.inst === "principal" && p.chave === "chave-closer")).toBe(true);
  });
});
