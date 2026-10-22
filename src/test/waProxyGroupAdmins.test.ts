// wa-proxy ponta a ponta (21/10/2026): group-admins confere o número com e sem o 9, ADICIONA quem não está no grupo,
// PROMOVE e relê o grupo. Reproduz o caso "Alunas MGMD 01": admins cadastrados como 5531990000103/5531990000104,
// mas o WhatsApp só conhece 553190000103/553190000104 (DDD 31 sem o 9). Sobe o server.mjs de verdade contra um
// OpenWA falso; nada aqui fala com WhatsApp.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { hmacHex, textoCanonico, variantesTelefoneBR, membrosDoGrupo, textoStatusParticipante } from "../../infra/wa-proxy/lib.mjs";

const CHAT = "120363000000000102@g.us";
const MEU = "553199990000";
const A1 = "553190000103";
const A2 = "553190000104";
const PRIVADO = "553197777777"; // existe, mas a privacidade recusa (403)

describe("wa-proxy lib: regra do 9 e leitura do grupo", () => {
  it("DDD 31+ tenta sem o 9 primeiro; DDD 11-28 com o 9; fixo fica como está", () => {
    expect(variantesTelefoneBR("5531990000103")).toEqual(["553190000103", "5531990000103"]);
    expect(variantesTelefoneBR("553190000103")).toEqual(["553190000103", "5531990000103"]);
    expect(variantesTelefoneBR("5511999998888")).toEqual(["5511999998888", "551199998888"]);
    expect(variantesTelefoneBR("551133334444")).toEqual(["551133334444"]);
    expect(variantesTelefoneBR("abc")).toEqual([]);
  });
  it("membrosDoGrupo lê id @c.us/@s.whatsapp.net e admin; @lid sem telefone fica de fora", () => {
    const m = membrosDoGrupo({ participants: [
      { id: `${MEU}@c.us`, isAdmin: true, isSuperAdmin: true },
      { id: `${A1}@s.whatsapp.net`, isAdmin: false },
      { id: "123456789012345@lid", isAdmin: true },
    ] });
    expect([...m.membros]).toEqual([MEU, A1]);
    expect([...m.admins]).toEqual([MEU]);
    expect(m.total).toBe(3);
  });
  it("códigos viram frase legível", () => {
    expect(textoStatusParticipante("add", 403)).toMatch(/privacidade/);
    expect(textoStatusParticipante("promote", 404)).toMatch(/não está no grupo/);
  });
});

