// Ativação da IA por gatilho (20/10/2026) com classificador FALSO: atalhos, classificador (Haiku mockado), portões
// (grupo, humano atendendo, importada, antiga) e o passo de fluxo "Transferir para agente IA". Nada vai para a rede.
import { describe, expect, it, vi } from "vitest";
import {
  ATALHOS_AVALIACAO,
  type AgenteGatilho,
  camposDoModo,
  casaAtalho,
  type CompletarGatilho,
  type ContextoGatilho,
  decidirAtivacaoPorGatilho,
  decidirTransferenciaFluxo,
  detalheAtivacao,
  horasHumano,
  leadEsperando,
  lerDecisaoGatilho,
  maxMensagensGatilho,
  modoAtivacao,
  montarClassificacaoGatilho,
  patchAtivacao,
  portoesGatilho,
  QUANDO_ATIVAR_AVALIACAO,
} from "../../supabase/functions/_shared/iaGatilho.ts";
import { avaliarGatilhoAoReceber, transferirParaIAPorFluxo } from "../../supabase/functions/_shared/iaGatilhoDb.ts";
import { resumoPasso, validarFluxo, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";
import { no, problemasTransferirIA, simularArvore, validarConstrutor } from "../../supabase/functions/_shared/fluxoConstrutor.ts";
import { payloadAgente, type AgenteIA } from "@/lib/crm/treinarIA";

const NUM = "11111111-1111-1111-1111-111111111111";
const AGORA = new Date(Date.UTC(2026, 9, 20, 15, 0));
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

/** Mensagem que o formulário de avaliação abre no WhatsApp (src/pages/Agendar.tsx). */
const MSG_FORMULARIO = [
  "Olá! Fui qualificada no formulário de avaliação! 🎉",
  "",
  "*Horário Agendado:*",
  "📅 21/10/2026 às 🕒 10:00",
  "",
  "*Nome:* Ana Souza",
  "*Minhas respostas:*",
].join("\n");

const AGENTE: AgenteGatilho = {
  id: "ag1", slug: "avaliacao", nome: "Avaliação fitness", tipo: "atendimento", prompt: "x", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: ["Fui qualificada no formulário de avaliação!"], modelo: null, temperatura: 0.1,
  ativo: false, horario_inicio: "00:00", horario_fim: "23:59", dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15,
  historico_mensagens: 20, atraso_segundos: 0, numero_id: NUM, ativacao_modo: "gatilho", ativacao_quando: QUANDO_ATIVAR_AVALIACAO,
  ativacao_max_mensagens: 3, ativacao_humano_horas: 12,
};

const ctxBase = (o: Partial<ContextoGatilho> = {}): ContextoGatilho => ({
  numero: { id: NUM, robo_ia_ligado: true },
  contato: { phone: "5531988887777", name: "Ana", stage: "leads", numero_id: NUM, ai_agent_slug: null, ai_pausado: false, ai_precisa_humano: false, atendente: null },
  agentes: [AGENTE],
  mensagensLead: [MSG_FORMULARIO],
  mensagemImportada: false,
  mensagemEm: minAtras(0),
  ultimaAcaoHumanaEm: null,
  avaliacoesRecentes: 0,
  agora: AGORA,
  ...o,
});

/** Classificador falso: devolve o texto (ou lança) e guarda o que recebeu. */
function classificador(resposta: string | Error) {
  return vi.fn<CompletarGatilho>(async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  });
}

