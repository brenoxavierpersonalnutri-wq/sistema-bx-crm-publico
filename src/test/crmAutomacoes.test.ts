import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  agendarLotes,
  aindaSemResposta,
  avaliarEventos,
  avaliarSemResposta,
  dentroDaJanela,
  filtrarPublico,
  intervaloAleatorio,
  passosDoEnvio,
  payloadTemplateOficial,
  problemasDosPassos,
  registrarResultado,
  sinalDeRestricao,
  telefoneE164,
  validarAutomacao,
  verificarLimites,
  type Automacao,
  type ContatoBasico,
  type EventoContato,
  type PassoBasico,
} from "../../supabase/functions/_shared/automacoes.ts";

// 16/10/2026 15:00 em Brasília = 18:00 UTC
const AGORA = new Date("2026-10-16T18:00:00Z");
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

const aut = (p: Partial<Automacao> = {}): Automacao => ({
  id: "a1",
  nome: "Regra",
  ativo: true,
  gatilho_tipo: "etapa",
  gatilho_valor: "agendado",
  sem_resposta_horas: null,
  janela_max_horas: 48,
  filtro_etapas: [],
  acoes: [{ tipo: "roteiro", roteiro_id: "r1" }],
  ligado_em: horasAtras(2),
  ...p,
});

const contatos = (lista: ContatoBasico[]) => new Map(lista.map((c) => [c.phone, c]));

describe("validarAutomacao", () => {
  it("aceita regra completa", () => {
    expect(validarAutomacao(aut())).toEqual([]);
  });
  it("recusa sem ação, etapa inválida e duas mensagens", () => {
    expect(validarAutomacao(aut({ acoes: [] }))).toContain("Adicione pelo menos uma ação.");
    expect(validarAutomacao(aut({ gatilho_valor: "xyz" })).length).toBeGreaterThan(0);
    const duas = validarAutomacao(aut({ acoes: [{ tipo: "roteiro", roteiro_id: "r" }, { tipo: "passo", passo_id: "p" }] }));
    expect(duas).toContain("Só uma mensagem (roteiro ou passo) por automação.");
  });
  it("recusa mover para a mesma etapa do gatilho", () => {
    expect(validarAutomacao(aut({ acoes: [{ tipo: "etapa", etapa: "agendado" }] }))).toContain(
      "A ação de mover etapa não pode ser a mesma etapa do gatilho.",
    );
  });
  it("sem resposta exige horas válidas", () => {
    expect(validarAutomacao(aut({ gatilho_tipo: "sem_resposta", gatilho_valor: null, sem_resposta_horas: 0 })).length).toBe(1);
    expect(validarAutomacao(aut({ gatilho_tipo: "sem_resposta", gatilho_valor: null, sem_resposta_horas: 24 }))).toEqual([]);
  });
});

