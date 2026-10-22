// Instagram Direct no CRM: regras puras (_shared/instagram.ts), canal na tela Conversas e a fonte combinada.
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  assinaturaValida, cifrarToken, corpoDaMensagem, corpoEnvio, decidirJanela, decifrarToken, dividirTexto,
  estadoValido, faltamPermissoes, igsidDoPhone, interpretarWebhook, limparCode, phoneDoIgsid, precisaRenovar,
  respostaVerificacao, urlAutorizacao, validarMidia, CAMPOS_WEBHOOK,
} from "../../supabase/functions/_shared/instagram";
import {
  canalDoContato, ehGrupo, contatoEhGrupo, filtrarConversas, nomeExibido, subtituloContato, type Conversa, type ContatoCRM,
} from "@/lib/crm/conversas";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { combinarFontes } from "@/lib/crm/fonteInstagram";
import type { FonteConversas } from "@/lib/crm/fonteConversas";

const H = 60 * 60 * 1000;
const agora = new Date("2026-10-17T12:00:00Z");

describe("janela de resposta (24 h / HUMAN_AGENT 7 dias)", () => {
  it("sem mensagem da pessoa: não pode", () => {
    const j = decidirJanela(null, agora, true);
    expect(j.pode).toBe(false);
    expect(j.aviso).toMatch(/escreveu primeiro/);
  });
  it("dentro de 24 h: normal, até = entrada + 24 h", () => {
    const j = decidirJanela(new Date(agora.getTime() - 23 * H).toISOString(), agora, false);
    expect(j).toMatchObject({ pode: true, modo: "normal" });
    expect(j.ate).toBe(new Date(agora.getTime() + 1 * H).toISOString());
  });
  it("exatamente 24 h: já passou", () => {
    expect(decidirJanela(new Date(agora.getTime() - 24 * H).toISOString(), agora, false).pode).toBe(false);
  });
  it("entre 24 h e 7 dias: só com Human Agent liberado", () => {
    const e = new Date(agora.getTime() - 3 * 24 * H).toISOString();
    expect(decidirJanela(e, agora, false)).toMatchObject({ pode: false, modo: null });
    expect(decidirJanela(e, agora, true)).toMatchObject({ pode: true, modo: "human_agent" });
  });
  it("mais de 7 dias: nunca, nem com Human Agent", () => {
    expect(decidirJanela(new Date(agora.getTime() - 8 * 24 * H).toISOString(), agora, true).pode).toBe(false);
  });
  it("data lixo: não pode", () => {
    expect(decidirJanela("ontem", agora, true).pode).toBe(false);
  });
});

describe("corpo do envio", () => {
  it("texto normal leva messaging_type RESPONSE", () => {
    expect(corpoEnvio("123456", { texto: "oi" }, "normal")).toEqual({
      recipient: { id: "123456" }, message: { text: "oi" }, messaging_type: "RESPONSE",
    });
  });
  it("fora das 24 h leva MESSAGE_TAG + HUMAN_AGENT", () => {
    expect(corpoEnvio("123456", { texto: "oi" }, "human_agent")).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });
  it("imagem vai em attachments[], áudio em attachment, PDF como file", () => {
    expect(corpoEnvio("1", { midia: { tipo: "image", url: "https://x/a.jpg" } }, "normal").message)
      .toEqual({ attachments: [{ type: "image", payload: { url: "https://x/a.jpg" } }] });
    expect(corpoEnvio("1", { midia: { tipo: "audio", url: "https://x/a.m4a" } }, "normal").message)
      .toEqual({ attachment: { type: "audio", payload: { url: "https://x/a.m4a" } } });
    expect(corpoEnvio("1", { midia: { tipo: "document", url: "https://x/a.pdf" } }, "normal").message)
      .toEqual({ attachment: { type: "file", payload: { url: "https://x/a.pdf" } } });
  });
});

describe("texto até 1000 bytes", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  it("curto passa inteiro; vazio some", () => {
    expect(dividirTexto("  oi  ")).toEqual(["oi"]);
    expect(dividirTexto("   ")).toEqual([]);
  });
  it("longo quebra sem passar de 1000 bytes e sem perder palavra", () => {
    const longo = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");
    const partes = dividirTexto(longo);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(bytes(p)).toBeLessThanOrEqual(1000);
    expect(partes.join(" ").split(/\s+/)).toEqual(longo.split(" "));
  });
  it("acento e emoji contam bytes, não caracteres", () => {
    const partes = dividirTexto("ã".repeat(700)); // 1400 bytes
    expect(partes.length).toBe(2);
    for (const p of partes) expect(bytes(p)).toBeLessThanOrEqual(1000);
    const emoji = dividirTexto("😀".repeat(300)); // 1200 bytes
    expect(emoji.join("")).toBe("😀".repeat(300));
  });
});

