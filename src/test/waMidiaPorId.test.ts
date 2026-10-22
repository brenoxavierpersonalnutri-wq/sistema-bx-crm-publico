// Mídia do WhatsApp pelo ID da mensagem: rota media-id do proxy (infra/wa-proxy) e as regras de
// retry/classificação da edge function (_shared/waMidiaRegras.ts).
import { describe, it, expect } from "vitest";
import {
  montarPedidoOpenwa, ROTAS, mesmaMensagem, posicaoDoFim, midiaDaMensagem, erroOpenwaParaCrm, JANELA_MIDIA_OPENWA,
} from "../../infra/wa-proxy/lib.mjs";
import {
  atualizacaoDeFalha, baixarComRetry, classificarErroMidia, ehRotaInexistente, esperarSessaoPronta,
} from "../../supabase/functions/_shared/waMidiaRegras";

const sid = "uuid-closer";
const CHAT = "5531999998888@c.us";
const ID = "false_5531999998888@c.us_3EB0AAAA";
const erro = (status: number, detalhe: unknown) => Object.assign(new Error(`proxy ${status}`), { status, detalhe });

describe("proxy: rota media-id", () => {
  it("existe, valida chat e id e monta as três idas ao OpenWA", () => {
    expect(ROTAS).toContain("media-id");
    const p = montarPedidoOpenwa("media-id", { chatId: CHAT, messageId: ID }, sid);
    expect(p.erro).toBeUndefined();
    const c = encodeURIComponent(CHAT);
    expect(p.midiaPorId.arquivo).toBe(`/sessions/uuid-closer/messages/${c}/${encodeURIComponent(ID)}/media`);
    expect(p.midiaPorId.janela).toBe(`/sessions/uuid-closer/messages/${c}/history?limit=100`);
    expect(p.midiaPorId.comMidia(37)).toBe(`/sessions/uuid-closer/messages/${c}/history?limit=37&includeMedia=true`);
    expect(p.midiaPorId.comMidia(500)).toContain(`limit=${JANELA_MIDIA_OPENWA}&`);
    expect(montarPedidoOpenwa("media-id", { chatId: "1203@g.us", messageId: ID }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("media-id", { chatId: CHAT, messageId: "../x y" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("media-id", { chatId: CHAT, messageId: ID, limit: 5 }, sid).erro).toBeTruthy();
  });

  it("acha a mensagem pelo id serializado ou pelo id curto (chat @lid x @c.us)", () => {
    expect(mesmaMensagem(ID, ID)).toBe(true);
    expect(mesmaMensagem(ID, "false_123456789012345@lid_3EB0AAAA")).toBe(true);
    expect(mesmaMensagem(ID, "true_5531999998888@c.us_3EB0AAAA")).toBe(false);
    expect(mesmaMensagem(ID, "false_5531999998888@c.us_3EB0BBBB")).toBe(false);
    expect(mesmaMensagem("false_120363@g.us_3EB0CC_5531999998888@c.us", "false_120363@g.us_3EB0CC_5531999997777@c.us")).toBe(true);
    expect(mesmaMensagem("", "")).toBe(false);
  });

  it("posição contada do fim (histórico vem do mais antigo pro mais novo)", () => {
    const lista = Array.from({ length: 100 }, (_, i) => ({ id: `false_5531999998888@c.us_M${i}` }));
    expect(posicaoDoFim(lista, "false_5531999998888@c.us_M99")).toBe(1);
    expect(posicaoDoFim(lista, "false_5531999998888@c.us_M60")).toBe(40); // a 40ª: antes caía fora das 30
    expect(posicaoDoFim(lista, "false_5531999998888@c.us_M0")).toBe(100);
    expect(posicaoDoFim(lista, "false_5531999998888@c.us_X")).toBe(0);
    expect(posicaoDoFim(null, ID)).toBe(0);
  });

  it("tira a mídia da mensagem certa; omitida e sem mídia viram marcadores", () => {
    const lista = [
      { id: ID, media: { data: "AAEC", mimetype: "image/jpeg; x=1", filename: "f.jpg" } },
      { id: "false_5531999998888@c.us_OMIT", media: { mimetype: "video/mp4", omitted: true } },
      { id: "false_5531999998888@c.us_TXT" },
    ];
    expect(midiaDaMensagem(lista, ID)).toEqual({ data: "AAEC", mimetype: "image/jpeg", filename: "f.jpg" });
    expect(midiaDaMensagem(lista, "false_5531999998888@c.us_OMIT")).toEqual({ omitida: true });
    expect(midiaDaMensagem(lista, "false_5531999998888@c.us_TXT")).toEqual({ semMidia: true });
    expect(midiaDaMensagem(lista, "false_x@c.us_NADA")).toBeNull();
  });

  it("erro do OpenWA: 409/'not connected' = sessão; 5xx = 502; o resto passa", () => {
    expect(erroOpenwaParaCrm(409, "Session is not connected. The WhatsApp client is not ready.").corpo.error).toBe("sessao-desconectada");
    expect(erroOpenwaParaCrm(400, "Session is not connected").status).toBe(409);
    expect(erroOpenwaParaCrm(503, "page died")).toMatchObject({ status: 502 });
    expect(erroOpenwaParaCrm(404, "x")).toMatchObject({ status: 404 });
  });
});

describe("edge: classificação e retry da mídia", () => {
  it("classifica os erros que apareceram em produção", () => {
    expect(classificarErroMidia(erro(404, '{"error":"fora-da-janela","janela":100}')).tipo).toBe("definitivo");
    expect(classificarErroMidia(erro(502, { error: "falha no proxy" })).tipo).toBe("transitorio");
    expect(classificarErroMidia(erro(409, '{"error":"sessao-desconectada"}')).tipo).toBe("sessao");
    expect(classificarErroMidia(erro(400, { error: "openwa", message: "Session is not connected" })).tipo).toBe("sessao");
    expect(classificarErroMidia(erro(429, {})).tipo).toBe("limite");
    expect(classificarErroMidia(erro(413, "grande")).tipo).toBe("definitivo");
    expect(classificarErroMidia(erro(404, "vazio")).tipo).toBe("tentar-depois");
    expect(classificarErroMidia(Object.assign(new Error("signal timed out"), { name: "TimeoutError" })).tipo).toBe("transitorio");
    expect(ehRotaInexistente(erro(404, '{"error":"não existe"}'))).toBe(true);
    expect(ehRotaInexistente(erro(404, '{"error":"fora-da-janela"}'))).toBe(false);
  });

  it("502 tenta de novo com espera crescente e para no teto", async () => {
    const esperas: number[] = [];
    let n = 0;
    const r = await baixarComRetry({
      baixar: async () => { if (n++ < 2) throw erro(502, {}); return "ok"; },
      baixarLegado: async () => "legado", statusSessao: async () => "ready",
      dormir: async (ms) => { esperas.push(ms); },
    });
    expect(r).toBe("ok");
    expect(esperas).toEqual([1000, 3000]);

    let m = 0;
    await expect(baixarComRetry({
      baixar: async () => { m++; throw erro(502, {}); },
      baixarLegado: async () => "x", statusSessao: async () => "ready", dormir: async () => {},
    })).rejects.toMatchObject({ status: 502 });
    expect(m).toBe(4); // 1 + 3 retries
  });

  it("sessão desconectada: espera voltar a ready e tenta de novo; se não voltar, desiste", async () => {
    const st = ["disconnected", "initializing", "ready"];
    let n = 0;
    const r = await baixarComRetry({
      baixar: async () => { if (n++ === 0) throw erro(409, '{"error":"sessao-desconectada"}'); return "ok"; },
      baixarLegado: async () => "x", statusSessao: async () => st.shift() ?? "ready", dormir: async () => {},
    });
    expect(r).toBe("ok");

    const dormidas: number[] = [];
    expect(await esperarSessaoPronta({ statusSessao: async () => "disconnected", dormir: async (ms) => { dormidas.push(ms); } }))
      .toBe(false);
    expect(dormidas.reduce((a, b) => a + b, 0)).toBe(30_000);
  });

  it("proxy antigo (sem media-id) cai para a rota media; definitivo não repete", async () => {
    expect(await baixarComRetry({
      baixar: async () => { throw erro(404, '{"error":"não existe"}'); },
      baixarLegado: async () => "legado", statusSessao: async () => "ready", dormir: async () => {},
    })).toBe("legado");
    let n = 0;
    await expect(baixarComRetry({
      baixar: async () => { n++; throw erro(404, '{"error":"fora-da-janela"}'); },
      baixarLegado: async () => "x", statusSessao: async () => "ready", dormir: async () => {},
    })).rejects.toBeTruthy();
    expect(n).toBe(1);
  });

  it("o que grava na linha: definitivo falha já, sessão não gasta tentativa", () => {
    expect(atualizacaoDeFalha(0, "definitivo", "fora", 3)).toEqual({ media_tentativas: 3, media_status: "falhou", media_erro: "fora" });
    expect(atualizacaoDeFalha(1, "sessao", "s", 3)).toEqual({ media_tentativas: 1, media_status: "pendente", media_erro: "s" });
    expect(atualizacaoDeFalha(1, "transitorio", "502", 3)).toMatchObject({ media_tentativas: 2, media_status: "pendente" });
    expect(atualizacaoDeFalha(2, "tentar-depois", "x", 3)).toMatchObject({ media_tentativas: 3, media_status: "falhou" });
  });
});