describe("wa-proxy: group-admins adiciona e promove", () => {
  const SEGREDO = randomBytes(32).toString("hex");
  const log: { metodo: string; url: string; corpo: string }[] = [];
  const membros = new Map<string, boolean>(); // número -> admin
  const openwa = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => { corpo += c; });
    req.on("end", () => {
      log.push({ metodo: req.method ?? "", url: req.url ?? "", corpo });
      const json = (st: number, c: unknown) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
      const u = req.url ?? "";
      const g = `/api/sessions/id-g/groups/${encodeURIComponent(CHAT)}`;
      if (u === "/api/sessions") return json(200, [{ id: "id-g", name: "grupos-1" }]);
      if (u === "/api/sessions/id-g") return json(200, { status: "ready", phone: MEU });
      const chk = /^\/api\/sessions\/id-g\/contacts\/check\/(\d+)$/.exec(u);
      if (chk) {
        const existe = [A1, A2, PRIVADO].includes(chk[1]);
        return json(200, { number: chk[1], exists: existe, whatsappId: existe ? `${chk[1]}@c.us` : null });
      }
      if (u === g && req.method === "GET") {
        return json(200, { id: CHAT, name: "Alunas MGMD 01", participants: [...membros].map(([n, adm]) => ({ id: `${n}@c.us`, number: n, isAdmin: adm })) });
      }
      const ps = (JSON.parse(corpo || "{}").participants ?? []) as string[];
      if (u === `${g}/participants` && req.method === "POST") {
        const results = ps.map((p) => {
          const n = p.split("@")[0];
          if (n === PRIVADO) return { id: p, success: false, status: 403 };
          if (![A1, A2].includes(n)) return { id: p, success: false, status: 404 };
          membros.set(n, false);
          return { id: p, success: true, status: 200 };
        });
        return results.some((r) => r.success) ? json(200, { success: true, results }) : json(403, { message: "addParticipants failed for all" });
      }
      if (u === `${g}/participants/promote` && req.method === "POST") {
        const results = ps.map((p) => {
          const n = p.split("@")[0];
          if (!membros.has(n)) return { id: p, success: false, status: 404 };
          membros.set(n, true);
          return { id: p, success: true, status: 200 };
        });
        return results.some((r) => r.success) ? json(200, { success: true, results }) : json(403, { message: "promoteParticipants failed for all" });
      }
      return json(404, { message: "rota falsa" });
    });
  });
  let proxy: ChildProcess;
  let porta = 0;
  let dados = "";

  beforeAll(async () => {
    const po = await new Promise<number>((r) => openwa.listen(0, "127.0.0.1", () => r((openwa.address() as AddressInfo).port)));
    porta = await new Promise<number>((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
    dados = mkdtempSync(path.join(tmpdir(), "wa-proxy-admins-"));
    proxy = spawn(process.execPath, [path.resolve(__dirname, "../../infra/wa-proxy/server.mjs")], {
      env: {
        PATH: process.env.PATH, PORT: String(porta), DATA_DIR: dados, WA_PROXY_SECRET: SEGREDO,
        OPENWA_BASE: `http://127.0.0.1:${po}/api`, OPENWA_OPERATOR_KEY: "chave-closer", OPENWA_SESSION_NAME: "closer",
        OPENWA_SESSOES_EXTRAS: "grupos-1", OPENWA_OPERATOR_KEY_GRUPOS_1: "chave-grupos",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    await new Promise<void>((ok, falha) => {
      const t = setTimeout(() => falha(new Error(`proxy não subiu: ${saida}`)), 8000);
      proxy.stdout!.on("data", (c) => { saida += c; if (saida.includes("\"inicio\"")) { clearTimeout(t); ok(); } });
    });
  });

  afterAll(() => {
    proxy?.kill("SIGTERM");
    openwa.close();
    if (dados) rmSync(dados, { recursive: true, force: true });
  });

  async function chamar(rota: string, corpo: Record<string, unknown>) {
    const texto = JSON.stringify(corpo);
    const caminho = `/v1/${rota}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wa-timestamp": ts, "x-wa-nonce": nonce, "x-wa-signature": hmacHex(SEGREDO, textoCanonico(ts, nonce, "POST", caminho, texto)) },
      body: texto,
    });
    return { status: r.status, corpo: await r.json() as Record<string, unknown> };
  }

  it("fora da allowlist: 403 e nada de escrita no OpenWA", async () => {
    log.length = 0;
    const r = await chamar("group-admins", { sessao: "grupos-1", chatId: CHAT, participants: ["5531990000103"] });
    expect(r.status).toBe(403);
    expect(log.filter((p) => p.metodo !== "GET")).toEqual([]);
  });

  it("caso de hoje: números com o 9 a mais entram sem o 9 e viram admin", async () => {
    expect((await chamar("group-allowlist", { groups: [CHAT] })).status).toBe(200);
    membros.clear(); membros.set(MEU, true);
    log.length = 0;
    const r = await chamar("group-admins", { sessao: "grupos-1", chatId: CHAT, participants: ["5531990000103", "5531990000104"] });
    expect(r.status).toBe(200);
    expect(r.corpo.ok).toBe(true);
    expect(r.corpo.conferido).toBe(true);
    expect(r.corpo.participantes).toBe(3);
    const res = r.corpo.resultados as { telefone: string; numero: string; admin: boolean; verificado: boolean }[];
    expect(res.map((x) => [x.telefone, x.numero, x.admin, x.verificado])).toEqual([
      ["5531990000103", A1, true, true],
      ["5531990000104", A2, true, true],
    ]);
    const add = log.find((p) => p.url.endsWith("/participants") && p.metodo === "POST")!;
    expect(JSON.parse(add.corpo).participants).toEqual([`${A1}@c.us`, `${A2}@c.us`]);
    const prom = log.find((p) => p.url.endsWith("/participants/promote"))!;
    expect(JSON.parse(prom.corpo).participants).toEqual([`${A1}@c.us`, `${A2}@c.us`]);
  });

  it("refazer quando já são admins: não escreve nada, só confere", async () => {
    log.length = 0;
    const r = await chamar("group-admins", { sessao: "grupos-1", chatId: CHAT, participants: ["5531990000103", "5531990000104"] });
    expect(r.corpo.ok).toBe(true);
    expect(log.filter((p) => p.metodo === "POST")).toEqual([]);
  });

  it("privacidade (403) e número sem WhatsApp viram erro legível por telefone", async () => {
    membros.clear(); membros.set(MEU, true);
    const r = await chamar("group-admins", { sessao: "grupos-1", chatId: CHAT, participants: [PRIVADO, "5531988880000", "5531990000103"] });
    expect(r.status).toBe(200);
    expect(r.corpo.ok).toBe(false);
    const res = r.corpo.resultados as { telefone: string; admin: boolean; erro?: string }[];
    expect(res[0].admin).toBe(false);
    expect(res[0].erro).toMatch(/privacidade/);
    expect(res[1].erro).toMatch(/não tem WhatsApp/);
    expect(res[2].admin).toBe(true);
  });
});
