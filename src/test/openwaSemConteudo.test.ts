// Bug de 18/10/2026: ao conectar o comercial-fit-2, toda conversa ganhou uma bolha "[mensagem]" com o
// horário do pareamento e 1 não lida. Causa: o WhatsApp Web cria um aviso de sistema (criptografia,
// gp2, número de segurança...) em cada conversa do aparelho recém-pareado; o OpenWA v0.24.0 manda isso
// como type "unknown" com body vazio, e o interpretador gravava "[mensagem]".
import { describe, it, expect } from "vitest";
import { interpretarEventoOpenwa, semConteudo } from "../../supabase/functions/_shared/openwa";
import { linhasDoHistorico } from "../../supabase/functions/_shared/waBackfill";

const TEL = "5531990000108";
const ev = (data: Record<string, unknown>, event = "message.received") => ({ event, data: { chatId: `${TEL}@c.us`, ...data } });

describe("aviso de sistema sem conteúdo (causa do [mensagem])", () => {
  it("type unknown com body vazio é ignorado no webhook", () => {
    const r = interpretarEventoOpenwa(ev({ id: "false_x_1", type: "unknown", body: "", timestamp: 1792360000, fromMe: false }));
    expect(r.tipo).toBe("ignorar");
    if (r.tipo === "ignorar") expect(r.motivo).toMatch(/sem conteúdo/);
  });
  it("tipos crus de sistema do WhatsApp Web (e2e_notification, gp2, ciphertext, protocol) sem corpo são ignorados", () => {
    for (const type of ["e2e_notification", "notification_template", "gp2", "ciphertext", "protocol", "notification"]) {
      expect(interpretarEventoOpenwa(ev({ id: `false_x_${type}`, type, body: "", timestamp: 1 })).tipo).toBe("ignorar");
    }
  });
  it("nenhum caminho produz mais o texto literal [mensagem]", () => {
    for (const type of ["unknown", "xyz", "", "text"]) {
      const r = interpretarEventoOpenwa(ev({ id: "false_x_9", type, body: "", timestamp: 1 }));
      if (r.tipo === "mensagem") expect(r.corpo).not.toBe("[mensagem]");
    }
  });
  it("tipo desconhecido COM texto continua gravando o texto real", () => {
    const r = interpretarEventoOpenwa(ev({ id: "false_x_2", type: "unknown", body: "Olá, quero saber do plano", timestamp: 1792360000 }));
    expect(r).toMatchObject({ tipo: "mensagem", corpo: "Olá, quero saber do plano" });
  });
  it("mídia sem legenda vira rótulo do tipo; ligação/pedido/enquete viram rótulo", () => {
    expect(interpretarEventoOpenwa(ev({ id: "a", type: "sticker", body: "", timestamp: 1 }))).toMatchObject({ corpo: "[figurinha]", mediaType: "sticker" });
    expect(interpretarEventoOpenwa(ev({ id: "b", type: "voice", body: "", timestamp: 1 }))).toMatchObject({ corpo: "[áudio]", mediaType: "audio" });
    expect(interpretarEventoOpenwa(ev({ id: "c", type: "call", body: "", timestamp: 1 }))).toMatchObject({ corpo: "[ligação]" });
    expect(interpretarEventoOpenwa(ev({ id: "d", type: "order", body: "", timestamp: 1 }))).toMatchObject({ corpo: "[pedido]" });
  });
  it("horário real: timestamp do WhatsApp (segundos) vira created_at", () => {
    const r = interpretarEventoOpenwa(ev({ id: "e", type: "text", body: "oi", timestamp: 1792360000 }));
    expect(r).toMatchObject({ criadoEm: new Date(1792360000 * 1000).toISOString() });
  });
  it("semConteudo: só quando não há texto, mídia nem rótulo", () => {
    expect(semConteudo("unknown", null, false)).toBe(true);
    expect(semConteudo("unknown", "x", false)).toBe(false);
    expect(semConteudo("image", null, true)).toBe(false);
    expect(semConteudo("location", null, false)).toBe(false);
  });
});

describe("histórico: sem aviso de sistema e sem horário inventado", () => {
  it("linhasDoHistorico pula o aviso de sistema e a mensagem sem timestamp", () => {
    const l = linhasDoHistorico([
      { id: "false_a_1", type: "unknown", body: "", timestamp: 1792360000, fromMe: false },
      { id: "false_a_2", type: "text", body: "sem horário", fromMe: false },
      { id: "false_a_3", type: "text", body: "real", timestamp: 1792360100, fromMe: false },
    ], TEL);
    expect(l.map((x) => x.message_id)).toEqual(["false_a_3"]);
    expect(l[0].created_at).toBe(new Date(1792360100 * 1000).toISOString());
  });
});
