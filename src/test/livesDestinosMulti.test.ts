// Vários destinos na mesma live: um Egress com as URLs de todos os ligados, falha parcial que não derruba os
// outros, o webhook descobrindo qual destino caiu pela URL redigida do LiveKit, e a chave sempre mascarada.
import { describe, expect, it } from "vitest";
import { finalDaChave, urlRtmpCompleta } from "../../supabase/functions/_shared/liveCrypto";
import { falhasDoEgress, limparMotivo, montarSaidas, redigirUrlRtmp, textoFalhaSaida } from "../../supabase/functions/_shared/liveSaidas";
import { estadoNestaLive, quedasNovas, resumoLigados, validarServidorInstagram } from "@/lib/lives/destinos";

const YT = { id: "yt", nome: "YouTube · Canal BX" };
const IG = { id: "ig", nome: "Instagram Live" };
const URL_YT = urlRtmpCompleta("rtmps://a.rtmps.youtube.com/live2", "abcd-efgh-ijkl-mnop-qrst");
const CHAVE_IG = "17912345678901234?s_bl=1&s_oil=2&s_sw=0&s_vt=ig&a=AbSecreto9876";
const URL_IG = urlRtmpCompleta("rtmps://edgetee-upload-gru2-1.xx.fbcdn.net:443/rtmp/", CHAVE_IG);
const ok = (v: string): PromiseSettledResult<string> => ({ status: "fulfilled", value: v });
const erro = (m: string): PromiseSettledResult<string> => ({ status: "rejected", reason: new Error(m) });

describe("montagem das URLs do Egress", () => {
  it("1 destino: uma URL", () => {
    expect(montarSaidas([YT], [ok(URL_YT)])).toEqual({ urls: [URL_YT], okIds: ["yt"], falhas: [] });
  });

  it("2 destinos: YouTube + Instagram no MESMO Egress, na ordem", () => {
    const r = montarSaidas([YT, IG], [ok(URL_YT), ok(URL_IG)]);
    expect(r.urls).toEqual([URL_YT, URL_IG]);
    expect(r.okIds).toEqual(["yt", "ig"]);
    expect(r.falhas).toEqual([]);
  });

  it("junta servidor do Instagram com barra no fim e a chave com query sem barra dupla", () => {
    expect(URL_IG).toBe(`rtmps://edgetee-upload-gru2-1.xx.fbcdn.net:443/rtmp/${CHAVE_IG}`);
  });

  it("falha parcial: o que falhou fica de fora com o motivo, o resto segue", () => {
    const r = montarSaidas([YT, IG], [erro("YouTube recusou o broadcast"), ok(URL_IG)]);
    expect(r.urls).toEqual([URL_IG]);
    expect(r.okIds).toEqual(["ig"]);
    expect(r.falhas).toEqual([{ id: "yt", nome: YT.nome, motivo: "YouTube recusou o broadcast" }]);
  });

  it("todos falham: nenhuma URL (o live-control responde 'nenhum destino pronto')", () => {
    const r = montarSaidas([YT, IG], [erro("a"), erro("b")]);
    expect(r.urls).toEqual([]);
    expect(r.falhas.map((f) => f.id)).toEqual(["yt", "ig"]);
  });

  it("URL repetida não entra duas vezes (o LiveKit recusaria o Egress inteiro)", () => {
    const r = montarSaidas([YT, { id: "yt2", nome: "cópia" }], [ok(URL_YT), ok(URL_YT)]);
    expect(r.urls).toEqual([URL_YT]);
    expect(r.falhas[0]).toMatchObject({ id: "yt2" });
  });

  it("motivo de falha nunca carrega URL rtmp nem a chave", () => {
    const r = montarSaidas([IG], [erro(`não conectou em ${URL_IG}`)]);
    expect(r.falhas[0].motivo).not.toContain(CHAVE_IG);
    expect(r.falhas[0].motivo).not.toContain("fbcdn");
    expect(limparMotivo(`chave ${CHAVE_IG} recusada`, [CHAVE_IG])).toBe("chave [oculto] recusada");
  });
});

describe("redação igual à do LiveKit (protocol/utils/redact.go)", () => {
  it("YouTube: 3 primeiros e 3 últimos caracteres da chave", () => {
    expect(redigirUrlRtmp(URL_YT)).toBe("rtmps://a.rtmps.youtube.com/live2/{abc...rst}");
  });
  it("chave curta: menos caracteres à mostra", () => {
    expect(redigirUrlRtmp("rtmp://h/app/abcdef")).toBe("rtmp://h/app/{ab...ef}");
    expect(redigirUrlRtmp("rtmp://h/app/ab")).toBe("rtmp://h/app/{...}");
  });
  it("sem app/chave no formato: null", () => {
    expect(redigirUrlRtmp("rtmp://host")).toBeNull();
  });
});

