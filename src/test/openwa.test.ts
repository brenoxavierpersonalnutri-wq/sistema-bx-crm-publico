// HMAC do webhook do OpenWA, normalização de telefone/evento e o contrato
// edge function <-> proxy da VPS (assinatura, relógio, nonce, limites, rotas fechadas).
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  hmacSha256Hex, assinaturaOpenwaValida, iguaisTempoConstante, telefoneDoWid,
  interpretarEventoOpenwa, extensaoDoMime, assinarChamadaProxy, avatarPrecisaAtualizar, chatIdDoContato,
  caminhoAvatar, ehGrupo,
} from "../../supabase/functions/_shared/openwa";
import {
  conferirChamada, CacheNonce, Limitador, LimitadorLeitura, montarPedidoOpenwa, mascarar, diaBRT, filtrarChatsIndividuais,
  telefoneResolvido, filtrarChatsGrupos, resumoGrupo, urlFotoPermitida, ROTAS_DE_ENVIO,
} from "../../infra/wa-proxy/lib.mjs";

const SECRET = "segredo-de-teste-0123456789abcdef";
// mesmo cálculo do OpenWA (webhook-delivery.service.ts, generateSignature)
const assinaturaDoOpenwa = (corpo: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(corpo).digest("hex")}`;

describe("HMAC-SHA256", () => {
  it("bate com o vetor RFC 4231 (caso 2)", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?"))
      .toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("aceita a assinatura gerada como o OpenWA gera", async () => {
    const corpo = JSON.stringify({ event: "message.received", data: { id: "x", body: "olá ç" } });
    expect(await assinaturaOpenwaValida(corpo, assinaturaDoOpenwa(corpo), SECRET)).toBe(true);
    expect(await assinaturaOpenwaValida(corpo, assinaturaDoOpenwa(corpo).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, formato errado e ausência", async () => {
    const corpo = '{"event":"message.received","data":{}}';
    const sig = assinaturaDoOpenwa(corpo);
    expect(await assinaturaOpenwaValida(corpo + " ", sig, SECRET)).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, assinaturaDoOpenwa(corpo, "outro"), SECRET)).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, sig.replace("sha256=", ""), SECRET)).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, sig.slice(0, -1), SECRET)).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, null, SECRET)).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, sig, "")).toBe(false);
    expect(await assinaturaOpenwaValida(corpo, sig, undefined)).toBe(false);
  });

  it("re-serializar o JSON muda os bytes e invalida (tem que usar o corpo cru)", async () => {
    const cru = '{"data":{"id":"1"},"event":"message.received"}';
    const sig = assinaturaDoOpenwa(cru);
    const reserializado = JSON.stringify(JSON.parse(cru), null, 1);
    expect(await assinaturaOpenwaValida(reserializado, sig, SECRET)).toBe(false);
  });

  it("comparação em tempo constante", () => {
    expect(iguaisTempoConstante("abc", "abc")).toBe(true);
    expect(iguaisTempoConstante("abc", "abd")).toBe(false);
    expect(iguaisTempoConstante("abc", "abcd")).toBe(false);
  });
});

describe("telefoneDoWid", () => {
  it("extrai telefone de @c.us e @s.whatsapp.net (com sufixo de aparelho)", () => {
    expect(telefoneDoWid("5531999998888@c.us")).toBe("5531999998888");
    expect(telefoneDoWid("553199998888@s.whatsapp.net")).toBe("553199998888");
    expect(telefoneDoWid("5531999998888:12@s.whatsapp.net")).toBe("5531999998888");
  });
  it("devolve null pra grupo, lid, canal, status, curto e lixo", () => {
    expect(telefoneDoWid("120363000000000000@g.us")).toBeNull();
    expect(telefoneDoWid("123456789012345@lid")).toBeNull();
    expect(telefoneDoWid("120363@newsletter")).toBeNull();
    expect(telefoneDoWid("status@broadcast")).toBeNull();
    expect(telefoneDoWid("12345@c.us")).toBeNull();
    expect(telefoneDoWid("5531999998888")).toBeNull();
    expect(telefoneDoWid(undefined)).toBeNull();
  });
});

const recebida = (data: Record<string, unknown>) => ({
  event: "message.received", sessionId: "s", timestamp: "2026-10-16T12:00:00.000Z", data,
});

describe("interpretarEventoOpenwa", () => {
  it("mensagem de texto recebida vira inbound com nome e data", () => {
    const ev = interpretarEventoOpenwa(recebida({
      id: "false_5531999998888@c.us_3EB0AA", from: "5531999998888@c.us", to: "5531000000000@c.us",
      chatId: "5531999998888@c.us", body: "Oi, quero saber do método", type: "text",
      timestamp: 1791900000, fromMe: false, isGroup: false, kind: "individual",
      contact: { pushName: "Maria" },
    }));
    expect(ev).toMatchObject({
      tipo: "mensagem", telefone: "5531999998888", fromMe: false, corpo: "Oi, quero saber do método",
      messageId: "false_5531999998888@c.us_3EB0AA", nome: "Maria", mediaType: null,
    });
    if (ev.tipo === "mensagem") expect(ev.criadoEm).toBe(new Date(1791900000 * 1000).toISOString());
  });

  it("message.sent vira outbound, telefone pelo chatId/to, sem nome", () => {
    const ev = interpretarEventoOpenwa({
      event: "message.sent",
      data: { id: "true_5531999998888@c.us_X", from: "5531000000000@c.us", to: "5531999998888@c.us",
        body: "Bom dia!", type: "text", fromMe: true, isGroup: false, kind: "individual",
        contact: { pushName: "Conta própria" } },
    });
    expect(ev).toMatchObject({ tipo: "mensagem", telefone: "5531999998888", fromMe: true, nome: null });
  });

  it("grupo vira mensagem com telefone = JID do grupo e autor separado", () => {
    const ev = interpretarEventoOpenwa(recebida({
      id: "false_120363000000000000@g.us_ABC_5531999998888@c.us", chatId: "120363000000000000@g.us",
      from: "120363000000000000@g.us", author: "5531999998888@c.us", isGroup: true, kind: "group",
      body: "bom dia grupo", type: "text", contact: { pushName: "Carla", number: "5531999998888" },
    }));
    expect(ev).toMatchObject({
      tipo: "mensagem", grupo: true, telefone: "120363000000000000@g.us", autorNome: "Carla",
      autorTelefone: "5531999998888", autorId: "5531999998888@c.us", nome: null, corpo: "bom dia grupo",
    });
    // como chega de verdade (medido em 17/10): autor @lid, sem senderPhone nem contact.number
    expect(interpretarEventoOpenwa(recebida({
      id: "g4", chatId: "120363000000000000@g.us", author: "98765432101234@lid", isGroup: true, kind: "group",
      body: "x", contact: { pushName: "Dani" },
    }))).toMatchObject({ grupo: true, autorNome: "Dani", autorTelefone: null, autorId: "98765432101234@lid" });
    // grupo antigo (criador-epoch) e autor @lid com senderPhone
    expect(interpretarEventoOpenwa(recebida({
      id: "g2", chatId: "553199990000-1612345678@g.us", author: "98765432101234@lid", senderPhone: "5531977776666",
      isGroup: true, kind: "group", body: "oi", contact: { name: "Zé" },
    }))).toMatchObject({ grupo: true, telefone: "553199990000-1612345678@g.us", autorNome: "Zé", autorTelefone: "5531977776666" });
    // enviada por mim no grupo: sem autor
    expect(interpretarEventoOpenwa({ event: "message.sent", data: {
      id: "g3", chatId: "120363000000000000@g.us", fromMe: true, isGroup: true, kind: "group", body: "eu",
    } })).toMatchObject({ grupo: true, fromMe: true, autorNome: null, autorTelefone: null });
    // individual continua com grupo: false
    expect(interpretarEventoOpenwa(recebida({ id: "i", chatId: "5531999998888@c.us", body: "x" })))
      .toMatchObject({ grupo: false, autorNome: null });
  });

  it("ignora grupo com id inválido, kind de grupo sem @g.us, status e canal", () => {
    expect(interpretarEventoOpenwa(recebida({ chatId: "1203@g.us", from: "1203@g.us", isGroup: true, body: "x" })).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(recebida({ chatId: "abc@g.us", from: "abc@g.us", body: "x" })).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(recebida({ chatId: "5531999998888@c.us", kind: "group", body: "x" })).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(recebida({ chatId: "status@broadcast", isStatusBroadcast: true, body: "x" })).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(recebida({ chatId: "12@newsletter", body: "x" })).tipo).toBe("ignorar");
  });

  it("@lid usa senderPhone; sem ele, contact.number; sem nenhum, ignora", () => {
    const base = { chatId: "98765432101234@lid", from: "98765432101234@lid", body: "oi", type: "text", isLidSender: true };
    expect(interpretarEventoOpenwa(recebida({ ...base, senderPhone: "5531999998888" })))
      .toMatchObject({ tipo: "mensagem", telefone: "5531999998888" });
    expect(interpretarEventoOpenwa(recebida({ ...base, senderPhone: null, contact: { number: "553199997777" } })))
      .toMatchObject({ tipo: "mensagem", telefone: "553199997777" });
    expect(interpretarEventoOpenwa(recebida({ ...base, senderPhone: null })))
      .toEqual({ tipo: "ignorar", motivo: "lid sem telefone" });
  });

  it("ack: devolve messageId e status; status desconhecido é ignorado", () => {
    expect(interpretarEventoOpenwa({ event: "message.ack", data: { id: "abc", messageId: "abc", status: "read", ack: 3 } }))
      .toEqual({ tipo: "ack", messageId: "abc", status: "read" });
    expect(interpretarEventoOpenwa({ event: "message.ack", data: { messageId: "abc", status: "lido" } }).tipo).toBe("ignorar");
  });

  it("mídia inline vem pronta; mídia omitida fica pendente (busca no proxy)", () => {
    const inline = interpretarEventoOpenwa(recebida({
      id: "m1", chatId: "5531999998888@c.us", type: "image", body: "olha", hasMedia: true,
      media: { mimetype: "image/jpeg", data: "/9j/AAAA" },
    }));
    expect(inline).toMatchObject({ tipo: "mensagem", mediaType: "image", caption: "olha", corpo: "olha", midiaInline: "/9j/AAAA", midiaPendente: false });
    const omitida = interpretarEventoOpenwa(recebida({
      id: "m2", chatId: "5531999998888@c.us", type: "voice", body: "", hasMedia: true,
      media: { mimetype: "audio/ogg; codecs=opus", omitted: true, sizeBytes: 3_000_000 },
    }));
    expect(omitida).toMatchObject({ tipo: "mensagem", mediaType: "audio", corpo: "[áudio]", midiaInline: null, midiaPendente: true });
    const doc = interpretarEventoOpenwa(recebida({
      id: "m3", chatId: "5531999998888@c.us", type: "document", body: "", media: { mimetype: "application/pdf", filename: "proposta.pdf" },
    }));
    expect(doc).toMatchObject({ corpo: "proposta.pdf", fileName: "proposta.pdf", midiaPendente: true });
  });

  it("apagada é ignorada; localização vira rótulo; evento estranho é ignorado", () => {
    expect(interpretarEventoOpenwa(recebida({ chatId: "5531999998888@c.us", type: "revoked" })).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(recebida({ id: "l", chatId: "5531999998888@c.us", type: "location", body: "" })))
      .toMatchObject({ corpo: "[localização]" });
    expect(interpretarEventoOpenwa({ event: "session.status", data: { status: "ready" } }).tipo).toBe("ignorar");
    expect(interpretarEventoOpenwa(null).tipo).toBe("ignorar");
  });

  it("extensão do arquivo pelo nome ou mimetype", () => {
    expect(extensaoDoMime("image/jpeg")).toBe("jpg");
    expect(extensaoDoMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extensaoDoMime("application/pdf", "Proposta Final.PDF")).toBe("pdf");
    expect(extensaoDoMime(null)).toBe("bin");
  });
});

describe("contrato edge function -> proxy", () => {
  const AGORA = 1_791_900_000_000;
  const caminho = "/v1/send-text";
  const corpo = JSON.stringify({ phone: "5531999998888", text: "oi" });
  const headers = (a: { ts: string; nonce: string; assinatura: string }) =>
    ({ "x-wa-timestamp": a.ts, "x-wa-nonce": a.nonce, "x-wa-signature": a.assinatura });

  it("assinatura da edge function é aceita pelo proxy", async () => {
    const a = await assinarChamadaProxy(SECRET, "POST", caminho, corpo, AGORA);
    expect(a.nonce).toMatch(/^[a-f0-9]{32}$/);
    const r = conferirChamada({ secret: SECRET, headers: headers(a), metodo: "POST", caminho, corpo, agoraMs: AGORA + 5000, cache: new CacheNonce() });
    expect(r).toEqual({ ok: true });
  });

  it("recusa relógio > 60 s, nonce repetido, corpo/rota alterados e segredo errado", async () => {
    const a = await assinarChamadaProxy(SECRET, "POST", caminho, corpo, AGORA);
    const cache = new CacheNonce();
    const base = { secret: SECRET, headers: headers(a), metodo: "POST", caminho, corpo, cache };
    expect(conferirChamada({ ...base, agoraMs: AGORA + 61_000 }).motivo).toBe("relógio");
    expect(conferirChamada({ ...base, agoraMs: AGORA - 61_000 }).motivo).toBe("relógio");
    expect(conferirChamada({ ...base, corpo: corpo.replace("oi", "OI"), agoraMs: AGORA }).motivo).toBe("assinatura");
    expect(conferirChamada({ ...base, caminho: "/v1/send-image", agoraMs: AGORA }).motivo).toBe("assinatura");
    expect(conferirChamada({ ...base, secret: "outro-segredo", agoraMs: AGORA }).motivo).toBe("assinatura");
    expect(conferirChamada({ ...base, agoraMs: AGORA }).ok).toBe(true);
    expect(conferirChamada({ ...base, agoraMs: AGORA + 1000 }).motivo).toBe("nonce repetido");
    expect(conferirChamada({ ...base, headers: {}, agoraMs: AGORA }).status).toBe(401);
  });

  it("limite: 20 por minuto e 300 por dia (vira à meia-noite de São Paulo)", () => {
    const l = new Limitador();
    for (let i = 0; i < 20; i++) expect(l.reservar(AGORA + i).ok).toBe(true);
    const bloqueio = l.reservar(AGORA + 100);
    expect(bloqueio).toMatchObject({ ok: false, motivo: "limite por minuto" });
    expect(l.reservar(AGORA + 61_000).ok).toBe(true);

    const d = new Limitador({ dia: diaBRT(AGORA), noDia: 300, minuto: [] });
    expect(d.reservar(AGORA)).toMatchObject({ ok: false, motivo: "limite diário" });
    const meiaNoiteBRT = Date.parse(`${diaBRT(AGORA)}T03:00:00.000Z`) + 24 * 3600 * 1000;
    expect(d.reservar(meiaNoiteBRT + 1000).ok).toBe(true);
    // estado sobrevive a reinício (salvo em /data/limites.json)
    expect(new Limitador(JSON.parse(JSON.stringify(d.paraJSON()))).noDia).toBe(1);
  });

  it("rota typing (digitando… do robô de IA): só telefone individual e estado conhecido", () => {
    const sid = "uuid-closer";
    expect(montarPedidoOpenwa("typing", { phone: "5531999998888", state: "typing" }, sid)).toEqual({
      metodo: "POST", caminho: "/sessions/uuid-closer/chats/typing", corpo: { chatId: "5531999998888@c.us", state: "typing" },
    });
    expect(montarPedidoOpenwa("typing", { phone: "5531999998888", state: "paused" }, sid).corpo).toMatchObject({ state: "paused" });
    expect(montarPedidoOpenwa("typing", { phone: "5531999998888", state: "online" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("typing", { phone: "120363000000000000@g.us", state: "typing" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("typing", { phone: "5531999998888", state: "typing", text: "oi" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-text", { phone: "5531999998888", text: "oi", state: "typing" }, sid).erro).toBeTruthy();
  });

  it("rotas fechadas: só o que está na lista, 1 destinatário, https, sem campo extra", () => {
    const sid = "uuid-closer";
    expect(montarPedidoOpenwa("send-text", { phone: "5531999998888", text: "oi" }, sid)).toEqual({
      metodo: "POST", caminho: "/sessions/uuid-closer/messages/send-text",
      corpo: { chatId: "5531999998888@c.us", text: "oi" },
    });
    for (const rota of ["send-bulk", "logout", "webhooks", "groups", "send-video", "../sessions"]) {
      expect(montarPedidoOpenwa(rota, { phone: "5531999998888", text: "oi" }, sid).erro).toBeTruthy();
    }
    expect(montarPedidoOpenwa("send-text", { phone: ["5531999998888", "5531999997777"], text: "oi" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-text", { phone: "120363000000000000@g.us", text: "oi" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-text", { phone: "5531999998888", text: "oi", chatId: "1203@g.us" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-text", { phone: "5531999998888", text: "x".repeat(4097) }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-image", { phone: "5531999998888", url: "http://a.com/x.jpg" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-document", { phone: "5531999998888", url: "https://a.com/x.pdf", filename: "x.pdf" }, sid))
      .toMatchObject({ corpo: { chatId: "5531999998888@c.us", url: "https://a.com/x.pdf", filename: "x.pdf" } });
    expect(montarPedidoOpenwa("history", { phone: "5531999998888", limit: 5000 }, sid).caminho)
      .toBe("/sessions/uuid-closer/messages/5531999998888%40c.us/history?limit=100");
    expect(montarPedidoOpenwa("media", { chatId: "5531999998888@c.us", messageId: "false_5531999998888@c.us_3EB0" }, sid))
      .toMatchObject({ metodo: "GET", binario: true });
    expect(montarPedidoOpenwa("media", { chatId: "1203@g.us", messageId: "x" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("status", {}, sid)).toEqual({ metodo: "GET", caminho: "/sessions/uuid-closer" });
    expect(montarPedidoOpenwa("status", { phone: "5531999998888" }, sid).erro).toBeTruthy();
  });

  it("send-audio: nota de voz vai com ptt e mimetype ogg/opus; nada de campo extra nem http", () => {
    const sid = "uuid-closer";
    expect(ROTAS_DE_ENVIO.has("send-audio")).toBe(true);
    expect(montarPedidoOpenwa("send-audio", { phone: "5531999998888", url: "https://a.com/v.ogg", ptt: true }, sid)).toEqual({
      metodo: "POST", caminho: "/sessions/uuid-closer/messages/send-audio",
      corpo: { chatId: "5531999998888@c.us", url: "https://a.com/v.ogg", ptt: true, mimetype: "audio/ogg; codecs=opus" },
      voz: true, gravando: "5531999998888@c.us",
    });
    expect(montarPedidoOpenwa("send-audio", { phone: "5531999998888", url: "https://a.com/a.mp3" }, sid).corpo)
      .toEqual({ chatId: "5531999998888@c.us", url: "https://a.com/a.mp3" });
    expect(montarPedidoOpenwa("send-audio", { phone: "5531999998888", url: "https://a.com/v.ogg", ptt: "sim" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-audio", { phone: "5531999998888", url: "http://a.com/v.ogg", ptt: true }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-audio", { phone: "5531999998888", url: "https://a.com/v.ogg", caption: "x" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-audio", { phone: "120363000000000000@g.us", url: "https://a.com/v.ogg", ptt: true }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-text", { phone: "5531999998888", text: "oi", ptt: true }, sid).erro).toBeTruthy();
  });

  it("history por chatId (@c.us, @lid ou grupo), nunca canal/status, nunca os dois campos", () => {
    const sid = "uuid-closer";
    expect(montarPedidoOpenwa("history", { chatId: "123456789012345@lid", limit: 20 }, sid).caminho)
      .toBe("/sessions/uuid-closer/messages/123456789012345%40lid/history?limit=20");
    expect(montarPedidoOpenwa("history", { chatId: "5531999998888@c.us" }, sid).caminho)
      .toBe("/sessions/uuid-closer/messages/5531999998888%40c.us/history?limit=50");
    expect(montarPedidoOpenwa("history", { chatId: "120363000000000000@g.us" }, sid).caminho)
      .toBe("/sessions/uuid-closer/messages/120363000000000000%40g.us/history?limit=50");
    expect(montarPedidoOpenwa("history", { chatId: "12@newsletter" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("history", { chatId: "status@broadcast" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("history", { chatId: "5531999998888@c.us", phone: "5531999998888" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("history", {}, sid).erro).toBeTruthy();
  });

  it("telefone resolvido de @lid: só dígitos válidos", () => {
    expect(telefoneResolvido({ contactId: "1@lid", phone: "5531999998888" })).toBe("5531999998888");
    expect(telefoneResolvido({ phone: "+55 (31) 99999-8888" })).toBe("5531999998888");
    expect(telefoneResolvido({ phone: null })).toBeNull();
    expect(telefoneResolvido(null)).toBeNull();
  });

  it("qr e chats: só leitura, sem campo extra, limite de 60 conversas", () => {
    const sid = "uuid-closer";
    expect(montarPedidoOpenwa("qr", {}, sid)).toEqual({ metodo: "GET", caminho: "/sessions/uuid-closer/qr" });
    expect(montarPedidoOpenwa("qr", { phone: "5531999998888" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("chats", {}, sid).caminho).toBe("/sessions/uuid-closer/chats?limit=30");
    expect(montarPedidoOpenwa("chats", { limit: 5000 }, sid).caminho).toBe("/sessions/uuid-closer/chats?limit=60");
    expect(montarPedidoOpenwa("chats", { limit: 10, phone: "5531999998888" }, sid).erro).toBeTruthy();
    for (const rota of ["start", "stop", "logout", "pairing-code", "chats/read"]) {
      expect(montarPedidoOpenwa(rota, {}, sid).erro).toBeTruthy();
    }
  });

  it("chats: só individuais (@c.us e @lid), sem prévia da última mensagem", () => {
    const r = filtrarChatsIndividuais([
      { id: "5531999998888@c.us", name: "Ana", isGroup: false, kind: "individual", timestamp: 10, lastMessage: "segredo" },
      { id: "120363000000000000@g.us", name: "Grupo", isGroup: true, kind: "group", timestamp: 9 },
      { id: "123456789012345@lid", name: "Lid", isGroup: false, kind: "individual", timestamp: 8 },
      { id: "status@broadcast", name: "s", isGroup: false, kind: "status", timestamp: 7 },
      { id: "5531988887777@c.us", name: "", isGroup: false, timestamp: 6 },
      null,
    ]);
    expect(r).toEqual([
      { chatId: "5531999998888@c.us", phone: "5531999998888", name: "Ana", timestamp: 10 },
      { chatId: "123456789012345@lid", phone: null, name: "Lid", timestamp: 8 },
      { chatId: "5531988887777@c.us", phone: "5531988887777", name: null, timestamp: 6 },
    ]);
    expect(JSON.stringify(r)).not.toContain("segredo");
    expect(filtrarChatsIndividuais({ erro: 1 })).toEqual([]);
  });

  it("leituras: 60 por minuto, janela deslizante", () => {
    const l = new LimitadorLeitura();
    for (let i = 0; i < 60; i++) expect(l.reservar(AGORA + i).ok).toBe(true);
    expect(l.reservar(AGORA + 100)).toMatchObject({ ok: false, motivo: "limite de leitura por minuto" });
    expect(l.reservar(AGORA + 60_001).ok).toBe(true);
  });

  it("log mascara o telefone", () => {
    expect(mascarar("5531999998888")).toBe("***8888");
    expect(mascarar(undefined)).toBe("-");
  });
});

describe("proxy: grupos e foto (só leitura)", () => {
  const sid = "uuid-closer";

  it("groups lê da lista de chats (3x o limite, teto 180) e group-info só aceita grupo", () => {
    expect(montarPedidoOpenwa("groups", { limit: 20 }, sid))
      .toEqual({ metodo: "GET", caminho: "/sessions/uuid-closer/chats?limit=60", limiteGrupos: 20 });
    expect(montarPedidoOpenwa("groups", { limit: 999 }, sid))
      .toMatchObject({ caminho: "/sessions/uuid-closer/chats?limit=180", limiteGrupos: 60 });
    expect(montarPedidoOpenwa("groups", { limit: 5, chatId: "x" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("group-info", { chatId: "120363000000000000@g.us" }, sid))
      .toEqual({ metodo: "GET", caminho: "/sessions/uuid-closer/groups/120363000000000000%40g.us" });
    expect(montarPedidoOpenwa("group-info", { chatId: "5531999998888@c.us" }, sid).erro).toBeTruthy();
  });

  it("avatar: contato -> profile-picture, grupo -> picture; resto recusado", () => {
    expect(montarPedidoOpenwa("avatar", { chatId: "5531999998888@c.us" }, sid)).toEqual({
      metodo: "GET", caminho: "/sessions/uuid-closer/contacts/5531999998888%40c.us/profile-picture", foto: true,
    });
    expect(montarPedidoOpenwa("avatar", { chatId: "123456789012345@lid" }, sid)).toMatchObject({ foto: true });
    expect(montarPedidoOpenwa("avatar", { chatId: "120363000000000000@g.us" }, sid)).toEqual({
      metodo: "GET", caminho: "/sessions/uuid-closer/groups/120363000000000000%40g.us/picture", foto: true,
    });
    for (const chatId of ["status@broadcast", "12@newsletter", "../x", "5531999998888", ""]) {
      expect(montarPedidoOpenwa("avatar", { chatId }, sid).erro).toBeTruthy();
    }
    expect(montarPedidoOpenwa("avatar", { chatId: "5531999998888@c.us", phone: "1" }, sid).erro).toBeTruthy();
  });

  it("envio a grupo continua impossível", () => {
    for (const rota of ["send-text", "send-image", "send-document", "send-audio"]) {
      expect(montarPedidoOpenwa(rota, { phone: "120363000000000000@g.us", text: "x", url: "https://a.com/x.jpg" }, sid).erro).toBeTruthy();
    }
  });

  it("filtrarChatsGrupos: só @g.us, sem prévia, respeita o limite", () => {
    const r = filtrarChatsGrupos([
      { id: "5531999998888@c.us", name: "Ana", isGroup: false, kind: "individual", timestamp: 10 },
      { id: "120363000000000000@g.us", name: "Turma", isGroup: true, kind: "group", timestamp: 9, lastMessage: "segredo" },
      { id: "553199990000-1612345678@g.us", name: "", isGroup: true, kind: "group", timestamp: 8 },
      { id: "120363000000000001@g.us", name: "Comunidade", isGroup: true, kind: "community", timestamp: 7 },
      { id: "120363000000000002@g.us", name: "Terceiro", isGroup: true, kind: "group", timestamp: 6 },
    ], 2);
    expect(r).toEqual([
      { chatId: "120363000000000000@g.us", name: "Turma", timestamp: 9 },
      { chatId: "553199990000-1612345678@g.us", name: null, timestamp: 8 },
    ]);
    expect(JSON.stringify(r)).not.toContain("segredo");
  });

  it("resumoGrupo: assunto e contagem, nunca a lista de participantes", () => {
    const r = resumoGrupo({ id: "120363000000000000@g.us", name: "Turma", participants: [{ id: "5531999998888@c.us" }, { id: "x" }] });
    // sem o telefone da sessão: permissão "não sei" (null), nunca admin
    expect(r).toEqual({ chatId: "120363000000000000@g.us", name: "Turma", participants: 2, souAdmin: null, announce: null, locked: null });
    expect(JSON.stringify(r)).not.toContain("5531999998888");
    expect(resumoGrupo({ id: "5531999998888@c.us" })).toBeNull();
  });

  it("urlFotoPermitida: só https do CDN do WhatsApp/Meta", () => {
    expect(urlFotoPermitida("https://pps.whatsapp.net/v/t61/abc.jpg?oh=1&oe=2")).toBe(true);
    expect(urlFotoPermitida("https://scontent.fbcdn.net/x.jpg")).toBe(true);
    for (const u of [
      "http://pps.whatsapp.net/x.jpg", "https://pps.whatsapp.net.evil.com/x.jpg", "https://evilwhatsapp.net/x",
      "https://169.254.169.254/latest", "https://pps.whatsapp.net:8443/x", "https://u:p@pps.whatsapp.net/x",
      "file:///etc/passwd", "", null,
    ]) expect(urlFotoPermitida(u)).toBe(false);
  });

  it("validade da foto: 7 dias", () => {
    const agora = Date.parse("2026-10-17T12:00:00Z");
    expect(avatarPrecisaAtualizar(null, agora)).toBe(true);
    expect(avatarPrecisaAtualizar("2026-10-12T12:00:00Z", agora)).toBe(false);
    expect(avatarPrecisaAtualizar("2026-10-10T11:00:00Z", agora)).toBe(true);
    expect(avatarPrecisaAtualizar("lixo", agora)).toBe(true);
  });

  it("chatId e caminho da foto: hash, sem o telefone no caminho", async () => {
    expect(chatIdDoContato("5531999998888")).toBe("5531999998888@c.us");
    expect(chatIdDoContato("120363000000000000@g.us")).toBe("120363000000000000@g.us");
    expect(chatIdDoContato("123")).toBeNull();
    expect(ehGrupo("120363000000000000@g.us")).toBe(true);
    expect(ehGrupo("5531999998888@c.us")).toBe(false);
    const c = await caminhoAvatar("5531999998888", "image/jpeg");
    expect(c).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{40}\.jpg$/);
    expect(c).not.toContain("5531999998888");
    expect(await caminhoAvatar("5531999998888", "image/jpeg")).toBe(c);
  });
});
