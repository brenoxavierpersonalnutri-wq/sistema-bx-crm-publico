// Rota "desconectar" do headturbo-wa-proxy (21/10/2026), de ponta a ponta: sobe o server.mjs DE VERDADE (processo
// node) apontando para dois OpenWA falsos (instância principal e a de grupos/Baileys) e confere, pelas requisições
// que cada um recebeu, que o logout vai para a instância certa com a chave da sessão, que o start vem depois, que o
// cache de status/QR só daquela sessão é limpo, os limites, o `confirmar` e as mensagens de erro legíveis.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AddressInfo } from "node:net";
import {
  hmacHex, textoCanonico, respostaDesconectar, montarPedidoOpenwa, LeituraDeEstado, LimitadorPareamento, ROTAS,
  timeoutDoPedido, temposDoProxy, TEMPO_DESCONECTAR_MS,
} from "../../infra/wa-proxy/lib.mjs";

type Pedido = { metodo: string; caminho: string; chave: string };
type Falso = {
  servidor: http.Server; url: string; pedidos: Pedido[];
  logout: Record<string, number>; start: Record<string, number>;
};

async function openwaFalso(): Promise<Falso> {
  const f = { pedidos: [] as Pedido[], logout: {} as Record<string, number>, start: {} as Record<string, number> } as Falso;
  f.servidor = http.createServer((req, res) => {
    f.pedidos.push({ metodo: req.method ?? "", caminho: req.url ?? "", chave: String(req.headers["x-api-key"] ?? "") });
    const m = /^\/api\/sessions\/([^/]+)(\/(logout|start))?$/.exec(req.url ?? "");
    const json = (st: number, corpo: unknown) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(corpo)); };
    if (!m) return json(404, { message: "não existe" });
    const id = decodeURIComponent(m[1]);
    if (req.method === "GET" && !m[3]) return json(200, { id, status: "ready", phone: "5531999990000" });
    if (req.method === "POST" && m[3] === "logout") {
      const st = f.logout[id] ?? 200;
      if (st === 200) return json(200, { id, status: "disconnected", phone: null });
      if (st === 400) return json(400, { message: "Session is not started" });
      if (st === 502) return json(502, { message: "logout incomplete", code: "SESSION_LOGOUT_INCOMPLETE" });
      return json(st, { message: "falhou" });
    }
    if (req.method === "POST" && m[3] === "start") {
      const st = f.start[id] ?? 200;
      return st === 200 ? json(200, { id, status: "initializing" }) : json(st, { message: "não subiu" });
    }
    return json(404, { message: "não existe" });
  });
  await new Promise<void>((r) => f.servidor.listen(0, "127.0.0.1", () => r()));
  f.url = `http://127.0.0.1:${(f.servidor.address() as AddressInfo).port}/api`;
  return f;
}

const SEGREDO = randomBytes(32).toString("hex");
let principal: Falso;
let grupos: Falso;
let proxy: ChildProcess;
let portaProxy = 0;
const logsProxy: string[] = [];

async function chamar(rota: string, corpo: unknown, assinar = true) {
  const texto = JSON.stringify(corpo);
  const caminho = `/v1/${rota}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (assinar) {
    headers["X-WA-Timestamp"] = ts;
    headers["X-WA-Nonce"] = nonce;
    headers["X-WA-Signature"] = hmacHex(SEGREDO, textoCanonico(ts, nonce, "POST", caminho, texto));
  }
  const r = await fetch(`http://127.0.0.1:${portaProxy}${caminho}`, { method: "POST", headers, body: texto });
  return { status: r.status, corpo: await r.json().catch(() => ({})), cache: r.headers.get("x-cache") };
}

const idas = (f: Falso, fim: string) => f.pedidos.filter((p) => p.caminho.endsWith(fim));

beforeAll(async () => {
  principal = await openwaFalso();
  grupos = await openwaFalso();
  const livre = http.createServer();
  await new Promise<void>((r) => livre.listen(0, "127.0.0.1", () => r()));
  portaProxy = (livre.address() as AddressInfo).port;
  await new Promise<void>((r) => livre.close(() => r()));
  proxy = spawn(process.execPath, [path.resolve(__dirname, "../../infra/wa-proxy/server.mjs")], {
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(portaProxy),
      WA_PROXY_SECRET: SEGREDO,
      DATA_DIR: mkdtempSync(path.join(tmpdir(), "wa-proxy-teste-")),
      OPENWA_BASE: principal.url,
      OPENWA_OPERATOR_KEY: "chave-closer",
      OPENWA_SESSION_ID: "uuid-closer",
      OPENWA_SESSION_NAME: "closer",
      OPENWA_SESSOES_EXTRAS: "comercial-fit-2,grupos-1",
      OPENWA_OPERATOR_KEY_COMERCIAL_FIT_2: "chave-fit",
      OPENWA_SESSION_ID_COMERCIAL_FIT_2: "uuid-fit",
      OPENWA_OPERATOR_KEY_GRUPOS_1: "chave-grupos",
      OPENWA_SESSION_ID_GRUPOS_1: "uuid-grupos",
      OPENWA_BASE_GRUPOS_1: grupos.url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`proxy não subiu: ${logsProxy.join("")}`)), 8000);
    proxy.stdout?.on("data", (b: Buffer) => {
      logsProxy.push(b.toString());
      if (b.toString().includes('"evento":"inicio"')) { clearTimeout(t); resolve(); }
    });
    proxy.stderr?.on("data", (b: Buffer) => logsProxy.push(b.toString()));
  });
}, 15000);