describe("atalhos determinísticos", () => {
  it("a mensagem do formulário bate com o atalho, mesmo com emoji, asterisco e sem acento", () => {
    expect(casaAtalho(AGENTE.gatilhos, MSG_FORMULARIO)).toBe("Fui qualificada no formulário de avaliação!");
    expect(casaAtalho(["fui qualificada no formulario de avaliacao"], "OLÁ!! *FUI QUALIFICADA* no Formulário de Avaliação 🎉")).toBeTruthy();
    expect(casaAtalho(ATALHOS_AVALIACAO, "oi, fui aprovada na avaliação, e agora?")).toBe("Fui aprovada na avaliação");
  });
  it("oi qualquer, trecho parcial e atalho curto demais não batem", () => {
    expect(casaAtalho(ATALHOS_AVALIACAO, "oi")).toBeNull();
    expect(casaAtalho(ATALHOS_AVALIACAO, "quero saber da avaliação")).toBeNull();
    expect(casaAtalho(["oi"], "oi tudo bem")).toBeNull();
    expect(casaAtalho(["avaliação"], "reavaliação")).toBeNull(); // palavra inteira
    expect(casaAtalho([], MSG_FORMULARIO)).toBeNull();
  });
});

describe("modo de ativação", () => {
  it("gatilho gravado vence; sem coluna, o ativo decide", () => {
    expect(modoAtivacao({ ativo: false, ativacao_modo: "gatilho" })).toBe("gatilho");
    expect(modoAtivacao({ ativo: true })).toBe("todas");
    expect(modoAtivacao({ ativo: false })).toBe("transferidas");
    expect(modoAtivacao({ ativo: false, ativacao_modo: "todas" })).toBe("transferidas");
    expect(camposDoModo("gatilho")).toEqual({ ativacao_modo: "gatilho", ativo: false });
    expect(camposDoModo("todas")).toEqual({ ativacao_modo: "todas", ativo: true });
  });
  it("faixas: mensagens 1..10 (padrão 3), horas 1..168 (padrão 12)", () => {
    expect(maxMensagensGatilho({})).toBe(3);
    expect(maxMensagensGatilho({ ativacao_max_mensagens: 99 })).toBe(10);
    expect(horasHumano({})).toBe(12);
    expect(horasHumano({ ativacao_humano_horas: 0 })).toBe(1);
  });
  it("a tela grava modo, ativo acompanhando e as faixas (só com as colunas novas)", () => {
    const p = payloadAgente({ ...AGENTE, ativo: true, ativacao_modo: "gatilho", ativacao_max_mensagens: 50, ativacao_quando: "  " } as AgenteIA);
    expect(p).toMatchObject({ ativacao_modo: "gatilho", ativo: false, ativacao_max_mensagens: 10, ativacao_humano_horas: 12, ativacao_quando: null });
    const { ativacao_modo: _m, ativacao_quando: _q, ativacao_max_mensagens: _x, ativacao_humano_horas: _h, ...antigo } = AGENTE;
    const p2 = payloadAgente({ ...antigo, ativo: true } as AgenteIA);
    expect("ativacao_modo" in p2).toBe(false);
    expect(p2.ativo).toBe(true);
  });
});