describe("mídia aceita pelo Direct", () => {
  it("aceita os formatos da doc", () => {
    expect(validarMidia("image", { mime: "image/jpeg", nome: "a.jpg", tamanho: 1e6 })).toBeNull();
    expect(validarMidia("audio", { mime: "audio/mp4", nome: "a.m4a" })).toBeNull();
    expect(validarMidia("video", { mime: "video/quicktime", nome: "a.mov" })).toBeNull();
    expect(validarMidia("document", { mime: "application/pdf", nome: "a.pdf" })).toBeNull();
  });
  it("recusa webp, ogg de áudio, docx e tamanho acima do teto", () => {
    expect(validarMidia("image", { mime: "image/webp", nome: "a.webp" })).toMatch(/PNG ou JPEG/);
    expect(validarMidia("audio", { mime: "audio/ogg", nome: "a.ogg" })).toMatch(/Áudio/);
    expect(validarMidia("document", { nome: "contrato.docx" })).toMatch(/PDF/);
    expect(validarMidia("image", { mime: "image/png", tamanho: 9 * 1024 * 1024 })).toMatch(/grande/);
  });
  it("link de roteiro sem mime: decide pela extensão (com query string)", () => {
    expect(validarMidia("audio", { nome: "https://equipe.brenoxavier.com.br/x/audio.mp3?v=1" })).toMatch(/Áudio/);
    expect(validarMidia("image", { nome: "https://equipe.brenoxavier.com.br/x/fisico-1.jpg" })).toBeNull();
  });
});

describe("assinatura do webhook (X-Hub-Signature-256)", () => {
  const segredo = "segredo-do-app-123";
  const corpo = JSON.stringify({ object: "instagram", entry: [] });
  const assinar = (c: string, s = segredo) => `sha256=${createHmac("sha256", s).update(c).digest("hex")}`;
  it("aceita a assinatura certa (string e bytes)", async () => {
    expect(await assinaturaValida(corpo, assinar(corpo), segredo)).toBe(true);
    expect(await assinaturaValida(new TextEncoder().encode(corpo), assinar(corpo), segredo)).toBe(true);
  });
  it("recusa: segredo errado, corpo alterado, sem prefixo, vazio, sem segredo", async () => {
    expect(await assinaturaValida(corpo, assinar(corpo, "outro"), segredo)).toBe(false);
    expect(await assinaturaValida(corpo + " ", assinar(corpo), segredo)).toBe(false);
    expect(await assinaturaValida(corpo, assinar(corpo).slice(7), segredo)).toBe(false);
    expect(await assinaturaValida(corpo, null, segredo)).toBe(false);
    expect(await assinaturaValida(corpo, assinar(corpo), "")).toBe(false);
    expect(await assinaturaValida(corpo, "sha1=" + "a".repeat(40), segredo)).toBe(false);
  });
});