afterAll(async () => {
  proxy?.kill("SIGTERM");
  await Promise.all([principal, grupos].map((f) => new Promise<void>((r) => f.servidor.close(() => r()))));
});

beforeEach(() => {
  for (const f of [principal, grupos]) { f.pedidos.length = 0; f.logout = {}; f.start = {}; }
});

describe("proxy (processo real): rota desconectar", () => {
  it("rota existe e exige assinatura (sem assinatura = 401, não 404)", async () => {
    const r = await chamar("desconectar", { sessao: "comercial-fit-2", confirmar: "comercial-fit-2" }, false);
    expect(r.status).toBe(401);
    expect(principal.pedidos).toHaveLength(0);
  });

  it("sessão Baileys (grupos-1): logout e start na instância de grupos, com a chave dela; principal intocada", async () => {
    const r = await chamar("desconectar", { sessao: "grupos-1", confirmar: "grupos-1" });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ desconectado: true, reiniciada: true, status: "initializing" });
    expect(grupos.pedidos.map((p) => `${p.metodo} ${p.caminho} ${p.chave}`)).toEqual([
      "POST /api/sessions/uuid-grupos/logout chave-grupos",
      "POST /api/sessions/uuid-grupos/start chave-grupos",
    ]);
    expect(principal.pedidos).toHaveLength(0);
  });

  it("sessão wwebjs (comercial-fit-2): instância principal; limpa só o cache dessa sessão", async () => {
    // aquece o cache de status das duas sessões da principal
    expect((await chamar("status", { sessao: "comercial-fit-2" })).status).toBe(200);
    expect((await chamar("status", {})).status).toBe(200);
    expect((await chamar("status", { sessao: "comercial-fit-2" })).cache).toBe("cache");
    principal.pedidos.length = 0;

    const r = await chamar("desconectar", { sessao: "comercial-fit-2", confirmar: "comercial-fit-2" });
    expect(r.status).toBe(200);
    expect(principal.pedidos.map((p) => `${p.metodo} ${p.caminho} ${p.chave}`)).toEqual([
      "POST /api/sessions/uuid-fit/logout chave-fit",
      "POST /api/sessions/uuid-fit/start chave-fit",
    ]);
    expect(grupos.pedidos).toHaveLength(0);

    // a sessão desconectada vai ao OpenWA de novo; a outra (closer) continua no cache
    const fit = await chamar("status", { sessao: "comercial-fit-2" });
    expect(fit.cache).toBeNull();
    expect(idas(principal, "/sessions/uuid-fit")).toHaveLength(1);
    const closer = await chamar("status", {});
    expect(closer.cache).toBe("cache");
    expect(idas(principal, "/sessions/uuid-closer")).toHaveLength(0);
  });

  it("confirmar errado ou ausente: 400 sem tocar no OpenWA (corpo sem sessao nunca derruba a padrão por engano)", async () => {
    for (const corpo of [
      { sessao: "comercial-fit-2", confirmar: "closer" },
      { confirmar: "comercial-fit-2" },
      { sessao: "comercial-fit-2" },
      { sessao: "comercial-fit-2", confirmar: "comercial-fit-2", phone: "5531999998888" },
    ]) {
      const r = await chamar("desconectar", corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(400);
    }
    expect((await chamar("desconectar", { sessao: "outra-sessao", confirmar: "outra-sessao" })).status).toBe(400);
    expect(idas(principal, "/logout")).toHaveLength(0);
  });

  it("padrão (closer) com confirmar = closer desconecta a padrão", async () => {
    const r = await chamar("desconectar", { confirmar: "closer" });
    expect(r.status).toBe(200);
    expect(idas(principal, "/logout").map((p) => p.caminho)).toEqual(["/api/sessions/uuid-closer/logout"]);
    expect(idas(principal, "/logout")[0].chave).toBe("chave-closer");
  });

  it("logout recusado/incompleto: erro legível e NÃO tenta start", async () => {
    grupos.logout["uuid-grupos"] = 400;
    const r400 = await chamar("desconectar", { sessao: "grupos-1", confirmar: "grupos-1" });
    expect(r400.status).toBe(409);
    expect(r400.corpo.error).toMatch(/já estava desconectado/);
    expect(idas(grupos, "/start")).toHaveLength(0);

    principal.logout["uuid-fit"] = 502;
    const r502 = await chamar("desconectar", { sessao: "comercial-fit-2", confirmar: "comercial-fit-2" });
    expect(r502.status).toBe(502);
    expect(r502.corpo.error).toMatch(/não confirmou a desconexão/);
    expect(idas(principal, "/start")).toHaveLength(0);
  });

  it("start falhou depois do logout: 200 desconectado, reiniciada false, com aviso", async () => {
    principal.start["uuid-closer"] = 500;
    const r = await chamar("desconectar", { confirmar: "closer" });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ desconectado: true, reiniciada: false, status: "disconnected" });
    expect(r.corpo.aviso).toMatch(/não voltou a pedir QR/);
  });

  it("limite por sessão: grupos-1 já usou 2 no minuto, a 3ª é 429 sem ir ao OpenWA", async () => {
    const r = await chamar("desconectar", { sessao: "grupos-1", confirmar: "grupos-1" });
    expect(r.status).toBe(429);
    expect(r.corpo.error).toMatch(/desconexões por minuto/);
    expect(grupos.pedidos).toHaveLength(0);
  });

  it("o log do proxy registra a desconexão sem chave nem segredo", () => {
    const tudo = logsProxy.join("");
    expect(tudo).toContain('"rota":"desconectar"');
    expect(tudo).toContain('"evento":"desconectar"');
    expect(tudo).not.toContain("chave-fit");
    expect(tudo).not.toContain(SEGREDO);
  });
});