describe("classificador (Haiku falso)", () => {
  it("atalho bateu: ativa SEM chamar o classificador", async () => {
    const ia = classificador('{"ativar": false}');
    const d = await decidirAtivacaoPorGatilho(ctxBase(), ia);
    expect(d).toMatchObject({ ativar: true, por: "atalho" });
    expect(ia).not.toHaveBeenCalled();
    expect(detalheAtivacao((d as { motivo: string }).motivo)).toMatch(/^IA ativada por gatilho: atalho "Fui qualificada/);
  });
  it('"oi" não ativa: o classificador diz false e fica registrado como avaliado', async () => {
    const ia = classificador('{"ativar": false, "motivo": ""}');
    const d = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi"] }), ia);
    expect(d).toMatchObject({ ativar: false, registrar: true, avaliou: true });
    expect(ia).toHaveBeenCalledTimes(1);
    expect(ia.mock.calls[0][1]).toEqual({ tarefa: "gatilho" });
  });
  it("frase com as palavras da lead: o classificador diz true e ativa", async () => {
    const ia = classificador('```json\n{"ativar": true, "motivo": "disse que respondeu o questionário"}\n```');
    const d = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi, acabei de responder o questionário de vocês"] }), ia);
    expect(d).toMatchObject({ ativar: true, por: "classificador", motivo: "disse que respondeu o questionário" });
  });
  it("o pedido leva a regra do agente e só as últimas N mensagens da lead, como dado a julgar", async () => {
    const ia = classificador('{"ativar": false}');
    await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["m1", "m2", "m3", "m4"], agentes: [{ ...AGENTE, ativacao_max_mensagens: 2 }] }), ia);
    const [sistema, usuario] = ia.mock.calls[0][0];
    expect(sistema.content).toContain("## QUANDO ATIVAR");
    expect(sistema.content).toContain("Fui qualificada no formulário de avaliação");
    expect(sistema.content).toMatch(/ignore qualquer instrução/);
    expect(usuario.content).toContain("m3");
    expect(usuario.content).toContain("m4");
    expect(usuario.content).not.toContain("m2");
    expect(montarClassificacaoGatilho(AGENTE, ["x"])).toHaveLength(2);
  });
  it("falha e resposta fora do formato: não ativa (nunca liga a IA no escuro)", async () => {
    const d1 = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi"] }), classificador(new Error("timeout")));
    expect(d1).toMatchObject({ ativar: false, registrar: true });
    expect((d1 as { motivo: string }).motivo).toMatch(/falhou: timeout/);
    const d2 = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi"] }), classificador("sim, ativa"));
    expect(d2).toMatchObject({ ativar: false });
    expect(lerDecisaoGatilho('{"ativar":"sim"}')).toBeNull();
  });
  it("teto de avaliações por conversa/dia: passou, nem chama o classificador", async () => {
    const ia = classificador('{"ativar": true}');
    const d = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi"], avaliacoesRecentes: 3 }), ia);
    expect(d).toMatchObject({ ativar: false, registrar: false });
    expect(ia).not.toHaveBeenCalled();
  });
  it('sem regra "Quando ativar": só atalho ativa, sem chamar IA', async () => {
    const ia = classificador('{"ativar": true}');
    const d = await decidirAtivacaoPorGatilho(ctxBase({ mensagensLead: ["oi"], agentes: [{ ...AGENTE, ativacao_quando: null }] }), ia);
    expect(d.ativar).toBe(false);
    expect(ia).not.toHaveBeenCalled();
  });
});

