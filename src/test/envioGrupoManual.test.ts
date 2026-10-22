// Envio MANUAL a grupo (18/10/2026): rotas send-group-manual-* do proxy (sem allowlist, 60/min),
// a decisão de destino das edge functions e a flag `manual` do front.
import { describe, it, expect } from "vitest";
import {
  montarPedidoGrupoManual, montarPedidoGrupo, LimitadorManualGrupo, LimitadorGrupo, separarSessao, ROTAS_GRUPO,
  ROTAS_ENVIO_GRUPO, ROTAS_ENVIO_GRUPO_MANUAL, ROTAS_COM_SESSAO, LIMITE_GRUPO_MANUAL_MINUTO, LIMITE_GRUPO_MANUAL_DIA,
  montarPedidoOpenwa,
} from "../../infra/wa-proxy/lib.mjs";
import { avisoLimite, corpoMidiaGrupoManual, destinoEnvio, jidGrupo } from "../../supabase/functions/_shared/envioGrupoManual";
import { envioManual, grupoEnviavel, pastaDoContato } from "@/lib/crm/envioGrupo";

const G = "120363012345678901@g.us";
const SID = "sess-1";

describe("proxy: envio manual a grupo", () => {
  it("rotas manuais existem, aceitam sessao e não entram no disparo automático", () => {
    expect(ROTAS_GRUPO).toEqual(expect.arrayContaining(["send-group-manual-text", "send-group-manual-media"]));
    expect(ROTAS_COM_SESSAO.has("send-group-manual-text")).toBe(true);
    expect(ROTAS_ENVIO_GRUPO.has("send-group-manual-text")).toBe(false);
    expect(ROTAS_ENVIO_GRUPO_MANUAL.has("send-group-text")).toBe(false);
    expect(separarSessao("send-group-manual-media", { chatId: G, sessao: "fit2" }, new Set(["fit2"]))).toEqual({
      corpo: { chatId: G }, sessao: "fit2",
    });
  });

  it("texto vai para qualquer grupo, sem allowlist", () => {
    expect(montarPedidoGrupoManual("send-group-manual-text", { chatId: G, text: "oi" }, SID)).toEqual({
      metodo: "POST", caminho: "/sessions/sess-1/messages/send-text", corpo: { chatId: G, text: "oi" },
    });
    // a rota automática continua barrando o mesmo grupo fora da allowlist
    expect(montarPedidoGrupo("send-group-text", { chatId: G, text: "oi" }, SID, new Set()).status).toBe(403);
  });

  it("nota de voz em grupo: ptt + mimetype Ogg/Opus", () => {
    expect(montarPedidoGrupoManual("send-group-manual-media", { chatId: G, kind: "audio", url: "https://x.co/a.ogg", ptt: true }, SID))
      .toEqual({
        metodo: "POST", caminho: "/sessions/sess-1/messages/send-audio",
        corpo: { chatId: G, url: "https://x.co/a.ogg", ptt: true, mimetype: "audio/ogg; codecs=opus" },
        voz: true,
      });
  });

  it("imagem com legenda e documento com nome", () => {
    expect(montarPedidoGrupoManual("send-group-manual-media", { chatId: G, kind: "image", url: "https://x.co/i.jpg", caption: "c" }, SID).corpo)
      .toEqual({ chatId: G, url: "https://x.co/i.jpg", caption: "c" });
    expect(montarPedidoGrupoManual("send-group-manual-media", { chatId: G, kind: "document", url: "https://x.co/d.pdf", filename: "d.pdf" }, SID).caminho)
      .toBe("/sessions/sess-1/messages/send-document");
  });

  it("recusa corpo torto", () => {
    const ruins: [string, Record<string, unknown>][] = [
      ["send-group-manual-text", { chatId: "5511999999999@c.us", text: "oi" }],
      ["send-group-manual-text", { chatId: G, text: "" }],
      ["send-group-manual-text", { chatId: G, text: "oi", linkPreview: true }],
      ["send-group-manual-text", { chatId: G, text: "oi", phone: "5511999999999" }],
      ["send-group-manual-media", { chatId: G, kind: "image", url: "http://x.co/i.jpg" }],
      ["send-group-manual-media", { chatId: G, kind: "sticker", url: "https://x.co/i.webp" }],
      ["send-group-manual-media", { chatId: G, kind: "image", url: "https://x.co/i.jpg", ptt: true }],
      ["send-group-manual-media", { chatId: G, kind: "audio", url: "https://x.co/a.ogg", caption: "x" }],
      ["send-group-manual-media", { chatId: G, kind: "audio", url: "https://x.co/a.ogg", ptt: true, filename: "a.ogg" }],
      ["send-group-manual-media", { chatId: G, kind: "audio", url: "https://x.co/a.ogg", ptt: "sim" }],
      ["send-group-text", { chatId: G, text: "oi" }],
    ];
    for (const [r, b] of ruins) expect(montarPedidoGrupoManual(r, b, SID).erro, `${r} ${JSON.stringify(b)}`).toBeTruthy();
  });

  it("rotas de telefone continuam recusando grupo", () => {
    expect(montarPedidoOpenwa("send-text", { phone: G, text: "oi" }, SID).erro).toBeTruthy();
  });

  it("limite manual: 60/min por sessão, sem intervalo mínimo, separado do automático", () => {
    const l = new LimitadorManualGrupo();
    const t0 = Date.UTC(2026, 9, 20, 15, 0, 0);
    for (let i = 0; i < LIMITE_GRUPO_MANUAL_MINUTO; i++) expect(l.reservar(null, t0 + i * 100).ok).toBe(true);
    const cheio = l.reservar(null, t0 + 7000);
    expect(cheio.ok).toBe(false);
    expect(cheio.retryAfter).toBeGreaterThan(0);
    expect(l.reservar("fit2", t0 + 7000).ok).toBe(true); // outra sessão, outra conta
    expect(l.reservar(null, t0 + 61_000).ok).toBe(true); // janela andou
    // o automático segue com 8 s entre envios
    const auto = new LimitadorGrupo();
    expect(auto.reservar(null, t0).ok).toBe(true);
    expect(auto.reservar(null, t0 + 1000).ok).toBe(false);
  });

  it("limite manual diário e persistência", () => {
    const t0 = Date.UTC(2026, 9, 20, 15, 0, 0);
    const l = new LimitadorManualGrupo(JSON.parse(JSON.stringify({ _padrao: { minuto: [], dia: "2026-10-20", noDia: LIMITE_GRUPO_MANUAL_DIA } })));
    expect(l.reservar(null, t0).ok).toBe(false);
    expect(l.reservar(null, Date.UTC(2026, 9, 21, 15, 0, 0)).ok).toBe(true); // virou o dia (BRT)
    expect(new LimitadorManualGrupo(l.paraJSON()).paraJSON()._padrao.noDia).toBe(1);
  });
});