describe("verificação GET (hub.challenge)", () => {
  const p = (o: Record<string, string>) => new URLSearchParams(o);
  it("devolve o challenge só com mode=subscribe e token igual", () => {
    expect(respostaVerificacao(p({ "hub.mode": "subscribe", "hub.verify_token": "abc", "hub.challenge": "123" }), "abc")).toBe("123");
    expect(respostaVerificacao(p({ "hub.mode": "subscribe", "hub.verify_token": "abd", "hub.challenge": "123" }), "abc")).toBeNull();
    expect(respostaVerificacao(p({ "hub.mode": "unsubscribe", "hub.verify_token": "abc", "hub.challenge": "123" }), "abc")).toBeNull();
    expect(respostaVerificacao(p({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), null)).toBeNull();
  });
});

describe("leitura do webhook", () => {
  const conta = "17841400000000001";
  const user = "1234567890123456789"; // 19 dígitos: não pode virar "grupo"
  it("mensagem de texto da pessoa", () => {
    const ev = interpretarWebhook({
      object: "instagram",
      entry: [{ id: conta, time: 1, messaging: [{ sender: { id: user }, recipient: { id: conta }, timestamp: 1760702400000, message: { mid: "m1", text: "oi" } }] }],
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tipo: "mensagem", contaIgId: conta, igsid: user, mid: "m1", texto: "oi", em: "2025-10-17T12:00:00.000Z" });
  });
  it("eco (o que a conta mandou): igsid é o destinatário", () => {
    const ev = interpretarWebhook({
      object: "instagram",
      entry: [{ id: conta, messaging: [{ sender: { id: conta }, recipient: { id: user }, timestamp: 1, message: { mid: "m2", text: "resp", is_echo: true } }] }],
    });
    expect(ev[0]).toMatchObject({ tipo: "eco", igsid: user, mid: "m2" });
  });
  it("anexos, resposta a story e anúncio viram contexto", () => {
    const [e] = interpretarWebhook({
      object: "instagram",
      entry: [{ id: conta, messaging: [{
        sender: { id: user }, recipient: { id: conta }, timestamp: 1,
        message: { mid: "m3", text: "quero", reply_to: { story: { id: "s", url: "https://cdn/x" } }, attachments: [{ type: "image", payload: { url: "https://cdn/f.jpg" } }, { type: "file", payload: { url: "https://cdn/a.pdf" } }] },
      }] }],
    });
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    expect(e.anexos).toEqual([{ tipo: "image", url: "https://cdn/f.jpg" }, { tipo: "document", url: "https://cdn/a.pdf" }]);
    expect(corpoDaMensagem(e)).toBe("[Respondeu ao seu story]\nquero");
    const [ad] = interpretarWebhook({
      object: "instagram",
      entry: [{ id: conta, messaging: [{ sender: { id: user }, recipient: { id: conta }, timestamp: 1, message: { mid: "m4", text: "oi", referral: { source: "ADS", ad_id: "9" } } }] }],
    });
    expect(ad.tipo === "mensagem" && ad.contexto).toBe("Veio de um anúncio");
  });
  it("lida, postback, apagada e formato changes", () => {
    const ev = interpretarWebhook({
      object: "instagram",
      entry: [{
        id: conta,
        messaging: [
          { sender: { id: user }, recipient: { id: conta }, timestamp: 2, read: { mid: "m2" } },
          { sender: { id: user }, recipient: { id: conta }, timestamp: 3, postback: { mid: "p1", title: "Quero", payload: "QUERO" } },
          { sender: { id: user }, recipient: { id: conta }, timestamp: 4, message: { mid: "m9", is_deleted: true } },
        ],
        changes: [{ field: "messages", value: { sender: { id: user }, recipient: { id: conta }, timestamp: 5, message: { mid: "m10", text: "teste" } } }],
      }],
    });
    expect(ev.map((e) => e.tipo)).toEqual(["lida", "postback", "apagada", "mensagem"]);
  });
  it("ignora objeto que não é instagram, entry sem id e lixo", () => {
    expect(interpretarWebhook({ object: "page", entry: [{ id: "1", messaging: [{}] }] })).toEqual([]);
    expect(interpretarWebhook({ object: "instagram", entry: [{ messaging: [{ sender: { id: "1" }, message: { mid: "x" } }] }] })).toEqual([]);
    expect(interpretarWebhook(null)).toEqual([]);
    expect(interpretarWebhook({ object: "instagram", entry: [{ id: conta, messaging: [{ sender: { id: user }, message: { text: "sem mid" } }] }] })).toEqual([]);
  });
});

describe("OAuth e token", () => {
  it("URL de login com os escopos novos e state", () => {
    const u = new URL(urlAutorizacao({ appId: "111", redirectUri: "https://x.supabase.co/functions/v1/instagram-oauth", state: "s".repeat(32) }));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
  it("code com #_ no fim é limpo; state fora do formato é recusado", () => {
    expect(limparCode("AQBx1234567890#_")).toBe("AQBx1234567890");
    expect(limparCode("<script>")).toBeNull();
    expect(estadoValido("a".repeat(32))).toBe(true);
    expect(estadoValido("curto")).toBe(false);
    expect(estadoValido("a".repeat(31) + "'")).toBe(false);
  });
  it("detecta permissão de mensagens faltando", () => {
    expect(faltamPermissoes("instagram_business_basic,instagram_business_manage_messages")).toEqual([]);
    expect(faltamPermissoes(["instagram_business_basic"])).toEqual(["instagram_business_manage_messages"]);
  });
  it("cifra e decifra o token; segredo errado ou curto falha", async () => {
    const seg = "x".repeat(40);
    const c = await cifrarToken("IGAA-token-secreto", seg);
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("token-secreto");
    expect(await decifrarToken(c, seg)).toBe("IGAA-token-secreto");
    await expect(decifrarToken(c, "y".repeat(40))).rejects.toBeTruthy();
    await expect(cifrarToken("t", "curto")).rejects.toThrow(/IG_TOKEN_SEGREDO/);
  });
  it("renova com menos de 10 dias, não quando vencido ou longe", () => {
    expect(precisaRenovar(new Date(agora.getTime() + 5 * 24 * H).toISOString(), agora)).toBe(true);
    expect(precisaRenovar(new Date(agora.getTime() + 30 * 24 * H).toISOString(), agora)).toBe(false);
    expect(precisaRenovar(new Date(agora.getTime() - H).toISOString(), agora)).toBe(false);
  });
  it("campos do webhook só os de mensagens", () => {
    expect([...CAMPOS_WEBHOOK]).toEqual(["messages", "messaging_postbacks", "messaging_seen"]);
  });
});

describe("canal na tela Conversas", () => {
  const ig: ContatoCRM = { id: "a", phone: phoneDoIgsid("1234567890123456789"), name: "", username: "ana.fit", stage: "leads", updated_at: "", canal: "instagram" };
  const wa: ContatoCRM = { id: "b", phone: "5531999998888", name: "Bia", stage: "leads", updated_at: "" };
  it("phone ig: com IGSID longo não é grupo", () => {
    expect(ehGrupo(ig.phone)).toBe(false);
    expect(contatoEhGrupo(ig)).toBe(false);
    expect(igsidDoPhone(ig.phone)).toBe("1234567890123456789");
    expect(igsidDoPhone("ig:abc")).toBeNull();
  });
  it("canal, nome e subtítulo", () => {
    expect(canalDoContato(ig)).toBe("instagram");
    expect(canalDoContato({ phone: "ig:123456" })).toBe("instagram");
    expect(canalDoContato(wa)).toBe("whatsapp");
    expect(nomeExibido(ig)).toBe("@ana.fit");
    expect(subtituloContato(ig)).toBe("@ana.fit · Instagram");
    expect(subtituloContato(wa)).toBe("+55 31 99999-8888");
  });
  it("filtro por canal e busca pelo @", () => {
    const lista: Conversa[] = [ig, wa].map((c) => ({ contato: c, ultima: null, naoLidas: 0, ordem: "", semConversa: false }));
    expect(filtrarConversas(lista, "", "canal:instagram").map((c) => c.contato.id)).toEqual(["a"]);
    expect(filtrarConversas(lista, "", "canal:whatsapp").map((c) => c.contato.id)).toEqual(["b"]);
    expect(filtrarConversas(lista, "@ana", "tudo").map((c) => c.contato.id)).toEqual(["a"]);
  });
});

describe("fonte combinada (WhatsApp + Instagram)", () => {
  const fake = (nome: string, contatos: ContatoCRM[]): FonteConversas & { chamadas: string[] } => {
    const chamadas: string[] = [];
    return {
      chamadas,
      usuarioId: async () => "u",
      listarContatos: async () => contatos,
      mensagensRecentes: async () => [],
      mensagensDoContato: async (p) => { chamadas.push(`msgs:${p}`); return []; },
      assinar: () => () => undefined,
      enviarTexto: async (p) => { chamadas.push(`texto:${p}`); },
      enviarMidia: async (p) => { chamadas.push(`midia:${p}`); },
      enviarMidiaUrl: async (p) => { chamadas.push(`url:${p}`); },
      importarHistorico: async () => { chamadas.push(`hist:${nome}`); return 0; },
      atualizarContato: async (id) => { chamadas.push(`upd:${id}`); },
    };
  };
  it("junta as listas e despacha cada envio pelo canal", async () => {
    const wa = fake("wa", [{ id: "w1", phone: "5531999998888", name: "", stage: "leads", updated_at: "" }]);
    const ig = fake("ig", [{ id: "i1", phone: "ig:1234567", name: "", stage: "leads", updated_at: "", canal: "instagram" }]);
    const f = combinarFontes(wa, ig);
    expect((await f.listarContatos()).map((c) => c.id)).toEqual(["w1", "i1"]);
    await f.enviarTexto("ig:1234567", "oi");
    await f.enviarTexto("5531999998888", "oi");
    await f.enviarMidiaUrl!("ig:1234567", { url: "https://x/a.jpg", tipo: "image" }, "");
    await f.mensagensDoContato("ig:1234567", 10);
    await f.atualizarContato("i1", { stage: "contato" });
    await f.atualizarContato("w1", { stage: "contato" });
    expect(ig.chamadas).toEqual(["texto:ig:1234567", "url:ig:1234567", "msgs:ig:1234567", "upd:i1"]);
    expect(wa.chamadas).toEqual(["texto:5531999998888", "upd:w1"]);
  });
  it("Instagram fora do ar (tabela sem migration) não derruba a lista do WhatsApp", async () => {
    const wa = fake("wa", [{ id: "w1", phone: "5531999998888", name: "", stage: "leads", updated_at: "" }]);
    const ig = { ...fake("ig", []), listarContatos: async () => { throw new Error("relation does not exist"); } };
    const f = combinarFontes(wa, ig);
    expect((await f.listarContatos()).map((c) => c.id)).toEqual(["w1"]);
  });
});