describe("proxy (lógica pura): desconectar", () => {
  it("rota nova na lista; pedido só com confirmar válido", () => {
    expect(ROTAS).toContain("desconectar");
    expect(montarPedidoOpenwa("desconectar", { confirmar: "grupos-1" }, "u-1")).toEqual({
      metodo: "POST", caminho: "/sessions/u-1/logout", desconectar: true, confirmar: "grupos-1", reiniciar: "/sessions/u-1/start",
    });
    expect(montarPedidoOpenwa("desconectar", {}, "u-1").erro).toBeTruthy();
    expect(montarPedidoOpenwa("desconectar", { confirmar: "../x" }, "u-1").erro).toBeTruthy();
    expect(montarPedidoOpenwa("desconectar", { confirmar: "a", text: "oi" }, "u-1").erro).toBeTruthy();
    // confirmar não abre campo novo nas outras rotas
    expect(montarPedidoOpenwa("status", { confirmar: "closer" }, "u-1").erro).toBeTruthy();
    expect(timeoutDoPedido({ desconectar: true }, temposDoProxy({}))).toBe(TEMPO_DESCONECTAR_MS);
  });

  it("LeituraDeEstado.limpar apaga status e qr só daquela sessão; reservarIda respeita orçamento e bloqueio", () => {
    const e = new LeituraDeEstado({ porMinuto: 2 });
    e.guardar("status", "B", "a", { status: "ready" }, 0);
    e.guardar("qr", "B", "a", { qrCode: "x" }, 0);
    e.guardar("status", "B", "b", { status: "ready" }, 0);
    expect(e.limpar("B", "a")).toBe(2);
    expect(e.consultar("status", "B", "a", 1).usar).toBe("openwa");
    expect(e.consultar("status", "B", "b", 1).usar).toBe("cache");
    const f = new LeituraDeEstado({ porMinuto: 2 });
    expect(f.reservarIda("logout", "B", 0).ok).toBe(true);
    expect(f.reservarIda("logout", "B", 1).ok).toBe(true);
    expect(f.reservarIda("logout", "B", 2)).toMatchObject({ ok: false });
    expect(f.reservarIda("logout", "OUTRA", 2).ok).toBe(true);
    f.bloquear("start", "B", 30, 0);
    expect(f.reservarIda("start", "B", 1000)).toMatchObject({ ok: false, retryAfter: 29 });
  });

  it("LimitadorPareamento com rótulo próprio não muda o texto do código de pareamento", () => {
    const p = new LimitadorPareamento(1, 5);
    p.reservar("s", 0);
    expect(p.reservar("s", 1).motivo).toBe("limite de códigos por minuto");
    const d = new LimitadorPareamento(1, 5, "desconexões");
    d.reservar("s", 0);
    expect(d.reservar("s", 1).motivo).toBe("limite de desconexões por minuto");
  });

  it("respostaDesconectar: textos legíveis para cada resultado do OpenWA", () => {
    expect(respostaDesconectar({ status: 200, dados: {} }, { status: 200, dados: { status: "qr_ready" } }))
      .toEqual({ status: 200, corpo: { desconectado: true, reiniciada: true, status: "qr_ready" } });
    expect(respostaDesconectar({ status: 200, dados: {} }, null).corpo).toMatchObject({ reiniciada: false });
    expect(respostaDesconectar({ status: 200, dados: {} }, { status: 0 }).corpo).toMatchObject({ reiniciada: false });
    expect(respostaDesconectar({ status: 404, dados: {} }, null)).toMatchObject({ status: 404 });
    expect(respostaDesconectar({ status: 403, dados: {} }, null).corpo.error).toMatch(/permissão/);
    expect(respostaDesconectar({ status: 409, dados: {} }, null).corpo.error).toMatch(/outra operação/);
    expect(respostaDesconectar({ status: 500, dados: { message: "x" } }, null)).toMatchObject({ status: 502 });
  });
});
