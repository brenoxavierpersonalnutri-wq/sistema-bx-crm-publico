// Módulo Grupos (substitui o SendFlow): distribuição entre grupos, limite, agenda/intervalo,
// corpo do proxy e as rotas novas do proxy da VPS (envio a grupo com allowlist e limite próprio).
import { describe, it, expect } from "vitest";
import {
  escolherGrupo, simularCliques, ocupacao, planejarEnvios, intervaloAleatorioS, problemasMensagem,
  pedidoProxyGrupo, slugDe, slugValido, linkConviteValido, resumoEnvios, utmDaUrl,
  type GrupoDaCampanha,
} from "../../supabase/functions/_shared/grupos";
import {
  montarPedidoGrupo, montarPedidoOpenwa, LimitadorGrupo, separarSessao, sessoesPermitidas, validarAllowlist, credencialDaSessao, sufixoEnvSessao,
  linkConviteDe, ROTAS, ROTAS_GRUPO, LIMITE_GRUPO_MINUTO, LIMITE_GRUPO_DIA, INTERVALO_MIN_GRUPO_MS,
} from "../../infra/wa-proxy/lib.mjs";
import { telefoneDaUrl } from "@/lib/grupoLink";

const G = (id: string, ordem: number, extra: Partial<GrupoDaCampanha> = {}): GrupoDaCampanha => ({
  id, ordem, link_convite: `https://chat.whatsapp.com/ABCDEFGHIJKLMNOP${ordem}`,
  chat_id: `12036300000000000${ordem}@g.us`, ativo: true, cheio: false,
  cliques: 0, cliques_na_contagem: 0, participantes: null, ...extra,
});

describe("distribuição do link entre grupos", () => {
  it("enche o primeiro até o limite e passa pro próximo, na ordem", () => {
    const r = simularCliques([G("b", 2), G("a", 1), G("c", 3)], 3, 10);
    expect(r).toEqual(["a", "a", "a", "b", "b", "b", "c", "c", "c", null]);
  });

  it("pula inativo e marcado cheio; null quando todos lotados", () => {
    const grupos = [G("a", 1, { ativo: false }), G("b", 2, { cheio: true }), G("c", 3)];
    expect(escolherGrupo(grupos, 900)?.id).toBe("c");
    expect(escolherGrupo([G("a", 1, { cliques: 5 })], 5)).toBeNull();
  });

  it("ocupação = participantes da contagem + cliques depois dela (sem contagem: cliques)", () => {
    expect(ocupacao({ participantes: null, cliques: 7, cliques_na_contagem: 0 })).toBe(7);
    expect(ocupacao({ participantes: 850, cliques: 900, cliques_na_contagem: 880 })).toBe(870);
    expect(ocupacao({ participantes: 10, cliques: 3, cliques_na_contagem: 5 })).toBe(10); // nunca negativo
    // grupo com 899 pessoas reais (contadas) e limite 900: cabe 1 clique, depois passa pro próximo
    const r = simularCliques([G("a", 1, { participantes: 899, cliques: 40, cliques_na_contagem: 40 }), G("b", 2)], 900, 3);
    expect(r).toEqual(["a", "b", "b"]);
  });

  it("limite fora da faixa vira 1..1024 (teto do WhatsApp)", () => {
    expect(escolherGrupo([G("a", 1, { participantes: 1024 })], 5000)).toBeNull();
    expect(escolherGrupo([G("a", 1)], 0)?.id).toBe("a");
  });

  it("empate de ordem desempata por created_at e id (estável)", () => {
    const r = escolherGrupo([G("z", 0, { created_at: "2026-10-02" }), G("y", 0, { created_at: "2026-10-01" })], 10);
    expect(r?.id).toBe("y");
  });
});