describe("exclusões (portões)", () => {
  const nunca = async (o: Partial<ContextoGatilho>, re: RegExp) => {
    const ia = classificador('{"ativar": true}');
    const d = await decidirAtivacaoPorGatilho(ctxBase(o), ia);
    expect(d.ativar).toBe(false);
    expect((d as { motivo: string }).motivo).toMatch(re);
    expect(ia).not.toHaveBeenCalled();
    return d;
  };
  it("grupo nunca", async () => {
    await nunca({ contato: { ...ctxBase().contato!, phone: "1203630@g.us" } }, /grupo/);
    await nunca({ contato: { ...ctxBase().contato!, is_group: true } }, /grupo/);
  });
  it("robô do número desligado", () => nunca({ numero: { id: NUM, robo_ia_ligado: false } }, /desligado/));
  it("humano atendendo: dono atribuído, esperando humano, mensagem manual nas últimas 12 h", async () => {
    const d = await nunca({ contato: { ...ctxBase().contato!, atendente: "Gabi" } }, /dono atribuído \(Gabi\)/);
    expect(d).toMatchObject({ registrar: true }); // o atalho bateu: explica no histórico por que não entrou
    await nunca({ contato: { ...ctxBase().contato!, ai_precisa_humano: true } }, /esperando humano/);
    await nunca({ ultimaAcaoHumanaEm: minAtras(11 * 60) }, /últimas 12 h/);
  });
  it("mensagem manual há mais tempo que a janela não barra; janela configurável", async () => {
    expect((await decidirAtivacaoPorGatilho(ctxBase({ ultimaAcaoHumanaEm: minAtras(13 * 60) }), classificador("{}"))).ativar).toBe(true);
    await nunca({ ultimaAcaoHumanaEm: minAtras(13 * 60), agentes: [{ ...AGENTE, ativacao_humano_horas: 24 }] }, /últimas 24 h/);
  });
  it("conversa importada ou mensagem antiga (não chegou agora pelo webhook)", async () => {
    await nunca({ mensagemImportada: true }, /importada/);
    await nunca({ mensagemEm: minAtras(60) }, /antiga/);
    await nunca({ mensagemEm: null }, /antiga/);
  });
  it("IA já atendendo, agente em outro modo, outro número ou fora da etapa", async () => {
    await nunca({ contato: { ...ctxBase().contato!, ai_agent_slug: "avaliacao", ai_pausado: false } }, /já atende/);
    await nunca({ agentes: [{ ...AGENTE, ativacao_modo: "transferidas" }] }, /nenhum agente/);
    await nunca({ agentes: [{ ...AGENTE, numero_id: "outro" }] }, /nenhum agente/);
    await nunca({ agentes: [{ ...AGENTE, etapas: ["agendado"] }] }, /nenhum agente/);
    await nunca({ agentes: [{ ...AGENTE, tipo: "followup" }] }, /nenhum agente/);
  });
  it("IA pausada (por humano ou por fluxo, há quanto tempo for): o gatilho NUNCA reassume", async () => {
    for (const motivo of ["pausado por fluxo", "humano assumiu", null]) {
      const contato = { ...ctxBase().contato!, ai_agent_slug: "avaliacao", ai_pausado: true, ai_pausado_motivo: motivo };
      const g = portoesGatilho(ctxBase({ contato, ultimaAcaoHumanaEm: minAtras(20 * 60) }));
      expect(g).toMatchObject({ ok: false, motivo: expect.stringMatching(/pausada/) });
      await nunca({ contato, mensagensLead: [MSG_FORMULARIO] }, /pausada/);
    }
    // sem agente mas com marca de pausa (pausada e depois sem agente): também não
    const semAgente = { ...ctxBase().contato!, ai_agent_slug: null, ai_pausado: false, ai_pausado_motivo: "pausado por fluxo" };
    expect(portoesGatilho(ctxBase({ contato: semAgente }))).toMatchObject({ ok: false });
  });
});

// ------------------------------------------------------------------ banco falso (cadeia do supabase-js)