describe("avaliarEventos (etapa / tag)", () => {
  const evs: EventoContato[] = [
    { contact_phone: "5531900000001", tipo: "etapa", valor: "agendado", created_at: horasAtras(1) },
    { contact_phone: "5531900000002", tipo: "etapa", valor: "agendado", created_at: horasAtras(5) }, // antes de ligar
    { contact_phone: "5531900000003", tipo: "etapa", valor: "agendado", created_at: horasAtras(1) }, // já saiu da etapa
    { contact_phone: "5531900000004", tipo: "etapa", valor: "contato", created_at: horasAtras(1) },
    { contact_phone: "5531900000001", tipo: "etapa", valor: "agendado", created_at: horasAtras(0.5) }, // repetido
  ];
  const cs = contatos([
    { phone: "5531900000001", stage: "agendado" },
    { phone: "5531900000002", stage: "agendado" },
    { phone: "5531900000003", stage: "fechou" },
    { phone: "5531900000004", stage: "contato" },
  ]);

  it("só eventos depois de ligar, contato ainda na etapa, sem repetir", () => {
    expect(avaliarEventos(aut(), evs, cs, new Set(), AGORA)).toEqual(["5531900000001"]);
  });
  it("não reenvia a quem já está na fila desta automação", () => {
    expect(avaliarEventos(aut(), evs, cs, new Set(["5531900000001"]), AGORA)).toEqual([]);
  });
  it("cron parado: nunca olha mais de 24 h para trás", () => {
    const velho = [{ ...evs[0], created_at: horasAtras(30) }];
    expect(avaliarEventos(aut({ ligado_em: horasAtras(100) }), velho, cs, new Set(), AGORA)).toEqual([]);
  });
  it("simulação considera as últimas 24 h mesmo antes de ligar", () => {
    expect(avaliarEventos(aut({ ligado_em: null, ativo: false }), evs, cs, new Set(), AGORA, true)).toEqual([
      "5531900000001",
      "5531900000002",
    ]);
  });
  it("tag normalizada e contato ainda com a tag", () => {
    const evTag: EventoContato[] = [
      { contact_phone: "5531900000001", tipo: "tag", valor: "Quente", created_at: horasAtras(1) },
      { contact_phone: "5531900000002", tipo: "tag", valor: "quente", created_at: horasAtras(1) },
    ];
    const ct = contatos([
      { phone: "5531900000001", stage: "leads", tags: ["quente"] },
      { phone: "5531900000002", stage: "leads", tags: [] }, // tag removida
    ]);
    expect(avaliarEventos(aut({ gatilho_tipo: "tag", gatilho_valor: "QUENTE" }), evTag, ct, new Set(), AGORA)).toEqual([
      "5531900000001",
    ]);
  });
  it("filtro de etapa", () => {
    const evTag: EventoContato[] = [{ contact_phone: "5531900000001", tipo: "tag", valor: "x", created_at: horasAtras(1) }];
    const ct = contatos([{ phone: "5531900000001", stage: "leads", tags: ["x"] }]);
    expect(avaliarEventos(aut({ gatilho_tipo: "tag", gatilho_valor: "x", filtro_etapas: ["contato"] }), evTag, ct, new Set(), AGORA)).toEqual([]);
  });
});

describe("avaliarSemResposta", () => {
  const regra = aut({ gatilho_tipo: "sem_resposta", gatilho_valor: null, sem_resposta_horas: 24, janela_max_horas: 24 });
  const cs = contatos(["1", "2", "3", "4"].map((n) => ({ phone: `553190000000${n}`, stage: "contato" })));
  const msgs = [
    { contact_phone: "5531900000001", direction: "outbound", created_at: horasAtras(30) }, // calado 30h: entra
    { contact_phone: "5531900000002", direction: "outbound", created_at: horasAtras(30) },
    { contact_phone: "5531900000002", direction: "inbound", created_at: horasAtras(26) }, // ela respondeu por último
    { contact_phone: "5531900000003", direction: "outbound", created_at: horasAtras(10) }, // ainda não deu 24h
    { contact_phone: "5531900000004", direction: "outbound", created_at: horasAtras(60) }, // além da janela (base antiga)
  ];
  it("pega só quem está calado entre N e N+janela", () => {
    expect(avaliarSemResposta(regra, msgs, cs, new Set(), AGORA)).toEqual(["5531900000001"]);
  });
  it("na hora do envio, quem respondeu sai", () => {
    expect(aindaSemResposta({ contact_phone: "x", direction: "inbound", created_at: horasAtras(1) })).toBe(false);
    expect(aindaSemResposta({ contact_phone: "x", direction: "outbound", created_at: horasAtras(1) })).toBe(true);
    expect(aindaSemResposta(undefined)).toBe(false);
  });
});

