// Motor do passo "Mensagem da IA" com IA FALSA (18/10/2026): executarPassoFollowup é o que o crm-automacoes roda
// na hora do envio, com banco, Claude e WhatsApp injetados. Aqui nada vai para a rede.
import { describe, expect, it, vi } from "vitest";
import {
  executarPassoFollowup,
  gerarFollowup,
  gerarRespostaAtendimento,
  type Completar,
  type DepsPassoFollowup,
} from "../../supabase/functions/_shared/agenteResponder.ts";
import { ErroIA } from "../../supabase/functions/_shared/anthropic.ts";
import { PROMPT_FOLLOWUP_PADRAO, type LinhaHistorico } from "../../supabase/functions/_shared/agenteFollowup.ts";
import { nomeDoFormulario, type AgenteIA } from "../../supabase/functions/_shared/agentesIA.ts";

const T = (min: number) => new Date(Date.UTC(2026, 9, 17, 12, min)).toISOString();
const HIST: LinhaHistorico[] = [
  { direction: "outbound", body: "Oi Ana, vi que você pediu a avaliação. Qual seu objetivo hoje?", created_at: T(1) },
  { direction: "inbound", body: "quero emagrecer", created_at: T(0) },
];
const AGENTE = { id: "ag1", slug: "fu", nome: "Follow-up", prompt: PROMPT_FOLLOWUP_PADRAO, tipo: "followup", modelo: "claude-haiku-5-5", historico_mensagens: 12 };
const CONTATO = { phone: "5531988887777", name: "Ana Souza", stage: "contato" };

function deps(completar: Completar, extra: Partial<DepsPassoFollowup> = {}) {
  const log: { ok: boolean; detalhe: string }[] = [];
  const enviados: string[] = [];
  const d: DepsPassoFollowup = {
    carregarAgente: vi.fn(async (id: string) => (id === AGENTE.id ? AGENTE : null)),
    carregarHistorico: vi.fn(async () => HIST),
    completar,
    enviarTexto: vi.fn(async (t: string) => { enviados.push(t); return { estado: "enviado" as const }; }),
    registrar: vi.fn(async (ok: boolean, detalhe: string) => { log.push({ ok, detalhe }); }),
    ...extra,
  };
  return { d, log, enviados };
}

const acao = { agente_id: "ag1", instrucao: "2ª tentativa: lembrar do benefício X", tentativa: 2 };
const ctx = { contato: CONTATO, desde: T(5) };