describe("agenda: intervalo aleatório entre grupos", () => {
  it("primeiro grupo no horário, cada seguinte +[min,max] s, só grupos ativos com id, na ordem", () => {
    const inicio = new Date("2026-10-20T22:00:00.000Z");
    const seq = [0, 0.5, 0.999];
    let i = 0;
    const plano = planejarEnvios(
      [G("c", 3), G("a", 1), G("semid", 2, { chat_id: null }), G("off", 4, { ativo: false }), G("d", 5)],
      inicio, 20, 60, () => seq[i++ % seq.length],
    );
    expect(plano.map((p) => p.grupo_id)).toEqual(["a", "c", "d"]);
    expect(plano.map((p) => p.proximo_em)).toEqual([
      "2026-10-20T22:00:00.000Z",
      "2026-10-20T22:00:20.000Z", // rand 0 -> 20 s
      "2026-10-20T22:01:00.000Z", // rand 0.5 -> 40 s
    ]);
    expect(plano.map((p) => p.ordem)).toEqual([0, 1, 2]);
  });

  it("intervalo sempre dentro de [min, max] (1000 sorteios) e grupo repetido recebe uma vez só", () => {
    for (let k = 0; k < 1000; k++) {
      const s = intervaloAleatorioS(20, 60);
      expect(s).toBeGreaterThanOrEqual(20);
      expect(s).toBeLessThanOrEqual(60);
    }
    expect(intervaloAleatorioS(60, 20, () => 0)).toBe(20); // invertido não quebra
    const dup = planejarEnvios([G("a", 1), G("b", 2, { chat_id: "120363000000000001@g.us" })], new Date(0), 20, 60);
    expect(dup).toHaveLength(1);
  });

  it("valida a mensagem antes de agendar", () => {
    const agora = new Date("2026-10-20T12:00:00Z");
    expect(problemasMensagem({ tipo: "texto", texto: "oi", midia_path: null, agendado_para: "2026-10-20T13:00:00Z" }, agora)).toEqual([]);
    expect(problemasMensagem({ tipo: "texto", texto: "  ", midia_path: null }, agora)).toContain("Escreva o texto.");
    expect(problemasMensagem({ tipo: "imagem", texto: null, midia_path: null }, agora)).toContain("Envie o arquivo da mídia.");
    expect(problemasMensagem({ tipo: "audio", texto: "legenda", midia_path: "x/a.ogg" }, agora).join()).toMatch(/Áudio/);
    expect(problemasMensagem({ tipo: "texto", texto: "oi", midia_path: null, agendado_para: "2026-10-20T11:00:00Z" }, agora))
      .toContain("Data/hora já passou.");
    expect(problemasMensagem({ tipo: "texto", texto: "x".repeat(4097), midia_path: null }, agora).join()).toMatch(/4096/);
  });

  it("resumo dos envios por status", () => {
    expect(resumoEnvios([{ status: "enviado" }, { status: "falhou" }, { status: "pendente" }, { status: "cancelado" }, { status: "enviando" }]))
      .toEqual({ total: 5, enviados: 1, falhas: 1, pendentes: 2, cancelados: 1 });
  });
});

describe("corpo para o proxy", () => {
  const chat = "120363000000000001@g.us";
  it("texto com link liga a prévia; sem link não; sessão do número vai junto", () => {
    expect(pedidoProxyGrupo({ tipo: "texto", texto: "Live hoje https://x.com", midia_path: null }, chat, null, "grupos"))
      .toEqual({ rota: "send-group-text", corpo: { chatId: chat, text: "Live hoje https://x.com", linkPreview: true, sessao: "grupos" } });
    expect(pedidoProxyGrupo({ tipo: "texto", texto: "oi", midia_path: null }, chat, null, null))
      .toEqual({ rota: "send-group-text", corpo: { chatId: chat, text: "oi" } });
    expect(pedidoProxyGrupo({ tipo: "texto", texto: "https://x.com", midia_path: null, link_preview: false }, chat, null, null))
      .toEqual({ rota: "send-group-text", corpo: { chatId: chat, text: "https://x.com" } });
  });
  it("mídia: kind certo, legenda (menos no áudio), nome só no documento", () => {
    const url = "https://pgk.supabase.co/storage/v1/object/sign/grupos-midia/a.mp4?token=x";
    expect(pedidoProxyGrupo({ tipo: "video", texto: "aula", midia_path: "a.mp4" }, chat, url, null))
      .toEqual({ rota: "send-group-media", corpo: { chatId: chat, kind: "video", url, caption: "aula" } });
    expect(pedidoProxyGrupo({ tipo: "audio", texto: "ignorado", midia_path: "a.ogg" }, chat, url, null))
      .toEqual({ rota: "send-group-media", corpo: { chatId: chat, kind: "audio", url } });
    expect(pedidoProxyGrupo({ tipo: "documento", texto: null, midia_path: "a.pdf", nome_arquivo: "guia.pdf" }, chat, url, null))
      .toEqual({ rota: "send-group-media", corpo: { chatId: chat, kind: "document", url, filename: "guia.pdf" } });
    expect(pedidoProxyGrupo({ tipo: "imagem", texto: null, midia_path: "a.jpg" }, chat, null, null)).toEqual({ erro: "mídia sem link" });
    expect(pedidoProxyGrupo({ tipo: "texto", texto: "oi", midia_path: null }, "5531999998888@c.us", null, null)).toEqual({ erro: "chat_id inválido" });
  });
});

