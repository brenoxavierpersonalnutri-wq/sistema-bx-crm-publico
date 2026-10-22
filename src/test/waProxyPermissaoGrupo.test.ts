// wa-proxy ponta a ponta (Disparo em grupo, 20/10/2026): group-info diz se o número é admin do grupo e se só
// admins enviam (lendo o telefone da própria sessão), e group-subject (nome do grupo) só vale para grupo da
// allowlist. Sobe o server.mjs de verdade contra um OpenWA falso; nada aqui fala com WhatsApp.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { hmacHex, textoCanonico } from "../../infra/wa-proxy/lib.mjs";

const CHAT = "120363000000000001@g.us";
const MEU = "5531999990000";
type Pedido = { metodo: string; url: string };

describe("wa-proxy: permissão do número no grupo e nome do grupo", () => {
  const SEGREDO = randomBytes(32).toString("hex");
  const log: Pedido[] = [];
  const openwa = http.createServer((req, res) => {
    log.push({ metodo: req.method ?? "", url: req.url ?? "" });
    const json = (st: number, corpo: unknown) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
    const u = req.url ?? "";
    if (u === "/api/sessions") return json(200, [{ id: "id-g", name: "grupos-1" }]);
    if (u === "/api/sessions/id-g") return json(200, { status: "ready", phone: MEU });
    if (u === `/api/sessions/id-g/groups/${encodeURIComponent(CHAT)}`) {
      return json(200, {
        id: CHAT, name: "Turma 01", announce: true, locked: false,
        participants: [{ id: `${MEU}@c.us`, number: MEU, isAdmin: true }, { id: "5521988887777@c.us", number: "5521988887777", isAdmin: false }],
      });
    }
    return json(404, { message: "rota falsa" });
  });
  let proxy: ChildProcess;
  let porta = 0;
  let dados = "";

  beforeAll(async () => {
    const po = await new Promise<number>((r) => openwa.listen(0, "127.0.0.1", () => r((openwa.address() as AddressInfo).port)));
    porta = await new Promise<number>((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
    dados = mkdtempSync(path.join(tmpdir(), "wa-proxy-perm-"));
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

  it("group-info: admin e só-admins-enviam, só com leituras (GET) no OpenWA, sem lista de participantes", async () => {
    log.length = 0;
    const r = await chamar("group-info", { sessao: "grupos-1", chatId: CHAT });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ chatId: CHAT, name: "Turma 01", participants: 2, souAdmin: true, announce: true, locked: false });
    expect(JSON.stringify(r.corpo)).not.toContain("5521988887777");
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((p) => p.metodo === "GET")).toBe(true);
  });

  it("group-subject fora da allowlist: 403 e nada chega ao OpenWA", async () => {
    log.length = 0;
    const r = await chamar("group-subject", { sessao: "grupos-1", chatId: CHAT, subject: "Turma 02" });
    expect(r.status).toBe(403);
    expect(log.filter((p) => p.metodo !== "GET")).toEqual([]);
  });
});
