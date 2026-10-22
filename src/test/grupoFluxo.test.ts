// Fluxo de Grupo (padrão SendFlow, 19/10/2026): criação automática, evento relativo, enquete, fechar/abrir,
// nota de voz, mencionar todos, boas-vindas, entradas/saídas e as rotas novas do proxy da VPS.
import { describe, it, expect } from "vitest";
import {
  intervaloEfetivo, vagas, precisaNovoGrupo, nomeNovoGrupo, telefoneAdmin, textoBoasVindas, interpretarEventoGrupo,
  rotuloRelativo, offsetDe, erroCriacaoGrupo, MSG_CRIAR_GRUPO_NAO_SUPORTADO, pedidoProxyGrupo, problemasMensagem, planejarEnvios, ETAPAS_CRIACAO,
  type GrupoDaCampanha,
} from "../../supabase/functions/_shared/grupos";
import {
  montarPedidoGrupo, montarPedidoAdminGrupo, idsParticipantes, grupoCriadoDe, LimitadorPorSessao, separarSessao,
  ROTAS, ROTAS_COM_SESSAO, ROTAS_ADMIN_GRUPO, LIMITE_CRIACAO_GRUPO, montarPedidoOpenwa,
} from "../../infra/wa-proxy/lib.mjs";

const G = (id: string, ordem: number, extra: Partial<GrupoDaCampanha> = {}): GrupoDaCampanha => ({
  id, ordem, link_convite: `https://chat.whatsapp.com/ABCDEFGHIJKLMNOP${ordem}`,
  chat_id: `12036300000000000${ordem}@g.us`, ativo: true, cheio: false,
  cliques: 0, cliques_na_contagem: 0, participantes: null, ...extra,
});
const chat = "120363000000000001@g.us";
const sid = "sessao-uuid";
const lista = new Set([chat]);

describe("criação automática de grupos", () => {
  it("vagas somam só ativos e não cheios, com a ocupação (participantes + cliques depois da contagem)", () => {
    const gs = [G("a", 1, { participantes: 900, cliques: 10, cliques_na_contagem: 0 }), G("b", 2, { ativo: false }), G("c", 3, { cheio: true }), G("d", 4, { participantes: 100 })];
    expect(vagas(gs, 950)).toBe(40 + 850);
  });

  it("cria quando as vagas ficam abaixo da folga, e nunca passa do teto de grupos", () => {
    const regra = { limite_por_grupo: 100, folga_vagas: 30, max_grupos: 3 };
    expect(precisaNovoGrupo([], regra)).toBe(true); // campanha sem grupo: cria o primeiro
    expect(precisaNovoGrupo([G("a", 1, { participantes: 60 })], regra)).toBe(false); // 40 vagas
    expect(precisaNovoGrupo([G("a", 1, { participantes: 75 })], regra)).toBe(true); // 25 vagas
    expect(precisaNovoGrupo([G("a", 1, { participantes: 100 }), G("b", 2, { participantes: 100 }), G("c", 3, { participantes: 100 })], regra)).toBe(false);
  });

  it("nome sequencial com 2 dígitos, cortado em 100", () => {
    expect(nomeNovoGrupo("  Desafio   21D ", 3)).toBe("Desafio 21D 03");
    expect(nomeNovoGrupo("x".repeat(120), 12).length).toBe(100);
  });

  it("telefone de admin: BR sem DDI ganha 55; lixo é recusado", () => {
    expect(telefoneAdmin("(11) 99999-8888")).toBe("5511999998888");
    expect(telefoneAdmin("+55 21 98888-7777")).toBe("5521988887777");
    expect(telefoneAdmin("123")).toBeNull();
  });

  it("etapas em ordem: criar antes de convite, convite antes de pronto", () => {
    expect(ETAPAS_CRIACAO[0]).toBe("criar");
    expect(ETAPAS_CRIACAO.indexOf("convite")).toBeLessThan(ETAPAS_CRIACAO.indexOf("pronto"));
  });
});