describe("link público", () => {
  it("slug e convite", () => {
    expect(slugDe("Desafio 21 Dias — Turma Nov!")).toBe("desafio-21-dias-turma-nov");
    expect(slugValido("grupo-desafio")).toBe(true);
    expect(slugValido("Grupo")).toBe(false);
    expect(slugValido("-x-")).toBe(false);
    expect(linkConviteValido("https://chat.whatsapp.com/AbCdEfGhIjKlMnOp12")).toBe(true);
    expect(linkConviteValido("http://chat.whatsapp.com/AbCdEfGhIjKlMnOp12")).toBe(false);
    expect(linkConviteValido("https://evil.com/AbCdEfGhIjKlMnOp12")).toBe(false);
  });
  it("telefone e UTM da URL", () => {
    expect(telefoneDaUrl("?tel=(31)99999-8888")).toBe("(31)99999-8888");
    expect(telefoneDaUrl("?whatsapp=5531999998888")).toBe("5531999998888");
    expect(telefoneDaUrl("?tel=abc")).toBeNull();
    expect(utmDaUrl("?utm_source=ig&utm_campaign=desafio&x=1")).toEqual({ utm_source: "ig", utm_campaign: "desafio" });
  });
});

describe("proxy: envio a grupo", () => {
  const sid = "uuid-grupos";
  const chat = "120363000000000001@g.us";
  const lista = new Set([chat]);

  it("rotas novas existem só na lista de grupo; rotas de telefone continuam recusando grupo", () => {
    expect(ROTAS_GRUPO).toEqual([
      "group-allowlist", "send-group-text", "send-group-media", "send-group-poll", "send-group-manual-text", "send-group-manual-media",
      "group-create", "group-settings", "group-description", "group-picture", "group-promote", "group-subject",
      "group-admins",
    ]);
    for (const r of ROTAS_GRUPO) expect(ROTAS).not.toContain(r);
    expect(montarPedidoOpenwa("send-text", { phone: chat, text: "x" }, sid).erro).toBeTruthy();
    expect(montarPedidoOpenwa("send-group-text", { chatId: chat, text: "x" }, sid).erro).toBe("rota inexistente");
  });

  it("texto e mídia para grupo da allowlist; fora dela = 403", () => {
    expect(montarPedidoGrupo("send-group-text", { chatId: chat, text: "oi", linkPreview: true }, sid, lista)).toEqual({
      metodo: "POST", caminho: "/sessions/uuid-grupos/messages/send-text", corpo: { chatId: chat, text: "oi", linkPreview: true },
    });
    expect(montarPedidoGrupo("send-group-media", { chatId: chat, kind: "video", url: "https://a.com/v.mp4", caption: "c" }, sid, lista))
      .toEqual({ metodo: "POST", caminho: "/sessions/uuid-grupos/messages/send-video", corpo: { chatId: chat, url: "https://a.com/v.mp4", caption: "c" } });
    expect(montarPedidoGrupo("send-group-media", { chatId: chat, kind: "audio", url: "https://a.com/a.ogg" }, sid, lista).caminho)
      .toBe("/sessions/uuid-grupos/messages/send-audio");
    const fora = montarPedidoGrupo("send-group-text", { chatId: "120363000000000099@g.us", text: "oi" }, sid, lista);
    expect(fora).toEqual({ erro: "grupo fora da allowlist", status: 403 });
  });

  it("recusa telefone, http, campo extra, kind desconhecido e legenda em áudio", () => {
    const casos: [string, Record<string, unknown>][] = [
      ["send-group-text", { chatId: "5531999998888@c.us", text: "x" }],
      ["send-group-text", { chatId: chat, text: "x", phone: "1" }],
      ["send-group-text", { chatId: chat, text: "" }],
      ["send-group-text", { chatId: chat, text: "x", linkPreview: "sim" }],
      ["send-group-media", { chatId: chat, kind: "image", url: "http://a.com/x.jpg" }],
      ["send-group-media", { chatId: chat, kind: "sticker", url: "https://a.com/x.webp" }],
      ["send-group-media", { chatId: chat, kind: "audio", url: "https://a.com/a.ogg", caption: "x" }],
      ["send-group-media", { chatId: [chat], kind: "image", url: "https://a.com/x.jpg" }],
    ];
    for (const [r, b] of casos) expect(montarPedidoGrupo(r, b, sid, lista).erro, JSON.stringify(b)).toBeTruthy();
  });

  it("allowlist: só @g.us, sem repetição, teto 500", () => {
    expect(validarAllowlist({ groups: [chat, chat] })).toEqual({ grupos: [chat] });
    expect(validarAllowlist({ groups: ["5531999998888@c.us"] }).erro).toBeTruthy();
    expect(validarAllowlist({ groups: Array(501).fill(chat) }).erro).toBeTruthy();
    expect(validarAllowlist({ groups: [chat], extra: 1 }).erro).toBeTruthy();
  });

  it("sessao (contrato da Central): qualquer rota menos allowlist, só nomes do env", () => {
    const ok = sessoesPermitidas("comercial-fit-2, grupos ,../x,");
    expect([...ok]).toEqual(["comercial-fit-2", "grupos"]);
    expect(separarSessao("send-group-text", { chatId: chat, text: "x", sessao: "grupos" }, ok))
      .toEqual({ corpo: { chatId: chat, text: "x" }, sessao: "grupos" });
    expect(separarSessao("send-group-text", { chatId: chat, text: "x", sessao: "outra" }, ok).erro).toBeTruthy();
    expect(separarSessao("send-text", { phone: "5531999998888", text: "x", sessao: "comercial-fit-2" }, ok))
      .toEqual({ corpo: { phone: "5531999998888", text: "x" }, sessao: "comercial-fit-2" });
    expect(separarSessao("group-allowlist", { groups: [], sessao: "grupos" }, ok).erro).toBeTruthy();
    expect(separarSessao("groups", { limit: 10 }, ok)).toEqual({ corpo: { limit: 10 }, sessao: null });
    // o corpo que a Central monta (corpoComSessao) passa pela ponte e sai igual ao de antes
    const r = separarSessao("send-text", { phone: "5531999998888", text: "oi", sessao: "grupos" }, ok);
    expect(montarPedidoOpenwa("send-text", r.corpo, "id-grupos").corpo).toEqual({ chatId: "5531999998888@c.us", text: "oi" });
  });

  it("convite do grupo: rota de leitura e só o link sai", () => {
    expect(montarPedidoOpenwa("group-invite", { chatId: chat }, sid))
      .toEqual({ metodo: "GET", caminho: "/sessions/uuid-grupos/groups/120363000000000001%40g.us/invite-code" });
    expect(montarPedidoOpenwa("group-invite", { chatId: "5531999998888@c.us" }, sid).erro).toBeTruthy();
    expect(linkConviteDe({ inviteCode: "AbCdEfGhIjKlMnOp12", extra: "x" })).toBe("https://chat.whatsapp.com/AbCdEfGhIjKlMnOp12");
    expect(linkConviteDe({ inviteCode: "../x" })).toBeNull();
  });

  it("limite de grupo: 8 s entre envios, 6/min, 200/dia, separado por sessão", () => {
    const l = new LimitadorGrupo();
    const t0 = Date.parse("2026-10-20T15:00:00Z");
    expect(l.reservar(null, t0).ok).toBe(true);
    const cedo = l.reservar(null, t0 + 1000);
    expect(cedo.ok).toBe(false);
    expect(cedo.motivo).toMatch(/intervalo/);
    expect(l.reservar("outra", t0 + 1000).ok).toBe(true); // outra sessão não espera
    let t = t0;
    for (let i = 1; i < LIMITE_GRUPO_MINUTO; i++) { t += INTERVALO_MIN_GRUPO_MS; expect(l.reservar(null, t).ok).toBe(true); }
    const minuto = l.reservar(null, t + INTERVALO_MIN_GRUPO_MS);
    expect(minuto).toMatchObject({ ok: false, motivo: "limite de grupo por minuto" });
    // dia: persiste e recarrega
    const l2 = new LimitadorGrupo(JSON.parse(JSON.stringify({ _padrao: { minuto: [], dia: "2026-10-20", noDia: LIMITE_GRUPO_DIA, ultimo: 0 } })));
    expect(l2.reservar(null, t0 + 3600_000)).toMatchObject({ ok: false, motivo: "limite diário de grupo" });
    expect(l2.reservar(null, Date.parse("2026-10-21T04:00:00Z")).ok).toBe(true); // virou o dia BRT
  });
});

