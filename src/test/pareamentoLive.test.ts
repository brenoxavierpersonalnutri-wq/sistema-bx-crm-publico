// Pareamento das lives (VPS -> CRM): HMAC, janela, nonce, corpo e mapeamento da SQL.
import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  assinarPareamento, conferirAssinatura, validarCorpo, hashCurto, lerConfigGuardada, statusDaGravacao, JANELA_SEG,
} from "../../supabase/functions/_shared/pareamentoLive";

const SEGREDO = "a".repeat(64);
const AGORA = Date.parse("2026-10-17T20:00:00Z");
const TS = String(Math.floor(AGORA / 1000));
const NONCE = "n0nce_unico-123456789";
const CORPO = JSON.stringify({ url: "https://livekit.brenoxavier.com.br", api_key: "APIabc123", api_secret: "s".repeat(40) });

const cab = async (over: Partial<{ ts: string; nonce: string; assinatura: string; corpo: string; segredo: string }> = {}) => {
  const ts = over.ts ?? TS, nonce = over.nonce ?? NONCE;
  return { ts, nonce, assinatura: over.assinatura ?? await assinarPareamento(over.segredo ?? SEGREDO, ts, nonce, over.corpo ?? CORPO) };
};

describe("assinatura", () => {
  it("bate com o HMAC que o script Python calcula (hmac.new(segredo, ts.nonce.corpo, sha256))", async () => {
    const esperado = createHmac("sha256", SEGREDO).update(`${TS}.${NONCE}.${CORPO}`).digest("hex");
    expect(await assinarPareamento(SEGREDO, TS, NONCE, CORPO)).toBe(esperado);
  });

  it("aceita assinatura certa dentro da janela (inclusive na borda)", async () => {
    expect((await conferirAssinatura(SEGREDO, await cab(), CORPO, AGORA)).ok).toBe(true);
    expect((await conferirAssinatura(SEGREDO, await cab(), CORPO, AGORA + JANELA_SEG * 1000)).ok).toBe(true);
    expect((await conferirAssinatura(SEGREDO, await cab(), CORPO, AGORA - JANELA_SEG * 1000)).ok).toBe(true);
  });

  it("recusa fora da janela de 5 min (passado e futuro)", async () => {
    expect(await conferirAssinatura(SEGREDO, await cab(), CORPO, AGORA + (JANELA_SEG + 1) * 1000)).toMatchObject({ ok: false, motivo: "timestamp fora da janela" });
    expect((await conferirAssinatura(SEGREDO, await cab(), CORPO, AGORA - (JANELA_SEG + 1) * 1000)).ok).toBe(false);
  });

  it("recusa corpo adulterado, segredo errado, ts/nonce trocados depois de assinar", async () => {
    const c = await cab();
    expect((await conferirAssinatura(SEGREDO, c, CORPO.replace("APIabc123", "APIabc124"), AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, await cab({ segredo: "b".repeat(64) }), CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, ts: String(Number(TS) + 1) }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, nonce: "outro_nonce_1234567" }, CORPO, AGORA)).ok).toBe(false);
  });

  it("recusa cabeçalho ausente/malformado e segredo do servidor ausente", async () => {
    const c = await cab();
    expect((await conferirAssinatura(SEGREDO, { ...c, ts: null }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, ts: "1e9" }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, nonce: null }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, nonce: "curto" }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, nonce: "tem espaço no nonce 123" }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, assinatura: null }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura(SEGREDO, { ...c, assinatura: c.assinatura.toUpperCase() }, CORPO, AGORA)).ok).toBe(false);
    expect((await conferirAssinatura("", c, CORPO, AGORA)).motivo).toBe("segredo de assinatura ausente");
    expect((await conferirAssinatura("curto", await cab({ segredo: "curto" }), CORPO, AGORA)).ok).toBe(false);
  });
});

describe("validarCorpo", () => {
  it("normaliza (tira barra final, ordem fixa) e o hash curto bate com sha256 do valor", async () => {
    const v = validarCorpo(JSON.stringify({ api_secret: "s".repeat(40), url: "https://livekit.brenoxavier.com.br/", api_key: "APIabc123" }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.valor).toBe(CORPO);
    expect(await hashCurto(v.valor)).toBe(createHash("sha256").update(CORPO).digest("hex").slice(0, 12));
  });

  it("recusa url sem https, com caminho, key/secret ruins, JSON quebrado", () => {
    const base = { url: "https://livekit.brenoxavier.com.br", api_key: "APIabc123", api_secret: "s".repeat(40) };
    expect(validarCorpo(JSON.stringify({ ...base, url: "http://livekit.brenoxavier.com.br" })).ok).toBe(false);
    expect(validarCorpo(JSON.stringify({ ...base, url: "https://x.com/caminho" })).ok).toBe(false);
    expect(validarCorpo(JSON.stringify({ ...base, url: "javascript:alert(1)" })).ok).toBe(false);
    expect(validarCorpo(JSON.stringify({ ...base, api_key: "" })).ok).toBe(false);
    expect(validarCorpo(JSON.stringify({ ...base, api_key: "com espaço" })).ok).toBe(false);
    expect(validarCorpo(JSON.stringify({ ...base, api_secret: "curto" })).ok).toBe(false);
    expect(validarCorpo("{").ok).toBe(false);
    expect(validarCorpo("[]").ok).toBe(false);
    expect(validarCorpo("null").ok).toBe(false);
  });
});

describe("leitura e SQL", () => {
  it("lerConfigGuardada aceita o formato gravado e o formato do env; recusa lixo", () => {
    expect(lerConfigGuardada(CORPO)).toEqual({ url: "https://livekit.brenoxavier.com.br", api_key: "APIabc123", api_secret: "s".repeat(40) });
    expect(lerConfigGuardada(JSON.stringify({ LIVEKIT_URL: "https://a.b", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" }))?.url).toBe("https://a.b");
    expect(lerConfigGuardada("nao-json")).toBeNull();
    expect(lerConfigGuardada(JSON.stringify({ url: "https://a.b" }))).toBeNull();
    expect(lerConfigGuardada(null)).toBeNull();
  });

  it("statusDaGravacao: ok 200, já pareado 410, replay 409, resto 500", () => {
    expect(statusDaGravacao("ok").status).toBe(200);
    expect(statusDaGravacao("ja_pareado").status).toBe(410);
    expect(statusDaGravacao("replay").status).toBe(409);
    expect(statusDaGravacao(null).status).toBe(500);
  });
});
