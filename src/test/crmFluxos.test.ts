import { describe, expect, it } from "vitest";
import {
  aplicarDesvio,
  decidir,
  duracaoEspera,
  inscricoesDoFluxo,
  normalizarEvento,
  resolverVariaveis,
  resumoPasso,
  templatesNaoAprovados,
  validarFluxo,
  variaveisDoTemplate,
  type EventoFluxo,
  type ExecucaoFluxo,
  type Fluxo,
} from "../../supabase/functions/_shared/fluxos.ts";
import type { ContatoBasico } from "../../supabase/functions/_shared/automacoes.ts";

const AGORA = new Date("2026-10-17T18:00:00Z");
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

const fluxo = (p: Partial<Fluxo> = {}): Fluxo => ({
  id: "f1",
  nome: "Fluxo",
  ativo: true,
  gatilho_tipo: "evento",
  gatilho_valor: "lead_qualificado",
  parar_se_responder: false,
  permitir_repetir: false,
  passos: [{ tipo: "template_oficial", template: "qualificadoavaliacao", variaveis: { "1": "{primeiro_nome}" } }],
  ligado_em: horasAtras(2),
  ...p,
});

const exec = (p: Partial<ExecucaoFluxo> = {}): ExecucaoFluxo => ({
  id: 1,
  fluxo_id: "f1",
  contact_phone: "5531999998888",
  passo_idx: 0,
  status: "ativo",
  proximo_em: horasAtras(0),
  aguardando_resposta: false,
  iniciado_em: horasAtras(1),
  ultimo_envio_em: null,
  dados: {},
  ...p,
});

const ctx = (c: Partial<ContatoBasico> = {}, respondeuEm: string | null = null) => ({
  contato: { phone: "5531999998888", name: "Maria Silva", stage: "leads", tags: [], ...c },
  respondeuDesde: (d: string) => (respondeuEm ? new Date(respondeuEm) > new Date(d) : false),
});

describe("validarFluxo", () => {
  it("aceita o fluxo do Full Funnel (evento → tags → template)", () => {
    expect(validarFluxo(fluxo({
      passos: [
        { tipo: "tag", acao: "por", tag: "lead-qualificado-breno" },
        { tipo: "template_oficial", template: "qualificadoavaliacao" },
      ],
    }))).toEqual([]);
  });
  it("recusa sem nome, sem passos, gatilho vazio e espera acima de 60 dias", () => {
    expect(validarFluxo(fluxo({ nome: " " }))).toContain("Dê um nome ao fluxo.");
    expect(validarFluxo(fluxo({ passos: [] }))).toContain("Adicione pelo menos um passo.");
    expect(validarFluxo(fluxo({ gatilho_valor: "" }))).toContain("Informe o nome do evento que inicia o fluxo.");
    expect(validarFluxo(fluxo({ gatilho_tipo: "etapa", gatilho_valor: "xyz" })).length).toBe(1);
    expect(validarFluxo(fluxo({ passos: [{ tipo: "esperar", quantidade: 61, unidade: "dias" }] }))[0]).toMatch(/60 dias/);
    expect(validarFluxo(fluxo({ passos: [{ tipo: "esperar", quantidade: 60, unidade: "dias" }] }))).toEqual([]);
  });
  it("desvio de condição só vai para frente", () => {
    const passos = [
      { tipo: "esperar", quantidade: 1, unidade: "dias" },
      { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "parar", se_nao: 1 },
      { tipo: "template_oficial", template: "b1" },
    ] as Fluxo["passos"];
    expect(validarFluxo(fluxo({ passos })).join()).toMatch(/desvio inválido/);
    passos[1] = { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "parar", se_nao: 3 };
    expect(validarFluxo(fluxo({ passos }))).toEqual([]);
  });
  it("mensagem não oficial precisa de roteiro ou passo", () => {
    expect(validarFluxo(fluxo({ passos: [{ tipo: "mensagem" }] })).join()).toMatch(/roteiro ou o passo/);
  });
});