describe("wa-proxy: chave operator por sessão", () => {
  const env = {
    OPENWA_OPERATOR_KEY_COMERCIAL_FIT_2: "k-fit",
    OPENWA_SESSION_ID_COMERCIAL_FIT_2: "uuid-fit",
    OPENWA_OPERATOR_KEY_SUPORTE_CONSULTORIA_1: "k-sup",
  };
  const padrao = { chave: "k-closer", id: "uuid-closer" };
  it("sufixo do env troca hífen por _ e sobe a caixa", () => {
    expect(sufixoEnvSessao("comercial-fit-2")).toBe("COMERCIAL_FIT_2");
  });
  it("padrão usa a chave padrão; extra usa a SUA chave, nunca a do closer", () => {
    expect(credencialDaSessao(null, env, padrao)).toEqual({ chave: "k-closer", id: "uuid-closer" });
    expect(credencialDaSessao("comercial-fit-2", env, padrao)).toEqual({ chave: "k-fit", id: "uuid-fit" });
    expect(credencialDaSessao("suporte-consultoria-1", env, padrao)).toEqual({ chave: "k-sup", id: null });
    expect(credencialDaSessao("comercial-implementacao-1", env, padrao)).toEqual({ chave: null, id: null });
    expect(credencialDaSessao("../x", env, padrao)).toEqual({ chave: null, id: null });
  });
});