describe("passo Mensagem da IA no motor (IA falsa)", () => {
  it("gera com o histórico da conversa, registra a mensagem gerada no log e envia pelo número do fluxo", async () => {
    const completar = vi.fn<Completar>(async () => "Ana, ainda quer aquela avaliação para emagrecer? Posso te mostrar como funciona?");
    const { d, log, enviados } = deps(completar);
    const r = await executarPassoFollowup(acao, ctx, d);
    expect(r).toEqual({ estado: "enviado" });
    expect(d.carregarHistorico).toHaveBeenCalledWith(CONTATO.phone, 12); // o tamanho do histórico do agente
    const [msgs, opcoes] = completar.mock.calls[0];
    expect(opcoes).toEqual({ tarefa: "conversa", modelo: "claude-haiku-5-5" });
    expect(msgs[msgs.length - 1].role).toBe("user");
    expect(msgs[1].content).toContain("Lead: quero emagrecer");
    expect(msgs[1].content).toContain("lembrar do benefício X");
    expect(log).toEqual([{ ok: true, detalhe: 'mensagem gerada (agente Follow-up, 2ª tentativa): "Ana, ainda quer aquela avaliação para emagrecer? Posso te mostrar como funciona?"' }]);
    expect(enviados).toEqual(["Ana, ainda quer aquela avaliação para emagrecer? Posso te mostrar como funciona?"]);
  });

  it("IA sem chave (503): NÃO envia, registra o motivo claro e devolve erro (o motor tenta de novo uma vez)", async () => {
    const { d, log, enviados } = deps(async () => { throw new ErroIA(503, "chave da Anthropic não configurada: rode o pareamento na VPS (anthropic-parear)"); });
    const r = await executarPassoFollowup(acao, ctx, d);
    expect(r).toEqual({ estado: "erro", motivo: expect.stringContaining("HTTP 503") });
    expect(enviados).toEqual([]);
    expect(log).toHaveLength(1);
    expect(log[0].ok).toBe(false);
    expect(log[0].detalhe).toBe("não enviado (agente Follow-up, 2ª tentativa): IA (Claude) falhou: HTTP 503: chave da Anthropic não configurada: rode o pareamento na VPS (anthropic-parear)");
  });

  it("IA 4xx (crédito, recusa) também não envia; a chave nunca aparece no log", async () => {
    const { d, log, enviados } = deps(async () => { throw new ErroIA(400, "sem crédito na conta sk-ant-api03-SEGREDO"); });
    expect((await executarPassoFollowup(acao, ctx, d)).estado).toBe("erro");
    expect(enviados).toEqual([]);
    expect(log[0].detalhe).toContain("HTTP 400");
    expect(log[0].detalhe).not.toContain("SEGREDO");
  });

  it("erro qualquer (timeout de rede) não envia", async () => {
    const { d, enviados, log } = deps(async () => { throw new Error("The signal has been aborted"); });
    expect((await executarPassoFollowup(acao, ctx, d)).estado).toBe("erro");
    expect(enviados).toEqual([]);
    expect(log[0].detalhe).toContain("aborted");
  });

  it("lead respondeu depois do início do fluxo: nem chama a IA, nada sai, fica 'ignorado'", async () => {
    const completar = vi.fn<Completar>(async () => "x");
    const { d, enviados, log } = deps(completar, {
      carregarHistorico: async () => [...HIST, { direction: "inbound", body: "oi, voltei", created_at: T(30) }],
    });
    const r = await executarPassoFollowup(acao, ctx, d);
    expect(r).toEqual({ estado: "ignorado", motivo: expect.stringMatching(/respondeu/) });
    expect(completar).not.toHaveBeenCalled();
    expect(enviados).toEqual([]);
    expect(log[0]).toMatchObject({ ok: false });
  });

  it("saiu repetida: pede outra UMA vez avisando qual evitar; a segunda sai", async () => {
    const completar = vi.fn<Completar>()
      .mockResolvedValueOnce("Oi Ana, vi que você pediu a avaliação. Qual seu objetivo hoje?")
      .mockResolvedValueOnce("Ana, emagrecer ainda é prioridade pra você agora?");
    const { d, enviados } = deps(completar);
    expect((await executarPassoFollowup(acao, ctx, d)).estado).toBe("enviado");
    expect(completar).toHaveBeenCalledTimes(2);
    expect(completar.mock.calls[1][0][1].content).toContain("saiu igual a uma já enviada");
    expect(enviados).toEqual(["Ana, emagrecer ainda é prioridade pra você agora?"]);
  });

  it("repetida duas vezes ou falando preço: não envia, 'ignorado' (sem nova tentativa)", async () => {
    const repetida = vi.fn<Completar>(async () => "Oi Ana, vi que você pediu a avaliação. Qual seu objetivo hoje?");
    const a = deps(repetida);
    expect(await executarPassoFollowup(acao, ctx, a.d)).toEqual({ estado: "ignorado", motivo: expect.stringMatching(/mesmo pedindo outra/) });
    expect(a.enviados).toEqual([]);
    const b = deps(async () => "Só hoje fica R$ 297, bora?");
    expect((await executarPassoFollowup(acao, ctx, b.d)).estado).toBe("ignorado");
    expect(b.enviados).toEqual([]);
    expect(b.log[0].detalhe).toMatch(/preço/);
  });

  it("agente apagado ou que não é de follow-up: não envia e explica", async () => {
    const a = deps(async () => "x");
    expect(await executarPassoFollowup({ agente_id: "sumiu" }, ctx, a.d)).toEqual({ estado: "ignorado", motivo: "agente de follow-up não existe" });
    const b = deps(async () => "x", { carregarAgente: async () => ({ ...AGENTE, tipo: "atendimento" }) });
    expect((await executarPassoFollowup(acao, ctx, b.d)).estado).toBe("ignorado");
    expect(b.log[0].detalhe).toMatch(/não é de follow-up/);
    expect(a.enviados.concat(b.enviados)).toEqual([]);
  });

  it("falha do WhatsApp no envio volta para o motor como está (conta para a pausa anti-ban)", async () => {
    const falha = { estado: "erro" as const, motivo: "falha no passo 2 (HTTP 500)", falhaWhatsApp: { status: 500, detalhe: "x" } };
    const { d } = deps(async () => "Ana, posso te ajudar com mais alguma dúvida?", { enviarTexto: async () => falha });
    expect(await executarPassoFollowup(acao, ctx, d)).toBe(falha);
  });

  it("gerarFollowup não chama a IA quando a lead pediu para parar", async () => {
    const completar = vi.fn<Completar>(async () => "x");
    const r = await gerarFollowup({ agente: AGENTE, contato: CONTATO, historico: [{ direction: "inbound", body: "pare de mandar mensagem", created_at: T(0) }], completar });
    expect(r).toMatchObject({ ok: false, falhaIA: false });
    expect(completar).not.toHaveBeenCalled();
  });
});

