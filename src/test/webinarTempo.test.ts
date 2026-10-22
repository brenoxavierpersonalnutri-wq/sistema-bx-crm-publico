// Relógio do webinário ao vivo (offset do HLS), ofertas por tempo/manuais e limite do chat.
import { describe, expect, it } from "vitest";
import {
  contarPresentes, destinoOferta, formatarTempo, lerTempo, ofertasVisiveis, podeEnviarChat, restanteOferta,
  roteiroVisivel, tempoDoConteudo, type OfertaWebinar,
} from "@/lib/lives/webinarTempo";

const INICIO = "2026-10-20T22:00:00.000Z";
const T0 = Date.parse(INICIO);
const S = "sessao-1";

describe("tempo do conteúdo", () => {
  it("desconta o atraso do HLS e nunca fica negativo", () => {
    expect(tempoDoConteudo(INICIO, T0 + 60_000, 0)).toBe(60);
    expect(tempoDoConteudo(INICIO, T0 + 60_000, 20)).toBe(40);
    expect(tempoDoConteudo(INICIO, T0 + 10_000, 20)).toBe(0);
    expect(tempoDoConteudo(null, T0, 0)).toBe(0);
    expect(tempoDoConteudo("lixo", T0, 0)).toBe(0);
  });

  it("offset absurdo é limitado a 600 s", () => {
    expect(tempoDoConteudo(INICIO, T0 + 3600_000, 99999)).toBe(3000);
  });
});

