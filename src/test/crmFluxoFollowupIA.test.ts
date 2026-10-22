// Passo "Mensagem da IA (follow-up)" no construtor e o modelo pronto "Follow-up IA" (18/10/2026): validação,
// número oficial barrado, compilação da árvore, cadência e o motor (decidir) andando o modelo inteiro.
import { describe, expect, it } from "vitest";
import {
  CADENCIA_PADRAO,
  compilarArvore,
  descompilarPassos,
  diasDasTentativas,
  errosPorNo,
  modeloFollowupIA,
  no,
  passoEnvia,
  problemasIAFollowup,
  registroParaSalvar,
  simularArvore,
  validarCadencia,
  validarConstrutor,
  type AgenteInfo,
  type NumeroInfo,
} from "../../supabase/functions/_shared/fluxoConstrutor.ts";
import { decidir, resumoPasso, validarFluxo, type ExecucaoFluxo, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";
import { lerCadencia, textoDias } from "@/components/crm/fluxos/ModeloFollowupIA";

const NUMEROS: NumeroInfo[] = [
  { id: "ofi", tipo: "oficial", apelido: "Oficial" },
  { id: "com", tipo: "openwa", apelido: "Comercial" },
  { id: "off", tipo: "openwa", apelido: "Velho", ativo: false },
];
const AGENTES: AgenteInfo[] = [
  { id: "fu1", slug: "fu", nome: "Follow-up", tipo: "followup" },
  { id: "at1", slug: "avaliacao", nome: "Avaliação", tipo: "atendimento" },
];
const DIA = 86_400_000;

describe("passo Mensagem da IA", () => {
  it("validarFluxo exige o agente; instrução até 500", () => {
    const base = { nome: "F", gatilho_tipo: "evento" as const, gatilho_valor: "x" };
    expect(validarFluxo({ ...base, passos: [{ tipo: "ia_followup", agente_id: "" }] })).toEqual(["Passo 1: escolha o agente de follow-up."]);
    expect(validarFluxo({ ...base, passos: [{ tipo: "ia_followup", agente_id: "fu1", instrucao: "x".repeat(501) }] })[0]).toMatch(/500/);
    expect(validarFluxo({ ...base, passos: [{ tipo: "ia_followup", agente_id: "fu1", instrucao: "2ª: benefício" }] })).toEqual([]);
  });

  it("número oficial (do passo ou do fluxo) é barrado; desativado e agente errado também", () => {
    const p = { tipo: "ia_followup" as const, agente_id: "fu1" };
    expect(problemasIAFollowup(p, "com", NUMEROS, AGENTES)).toEqual([]);
    expect(problemasIAFollowup(p, "ofi", NUMEROS, AGENTES)[0]).toMatch(/só por número não oficial/);
    expect(problemasIAFollowup({ ...p, numero_id: "ofi" }, "com", NUMEROS)[0]).toMatch(/não oficial/);
    expect(problemasIAFollowup({ ...p, numero_id: "off" }, null, NUMEROS)[0]).toMatch(/desativado/);
    expect(problemasIAFollowup({ ...p, agente_id: "at1" }, "com", NUMEROS, AGENTES)).toEqual(["o agente Avaliação não é de follow-up."]);
    expect(problemasIAFollowup({ ...p, agente_id: "x" }, "com", NUMEROS, AGENTES)[0]).toMatch(/não existe/);
  });

  it("validarConstrutor e errosPorNo pintam o passo com número oficial", () => {
    const arvore = [no({ tipo: "ia_followup", agente_id: "fu1" }, "n1")];
    const f = { nome: "F", gatilhos: [{ tipo: "tag" as const, valor: "x" }], numero_id: "ofi", arvore };
    expect(validarConstrutor(f, { numeros: NUMEROS, agentes: AGENTES }).join(" ")).toMatch(/Mensagem da IA \(passo 1\): número oficial/);
    expect(errosPorNo(arvore, "ofi", NUMEROS, [], AGENTES).n1[0]).toMatch(/número oficial/);
    expect(validarConstrutor({ ...f, numero_id: "com" }, { numeros: NUMEROS, agentes: AGENTES })).toEqual([]);
  });

  it("compila e descompila sem perder o passo; conta como envio (janela de horário); resumo legível", () => {
    const p = { tipo: "ia_followup" as const, agente_id: "fu1", instrucao: "x", tentativa: 2, numero_id: "com" };
    const passos = compilarArvore([no(p)]);
    expect(passos).toEqual([p]);
    expect(descompilarPassos(passos)[0].passo).toEqual(p);
    expect(passoEnvia(p)).toBe(true);
    expect(resumoPasso(p)).toBe("Mensagem da IA (follow-up), 2ª tentativa");
  });
});

describe("cadência", () => {
  it("padrão 1, 2, 4, 7 → 5 mensagens: no gatilho, D+1, D+3, D+7, D+14", () => {
    expect(CADENCIA_PADRAO).toEqual([1, 2, 4, 7]);
    expect(diasDasTentativas(CADENCIA_PADRAO)).toEqual([0, 1, 3, 7, 14]);
    expect(textoDias(CADENCIA_PADRAO)).toBe("no gatilho, D+1, D+3, D+7, D+14");
  });
  it("lê o texto da tela e valida (1 a 7 esperas, 1 a 30 dias, inteiros)", () => {
    expect(lerCadencia("1, 2 ;3")).toEqual([1, 2, 3]);
    expect(validarCadencia([1, 2])).toEqual([]);
    expect(validarCadencia([])).toHaveLength(1);
    expect(validarCadencia([0])[0]).toMatch(/1 a 30/);
    expect(validarCadencia(lerCadencia("1, x"))[0]).toMatch(/1 a 30/);
    expect(validarCadencia([1, 1, 1, 1, 1, 1, 1, 1])[0]).toMatch(/no máximo 8/);
  });
});

describe("modelo pronto Follow-up IA", () => {
  const m = modeloFollowupIA({ agenteId: "fu1", numeroId: "com", instrucoes: ["a", "b"] });

  it("nasce rascunho, com parar se responder, janela 8-20 h, número escolhido e gatilho padrão sem resposta 24 h", () => {
    expect(m).toMatchObject({ ativo: false, parar_se_responder: true, permitir_repetir: false, numero_id: "com", nome: "Follow-up IA" });
    expect(m.config).toEqual({ hora_inicio: 8, hora_fim: 20, limite_dia: 100 });
    expect(m.gatilhos).toEqual([{ tipo: "sem_resposta", horas: 24 }]);
  });

  it("árvore: IA → (Esperar → Respondeu? sim: Parar → IA) × 4, tentativas 1..5 e instruções na ordem", () => {
    expect(m.arvore.map((n) => n.passo.tipo)).toEqual([
      "ia_followup", "esperar", "se", "ia_followup", "esperar", "se", "ia_followup", "esperar", "se", "ia_followup", "esperar", "se", "ia_followup",
    ]);
    const ias = m.arvore.filter((n) => n.passo.tipo === "ia_followup").map((n) => n.passo as { tentativa: number; instrucao: string | null; agente_id: string });
    expect(ias.map((x) => x.tentativa)).toEqual([1, 2, 3, 4, 5]);
    expect(ias.map((x) => x.instrucao)).toEqual(["a", "b", null, null, null]);
    expect(new Set(ias.map((x) => x.agente_id))).toEqual(new Set(["fu1"]));
    const esperas = m.arvore.filter((n) => n.passo.tipo === "esperar").map((n) => (n.passo as { quantidade: number; unidade: string }));
    expect(esperas).toEqual(CADENCIA_PADRAO.map((q) => ({ tipo: "esperar", quantidade: q, unidade: "dias" })));
    const se = m.arvore[2].passo as { condicao: unknown; sim: { passo: { tipo: string } }[]; nao: unknown[] };
    expect(se.condicao).toEqual({ tipo: "respondeu" });
    expect(se.sim.map((n) => n.passo.tipo)).toEqual(["parar"]);
    expect(se.nao).toEqual([]);
  });

  it("gatilho, cadência e nome editáveis; cadência inválida é recusada", () => {
    const e = modeloFollowupIA({ agenteId: "fu1", gatilho: { tipo: "etapa", valor: "contato" }, cadencia: [2, 3], nome: "Reativar" });
    expect(e.gatilhos).toEqual([{ tipo: "etapa", valor: "contato" }]);
    expect(e.arvore.filter((n) => n.passo.tipo === "ia_followup")).toHaveLength(3);
    expect(e.nome).toBe("Reativar");
    expect(() => modeloFollowupIA({ agenteId: "fu1", cadencia: [0] })).toThrow(/Cadência/);
  });

  it("o registro salvo passa na validação do construtor e do motor (pronto para publicar)", () => {
    const reg = registroParaSalvar(m);
    expect(reg).toMatchObject({ gatilho_tipo: "sem_resposta", gatilho_valor: "24", parar_se_responder: true, numero_id: "com" });
    expect(validarConstrutor(m, { numeros: NUMEROS, agentes: AGENTES })).toEqual([]);
    expect(validarFluxo({ ...m, passos: reg.passos as Fluxo["passos"] })).toEqual([]);
  });

  it("Testar fluxo: sem resposta passa pelas 5 mensagens; respondendo, para no primeiro Se", () => {
    const sem = simularArvore(m.arvore, { respondeu: false, tags: [], etapa: "contato" }).map((c) => c.texto);
    expect(sem.filter((t) => t.startsWith("Mensagem da IA"))).toEqual(["Mensagem da IA (1ª)", "Mensagem da IA (2ª)", "Mensagem da IA (3ª)", "Mensagem da IA (4ª)", "Mensagem da IA (5ª)"]);
    const com = simularArvore(m.arvore, { respondeu: true, tags: [], etapa: "contato" }).map((c) => c.texto);
    expect(com).toEqual(["Mensagem da IA (1ª)", "esperar", "Se: SIM", "Parar"]);
  });
});

describe("motor (decidir) andando o modelo", () => {
  const passos = compilarArvore(modeloFollowupIA({ agenteId: "fu1", numeroId: "com" }).arvore);
  const fluxo: Fluxo = {
    id: "f", nome: "Follow-up IA", ativo: true, gatilho_tipo: "sem_resposta", gatilho_valor: "24", parar_se_responder: true,
    permitir_repetir: false, passos, ligado_em: null,
  };
  const exec0: ExecucaoFluxo = {
    id: 1, fluxo_id: "f", contact_phone: "5531988887777", passo_idx: 0, status: "ativo", proximo_em: "", aguardando_resposta: false,
    iniciado_em: "2026-10-17T12:00:00Z", ultimo_envio_em: null, dados: {},
  };

  /** Anda a execução como o crm-automacoes: ação → próximo; espera → avança o relógio. Devolve a linha do tempo. */
  function andar(respondeuNoDia: number | null) {
    let agora = new Date("2026-10-17T12:00:00Z");
    let ex = { ...exec0 };
    const linha: string[] = [];
    for (let i = 0; i < 60; i++) {
      const dia = Math.round((agora.getTime() - new Date(exec0.iniciado_em).getTime()) / DIA);
      const respondeu = respondeuNoDia !== null && dia >= respondeuNoDia;
      const d = decidir(fluxo, ex, { contato: { phone: ex.contact_phone }, respondeuDesde: () => respondeu }, agora);
      if (d.fazer === "parar") { linha.push(`D+${dia} parar: ${d.motivo}`); break; }
      if (d.fazer === "esperar") { agora = d.ate; ex = { ...ex, passo_idx: d.proximo_idx }; continue; }
      if (d.passo.tipo === "ia_followup") linha.push(`D+${dia} IA ${d.passo.tentativa}ª`);
      ex = { ...ex, passo_idx: d.proximo_idx ?? passos.length, ultimo_envio_em: agora.toISOString() };
    }
    return linha;
  }

  it("ninguém responde: 5 mensagens da IA em D+0, D+1, D+3, D+7, D+14 e fim", () => {
    expect(andar(null)).toEqual(["D+0 IA 1ª", "D+1 IA 2ª", "D+3 IA 3ª", "D+7 IA 4ª", "D+14 IA 5ª", "D+14 parar: fim do fluxo"]);
  });

  it("a lead responde no D+2: para (parar se responder) antes da 3ª", () => {
    expect(andar(2)).toEqual(["D+0 IA 1ª", "D+1 IA 2ª", "D+3 parar: a lead respondeu (parar se responder)"]);
  });
});
