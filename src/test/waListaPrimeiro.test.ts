// Lista primeiro (18/10/2026): rota chats-recentes do proxy e a conversão da resposta no que o CRM grava.
import { describe, it, expect } from "vitest";
import { montarPedidoOpenwa, filtrarChatsRecentes, mensagemLeve, ROTAS } from "../../infra/wa-proxy/lib.mjs";
import { conversasDosRecentes, contatoNovoDaConversa } from "../../supabase/functions/_shared/waRecentes";

const G = "120363000000000101@g.us";
const NUM = "11111111-2222-3333-4444-555555555555";

describe("proxy: chats-recentes", () => {
  it("rota existe, só aceita limit/porChat e tem teto", () => {
    expect(ROTAS).toContain("chats-recentes");
    expect(montarPedidoOpenwa("chats-recentes", { limit: 80, porChat: 20 }, "s1")).toEqual({
      metodo: "GET", caminho: "/sessions/s1/chats?limit=160", chatsRecentes: { limit: 80, porChat: 20 },
    });
    expect(montarPedidoOpenwa("chats-recentes", { limit: 5000, porChat: 500 }, "s1").chatsRecentes).toEqual({ limit: 100, porChat: 30 });
    expect(montarPedidoOpenwa("chats-recentes", {}, "s1").chatsRecentes).toEqual({ limit: 60, porChat: 1 });
    expect(montarPedidoOpenwa("chats-recentes", { limit: 10, chatId: "x" }, "s1")).toEqual({ erro: "campos" });
  });
  it("filtrarChatsRecentes: mais recente primeiro, sem canal/broadcast, até o limite", () => {
    const r = filtrarChatsRecentes([
      { id: "5531999990001@c.us", name: "Ana", kind: "individual", timestamp: 100 },
      { id: "status@broadcast", name: "s", timestamp: 999 },
      { id: "123@newsletter", name: "canal", timestamp: 998 },
      { id: G, name: "Grupo", kind: "group", timestamp: 300 },
      { id: "177618489987304@lid", name: "Lid", kind: "individual", timestamp: 200 },
    ], 2);
    expect(r.map((c: { chatId: string }) => c.chatId)).toEqual([G, "177618489987304@lid"]);
  });
  it("mensagemLeve tira base64 e campos extras", () => {
    const m = mensagemLeve({ id: "x", body: "oi", type: "image", timestamp: 1, fromMe: false, media: { data: "AAAA", mimetype: "image/jpeg" }, _data: { segredo: 1 } });
    expect(m).toEqual({ id: "x", body: "oi", type: "image", timestamp: 1, fromMe: false, media: { mimetype: "image/jpeg", filename: null, omitted: true } });
  });
});

describe("waRecentes: resposta -> conversas", () => {
  const resp = {
    parcial: false,
    itens: [
      { chatId: "5531999990001@c.us", kind: "individual", phone: "5531999990001", name: "Kelly de Souza", timestamp: 1792360200,
        mensagens: [
          { id: "false_5531999990001@c.us_A", type: "text", body: "Oi, quero o plano", timestamp: 1792360100, fromMe: false },
          { id: "true_5531999990001@c.us_B", type: "text", body: "Claro!", timestamp: 1792360200, fromMe: true },
          { id: "false_5531999990001@c.us_E2E", type: "unknown", body: "", timestamp: 1792369999, fromMe: false },
        ] },
      // só aviso de sistema: fica de fora (contato sem mensagem não nasce)
      { chatId: "5531999990002@c.us", kind: "individual", phone: "5531999990002", name: "Só aviso", timestamp: 1792369999,
        mensagens: [{ id: "false_5531999990002@c.us_E2E", type: "unknown", body: "", timestamp: 1792369999 }] },
      // @lid sem telefone: fora
      { chatId: "177618489987304@lid", kind: "individual", phone: null, name: "Lid", timestamp: 1792360000,
        mensagens: [{ id: "false_177618489987304@lid_X", type: "text", body: "x", timestamp: 1792360000 }] },
      { chatId: G, kind: "group", phone: null, name: "Pequeno Rebanho", timestamp: 1792360300,
        mensagens: [{ id: `false_${G}_C_1@lid`, chatId: G, author: "1@lid", type: "sticker", body: "", timestamp: 1792360300, isGroup: true }] },
    ],
  };
  it("só conversa com mensagem real, horário real, ordem pela última mensagem", () => {
    const c = conversasDosRecentes(resp, NUM);
    expect(c.map((x) => x.phone)).toEqual([G, "5531999990001"]);
    const kelly = c[1];
    expect(kelly.linhas.map((l) => l.body)).toEqual(["Oi, quero o plano", "Claro!"]);
    expect(kelly.linhas.every((l) => l.numero_id === NUM)).toBe(true);
    expect(kelly.ultimaEm).toBe(new Date(1792360200 * 1000).toISOString());
    expect(c[0].linhas[0]).toMatchObject({ body: "[figurinha]", media_type: "sticker", media_status: null });
    expect(JSON.stringify(c)).not.toContain("[mensagem]");
  });
  it("contato novo nasce com a data da última mensagem, nunca agora", () => {
    const [grupo, kelly] = conversasDosRecentes(resp, NUM);
    expect(contatoNovoDaConversa(kelly, NUM)).toEqual({
      numero_id: NUM, phone: "5531999990001", name: "Kelly de Souza", source: "whatsapp-importacao",
      updated_at: kelly.ultimaEm, created_at: kelly.ultimaEm,
    });
    expect(contatoNovoDaConversa(grupo, null)).toMatchObject({ phone: G, is_group: true, source: "whatsapp-grupo" });
  });
  it("mesmo telefone em c.us e @lid vira uma conversa só", () => {
    const c = conversasDosRecentes({ itens: [
      { chatId: "5531999990001@c.us", kind: "individual", phone: "5531999990001", name: "K", mensagens: [{ id: "a", type: "text", body: "1", timestamp: 10 }] },
      { chatId: "999@lid", kind: "individual", phone: "5531999990001", name: "K", mensagens: [{ id: "b", type: "text", body: "2", timestamp: 20 }, { id: "a", type: "text", body: "1", timestamp: 10 }] },
    ] }, null);
    expect(c).toHaveLength(1);
    expect(c[0].linhas.map((l) => l.message_id).sort()).toEqual(["a", "b"]);
    expect(c[0].ultimaEm).toBe(new Date(20_000).toISOString());
  });
  it("resposta inválida não quebra", () => {
    expect(conversasDosRecentes(null, null)).toEqual([]);
    expect(conversasDosRecentes({ itens: "x" }, null)).toEqual([]);
  });
});