describe("limites anti-ban", () => {
  const ligado = { ...CONFIG_PADRAO, ligado: true };
  it("nasce desligado", () => {
    expect(verificarLimites(CONFIG_PADRAO, { hora: 0, dia: 0 }, 1, AGORA)).toMatchObject({ ok: false, motivo: "desligado" });
  });
  it("libera dentro da janela e dos limites", () => {
    expect(verificarLimites(ligado, { hora: 0, dia: 0 }, 1, AGORA)).toEqual({ ok: true });
  });
  it("janela 8h-20h em Brasília", () => {
    expect(dentroDaJanela(ligado, new Date("2026-10-16T10:59:00Z"))).toBe(false); // 07:59
    expect(dentroDaJanela(ligado, new Date("2026-10-16T11:00:00Z"))).toBe(true); // 08:00
    expect(dentroDaJanela(ligado, new Date("2026-10-16T22:59:00Z"))).toBe(true); // 19:59
    expect(dentroDaJanela(ligado, new Date("2026-10-16T23:00:00Z"))).toBe(false); // 20:00
    expect(verificarLimites(ligado, { hora: 0, dia: 0 }, 1, new Date("2026-10-17T01:00:00Z"))).toMatchObject({ motivo: "fora_janela" });
  });
  it("máximo por hora e por dia contam as mensagens do envio", () => {
    expect(verificarLimites(ligado, { hora: 29, dia: 0 }, 1, AGORA)).toEqual({ ok: true });
    expect(verificarLimites(ligado, { hora: 29, dia: 0 }, 2, AGORA)).toMatchObject({ motivo: "limite_hora" });
    expect(verificarLimites(ligado, { hora: 0, dia: 200 }, 1, AGORA)).toMatchObject({ motivo: "limite_dia" });
  });
  it("respeita o intervalo e a pausa", () => {
    expect(verificarLimites({ ...ligado, proximo_envio_em: horasAtras(-0.01) }, { hora: 0, dia: 0 }, 1, AGORA)).toMatchObject({
      motivo: "aguardando_intervalo",
    });
    expect(verificarLimites({ ...ligado, pausado: true }, { hora: 0, dia: 0 }, 1, AGORA)).toMatchObject({ motivo: "pausado" });
  });
  it("intervalo aleatório fica entre min e max", () => {
    expect(intervaloAleatorio(40, 120, () => 0)).toBe(40);
    expect(intervaloAleatorio(40, 120, () => 0.9999)).toBe(120);
    for (let i = 0; i < 200; i++) {
      const s = intervaloAleatorio(40, 120);
      expect(s).toBeGreaterThanOrEqual(40);
      expect(s).toBeLessThanOrEqual(120);
    }
  });
  it("pausa com 3 falhas seguidas e na hora com sinal de restrição", () => {
    let f = 0;
    let r = registrarResultado(f, { ok: false, status: 502, detalhe: "timeout" });
    expect(r.pausar).toBe(false);
    f = r.falhasSeguidas;
    r = registrarResultado(f, { ok: false, status: 500, detalhe: "erro" });
    expect(r.pausar).toBe(false);
    r = registrarResultado(r.falhasSeguidas, { ok: false, status: 500, detalhe: "erro" });
    expect(r).toMatchObject({ pausar: true, motivo: "3 falhas seguidas" });
    expect(registrarResultado(2, { ok: true })).toEqual({ falhasSeguidas: 0, pausar: false, motivo: null });
    expect(registrarResultado(0, { ok: false, status: 400, detalhe: { error: "number banned" } }).pausar).toBe(true);
    expect(sinalDeRestricao(429, "")).toBe(true);
    expect(sinalDeRestricao(500, "WhatsApp disconnected")).toBe(true);
    expect(sinalDeRestricao(500, "internal")).toBe(false);
  });
});

