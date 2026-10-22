// Backfill/mídia/nomes do WhatsApp (OpenWA): rotas novas do proxy (chats-page, contacts-info,
// history deep/includeMedia) e a lógica pura de _shared/waBackfill.ts.
import { describe, it, expect } from "vitest";
import {
  montarPedidoOpenwa, filtrarPaginaChats, resumoContato, filtrarMidiasHistorico, ROTAS,
} from "../../infra/wa-proxy/lib.mjs";
import {
  linhasDoHistorico, midiasParaBaixar, autoresSemNome, aplicarNomes, nomesDaResposta, variantesTelefoneBR,
  diasDaJanela, tsChatParaMs, corteDaJanela, chatNaJanela, filtroForaDaJanela,
  chatIdDaMensagem, OrcamentoLeituras, textoProgresso,
} from "../../supabase/functions/_shared/waBackfill";

const sid = "uuid-closer";
const G = "120363000000000101@g.us";

describe("proxy: history fundo e com mídia", () => {
  it("deep sobe o teto pra 2000; includeMedia limita a 30 e marca comMidia", () => {
    expect(montarPedidoOpenwa("history", { chatId: G, limit: 5000, deep: true }, sid).caminho)
      .toBe(`/sessions/uuid-closer/messages/${encodeURIComponent(G)}/history?limit=2000&deep=true`);
    expect(montarPedidoOpenwa("history", { chatId: G, limit: 99, includeMedia: true }, sid))
      .toMatchObject({ caminho: `/sessions/uuid-closer/messages/${encodeURIComponent(G)}/history?limit=30&includeMedia=true`, comMidia: true });
    // sem flag continua 100
    expect(montarPedidoOpenwa("history", { chatId: G, limit: 5000 }, sid).caminho).toMatch(/limit=100$/);
  });
  it("recusa flag que não é booleano e deep junto com includeMedia", () => {
    expect(montarPedidoOpenwa("history", { chatId: G, deep: "true" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("history", { chatId: G, includeMedia: 1 }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("history", { chatId: G, deep: true, includeMedia: true }, sid).erro).toBeTruthy();
    // flags novas não abrem outras rotas
    expect(montarPedidoOpenwa("media", { chatId: G, messageId: "x", deep: true }, sid).erro).toBeTruthy();
  });
  it("filtrarMidiasHistorico devolve só quem trouxe base64 e respeita o teto de bytes", () => {
    const lista = [
      { id: "a", media: { mimetype: "image/jpeg", data: "AAAA" } },
      { id: "b", media: { mimetype: "image/jpeg", omitted: true } },
      { id: "c", body: "texto" },
      { id: "d", media: { mimetype: "audio/ogg", filename: "x.ogg", data: "A".repeat(400) } },
    ];
    expect(filtrarMidiasHistorico(lista).map((m) => m.id)).toEqual(["a", "d"]);
    expect(filtrarMidiasHistorico(lista, 10).map((m) => m.id)).toEqual(["a"]);
    expect(filtrarMidiasHistorico(null)).toEqual([]);
  });
});

describe("proxy: chats-page e contacts-info", () => {
  it("chats-page pagina com limit/offset (teto 500)", () => {
    expect(montarPedidoOpenwa("chats-page", { limit: 9999, offset: 500 }, sid))
      .toEqual({ metodo: "GET", caminho: "/sessions/uuid-closer/chats?limit=500&offset=500", paginaChats: true });
    expect(montarPedidoOpenwa("chats-page", {}, sid).caminho).toBe("/sessions/uuid-closer/chats?limit=200&offset=0");
    expect(montarPedidoOpenwa("chats-page", { limit: 10, phone: "5531999998888" }, sid).erro).toBeTruthy();
  });
  it("filtrarPaginaChats separa contato e grupo e descarta canal/status/broadcast", () => {
    const r = filtrarPaginaChats([
      { id: G, name: "Pequeno Rebanho", kind: "group", timestamp: 10 },
      { id: "5531999998888@c.us", name: "Ana", kind: "individual", timestamp: 9 },
      { id: "177618489987304@lid", name: "Felipe", kind: "individual", timestamp: 8 },
      { id: "status@broadcast", kind: "status" },
      { id: "123@newsletter", kind: "channel" },
      { id: "999@broadcast", kind: "broadcast" },
    ]);
    expect(r.brutos).toBe(6);
    expect(r.itens).toEqual([
      { chatId: G, kind: "group", phone: null, name: "Pequeno Rebanho", timestamp: 10 },
      { chatId: "5531999998888@c.us", kind: "individual", phone: "5531999998888", name: "Ana", timestamp: 9 },
      { chatId: "177618489987304@lid", kind: "individual", phone: null, name: "Felipe", timestamp: 8 },
    ]);
  });
  it("contacts-info aceita até 50 WIDs de contato (sem grupo) e tira repetidos", () => {
    const ids = ["177618489987304@lid", "5531999998888@c.us", "177618489987304@lid"];
    expect(montarPedidoOpenwa("contacts-info", { ids }, sid))
      .toMatchObject({ contatos: ["177618489987304@lid", "5531999998888@c.us"] });
    expect(montarPedidoOpenwa("contacts-info", { ids: [G] }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("contacts-info", { ids: [] }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("contacts-info", { ids: Array.from({ length: 51 }, (_, i) => `${10000 + i}@lid`) }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("contacts-info", { ids: ["../x@lid"] }, sid).erro).toBeTruthy();
    expect(ROTAS).toContain("contacts-info");
    expect(ROTAS).toContain("chats-page");
  });
  it("resumoContato: nome salvo, pushName e telefone (do /phone, do id ou do number)", () => {
    expect(resumoContato("1@lid", { pushName: " Ju ", number: "5531988887777" }, null))
      .toEqual({ id: "1@lid", name: null, pushName: "Ju", phone: "5531988887777" });
    expect(resumoContato("5531999998888@c.us", { name: "Ana" }, null).phone).toBe("5531999998888");
    expect(resumoContato("1@lid", null, "5531977776666").phone).toBe("5531977776666");
    expect(resumoContato("1@lid", { number: "abc" }, null).phone).toBeNull();
  });
});

describe("waBackfill: linhas do histórico", () => {
  const agora = "2026-10-17T21:00:00.000Z";
  const hist = [
    { id: "false_120363000000000101@g.us_A_1@lid", chatId: G, from: G, author: "177618489987304@lid", isLidSender: true,
      type: "text", body: "oi", timestamp: 1792266000, fromMe: false, isGroup: true },
    { id: "false_120363000000000101@g.us_B_2@lid", chatId: G, author: "250242779857016@lid", contact: { pushName: "Matheus" },
      type: "image", body: "", timestamp: 1792266100, fromMe: false, isGroup: true },
    { id: "true_120363000000000101@g.us_C", chatId: G, type: "voice", body: "", timestamp: 1792266200, fromMe: true, isGroup: true },
    { id: "false_120363000000000101@g.us_D_1@lid", chatId: G, author: "177618489987304@lid", type: "revoked", timestamp: 1792266300, isGroup: true },
    { id: "false_120363000000000101@g.us_A_1@lid", chatId: G, author: "177618489987304@lid", type: "text", body: "oi", timestamp: 1792266000, isGroup: true },
  ];
  it("grupo: autor, mídia como rótulo, apagada e repetida fora", () => {
    const l = linhasDoHistorico(hist, G, agora);
    expect(l.map((x) => x.message_id)).toEqual([
      "false_120363000000000101@g.us_A_1@lid", "false_120363000000000101@g.us_B_2@lid", "true_120363000000000101@g.us_C",
    ]);
    expect(l[0]).toMatchObject({ direction: "inbound", author_id: "177618489987304@lid", author_name: null, body: "oi" });
    expect(l[1]).toMatchObject({ media_type: "image", body: "[foto]", author_name: "Matheus" });
    expect(l[2]).toMatchObject({ direction: "outbound", sender_type: "human", media_type: "audio", author_id: null });
    expect(l[0].created_at).toBe(new Date(1792266000 * 1000).toISOString());
  });
  it("individual @lid grava no telefone resolvido e ignora mensagem de grupo", () => {
    const l = linhasDoHistorico([
      { id: "false_177618489987304@lid_X", chatId: "177618489987304@lid", type: "text", body: "bom dia", timestamp: 1, fromMe: false },
      { id: "false_120363@g.us_Y", chatId: G, isGroup: true, type: "text", body: "x", timestamp: 2 },
    ], "5531999998888", agora);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ contact_phone: "5531999998888", author_id: null, body: "bom dia" });
  });
  it("midiasParaBaixar pega as N mais recentes, figurinha inclusive", () => {
    const base = { contact_phone: G, direction: "inbound", sender_type: "lead", body: "", mime_type: null, file_name: null,
      caption: null, author_name: null, author_phone: null, author_id: null, media_status: null } as const;
    const l = [
      { ...base, message_id: "1", media_type: "image", created_at: "2026-10-01T00:00:00Z" },
      { ...base, message_id: "2", media_type: "sticker", created_at: "2026-10-03T00:00:00Z" },
      { ...base, message_id: "3", media_type: "audio", created_at: "2026-10-02T00:00:00Z" },
      { ...base, message_id: "4", media_type: null, created_at: "2026-10-04T00:00:00Z" },
    ];
    expect(midiasParaBaixar(l, 1)).toEqual(["2"]);
    expect(midiasParaBaixar(l, 5)).toEqual(["2", "3", "1"]);
    expect(midiasParaBaixar(l, 0)).toEqual([]);
  });
  it("autoresSemNome + nomesDaResposta + aplicarNomes", () => {
    const l = linhasDoHistorico(hist, G, agora);
    expect(autoresSemNome(l)).toEqual(["177618489987304@lid"]);
    const nomes = nomesDaResposta([
      { id: "177618489987304@lid", name: "Felipe Neves", pushName: "Fe", phone: "5531988887777" },
      { id: "grupo@g.us", name: "x" },
      { id: "250242779857016@lid", pushName: "Mat", phone: "12" },
    ]);
    expect(nomes).toEqual([
      { wid: "177618489987304@lid", nome: "Felipe Neves", telefone: "5531988887777" },
      { wid: "250242779857016@lid", nome: "Mat", telefone: null },
    ]);
    aplicarNomes(l, new Map(nomes.map((n) => [n.wid, { nome: n.nome, telefone: n.telefone }])));
    expect(l[0]).toMatchObject({ author_name: "Felipe Neves", author_phone: "5531988887777" });
    expect(l[1].author_name).toBe("Matheus"); // pushName do evento não é sobrescrito
  });
});

describe("waBackfill: chaves e utilidades", () => {
  it("variantesTelefoneBR: celular com/sem 9; fixo e estrangeiro sem variante", () => {
    expect(variantesTelefoneBR("5531999998888")).toEqual(["5531999998888", "553199998888"]);
    expect(variantesTelefoneBR("553199998888")).toEqual(["553199998888", "5531999998888"]);
    expect(variantesTelefoneBR("553132221111")).toEqual(["553132221111"]); // fixo (começa com 3)
    expect(variantesTelefoneBR("14155550100")).toEqual(["14155550100"]);
    expect(variantesTelefoneBR(G)).toEqual([G]);
  });
  it("chatIdDaMensagem lê o chat do id serializado", () => {
    expect(chatIdDaMensagem("false_5531999998888@c.us_3EB0ABC")).toBe("5531999998888@c.us");
    expect(chatIdDaMensagem("true_120363000000000101@g.us_3EB0_177618489987304@lid")).toBe(G);
    expect(chatIdDaMensagem("false_177618489987304@lid_ABC")).toBe("177618489987304@lid");
    expect(chatIdDaMensagem("false_status@broadcast_X")).toBeNull();
    expect(chatIdDaMensagem("lixo")).toBeNull();
    expect(chatIdDaMensagem(null)).toBeNull();
  });
  it("OrcamentoLeituras: teto por minuto em janela deslizante", () => {
    let t = 0;
    const o = new OrcamentoLeituras(2, () => t);
    expect(o.reservar()).toBe(0);
    expect(o.reservar()).toBe(0);
    expect(o.reservar()).toBeGreaterThan(59_000);
    t = 60_001;
    expect(o.reservar()).toBe(0);
  });
  it("textoProgresso", () => {
    expect(textoProgresso({ status: "importando", total_chats: 600, chats_feitos: 120 })).toBe("importando 120/600 conversas");
    expect(textoProgresso({ status: "listando", total_chats: 0, chats_feitos: 0 })).toMatch(/listando/);
  });
});

describe("janela do backfill (backfill_dias)", () => {
  const AGORA_MS = Date.UTC(2026, 9, 17, 22, 0, 0);
  it("dias: padrão 90, inteiro, 0 = sem limite, lixo = padrão", () => {
    expect(diasDaJanela(null)).toBe(90);
    expect(diasDaJanela("")).toBe(90);
    expect(diasDaJanela("30")).toBe(30);
    expect(diasDaJanela(" 45.7 ")).toBe(45);
    expect(diasDaJanela("0")).toBe(0);
    expect(diasDaJanela("-3")).toBe(90);
    expect(diasDaJanela("abc")).toBe(90);
  });
  it("timestamp de chat em segundos ou ms; corte e filtro", () => {
    const seg = Math.floor(AGORA_MS / 1000);
    expect(tsChatParaMs(seg)).toBe(seg * 1000);
    expect(tsChatParaMs(AGORA_MS)).toBe(AGORA_MS);
    expect(tsChatParaMs(null)).toBeNull();
    expect(tsChatParaMs(0)).toBeNull();
    const corte = corteDaJanela(90, AGORA_MS)!;
    expect(corte).toBe(AGORA_MS - 90 * 86_400_000);
    expect(corteDaJanela(0, AGORA_MS)).toBeNull();
    expect(chatNaJanela(seg - 10 * 86400, corte)).toBe(true);
    expect(chatNaJanela(seg - 120 * 86400, corte)).toBe(false);
    expect(chatNaJanela((seg - 120 * 86400) * 1000, corte)).toBe(false);
    expect(chatNaJanela(null, corte)).toBe(true); // sem horário entra (fim da fila)
    expect(chatNaJanela(seg - 999 * 86400, null)).toBe(true);
    expect(filtroForaDaJanela(corte)).toBe(`ts.lt.${Math.floor(corte / 1000)},and(ts.gte.100000000000,ts.lt.${corte})`);
  });
});