type Op = { tabela: string; acao: string; filtros: string[]; valores?: unknown };
function bancoFalso(resolver: (op: Op) => { data?: unknown; error?: { message: string } | null; count?: number }) {
  const ops: Op[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const consulta = (tabela: string) => {
    const op: Op = { tabela, acao: "select", filtros: [] };
    const q: Record<string, unknown> = {};
    const encadeia = (nome: string) => (...a: unknown[]) => { op.filtros.push(`${nome}:${a.map((x) => JSON.stringify(x)).join(",")}`); return q; };
    for (const m of ["eq", "in", "gte", "order", "limit", "is", "or", "not", "select"]) q[m] = encadeia(m);
    for (const m of ["update", "insert", "upsert"]) q[m] = (v: unknown) => { op.acao = m; op.valores = v; return q; };
    const fim = () => { ops.push(op); return Promise.resolve({ data: null, error: null, ...resolver(op) }); };
    q.maybeSingle = fim;
    q.single = fim;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => fim().then(ok, ko);
    return q;
  };
  const db = {
    from: consulta,
    rpc: (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return Promise.resolve({ data: 1, error: null }); },
  };
  return { db, ops, rpcs };
}

describe("webhook: avaliarGatilhoAoReceber com banco falso", () => {
  const contato = ctxBase().contato!;
  const montar = (msgs: { body: string; created_at: string; importada?: boolean }[], o: { humano?: string; jaAtivou?: boolean } = {}) =>
    bancoFalso((op) => {
      if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes('"inbound"'))) return { data: [...msgs].reverse() };
      if (op.tabela === "whatsapp_messages") return { data: o.humano ? [{ created_at: o.humano }] : [] };
      if (op.tabela === "crm_ai_eventos" && op.acao === "select") return { data: [], count: 0 };
      if (op.tabela === "whatsapp_contacts" && op.acao === "update") return { data: o.jaAtivou ? [] : [{ phone: contato.phone }] };
      return {};
    });

  it("mensagem do formulário: ativa, grava 'IA ativada por gatilho' e enfileira com o tempo do agente", async () => {
    const { db, ops, rpcs } = montar([{ body: MSG_FORMULARIO, created_at: new Date().toISOString() }]);
    const ia = classificador('{"ativar": false}');
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: contato.phone, completar: ia });
    expect(r).toBe("ativado por atalho");
    expect(ia).not.toHaveBeenCalled();
    const up = ops.find((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")!;
    expect(up.valores).toMatchObject({ ai_agent_slug: "avaliacao", ai_pausado: false, ai_precisa_humano: false });
    const filtros = up.filtros.join(" ");
    // só ativa se ninguém ativou antes E a conversa não está pausada (nada de ai_pausado.eq.true no update)
    expect(filtros).toContain('is:"ai_agent_slug",null');
    expect(filtros).toContain('or:"ai_pausado.is.null,ai_pausado.eq.false"');
    expect(filtros).toContain('is:"ai_pausado_motivo",null');
    expect(filtros).not.toMatch(/ai_pausado\.eq\.true/);
    expect(up.valores).toMatchObject({ ai_respostas: 0, ai_falhas: 0 }); // conversa que nunca teve IA: zera
    const ev = ops.find((o) => o.tabela === "crm_ai_eventos" && o.acao === "insert")!;
    expect(ev.valores).toMatchObject({ tipo: "ativado_gatilho", agent_slug: "avaliacao" });
    expect(String((ev.valores as { detalhe: string }).detalhe)).toMatch(/^IA ativada por gatilho: atalho/);
    expect(rpcs[0]).toMatchObject({ fn: "crm_ai_enfileirar", args: { p_agent_slug: "avaliacao", p_phone: contato.phone } });
  });
  it('"oi": não ativa, não enfileira, registra a avaliação do classificador', async () => {
    const { db, ops, rpcs } = montar([{ body: "oi", created_at: new Date().toISOString() }]);
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: contato.phone, completar: classificador('{"ativar": false}') });
    expect(r).toMatch(/não bateu/);
    expect(rpcs).toHaveLength(0);
    expect(ops.some((o) => o.tabela === "whatsapp_contacts" && o.acao === "update")).toBe(false);
    expect(ops.find((o) => o.acao === "insert")?.valores).toMatchObject({ tipo: "gatilho_avaliado" });
  });
  it("conversa importada (última mensagem veio do histórico): não ativa", async () => {
    const { db, rpcs } = montar([{ body: MSG_FORMULARIO, created_at: new Date().toISOString(), importada: true }]);
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: contato.phone, completar: classificador("{}") });
    expect(r).toMatch(/importada/);
    expect(rpcs).toHaveLength(0);
  });
  it("equipe escreveu há 2 h: não ativa", async () => {
    const { db, rpcs } = montar([{ body: MSG_FORMULARIO, created_at: new Date().toISOString() }], { humano: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: contato.phone, completar: classificador("{}") });
    expect(r).toMatch(/humano atuou/);
    expect(rpcs).toHaveLength(0);
  });
  it("duas mensagens ao mesmo tempo: a segunda não ativa de novo", async () => {
    const { db, ops, rpcs } = montar([{ body: MSG_FORMULARIO, created_at: new Date().toISOString() }], { jaAtivou: true });
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [AGENTE], telefone: contato.phone, completar: classificador("{}") });
    expect(r).toBe("outra mensagem já ativou a IA");
    expect(rpcs).toHaveLength(0);
    expect(ops.some((o) => o.acao === "insert")).toBe(false);
  });
  it("número sem agente no modo gatilho: nenhuma consulta a mais", async () => {
    const { db, ops } = montar([]);
    const r = await avaliarGatilhoAoReceber(db, { numero: { id: NUM, robo_ia_ligado: true }, contato, agentes: [{ ...AGENTE, ativacao_modo: "transferidas" }], telefone: contato.phone, completar: classificador("{}") });
    expect(r).toBe("sem agente no modo gatilho");
    expect(ops).toHaveLength(0);
  });
});

