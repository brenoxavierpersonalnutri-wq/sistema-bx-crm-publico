// Pareamento das credenciais do app do Instagram (VPS -> CRM) e o aviso "falta X".
import { describe, expect, it } from "vitest";
import { faltasConfigIg, lerAppIgGuardado, statusGravacaoIg, validarCorpoIg } from "../../supabase/functions/_shared/pareamentoIg";
import { assinarPareamento, conferirAssinatura } from "../../supabase/functions/_shared/pareamentoLive";

const SEG = "a".repeat(32);
const corpoOk = JSON.stringify({ app_id: "1234567890123456", app_secret: "ABCDEF0123456789abcdef0123456789" });

describe("validarCorpoIg", () => {
  it("aceita app_id numérico e secret de 32 hex, normaliza pra minúsculas", () => {
    const v = validarCorpoIg(corpoOk);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.valor).toBe('{"app_id":"1234567890123456","app_secret":"abcdef0123456789abcdef0123456789"}');
  });
  it.each([
    ["não JSON", "x"],
    ["array", "[]"],
    ["app_id com letra", JSON.stringify({ app_id: "12ab567", app_secret: "a".repeat(32) })],
    ["secret curto", JSON.stringify({ app_id: "1234567", app_secret: "a".repeat(31) })],
    ["secret não hex", JSON.stringify({ app_id: "1234567", app_secret: "z".repeat(32) })],
  ])("recusa %s", (_n, c) => expect(validarCorpoIg(c).ok).toBe(false));
});

describe("lerAppIgGuardado", () => {
  it("lê o JSON do pareamento e o formato com nomes do env", () => {
    expect(lerAppIgGuardado('{"app_id":"1","app_secret":"s"}')).toEqual({ app_id: "1", app_secret: "s" });
    expect(lerAppIgGuardado('{"IG_APP_ID":"1","IG_APP_SECRET":"s"}')).toEqual({ app_id: "1", app_secret: "s" });
    expect(lerAppIgGuardado("lixo")).toBeNull();
    expect(lerAppIgGuardado(null)).toBeNull();
  });
});

describe("faltasConfigIg", () => {
  it("diz o que falta, vazio quando pronto", () => {
    expect(faltasConfigIg({ appId: "", appSecret: "", segredoToken: "" })).toHaveLength(2);
    expect(faltasConfigIg({ appId: "1", appSecret: "s", segredoToken: "" })[0]).toMatch(/IG_TOKEN_SEGREDO/);
    expect(faltasConfigIg({ appId: "", appSecret: "s", segredoToken: SEG })[0]).toMatch(/IG_APP_ID e IG_APP_SECRET/);
    expect(faltasConfigIg({ appId: "1", appSecret: "s", segredoToken: SEG })).toEqual([]);
  });
});

describe("assinatura do pareamento (mesma do live-pareamento)", () => {
  it("assinatura certa passa; corpo trocado não", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "n0nce_de_teste_1234";
    const assinatura = await assinarPareamento(SEG, ts, nonce, corpoOk);
    expect((await conferirAssinatura(SEG, { ts, nonce, assinatura }, corpoOk, Date.now())).ok).toBe(true);
    expect((await conferirAssinatura(SEG, { ts, nonce, assinatura }, corpoOk + " ", Date.now())).ok).toBe(false);
  });
});

describe("statusGravacaoIg", () => {
  it("mapeia a resposta da SQL", () => {
    expect(statusGravacaoIg("ok").status).toBe(200);
    expect(statusGravacaoIg("ja_pareado").status).toBe(410);
    expect(statusGravacaoIg("replay").status).toBe(409);
    expect(statusGravacaoIg(null).status).toBe(500);
  });
});
