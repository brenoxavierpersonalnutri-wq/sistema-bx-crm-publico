// Agente de follow-up (18/10/2026): template, travas antes/depois do modelo e montagem do pedido ao Claude.
import { describe, expect, it } from "vitest";
import {
  INSTRUCOES_TENTATIVA_PADRAO,
  PROMPT_FOLLOWUP_PADRAO,
  bloqueioAntesDoModelo,
  falaPreco,
  finalizarFollowup,
  montarPedidoFollowup,
  novoAgenteFollowup,
  pediuParaParar,
  repeteMensagem,
  tamanhoHistorico,
  transcricao,
  type LinhaHistorico,
} from "../../supabase/functions/_shared/agenteFollowup.ts";
import { escolherAgente, type AgenteIA } from "../../supabase/functions/_shared/agentesIA.ts";

const H = (direction: "inbound" | "outbound", body: string, min: number): LinhaHistorico => ({
  direction, body, created_at: new Date(Date.UTC(2026, 9, 17, 12, min)).toISOString(),
});
const CONTATO = { phone: "5531988887777", name: "ana paula souza", stage: "contato" };
const AGENTE = { id: "a1", slug: "followup-x", nome: "Follow-up", prompt: PROMPT_FOLLOWUP_PADRAO, tipo: "followup", modelo: null };

describe("template do agente de follow-up", () => {
  it("o prompt cobre objetivo, 1 pergunta, sem pressão, histórico, nome, preço, parar e não repetir", () => {
    for (const trecho of ["retomando uma conversa", "UMA pergunta", "sem pressão", "histórico", "primeiro nome", "Nunca fale preço", "Nunca repita", "[SILENCIO]"]) {
      expect(PROMPT_FOLLOWUP_PADRAO).toContain(trecho);
    }
  });

  it("novoAgenteFollowup: tipo followup, desligado, slug único derivado do nome, prompt preenchido", () => {
    const a = novoAgenteFollowup("Follow-up Avaliação", "abc12");
    expect(a).toMatchObject({ tipo: "followup", ativo: false, slug: "follow-up-avaliacao-abc12", nome: "Follow-up Avaliação", prompt: PROMPT_FOLLOWUP_PADRAO });
    expect(novoAgenteFollowup("", "zz").slug).toBe("followup-zz");
  });

  it("tem uma instrução por tentativa do modelo pronto (5), cada uma com ângulo diferente", () => {
    expect(INSTRUCOES_TENTATIVA_PADRAO).toHaveLength(5);
    expect(new Set(INSTRUCOES_TENTATIVA_PADRAO).size).toBe(5);
  });

  it("robô de atendimento nunca escolhe agente de follow-up, mesmo atribuído ou com gatilho", () => {
    const base = { prompt: "", base_conhecimento: null, etapas: [], origens: ["site"], gatilhos: ["oi"], modelo: null, temperatura: 0, ativo: true,
      horario_inicio: null, horario_fim: null, dias_semana: [], limite_interacoes: 10, historico_mensagens: 20, atraso_segundos: 0 };
    const fu = { ...base, id: "f", slug: "fu", nome: "FU", tipo: "followup" } as AgenteIA;
    expect(escolherAgente([fu], { phone: "1", ai_agent_slug: "fu" }, "oi")).toBeNull();
    expect(escolherAgente([fu], { phone: "1", source: "site" }, "oi")).toBeNull();
    const at = { ...base, id: "a", slug: "at", nome: "AT", tipo: "atendimento" } as AgenteIA;
    expect(escolherAgente([fu, at], { phone: "1" }, "oi")?.agente.slug).toBe("at");
  });
});

describe("travas antes do modelo", () => {
  it("pediuParaParar casa frase inteira, sem acento, e não dispara em 'para mim'", () => {
    expect(pediuParaParar("Por favor PARE de me mandar")).toBe("pare");
    expect(pediuParaParar("não tenho interesse, obrigada")).toBe("nao tenho interesse");
    expect(pediuParaParar("me remove dessa lista")).toBe("me remove");
    expect(pediuParaParar("para mim quinta é melhor")).toBeNull();
    expect(pediuParaParar("")).toBeNull();
  });

  it("lead respondeu depois do início do fluxo: não sai", () => {
    const hist = [H("outbound", "Oi Ana, tudo bem?", 0), H("inbound", "oi! tudo", 30)];
    expect(bloqueioAntesDoModelo(hist, new Date(Date.UTC(2026, 9, 17, 12, 10)).toISOString())?.motivo).toMatch(/respondeu/);
    // resposta ANTES do fluxo começar não bloqueia
    expect(bloqueioAntesDoModelo(hist, new Date(Date.UTC(2026, 9, 17, 13, 0)).toISOString())).toBeNull();
  });

  it("lead pediu para parar em qualquer das últimas mensagens dela: não sai", () => {
    const hist = [H("inbound", "não quero mais receber", 0), H("outbound", "Tudo bem!", 1)];
    expect(bloqueioAntesDoModelo(hist, null)?.motivo).toMatch(/pediu para parar/);
  });

  it("tamanho do histórico: padrão 20, entre 4 e 40", () => {
    expect(tamanhoHistorico({ historico_mensagens: null })).toBe(20);
    expect(tamanhoHistorico({ historico_mensagens: 2 })).toBe(4);
    expect(tamanhoHistorico({ historico_mensagens: 99 })).toBe(40);
  });
});