describe("edge: destino do envio", () => {
  it("grupo só com manual: true", () => {
    expect(destinoEnvio(G, true)).toEqual({ tipo: "grupo", chatId: G });
    expect(destinoEnvio(G, undefined)).toEqual({ erro: expect.any(String), status: 403 });
    expect(destinoEnvio(G, "true")).toMatchObject({ status: 403 });
    expect(destinoEnvio("abc@g.us", true)).toMatchObject({ status: 400 });
  });

  it("telefone igual a antes (55 na frente, 10 a 15 dígitos), com ou sem manual", () => {
    expect(destinoEnvio("(11) 99999-8888", undefined)).toEqual({ tipo: "telefone", numero: "5511999998888" });
    expect(destinoEnvio("5511999998888", true)).toEqual({ tipo: "telefone", numero: "5511999998888" });
    expect(destinoEnvio("123", true)).toMatchObject({ status: 400 });
    // id de grupo antigo sem @g.us não vira telefone
    expect(destinoEnvio("5511999998888-1600000000", true)).toMatchObject({ status: 400 });
  });

  it("corpo da mídia em grupo segue a escolha do envio a telefone", () => {
    expect(corpoMidiaGrupoManual(G, { tipo: "audio", url: "https://x/a.ogg", ptt: true, fileName: "a.ogg", legenda: "x" }))
      .toEqual({ chatId: G, kind: "audio", url: "https://x/a.ogg", ptt: true });
    expect(corpoMidiaGrupoManual(G, { tipo: "image", url: "https://x/i.jpg", legenda: "oi" }))
      .toEqual({ chatId: G, kind: "image", url: "https://x/i.jpg", caption: "oi" });
    expect(corpoMidiaGrupoManual(G, { tipo: "video", url: "https://x/v.mp4", fileName: "v.mp4", legenda: " " }))
      .toEqual({ chatId: G, kind: "document", url: "https://x/v.mp4", filename: "v.mp4" });
    // o corpo gerado é aceito pela rota do proxy
    for (const c of [
      corpoMidiaGrupoManual(G, { tipo: "audio", url: "https://x/a.ogg", ptt: true }),
      corpoMidiaGrupoManual(G, { tipo: "document", url: "https://x/d.pdf", fileName: "d.pdf", legenda: "l" }),
    ]) expect(montarPedidoGrupoManual("send-group-manual-media", c, SID).erro).toBeUndefined();
  });

  it("aviso do 429 por destino; jid igual ao do proxy", () => {
    expect(avisoLimite(true)).toMatch(/grupo/);
    expect(avisoLimite(false)).toMatch(/20\/min/);
    expect(jidGrupo("5511999998888-1600000000@g.us")).toBe(true);
    expect(jidGrupo("5511999998888@c.us")).toBe(false);
  });
});

describe("front: flag manual e pasta do anexo", () => {
  it("manual só para grupo com JID completo", () => {
    expect(envioManual(G)).toEqual({ manual: true });
    expect(envioManual("5511999998888")).toEqual({});
    expect(envioManual("ig:123")).toEqual({});
    expect(grupoEnviavel("5511999998888-1600000000")).toBe(false);
  });
  it("pasta sem @ e sem barra", () => {
    expect(pastaDoContato(G)).toBe("120363012345678901_g_us");
    expect(pastaDoContato("5511999998888")).toBe("5511999998888");
  });
});