describe("passo de fluxo: Transferir para agente IA", () => {
  const fluxo = (passos: Fluxo["passos"]): Partial<Fluxo> => ({ nome: "Avaliação", gatilho_tipo: "evento", gatilho_valor: "x", passos });

  it("valida, resume e aparece no teste do fluxo", () => {
    expect(validarFluxo(fluxo([{ tipo: "transferir_ia", agente: "" }]))).toContain("Passo 1: escolha o agente de IA que assume a conversa.");
    expect(validarFluxo(fluxo([{ tipo: "transferir_ia", agente: "avaliacao" }]))).toEqual([]);
    expect(resumoPasso({ tipo: "transferir_ia", agente: "avaliacao" })).toBe("Transferir para agente IA avaliacao");
    const caminho = simularArvore([no({ tipo: "transferir_ia", agente: "avaliacao" }, "n1")], { etapa: "leads", tags: [], respondeu: false });
    expect(caminho[0].texto).toBe("Transferir para agente IA (avaliacao)");
  });
  it("construtor: agente inexistente, de follow-up ou sem número vira erro do passo", () => {
    const agentes = [
      { slug: "avaliacao", nome: "Avaliação", tipo: "atendimento", numero_id: NUM },
      { slug: "fu", nome: "Follow-up", tipo: "followup", numero_id: null },
      { slug: "sem", nome: "Sem número", tipo: "atendimento", numero_id: null },
    ];
    expect(problemasTransferirIA({ tipo: "transferir_ia", agente: "avaliacao" }, agentes)).toEqual([]);
    expect(problemasTransferirIA({ tipo: "transferir_ia", agente: "sumiu" }, agentes)[0]).toMatch(/não existe/);
    expect(problemasTransferirIA({ tipo: "transferir_ia", agente: "fu" }, agentes)[0]).toMatch(/follow-up/);
    expect(problemasTransferirIA({ tipo: "transferir_ia", agente: "sem" }, agentes)[0]).toMatch(/não tem número/);
    const erros = validarConstrutor({ ...fluxo([]), arvore: [no({ tipo: "transferir_ia", agente: "fu" })] }, { numeros: [], agentes });
    expect(erros.some((e) => /Transferir para agente IA/.test(e))).toBe(true);
  });
  it("portões do passo: grupo nunca, humano atendendo barra (salvo 'mesmo com humano'), conversa nova passa", () => {
    const base = { agente: AGENTE, phone: "5531988887777", contato: null, ultimaAcaoHumanaEm: null, agora: AGORA };
    expect(decidirTransferenciaFluxo(base)).toEqual({ ok: true });
    expect(decidirTransferenciaFluxo({ ...base, phone: "123@g.us" })).toMatchObject({ ok: false, motivo: expect.stringMatching(/grupo/) });
    const comHumano = { ...base, contato: { phone: base.phone, ai_agent_slug: null, ai_pausado: false, atendente: "Gabi" } };
    expect(decidirTransferenciaFluxo(comHumano)).toMatchObject({ ok: false, motivo: expect.stringMatching(/Gabi/) });
    expect(decidirTransferenciaFluxo({ ...comHumano, mesmoComHumano: true })).toEqual({ ok: true });
    expect(decidirTransferenciaFluxo({ ...base, contato: { phone: base.phone }, ultimaAcaoHumanaEm: minAtras(30) })).toMatchObject({ ok: false });
    expect(decidirTransferenciaFluxo({ ...base, agente: { ...AGENTE, tipo: "followup" } })).toMatchObject({ ok: false });
    expect(decidirTransferenciaFluxo({ ...base, agente: { ...AGENTE, numero_id: null } })).toMatchObject({ ok: false });
    expect(decidirTransferenciaFluxo({ ...base, agente: null })).toMatchObject({ ok: false });
  });
  it("lead esperando (última mensagem dela, nova e não importada) = já enfileira", () => {
    expect(leadEsperando({ direction: "inbound", created_at: minAtras(5) }, AGORA)).toBe(true);
    expect(leadEsperando({ direction: "inbound", created_at: minAtras(5), importada: true }, AGORA)).toBe(false);
    expect(leadEsperando({ direction: "outbound", created_at: minAtras(5) }, AGORA)).toBe(false);
    expect(leadEsperando({ direction: "inbound", created_at: minAtras(90) }, AGORA)).toBe(false);
    expect(leadEsperando(null, AGORA)).toBe(false);
    expect(patchAtivacao("avaliacao", AGORA)).toMatchObject({ ai_agent_slug: "avaliacao", ai_pausado: false, ai_respostas: 0 });
    // conversa que já teve IA: não devolve o teto gasto de respostas/falhas
    const ja = patchAtivacao("avaliacao", AGORA, { ai_agent_slug: "outro", ai_atribuido_em: minAtras(60) });
    expect(ja).toMatchObject({ ai_agent_slug: "avaliacao", ai_pausado: false });
    expect(ja).not.toHaveProperty("ai_respostas");
    expect(ja).not.toHaveProperty("ai_falhas");
    expect(patchAtivacao("avaliacao", AGORA, { ai_agent_slug: null, ai_atribuido_em: minAtras(60) })).not.toHaveProperty("ai_respostas");
  });
  it("motor (banco falso): cria a conversa no número do agente, ativa, registra e enfileira se a lead espera", async () => {
    const { db, ops, rpcs } = bancoFalso((op) => {
      if (op.tabela === "crm_ai_agents") return { data: AGENTE };
      if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: null };
      if (op.tabela === "whatsapp_messages" && op.filtros.some((f) => f.includes("sender_type"))) return { data: [] };
      if (op.tabela === "whatsapp_messages") return { data: [{ direction: "inbound", created_at: new Date().toISOString(), importada: false }] };
      if (op.tabela === "crm_numeros") return { data: { robo_ia_ligado: true } };
      return {};
    });
    const r = await transferirParaIAPorFluxo(db, { phone: "5531988887777", nome: "Ana", agenteSlug: "avaliacao", motivo: "fluxo Avaliação, passo 2" });
    expect(r.ok).toBe(true);
    expect(r.detalhe).toMatch(/resposta da IA na fila/);
    expect(ops.find((o) => o.acao === "upsert")?.valores).toMatchObject({ phone: "5531988887777", numero_id: NUM });
    expect(ops.find((o) => o.tabela === "crm_ai_eventos")?.valores).toMatchObject({ tipo: "ativado_gatilho", detalhe: "IA ativada por gatilho: fluxo Avaliação, passo 2" });
    expect(rpcs[0]?.fn).toBe("crm_ai_enfileirar");
  });
  it("motor (banco falso): conversa com atendente não transfere e nada muda", async () => {
    const { db, ops, rpcs } = bancoFalso((op) => {
      if (op.tabela === "crm_ai_agents") return { data: AGENTE };
      if (op.tabela === "whatsapp_contacts" && op.acao === "select") return { data: { phone: "5531988887777", atendente: "Gabi", ai_agent_slug: null, ai_pausado: false } };
      return { data: [] };
    });
    const r = await transferirParaIAPorFluxo(db, { phone: "5531988887777", agenteSlug: "avaliacao", motivo: "fluxo X, passo 1" });
    expect(r).toMatchObject({ ok: false });
    expect(r.detalhe).toMatch(/Gabi/);
    expect(ops.some((o) => o.acao !== "select")).toBe(false);
    expect(rpcs).toHaveLength(0);
  });
});