describe("pedido ao Claude", () => {
  it("system com o prompt e o primeiro nome; user único com transcrição, já enviadas, tentativa e instrução", () => {
    const hist = [H("inbound", "quero saber da avaliação", 0), H("outbound", "Claro! Qual seu objetivo?", 1)];
    const msgs = montarPedidoFollowup({ agente: AGENTE, contato: CONTATO, historico: hist, instrucao: "2ª tentativa: lembrar do benefício X", tentativa: 2 });
    expect(msgs.map((m) => m.role)).toEqual(["system", "user"]); // termina em user (a API recusa terminar em assistant)
    expect(msgs[0].content).toContain(PROMPT_FOLLOWUP_PADRAO.slice(0, 40));
    expect(msgs[0].content).toContain("Primeiro nome: Ana");
    expect(msgs[1].content).toContain("Lead: quero saber da avaliação\nNós: Claro! Qual seu objetivo?");
    expect(msgs[1].content).toContain("- Claro! Qual seu objetivo?");
    expect(msgs[1].content).toContain("2ª mensagem de follow-up");
    expect(msgs[1].content).toContain("lembrar do benefício X");
  });

  it("sem histórico, diz que não houve conversa; contato sem nome não inventa nome", () => {
    const msgs = montarPedidoFollowup({ agente: AGENTE, contato: { phone: "5531900000000", name: "5531900000000" }, historico: [] });
    expect(msgs[1].content).toContain("nenhuma mensagem trocada");
    expect(msgs[0].content).toContain("não invente nome");
  });

  it("transcrição em ordem cronológica mesmo vindo do banco em ordem decrescente", () => {
    expect(transcricao([H("outbound", "b", 2), H("inbound", "a", 1)])).toBe("Lead: a\nNós: b");
  });
});

describe("travas depois do modelo", () => {
  it("texto limpo passa; aspas e marcações de ação somem; variável de nome é preenchida", () => {
    expect(finalizarFollowup('"Oi {primeiro_nome}, conseguiu ver? [TRANSFERIR]"', CONTATO, [])).toEqual({ ok: true, texto: "Oi Ana, conseguiu ver?" });
  });
  it("[SILENCIO], vazio, longo, preço e variável sem valor não saem", () => {
    expect(finalizarFollowup("[SILENCIO]", CONTATO, [])).toMatchObject({ ok: false, motivo: expect.stringMatching(/SILENCIO/) });
    expect(finalizarFollowup("   ", CONTATO, [])).toMatchObject({ ok: false, motivo: expect.stringMatching(/vazia/) });
    expect(finalizarFollowup("a".repeat(700), CONTATO, [])).toMatchObject({ ok: false, motivo: expect.stringMatching(/600/) });
    expect(finalizarFollowup("Hoje sai por R$ 497, topa?", CONTATO, [])).toMatchObject({ ok: false, motivo: expect.stringMatching(/preço/) });
    expect(finalizarFollowup("Te mando o link: [LINK_AGENDAMENTO]", CONTATO, [])).toMatchObject({ ok: false, motivo: expect.stringMatching(/variável/) });
  });
  it("falaPreco pega R$, reais, parcelas e desconto; não pega número qualquer", () => {
    for (const t of ["R$497", "são 300 reais", "em 12x de 49", "parcelado no cartão", "tem desconto hoje"]) expect(falaPreco(t)).toBe(true);
    expect(falaPreco("Consegue às 15h do dia 20?")).toBe(false);
  });
  it("repetida: igual ou quase igual a uma já enviada", () => {
    const enviadas = ["Oi Ana, conseguiu ver a mensagem de ontem?"];
    expect(repeteMensagem("oi ana! conseguiu ver a mensagem de ontem", enviadas)).toBe(enviadas[0]);
    expect(repeteMensagem("Ana, ainda faz sentido conversarmos sobre a avaliação?", enviadas)).toBeNull();
    expect(finalizarFollowup("Oi Ana, conseguiu ver a mensagem de ontem?", CONTATO, enviadas)).toMatchObject({ ok: false, repetida: enviadas[0] });
  });
});