describe("ritmo anti-ban", () => {
  it("teto por minuto vira piso do intervalo", () => {
    expect(intervaloEfetivo(20, 60, 3)).toEqual({ min: 20, max: 60 });
    expect(intervaloEfetivo(10, 15, 2)).toEqual({ min: 30, max: 30 });
    expect(intervaloEfetivo(10, 600, 99)).toEqual({ min: 10, max: 600 }); // teto acima de 6 vira 6 (10 s)
  });
  it("o plano respeita o intervalo efetivo", () => {
    const r = intervaloEfetivo(10, 10, 1);
    const plano = planejarEnvios([G("a", 1), G("b", 2)], new Date("2026-10-20T10:00:00Z"), r.min, r.max);
    expect(Date.parse(plano[1].proximo_em) - Date.parse(plano[0].proximo_em)).toBe(60_000);
  });
});

describe("mensagens novas", () => {
  const futuro = new Date(Date.now() + 3600_000).toISOString();
  it("enquete: pergunta + 2 a 12 opções sem repetir", () => {
    expect(problemasMensagem({ tipo: "enquete", texto: "Qual?", midia_path: null, enquete_opcoes: ["a", "b"], agendado_para: futuro })).toEqual([]);
    expect(problemasMensagem({ tipo: "enquete", texto: "Qual?", midia_path: null, enquete_opcoes: ["a"] })).toContain("Enquete precisa de 2 a 12 opções.");
    expect(problemasMensagem({ tipo: "enquete", texto: "Qual?", midia_path: null, enquete_opcoes: ["a", "a"] })).toContain("Opções repetidas.");
  });
  it("fechar/abrir não leva conteúdo; ptt só em áudio; mencionar não vale em enquete", () => {
    expect(problemasMensagem({ tipo: "travar", texto: null, midia_path: null })).toEqual([]);
    expect(problemasMensagem({ tipo: "travar", texto: "oi", midia_path: null }).length).toBe(1);
    expect(problemasMensagem({ tipo: "texto", texto: "oi", midia_path: null, ptt: true })).toContain("Nota de voz só vale para áudio.");
    expect(problemasMensagem({ tipo: "enquete", texto: "Q", midia_path: null, enquete_opcoes: ["a", "b"], mencionar_todos: true }))
      .toContain("Mencionar todos não vale para este tipo.");
  });
  it("pedido ao proxy: enquete, fechar/abrir, nota de voz e mencionar todos", () => {
    expect(pedidoProxyGrupo({ tipo: "enquete", texto: "Qual?", midia_path: null, enquete_opcoes: [" a ", "b", ""], enquete_multipla: true }, chat, null, "s1"))
      .toEqual({ rota: "send-group-poll", corpo: { chatId: chat, name: "Qual?", options: ["a", "b"], multiple: true, sessao: "s1" } });
    expect(pedidoProxyGrupo({ tipo: "travar", texto: null, midia_path: null }, chat, null, null))
      .toEqual({ rota: "group-settings", corpo: { chatId: chat, announce: true } });
    expect(pedidoProxyGrupo({ tipo: "destravar", texto: null, midia_path: null }, chat, null, null))
      .toEqual({ rota: "group-settings", corpo: { chatId: chat, announce: false } });
    const audio = pedidoProxyGrupo({ tipo: "audio", texto: null, midia_path: "x/a.ogg", ptt: true, mencionar_todos: true }, chat, "https://s/a.ogg", null);
    expect(audio).toEqual({ rota: "send-group-media", corpo: { chatId: chat, kind: "audio", url: "https://s/a.ogg", ptt: true, mentionAll: true } });
    const texto = pedidoProxyGrupo({ tipo: "texto", texto: "Começou!", midia_path: null, mencionar_todos: true }, chat, null, null);
    expect(texto).toEqual({ rota: "send-group-text", corpo: { chatId: chat, text: "Começou!", mentionAll: true } });
  });
});

describe("evento relativo (D-3, D-1, ao vivo)", () => {
  it("offset em minutos e rótulo", () => {
    expect(offsetDe(1, 0, 0, true)).toBe(-1440);
    expect(offsetDe(0, 2, 30, false)).toBe(150);
    expect(offsetDe(99, 0, 0, true)).toBe(-43200);
    expect(rotuloRelativo(-1440)).toBe("1d antes do evento");
    expect(rotuloRelativo(0)).toBe("na hora do evento");
    expect(rotuloRelativo(90)).toBe("1h 30min depois do evento");
  });
});