describe("webhook: qual destino caiu", () => {
  const dests = [{ ...YT, url: URL_YT }, { ...IG, url: URL_IG }];

  it("casa o stream FAILED pela URL redigida e não deixa a chave no motivo", () => {
    const f = falhasDoEgress([
      { url: redigirUrlRtmp(URL_YT)!, status: "ACTIVE" },
      { url: redigirUrlRtmp(URL_IG)!, status: "FAILED", error: `rtmp handshake failed for ${CHAVE_IG}` },
    ], dests);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe("ig");
    expect(f[0].motivo).not.toContain(CHAVE_IG);
    expect(f[0].motivo).toContain("handshake");
  });

  it("aceita o status numérico (FAILED = 2) e ignora FINISHED (destino desligado pela pessoa)", () => {
    const f = falhasDoEgress([
      { url: redigirUrlRtmp(URL_YT)!, status: 1 },
      { url: redigirUrlRtmp(URL_IG)!, status: 2 },
    ], dests);
    expect(f.map((x) => x.id)).toEqual(["ig"]);
  });

  it("redação diferente na VPS: cai no servidor quando só um destino usa aquele servidor", () => {
    const f = falhasDoEgress([{ url: "rtmps://edgetee-upload-gru2-1.xx.fbcdn.net:443/rtmp/{oculto}", status: "FAILED" }], dests);
    expect(f.map((x) => x.id)).toEqual(["ig"]);
  });

  it("dois destinos no mesmo servidor sem casar exato: não chuta", () => {
    const outro = { id: "yt2", nome: "Outro canal", url: urlRtmpCompleta("rtmps://a.rtmps.youtube.com/live2", "zzzz-yyyy-xxxx") };
    expect(falhasDoEgress([{ url: "rtmps://a.rtmps.youtube.com/live2/{???}", status: "FAILED" }], [...dests, outro])).toEqual([]);
  });

  it("Instagram ganha a dica de que a chave vale uma live só", () => {
    expect(textoFalhaSaida("recusado", "instagram")).toMatch(/vale para uma live só/);
    expect(textoFalhaSaida("recusado", "youtube")).toBe("recusado");
  });
});

describe("mascaramento da chave", () => {
  it("só os 4 últimos, com bolinhas", () => {
    expect(finalDaChave(CHAVE_IG)).toBe("••••9876");
    expect(finalDaChave("abcd-efgh-1234")).toBe("••••1234");
    expect(finalDaChave("abc")).toBe("••••");
  });
});

describe("tela: interruptores e Instagram", () => {
  it("servidor do Instagram precisa ser rtmps", () => {
    expect(validarServidorInstagram("rtmps://edgetee-upload.xx.fbcdn.net:443/rtmp/")).toBeNull();
    expect(validarServidorInstagram("rtmp://x/rtmp/")).toMatch(/rtmps/);
    expect(validarServidorInstagram(" ")).toMatch(/Cole/);
  });

  it("resumo dos ligados", () => {
    expect(resumoLigados([{ ativo: true, nome: "YouTube" }, { ativo: true, nome: "Instagram Live" }, { ativo: false, nome: "Face" }]))
      .toBe("Vai ao ar em: YouTube, Instagram Live.");
    expect(resumoLigados([{ ativo: false, nome: "x" }])).toBe("Nenhum destino ligado.");
  });

  it("destino que caiu ao vivo mostra o motivo e como tentar de novo", () => {
    expect(estadoNestaLive({ ativo: true, no_ar: false, yt_erro: "chave vencida" }, true)).toMatch(/caiu: chave vencida.*Desligue e ligue/);
    expect(estadoNestaLive({ ativo: true, no_ar: true, yt_erro: null }, true)).toBeNull();
  });

  it("aviso de queda só para quem estava no ar e caiu com erro", () => {
    const antes = new Set(["yt", "ig"]);
    expect(quedasNovas(antes, [
      { id: "yt", nome: "YouTube", no_ar: true, yt_erro: null },
      { id: "ig", nome: "Instagram Live", no_ar: false, yt_erro: "recusado" },
    ])).toEqual([{ nome: "Instagram Live", erro: "recusado" }]);
    expect(quedasNovas(new Set(), [{ id: "ig", nome: "I", no_ar: false, yt_erro: "x" }])).toEqual([]);
  });
});