describe("utilidades", () => {
  it("duração da espera e variáveis do template", () => {
    expect(duracaoEspera({ quantidade: 2, unidade: "horas" })).toBe(2 * 3600_000);
    expect(duracaoEspera({ quantidade: 1, unidade: "dias" })).toBe(86400_000);
    expect(duracaoEspera({ quantidade: 999, unidade: "dias" })).toBe(60 * 86400_000);
    expect(variaveisDoTemplate("Oi {{2}} e {{1}}, {{ 2 }}")).toEqual([1, 2]);
  });
  it("normaliza evento e resolve {dados.x} em ordem numérica", () => {
    expect(normalizarEvento("Compra Aprovada!")).toBe("compra_aprovada");
    expect(resolverVariaveis({ "2": "{dados.email}", "1": "{primeiro_nome}", "10": "x" }, { email: "a@b.c" }))
      .toEqual({ "1": "{primeiro_nome}", "2": "a@b.c", "10": "x" });
    expect(Object.keys(resolverVariaveis({ "2": "b", "1": "a" }, {}))).toEqual(["1", "2"]);
    expect(resolverVariaveis({ "1": "{dados.falta}" }, {})).toEqual({ "1": "" });
  });
  it("aplicarDesvio", () => {
    expect(aplicarDesvio("continuar", 0, 3)).toBe(1);
    expect(aplicarDesvio("continuar", 2, 3)).toBeNull();
    expect(aplicarDesvio("parar", 0, 3)).toBeNull();
    expect(aplicarDesvio(3, 0, 3)).toBe(2);
  });
  it("aponta template fora do catálogo aprovado", () => {
    const cat = [{ nome: "b1", status: "APPROVED" }, { nome: "x", status: "REJECTED" }];
    const f = fluxo({ passos: [{ tipo: "template_oficial", template: "b1" }, { tipo: "template_oficial", template: "x" }, { tipo: "template_oficial", template: "y" }] });
    expect(templatesNaoAprovados(f, cat)).toEqual(["x", "y"]);
  });
  it("resumo do passo", () => {
    expect(resumoPasso({ tipo: "esperar", quantidade: 2, unidade: "dias", ate_responder: true })).toBe("Esperar 2 dias (ou até responder)");
    expect(resumoPasso({ tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "parar", se_nao: "continuar" })).toBe("Se respondeu? sim: para; não: segue");
  });
});

describe("inscricoesDoFluxo", () => {
  const ev = (p: Partial<EventoFluxo> = {}): EventoFluxo => ({
    contact_phone: "5531999998888", tipo: "evento", valor: "lead_qualificado", created_at: horasAtras(1), dados: { email: "a@b.c" }, ...p,
  });
  const contatos = new Map<string, ContatoBasico>([["5531999998888", { phone: "5531999998888", name: "Maria", stage: "leads", tags: ["quente"] }]]);

  it("inscreve com os dados do evento", () => {
    expect(inscricoesDoFluxo(fluxo(), [ev()], contatos, [], AGORA)).toEqual([{ phone: "5531999998888", dados: { email: "a@b.c" } }]);
  });
  it("ignora evento antes de ligar, fluxo desligado, outro evento e contato inexistente", () => {
    expect(inscricoesDoFluxo(fluxo(), [ev({ created_at: horasAtras(3) })], contatos, [], AGORA)).toEqual([]);
    expect(inscricoesDoFluxo(fluxo({ ativo: false }), [ev()], contatos, [], AGORA)).toEqual([]);
    expect(inscricoesDoFluxo(fluxo(), [ev({ valor: "outro" })], contatos, [], AGORA)).toEqual([]);
    expect(inscricoesDoFluxo(fluxo(), [ev({ contact_phone: "5511" })], contatos, [], AGORA)).toEqual([]);
  });
  it("sem repetir: quem já passou não entra; com repetir: só evento novo e sem execução ativa", () => {
    const antiga = [{ contact_phone: "5531999998888", status: "concluido" as const, iniciado_em: horasAtras(1.5) }];
    expect(inscricoesDoFluxo(fluxo(), [ev()], contatos, antiga, AGORA)).toEqual([]);
    expect(inscricoesDoFluxo(fluxo({ permitir_repetir: true }), [ev()], contatos, antiga, AGORA)).toHaveLength(1);
    const depois = [{ ...antiga[0], iniciado_em: horasAtras(0.5) }];
    expect(inscricoesDoFluxo(fluxo({ permitir_repetir: true }), [ev()], contatos, depois, AGORA)).toEqual([]);
    const ativa = [{ ...antiga[0], status: "ativo" as const }];
    expect(inscricoesDoFluxo(fluxo({ permitir_repetir: true }), [ev()], contatos, ativa, AGORA)).toEqual([]);
  });
  it("gatilho por tag exige que o contato ainda tenha a tag", () => {
    const f = fluxo({ gatilho_tipo: "tag", gatilho_valor: "Quente" });
    expect(inscricoesDoFluxo(f, [ev({ tipo: "tag", valor: "quente" })], contatos, [], AGORA)).toHaveLength(1);
    const sem = new Map([["5531999998888", { phone: "5531999998888", tags: [] }]]);
    expect(inscricoesDoFluxo(f, [ev({ tipo: "tag", valor: "quente" })], sem, [], AGORA)).toEqual([]);
  });
});