describe("entradas, saídas e boas-vindas", () => {
  it("lê group.join/group.leave do OpenWA e ignora o resto", () => {
    const ev = interpretarEventoGrupo({ event: "group.join", data: { groupId: chat, participantIds: ["5511999998888@c.us", "123456789@lid", "lixo"], timestamp: 1760000000 } });
    expect(ev).toMatchObject({ chatId: chat, tipo: "entrada", participantes: ["5511999998888@c.us", "123456789@lid"] });
    expect(ev?.chave).toContain("group.join");
    expect(interpretarEventoGrupo({ event: "group.leave", data: { groupId: chat, participantIds: [] } })?.tipo).toBe("saida");
    expect(interpretarEventoGrupo({ event: "message.received", data: {} })).toBeNull();
    expect(interpretarEventoGrupo({ event: "group.join", data: { groupId: "5511@c.us" } })).toBeNull();
  });
  it("boas-vindas: {mencoes} vira @número e os ids vão em mentions; sem mencionar não leva id", () => {
    const r = textoBoasVindas("Bem-vinda {mencoes}!", ["5511999998888@c.us", "5511999998888@c.us", "x"], true);
    expect(r).toEqual({ text: "Bem-vinda @5511999998888!", mentions: ["5511999998888@c.us"] });
    expect(textoBoasVindas("Oi", ["5511999998888@c.us"], true).text).toBe("Oi\n\n@5511999998888");
    expect(textoBoasVindas("Oi {mencoes}", ["5511999998888@c.us"], false)).toEqual({ text: "Oi", mentions: [] });
  });
});

