// Cifra das chaves RTMP, tokens (convite, inscrição, render) e assinaturas de webhook das lives.
import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  assinarJwt, cifrarChave, escolherSegredoLive, conferirTokenInscricao, conferirTokenRender, decifrarChave, finalDaChave,
  sha256Hex, tokenInscricao, tokenLiveKit, tokenRender, urlRtmpCompleta, verificarJwt,
  webhookCfStreamValido, webhookLiveKitValido,
} from "../../supabase/functions/_shared/liveCrypto";

const SEGREDO = "segredo-de-teste-das-lives-0123456789abcdef";
const CHAVE_YT = "abcd-efgh-ijkl-mnop-qrst";

describe("cifra das chaves RTMP (AES-256-GCM)", () => {
  it("cifra e decifra de volta", async () => {
    const c = await cifrarChave(CHAVE_YT, SEGREDO);
    expect(c).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(c).not.toContain(CHAVE_YT);
    expect(await decifrarChave(c, SEGREDO)).toBe(CHAVE_YT);
  });

  it("IV aleatório: a mesma chave cifra diferente a cada vez", async () => {
    const [a, b] = await Promise.all([cifrarChave(CHAVE_YT, SEGREDO), cifrarChave(CHAVE_YT, SEGREDO)]);
    expect(a).not.toBe(b);
  });

  it("segredo errado não decifra", async () => {
    const c = await cifrarChave(CHAVE_YT, SEGREDO);
    await expect(decifrarChave(c, SEGREDO + "x")).rejects.toThrow(/decifrar/);
  });

  it("dado adulterado não decifra (GCM autentica)", async () => {
    const c = await cifrarChave(CHAVE_YT, SEGREDO);
    const [v, iv, ct] = c.split(".");
    const trocado = ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA");
    await expect(decifrarChave(`${v}.${iv}.${trocado}`, SEGREDO)).rejects.toThrow();
    await expect(decifrarChave("v2.x.y", SEGREDO)).rejects.toThrow(/formato/);
  });

  it("recusa segredo curto ou ausente", async () => {
    await expect(cifrarChave(CHAVE_YT, "curto")).rejects.toThrow(/LIVE_CHAVES_SEGREDO/);
    await expect(cifrarChave(CHAVE_YT, "")).rejects.toThrow(/LIVE_CHAVES_SEGREDO/);
  });

  it("o front só vê o final da chave", () => {
    expect(finalDaChave(CHAVE_YT)).toBe("••••qrst");
    expect(finalDaChave("abc")).toBe("••••");
  });

  it("monta a URL RTMP sem barra dobrada e recusa protocolo errado", () => {
    expect(urlRtmpCompleta("rtmp://a.rtmp.youtube.com/live2/", CHAVE_YT)).toBe(`rtmp://a.rtmp.youtube.com/live2/${CHAVE_YT}`);
    expect(urlRtmpCompleta("rtmps://live.cloudflare.com:443/live", "/k1")).toBe("rtmps://live.cloudflare.com:443/live/k1");
    expect(() => urlRtmpCompleta("https://x.com/live", "k")).toThrow(/rtmp/);
    expect(() => urlRtmpCompleta("rtmp://x", " ")).toThrow(/vazia/);
  });
});