describe("decidir", () => {
  const passos: Fluxo["passos"] = [
    { tipo: "template_oficial", template: "qualificadoavaliacao" },
    { tipo: "esperar", quantidade: 1, unidade: "dias", ate_responder: true },
    { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "parar", se_nao: "continuar" },
    { tipo: "tag", acao: "por", tag: "sem-resposta" },
  ];
  it("primeiro passo é ação", () => {
    const d = decidir(fluxo({ passos }), exec(), ctx(), AGORA);
    expect(d).toMatchObject({ fazer: "acao", idx: 0, proximo_idx: 1 });
  });
  it("espera devolve a data e marca aguardando resposta", () => {
    const d = decidir(fluxo({ passos }), exec({ passo_idx: 1 }), ctx(), AGORA);
    expect(d.fazer).toBe("esperar");
    if (d.fazer === "esperar") {
      expect(d.ate.getTime() - AGORA.getTime()).toBe(86400_000);
      expect(d.aguardando_resposta).toBe(true);
      expect(d.proximo_idx).toBe(2);
    }
  });
  it("condição respondeu: sim para, não segue para a tag", () => {
    const envio = horasAtras(0.5);
    expect(decidir(fluxo({ passos }), exec({ passo_idx: 2, ultimo_envio_em: envio }), ctx({}, horasAtras(0.1)), AGORA))
      .toMatchObject({ fazer: "parar", status: "concluido" });
    expect(decidir(fluxo({ passos }), exec({ passo_idx: 2, ultimo_envio_em: envio }), ctx(), AGORA))
      .toMatchObject({ fazer: "acao", idx: 3, proximo_idx: null });
  });
  it("parar se responder vence tudo", () => {
    const d = decidir(fluxo({ passos, parar_se_responder: true }), exec(), ctx({}, horasAtras(0.2)), AGORA);
    expect(d).toMatchObject({ fazer: "parar", status: "parado" });
  });
  it("fim do fluxo e passo parar", () => {
    expect(decidir(fluxo({ passos }), exec({ passo_idx: 4 }), ctx(), AGORA)).toMatchObject({ fazer: "parar", status: "concluido", motivo: "fim do fluxo" });
    expect(decidir(fluxo({ passos: [{ tipo: "parar" }] }), exec(), ctx(), AGORA)).toMatchObject({ fazer: "parar" });
  });
  it("condição por tag e etapa", () => {
    const p: Fluxo["passos"] = [
      { tipo: "condicao", condicao: { tipo: "tem_tag", valor: "VIP" }, se_sim: 3, se_nao: "continuar" },
      { tipo: "condicao", condicao: { tipo: "etapa", valor: "agendado" }, se_sim: "continuar", se_nao: "parar" },
      { tipo: "etapa", etapa: "fechou" },
    ];
    expect(decidir(fluxo({ passos: p }), exec(), ctx({ tags: ["vip"] }), AGORA)).toMatchObject({ fazer: "acao", idx: 2 });
    expect(decidir(fluxo({ passos: p }), exec(), ctx({ stage: "leads" }), AGORA)).toMatchObject({ fazer: "parar" });
    expect(decidir(fluxo({ passos: p }), exec(), ctx({ stage: "agendado" }), AGORA)).toMatchObject({ fazer: "acao", idx: 2 });
  });
});