describe("gerarRespostaAtendimento (base do robô, sem resposta automática ligada)", () => {
  it("monta o prompt do agente, chama a IA e lê as marcações", async () => {
    const agente = {
      id: "a", slug: "avaliacao", nome: "Av", prompt: "Você é a assistente.", base_conhecimento: null, etapas: [], origens: [], gatilhos: [],
      modelo: null, temperatura: 0, ativo: false, horario_inicio: null, horario_fim: null, dias_semana: [], limite_interacoes: 10,
      historico_mensagens: 20, atraso_segundos: 0,
    } as AgenteIA;
    const completar = vi.fn<Completar>(async () => "Oi {primeiro_nome}!\n\nPosso te ajudar?[ETAPA:contato]");
    const r = await gerarRespostaAtendimento({ agente, contato: { phone: "1", name: "bia" }, chat: [{ role: "user", content: "oi" }], completar, etapas: ["leads", "contato"] });
    expect(completar.mock.calls[0][0][0].content).toContain("Você é a assistente.");
    expect(r.resposta.mensagens.map((m) => m.conteudo)).toEqual(["Oi Bia!", "Posso te ajudar?"]);
    expect(r.resposta.etapa).toBe("contato");
  });
});

describe("nome do formulário de avaliação (21/10/2026)", () => {
  const agente = {
    id: "a", slug: "avaliacao", nome: "Av", prompt: "Você é a assistente.", base_conhecimento: null, etapas: [], origens: [], gatilhos: [],
    modelo: null, temperatura: 0, ativo: false, horario_inicio: null, horario_fim: null, dias_semana: [], limite_interacoes: 10,
    historico_mensagens: 20, atraso_segundos: 0,
  } as AgenteIA;
  const FORM = "Olá! Fui qualificada no formulário de avaliação! 🎉\n\n*Horário Agendado:*\n📅 22/10/2026 às 🕒 10:00\n\n*Nome:* Maria TESTE\n*WhatsApp:* 31999990000\n\n*Minhas respostas:*\n\n*1. Objetivo principal*\nEmagrecer\n\n";

  it("extrai o nome só quando a 1ª mensagem da lead é o formulário", () => {
    expect(nomeDoFormulario([{ role: "user", content: FORM }])).toBe("Maria TESTE");
    expect(nomeDoFormulario([{ role: "user", content: "oi" }, { role: "user", content: FORM }])).toBe("");
    expect(nomeDoFormulario([{ role: "user", content: "Olá! Fui qualificada\n*Nome:* 31999990000" }])).toBe("");
    expect(nomeDoFormulario([])).toBe("");
  });

  it("usa o nome do formulário no prompt e nas variáveis, não o do WhatsApp", async () => {
    const completar = vi.fn<Completar>(async () => "Oi {primeiro_nome}!");
    const r = await gerarRespostaAtendimento({ agente, contato: { phone: "1", name: "Zezinho Contato" }, chat: [{ role: "user", content: FORM }], completar, etapas: ["leads"] });
    const sistema = completar.mock.calls[0][0][0].content;
    expect(sistema).toContain("Primeiro nome: Maria");
    expect(sistema).toContain("nome_formulario: Maria TESTE");
    expect(sistema).not.toContain("Primeiro nome: Zezinho");
    expect(r.resposta.mensagens.map((m) => m.conteudo)).toEqual(["Oi Maria!"]);
  });

  it("sem formulário, nada muda", async () => {
    const completar = vi.fn<Completar>(async () => "Oi {primeiro_nome}!");
    const r = await gerarRespostaAtendimento({ agente, contato: { phone: "1", name: "bia" }, chat: [{ role: "user", content: "oi" }], completar, etapas: ["leads"] });
    expect(completar.mock.calls[0][0][0].content).not.toContain("nome_formulario");
    expect(r.resposta.mensagens.map((m) => m.conteudo)).toEqual(["Oi Bia!"]);
  });
});