describe("tokens", () => {
  it("sha256Hex igual ao do Node (hash do convite)", async () => {
    expect(await sha256Hex("convite-123")).toBe(createHash("sha256").update("convite-123").digest("hex"));
  });

  it("token de inscrição é idêntico ao gerado pelo SQL public.webinar_token_de()", async () => {
    // vetor tirado do Postgres local (pgcrypto) rodando a migration 20261020110000
    const segredo = "767b398389174f9a998189faf7156b02d0ed92ab33764a9ebc4d41dbd5a8d7b2";
    const reg = "e44c0a74-c4a3-4a28-bfe8-696237b80d4d";
    const doSql = "e44c0a74-c4a3-4a28-bfe8-696237b80d4d.jPR_s_cJ_oe6nCexceUBioqG573_Yr1dGTKLDTmAmhQ";
    expect(await tokenInscricao(reg, segredo)).toBe(doSql);
    expect(await conferirTokenInscricao(doSql, segredo)).toBe(reg);
    expect(await conferirTokenInscricao(doSql.slice(0, -1) + "A", segredo)).toBeNull();
    expect(await conferirTokenInscricao(doSql, segredo + "0")).toBeNull();
    expect(await conferirTokenInscricao("lixo", segredo)).toBeNull();
  });

  it("token de render vence e não serve para outra sala", async () => {
    const sala = "5b0e7b0a-4f7e-4b55-9d3e-6a9a2a0c1f00";
    const agora = 1_800_000_000;
    const t = await tokenRender(sala, SEGREDO, 60, agora);
    expect(await conferirTokenRender(t, SEGREDO, agora + 30)).toBe(sala);
    expect(await conferirTokenRender(t, SEGREDO, agora + 61)).toBeNull();
    const outra = t.replace(sala, "5b0e7b0a-4f7e-4b55-9d3e-6a9a2a0c1f01");
    expect(await conferirTokenRender(outra, SEGREDO, agora)).toBeNull();
    expect(await conferirTokenRender(t, "outro-segredo-0123456789abcdef0123456789", agora)).toBeNull();
  });

  it("token do LiveKit: HS256 com as claims que o servidor espera", async () => {
    const tok = await tokenLiveKit({
      apiKey: "APIabc", apiSecret: SEGREDO, identity: "conv_1", name: "Ana", agoraSeg: 1000, ttlSeg: 60,
      grant: { room: "live_x", roomJoin: true, canPublish: true }, attributes: { stage: "0" },
    });
    const [h, b, s] = tok.split(".");
    const esperado = createHmac("sha256", SEGREDO).update(`${h}.${b}`).digest("base64url");
    expect(s).toBe(esperado);
    const claims = JSON.parse(Buffer.from(b, "base64url").toString());
    expect(claims).toMatchObject({ iss: "APIabc", sub: "conv_1", name: "Ana", exp: 1060, video: { room: "live_x", roomJoin: true }, attributes: { stage: "0" } });
    expect(await verificarJwt(tok, SEGREDO, 1030)).not.toBeNull();
    expect(await verificarJwt(tok, SEGREDO, 1200)).toBeNull(); // vencido (+60 s de folga)
    expect(await verificarJwt(tok, "outro", 1030)).toBeNull();
  });
});

describe("webhooks", () => {
  it("LiveKit: confere assinatura, emissor e sha256 do corpo", async () => {
    const corpo = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_1" } });
    const sha = createHash("sha256").update(corpo).digest("base64");
    const agora = Math.floor(Date.now() / 1000);
    const jwt = await assinarJwt({ iss: "APIabc", nbf: agora - 5, exp: agora + 300, sha256: sha }, SEGREDO);
    expect(await webhookLiveKitValido(corpo, `Bearer ${jwt}`, "APIabc", SEGREDO)).toBe(true);
    expect(await webhookLiveKitValido(corpo, jwt, "APIabc", SEGREDO)).toBe(true);
    expect(await webhookLiveKitValido(corpo + " ", jwt, "APIabc", SEGREDO)).toBe(false); // corpo trocado
    expect(await webhookLiveKitValido(corpo, jwt, "APIoutro", SEGREDO)).toBe(false);
    expect(await webhookLiveKitValido(corpo, jwt, "APIabc", SEGREDO + "x")).toBe(false);
    expect(await webhookLiveKitValido(corpo, null, "APIabc", SEGREDO)).toBe(false);
  });

  it("Cloudflare Stream: Webhook-Signature time/sig1 com janela de 5 min", async () => {
    const corpo = '{"uid":"v1","readyToStream":true}';
    const time = 1_800_000_000;
    const sig = createHmac("sha256", SEGREDO).update(`${time}.${corpo}`).digest("hex");
    const header = `time=${time},sig1=${sig}`;
    expect(await webhookCfStreamValido(corpo, header, SEGREDO, time + 10)).toBe(true);
    expect(await webhookCfStreamValido(corpo, header, SEGREDO, time + 301)).toBe(false);
    expect(await webhookCfStreamValido(corpo + "x", header, SEGREDO, time)).toBe(false);
    expect(await webhookCfStreamValido(corpo, `time=${time},sig1=00`, SEGREDO, time)).toBe(false);
    expect(await webhookCfStreamValido(corpo, null, SEGREDO, time)).toBe(false);
  });
});

describe("escolherSegredoLive (env x banco)", () => {
  const ENV = "e".repeat(40);
  const BANCO = "b".repeat(64);
  it("env com 32+ vence sempre, mesmo havendo segredo no banco", () => {
    expect(escolherSegredoLive(ENV, BANCO)).toBe(ENV);
  });
  it("sem env (ou env curto) usa o do banco", () => {
    expect(escolherSegredoLive(undefined, BANCO)).toBe(BANCO);
    expect(escolherSegredoLive("", BANCO)).toBe(BANCO);
    expect(escolherSegredoLive("curto", BANCO)).toBe(BANCO);
  });
  it("nenhum válido -> null", () => {
    expect(escolherSegredoLive(null, null)).toBeNull();
    expect(escolherSegredoLive("x", "y".repeat(31))).toBeNull();
  });
  it("o segredo do banco cifra e decifra a chave RTMP", async () => {
    const s = escolherSegredoLive(undefined, BANCO)!;
    expect(await decifrarChave(await cifrarChave(CHAVE_YT, s), s)).toBe(CHAVE_YT);
  });
});