describe("campanhas", () => {
  const base: ContatoBasico[] = [
    { phone: "5531900000001", stage: "leads", source: "avaliacao", tags: ["quente"] },
    { phone: "5531900000002", stage: "contato", source: "individual", tags: [] },
    { phone: "5531900000003", stage: "leads", source: "Avaliacao", tags: ["frio"] },
    { phone: "123", stage: "leads" }, // inválido
    { phone: "5531900000001", stage: "leads", source: "avaliacao" }, // duplicado
  ];
  it("filtra por etapa, tag, origem e remove inválido/duplicado", () => {
    expect(filtrarPublico({ etapas: ["leads"] }, base).map((c) => c.phone)).toEqual(["5531900000001", "5531900000003"]);
    expect(filtrarPublico({ tags: ["Quente"] }, base).map((c) => c.phone)).toEqual(["5531900000001"]);
    expect(filtrarPublico({ origens: ["avaliacao"] }, base).map((c) => c.phone)).toEqual(["5531900000001", "5531900000003"]);
  });
  it("sem resposta há N dias exclui quem respondeu", () => {
    const r = filtrarPublico({ etapas: ["leads"], sem_resposta_dias: 3 }, base, new Set(["5531900000001"]));
    expect(r.map((c) => c.phone)).toEqual(["5531900000003"]);
  });
  it("lotes por dia: hoje agora, depois às 8h de Brasília", () => {
    const d = agendarLotes(5, 2, AGORA, 8);
    expect(d[0]).toBe(AGORA);
    expect(d[1]).toBe(AGORA);
    expect(d[2].toISOString()).toBe("2026-10-17T11:00:00.000Z");
    expect(d[4].toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(agendarLotes(3, null, AGORA).every((x) => x === AGORA)).toBe(true);
  });
});

describe("mensagens", () => {
  const p = (o: Partial<PassoBasico>): PassoBasico => ({
    id: String(o.ordem), ordem: 1, tipo: "text", conteudo: "oi", media_url: null, file_name: null,
    atraso_segundos: 0, aguarda_resposta: false, ...o,
  });
  it("roteiro para no primeiro passo que espera resposta", () => {
    const r = passosDoEnvio([p({ ordem: 3, aguarda_resposta: true }), p({ ordem: 1, aguarda_resposta: true }), p({ ordem: 2 })]);
    expect(r.map((x) => x.ordem)).toEqual([1, 2]);
  });
  it("aponta variável que o automático não preenche e mídia sem arquivo", () => {
    const probs = problemasDosPassos([
      p({ ordem: 1, conteudo: "Oi {primeiro_nome}, sua avaliação é {data}" }),
      p({ ordem: 2, tipo: "image", media_url: null }),
    ]);
    expect(probs.some((x) => x.includes("{data}"))).toBe(true);
    expect(probs.some((x) => x.includes("falta o arquivo"))).toBe(true);
    expect(problemasDosPassos([p({ conteudo: "Oi {primeiro_nome}" })])).toEqual([]);
  });
});

describe("Full Funnel (template oficial)", () => {
  it("telefone E.164", () => {
    expect(telefoneE164("5531999998888")).toBe("+5531999998888");
    expect(telefoneE164("31999998888")).toBe("+5531999998888");
    expect(telefoneE164("553199998888")).toBe("+5531999998888"); // ganha o 9
    expect(telefoneE164("+351912345678")).toBe("+351912345678");
    expect(telefoneE164("123")).toBeNull();
  });
  it("payload com template e variáveis", () => {
    const pl = payloadTemplateOficial(
      { phone: "5531999998888", name: "Maria Silva", stage: "agendado" },
      { template: "lembrete_avaliacao", variaveis: { nome: "{primeiro_nome}", dia: "sexta" } },
      { automacao: "a1" },
    );
    expect(pl).toMatchObject({
      template: "lembrete_avaliacao",
      phone: "+5531999998888",
      first_name: "Maria",
      var_1: "Maria",
      var_2: "sexta",
      variaveis: { nome: "Maria", dia: "sexta" },
    });
    expect(payloadTemplateOficial({ phone: "1" }, { template: "x" })).toBeNull();
  });
});