describe("ofertas", () => {
  const porTempo: OfertaWebinar = { id: "t", titulo: "Tempo", modo: "tempo", aparece_em_seg: 45 * 60, dura_seg: 15 * 60, url: "https://pay.x/1" };
  const manual: OfertaWebinar = { id: "m", titulo: "Manual", modo: "manual", checkout_link_id: "abc" };
  const ctx = (agoraMs: number, offset = 20) => ({ sessionId: S, iniciadaEm: INICIO, agoraMs, offsetHlsSeg: offset });

  it("por tempo: aparece no minuto 45 do que o público VÊ (com o atraso) e some depois de 15 min", () => {
    const aos45Estudio = T0 + 45 * 60_000;
    expect(ofertasVisiveis([porTempo], ctx(aos45Estudio))).toHaveLength(0); // público ainda está em 44:40
    expect(ofertasVisiveis([porTempo], ctx(aos45Estudio + 20_000))).toHaveLength(1);
    expect(ofertasVisiveis([porTempo], ctx(T0 + (60 * 60 + 19) * 1000))).toHaveLength(1);
    expect(ofertasVisiveis([porTempo], ctx(T0 + (60 * 60 + 20) * 1000))).toHaveLength(0);
  });

  it("por tempo sem duração fica até o fim; sessão sem início não mostra", () => {
    const semFim = { ...porTempo, dura_seg: null };
    expect(ofertasVisiveis([semFim], ctx(T0 + 5 * 3600_000))).toHaveLength(1);
    expect(ofertasVisiveis([porTempo], { ...ctx(T0 + 3600_000), iniciadaEm: null })).toHaveLength(0);
  });

  it("manual: só depois de soltar NESTA sessão, com o mesmo atraso do vídeo, e some ao recolher", () => {
    const solta = { ...manual, liberada_em: new Date(T0 + 600_000).toISOString(), liberada_session_id: S };
    expect(ofertasVisiveis([manual], ctx(T0 + 700_000))).toHaveLength(0);
    expect(ofertasVisiveis([solta], ctx(T0 + 610_000))).toHaveLength(0);
    expect(ofertasVisiveis([solta], ctx(T0 + 620_000))).toHaveLength(1);
    expect(ofertasVisiveis([{ ...solta, liberada_session_id: "outra" }], ctx(T0 + 700_000))).toHaveLength(0);
    const recolhida = { ...solta, encerrada_em: new Date(T0 + 900_000).toISOString() };
    expect(ofertasVisiveis([recolhida], ctx(T0 + 910_000))).toHaveLength(1);
    expect(ofertasVisiveis([recolhida], ctx(T0 + 920_000))).toHaveLength(0);
  });

  it("oferta desativada nunca aparece; ordem respeitada", () => {
    const a = { ...porTempo, id: "a", aparece_em_seg: 0, ordem: 2 };
    const b = { ...porTempo, id: "b", aparece_em_seg: 0, ordem: 1 };
    expect(ofertasVisiveis([a, b, { ...a, id: "c", ativo: false }], ctx(T0 + 60_000, 0)).map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("contagem regressiva da oferta por tempo", () => {
    expect(restanteOferta(porTempo, 45 * 60)).toBe(15 * 60);
    expect(restanteOferta(porTempo, 59 * 60)).toBe(60);
    expect(restanteOferta(manual, 100)).toBeNull();
  });

  it("destino: checkout existente (/checkout/:id) ou URL https, levando as UTMs", () => {
    expect(destinoOferta(manual, "https://equipe.brenoxavier.com.br", { utm_source: "ig" })).toBe("https://equipe.brenoxavier.com.br/checkout/abc?utm_source=ig");
    expect(destinoOferta(porTempo, "https://e.com", { utm_source: "ig" })).toBe("https://pay.x/1?utm_source=ig");
    expect(destinoOferta({ ...porTempo, url: "http://inseguro" }, "https://e.com")).toBeNull();
    expect(destinoOferta({ ...porTempo, url: "https://pay.x/1?utm_source=orig" }, "https://e.com", { utm_source: "ig" })).toBe("https://pay.x/1?utm_source=orig");
  });

  it("roteiro do chat segue o relógio do conteúdo", () => {
    const r = [{ id: "2", aos_seg: 120, autor_nome: "B", texto: "y" }, { id: "1", aos_seg: 30, autor_nome: "A", texto: "x" }];
    expect(roteiroVisivel(r, 29)).toHaveLength(0);
    expect(roteiroVisivel(r, 130).map((m) => m.id)).toEqual(["1", "2"]);
  });
});

describe("limite do chat (espelho da RPC webinar_chat_enviar)", () => {
  const agora = 1_000_000;
  it("vazia e longa", () => {
    expect(podeEnviarChat("   ", [], agora).motivo).toBe("vazia");
    expect(podeEnviarChat("a".repeat(501), [], agora).motivo).toBe("longa");
    expect(podeEnviarChat("a".repeat(500), [], agora).ok).toBe(true);
  });
  it("3 s entre mensagens", () => {
    const r = podeEnviarChat("oi", [agora - 1000], agora);
    expect(r).toEqual({ ok: false, motivo: "rapido", esperarSeg: 2 });
    expect(podeEnviarChat("oi", [agora - 3000], agora).ok).toBe(true);
  });
  it("6 por minuto; libera quando a mais antiga sai da janela", () => {
    const seis = [50, 40, 30, 20, 10, 5].map((s) => agora - s * 1000);
    const r = podeEnviarChat("oi", seis, agora);
    expect(r.motivo).toBe("limite");
    expect(r.esperarSeg).toBe(10);
    expect(podeEnviarChat("oi", seis.slice(1), agora).ok).toBe(true);
    expect(podeEnviarChat("oi", seis, agora + 10_000).ok).toBe(true);
  });
});

describe("utilidades", () => {
  it("presentes = ping nos últimos 75 s", () => {
    expect(contarPresentes([0, 30_000, 60_000, 100_000], 100_000)).toBe(3);
  });
  it("lê e formata tempo", () => {
    expect(lerTempo("45")).toBe(45);
    expect(lerTempo("45:00")).toBe(2700);
    expect(lerTempo("1:02:03")).toBe(3723);
    expect(lerTempo("1:60")).toBeNull();
    expect(lerTempo("abc")).toBeNull();
    expect(formatarTempo(2700)).toBe("45:00");
    expect(formatarTempo(3723)).toBe("1:02:03");
  });
});