describe("proxy: rotas do Fluxo de Grupo", () => {
  it("rotas de admin aceitam sessão e não existem na lista de telefone", () => {
    for (const r of ROTAS_ADMIN_GRUPO) {
      expect(ROTAS).not.toContain(r);
      expect(ROTAS_COM_SESSAO.has(r)).toBe(true);
    }
    expect(separarSessao("group-create", { name: "x", participants: ["5511999998888"], sessao: "grupos" }, new Set(["grupos"])).sessao).toBe("grupos");
    expect(montarPedidoOpenwa("group-create", { name: "x" }, sid).erro).toBeTruthy();
  });

  it("group-create: nome 1-100 e 1-10 telefones viram @c.us; sem allowlist", () => {
    expect(montarPedidoAdminGrupo("group-create", { name: " Turma 01 ", participants: ["5511999998888", "5511999998888"] }, sid, new Set()))
      .toEqual({ metodo: "POST", caminho: `/sessions/${sid}/groups`, corpo: { name: "Turma 01", participants: ["5511999998888@c.us"] }, criarGrupo: true });
    expect(montarPedidoAdminGrupo("group-create", { name: "x", participants: [] }, sid, new Set()).erro).toBeTruthy();
    expect(montarPedidoAdminGrupo("group-create", { name: "x", participants: ["120363@g.us"] }, sid, new Set()).erro).toBeTruthy();
    expect(montarPedidoAdminGrupo("group-create", { name: "x", participants: ["5511999998888"], extra: 1 }, sid, new Set()).erro).toBe("campos");
  });

  it("escritas de admin só em grupo da allowlist", () => {
    expect(montarPedidoAdminGrupo("group-settings", { chatId: chat, announce: true, locked: true }, sid, lista))
      .toEqual({ metodo: "PUT", caminho: `/sessions/${sid}/groups/${encodeURIComponent(chat)}/settings`, corpo: { announce: true, locked: true } });
    expect(montarPedidoAdminGrupo("group-settings", { chatId: chat }, sid, lista).erro).toBeTruthy();
    expect(montarPedidoAdminGrupo("group-settings", { chatId: chat, announce: "sim" }, sid, lista).erro).toBe("announce");
    expect(montarPedidoAdminGrupo("group-description", { chatId: chat, description: "" }, sid, lista).corpo).toEqual({ description: "" });
    expect(montarPedidoAdminGrupo("group-picture", { chatId: chat, url: "http://inseguro" }, sid, lista).erro).toBe("url");
    expect(montarPedidoAdminGrupo("group-promote", { chatId: chat, participants: ["5511999998888"] }, sid, lista).caminho).toMatch(/participants\/promote$/);
    const fora = montarPedidoAdminGrupo("group-settings", { chatId: "120363000000000009@g.us", announce: true }, sid, lista);
    expect(fora).toEqual({ erro: "grupo fora da allowlist", status: 403 });
  });

  it("enquete, menções e nota de voz no disparo", () => {
    expect(montarPedidoGrupo("send-group-poll", { chatId: chat, name: "Q", options: ["a", "b"], multiple: false }, sid, lista).corpo)
      .toEqual({ chatId: chat, name: "Q", options: ["a", "b"], allowMultipleAnswers: false });
    expect(montarPedidoGrupo("send-group-poll", { chatId: chat, name: "Q", options: ["a"] }, sid, lista).erro).toBeTruthy();
    expect(montarPedidoGrupo("send-group-poll", { chatId: chat, name: "Q", options: ["a", "a"] }, sid, lista).erro).toBe("options");
    const todos = montarPedidoGrupo("send-group-text", { chatId: chat, text: "oi", mentionAll: true }, sid, lista);
    expect(todos.mencionarTodos).toBe(chat);
    expect(todos.corpo.mentions).toBeUndefined();
    const alguns = montarPedidoGrupo("send-group-text", { chatId: chat, text: "oi @5511999998888", mentions: ["5511999998888@c.us"] }, sid, lista);
    expect(alguns.corpo.mentions).toEqual(["5511999998888@c.us"]);
    expect(montarPedidoGrupo("send-group-text", { chatId: chat, text: "oi", mentions: [chat] }, sid, lista).erro).toBe("mentions");
    expect(montarPedidoGrupo("send-group-text", { chatId: chat, text: "oi", mentions: ["5511999998888@c.us"], mentionAll: true }, sid, lista).erro).toBeTruthy();
    const voz = montarPedidoGrupo("send-group-media", { chatId: chat, kind: "audio", url: "https://x/a.ogg", ptt: true }, sid, lista);
    expect(voz.corpo).toEqual({ chatId: chat, url: "https://x/a.ogg", ptt: true, mimetype: "audio/ogg; codecs=opus" });
    expect(voz.voz).toBe(true);
    expect(montarPedidoGrupo("send-group-media", { chatId: chat, kind: "image", url: "https://x/a.jpg", ptt: true }, sid, lista).erro).toBe("ptt");
  });

  it("participantes para mencionar e grupo criado", () => {
    expect(idsParticipantes({ participants: [{ id: "5511999998888@c.us" }, { id: "1234567@lid" }, { id: chat }, "5521988887777@c.us"] }))
      .toEqual(["5511999998888@c.us", "1234567@lid", "5521988887777@c.us"]);
    expect(idsParticipantes(null)).toEqual([]);
    expect(grupoCriadoDe({ id: chat, name: "Turma 01" })).toEqual({ chatId: chat, name: "Turma 01" });
    expect(grupoCriadoDe({ id: "5511@c.us" })).toBeNull();
  });

  it("criação: 1 a cada 2 min e 10 por dia, por sessão", () => {
    const l = new LimitadorPorSessao(LIMITE_CRIACAO_GRUPO, {}, "criação de grupo");
    const t0 = Date.parse("2026-10-20T13:00:00Z");
    expect(l.reservar("s", t0).ok).toBe(true);
    expect(l.reservar("s", t0 + 60_000).ok).toBe(false);
    expect(l.reservar("outra", t0 + 60_000).ok).toBe(true);
    let ok = 1;
    for (let i = 1; i < 20; i++) if (l.reservar("s", t0 + i * 121_000).ok) ok++;
    expect(ok).toBe(10);
  });
});

describe("erro legível do group-create", () => {
  it("501 (direto ou dentro do corpo do 502 do proxy) vira a mensagem de não suportado", () => {
    expect(erroCriacaoGrupo(501, { error: "openwa", status: 501 })).toBe(MSG_CRIAR_GRUPO_NAO_SUPORTADO);
    expect(erroCriacaoGrupo(502, { error: "openwa", status: 501, message: "Not supported" })).toBe(MSG_CRIAR_GRUPO_NAO_SUPORTADO);
    expect(erroCriacaoGrupo(502, { error: "openwa", message: "não suportado neste motor" })).toBe(MSG_CRIAR_GRUPO_NAO_SUPORTADO);
  });
  it("outros casos trazem status e mensagem truncada em 200", () => {
    expect(erroCriacaoGrupo(502, { error: "openwa", status: 500, message: "boom" })).toBe("proxy 502 (OpenWA 500): openwa: boom");
    expect(erroCriacaoGrupo(429, { error: "limite" })).toBe("proxy 429: limite");
    expect(erroCriacaoGrupo(502, { message: "x".repeat(500) }).length).toBeLessThan(240);
  });
});
