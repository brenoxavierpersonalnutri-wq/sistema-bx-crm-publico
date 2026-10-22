import { describe, expect, it } from "vitest";
import {
  MARCA_BASE,
  alvosSemResposta,
  arvoreDoFluxo,
  compilarArvore,
  descompilarPassos,
  filtrarLista,
  inicioDiaBRT,
  inscricoesPorSegmento,
  inserirNo,
  no,
  problemasWhatsApp,
  proximaJanela,
  registroParaSalvar,
  removerNo,
  simularArvore,
  validarConstrutor,
  vagasHoje,
  type NoFluxo,
  type NumeroInfo,
} from "../../supabase/functions/_shared/fluxoConstrutor.ts";
import { decidir, validarFluxo, type ExecucaoFluxo, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";

const AGORA = new Date("2026-10-17T18:00:00Z"); // 15h em Brasília
const NUMEROS: NumeroInfo[] = [
  { id: "ofi", tipo: "oficial", apelido: "Oficial" },
  { id: "closer", tipo: "openwa", apelido: "Closer" },
];
const TEMPLATES = [{ nome: "qualificadoavaliacao", status: "APPROVED", corpo: "Olá, {{1}}!" }];

const tag = (t: string, id?: string) => no({ tipo: "tag", acao: "por", tag: t }, id);
const se = (sim: NoFluxo[], nao: NoFluxo[], id = "se1"): NoFluxo =>
  no({ tipo: "se", condicao: { tipo: "respondeu" }, sim, nao }, id);

const exec = (p: Partial<ExecucaoFluxo> = {}): ExecucaoFluxo => ({
  id: 1, fluxo_id: "f1", contact_phone: "5531999990000", passo_idx: 0, status: "ativo",
  proximo_em: AGORA.toISOString(), aguardando_resposta: false, iniciado_em: "2026-10-17T10:00:00Z",
  ultimo_envio_em: null, dados: {}, ...p,
});
const fluxo = (passos: Fluxo["passos"]): Fluxo => ({
  id: "f1", nome: "F", ativo: true, gatilho_tipo: "evento", gatilho_valor: "x", parar_se_responder: false,
  permitir_repetir: false, passos, ligado_em: null,
});

/** Anda o motor (decidir) até parar/esperar, aplicando as ações; devolve as tags postas. */
function rodar(passos: Fluxo["passos"], respondeu: boolean): string[] {
  const f = fluxo(passos);
  let e = exec();
  const tags: string[] = [];
  for (let i = 0; i < 50; i++) {
    const d = decidir(f, e, { contato: { phone: e.contact_phone, tags }, respondeuDesde: () => respondeu }, AGORA);
    if (d.fazer !== "acao") break;
    if (d.passo.tipo === "tag") tags.push(d.passo.tag);
    e = { ...e, passo_idx: d.proximo_idx ?? f.passos.length };
  }
  return tags;
}

describe("Se/Senão: compilar a árvore para a lista do motor", () => {
  const arvore = [tag("antes"), se([tag("sim-1"), tag("sim-2")], [tag("nao-1")]), tag("depois")];

  it("gera condição + salto e o motor segue o ramo certo", () => {
    const passos = compilarArvore(arvore);
    expect(passos.map((p) => p.tipo)).toEqual(["tag", "condicao", "tag", "tag", "ir_para", "tag", "tag"]);
    expect(validarFluxo({ ...fluxo(passos) })).toEqual([]);
    expect(rodar(passos, true)).toEqual(["antes", "sim-1", "sim-2", "depois"]);
    expect(rodar(passos, false)).toEqual(["antes", "nao-1", "depois"]);
  });

  it("Se/Senão no fim do fluxo: salto além do último vira parar", () => {
    const passos = compilarArvore([se([tag("s")], [])]);
    expect(passos).toEqual([
      { tipo: "condicao", condicao: { tipo: "respondeu" }, se_sim: "continuar", se_nao: "parar" },
      { tipo: "tag", acao: "por", tag: "s" },
      { tipo: "parar" },
    ]);
    expect(validarFluxo(fluxo(passos))).toEqual([]);
    expect(rodar(passos, true)).toEqual(["s"]);
    expect(rodar(passos, false)).toEqual([]);
  });

  it("Se aninhado e ramos vazios", () => {
    const interno = se([tag("a")], [tag("b")], "se2");
    const passos = compilarArvore([se([interno], [tag("c")]), tag("fim")]);
    expect(validarFluxo(fluxo(passos))).toEqual([]);
    expect(rodar(passos, true)).toEqual(["a", "fim"]);
    expect(rodar(passos, false)).toEqual(["c", "fim"]);
    const vazio = compilarArvore([se([], [tag("n")]), tag("fim")]);
    expect(rodar(vazio, true)).toEqual(["fim"]);
    expect(rodar(vazio, false)).toEqual(["n", "fim"]);
  });

  it("descompilar devolve a mesma árvore (ida e volta)", () => {
    const passos = compilarArvore([tag("x"), se([se([tag("a")], [], "i"), tag("b")], [tag("c")]), tag("d")]);
    const volta = descompilarPassos(passos);
    expect(compilarArvore(volta)).toEqual(passos);
    expect(volta[1].passo.tipo).toBe("se");
  });

  it("fluxo antigo (só lista) abre como árvore; template vira Enviar WhatsApp", () => {
    const arv = arvoreDoFluxo({ passos: [{ tipo: "tag", acao: "por", tag: "t" }, { tipo: "template_oficial", template: "qualificadoavaliacao", variaveis: { "1": "{primeiro_nome}" } }] });
    expect(arv.map((n) => n.passo.tipo)).toEqual(["tag", "whatsapp"]);
  });
});

describe("Enviar WhatsApp: o número decide o que pode", () => {
  it("número OFICIAL exige template", () => {
    expect(problemasWhatsApp({ tipo: "whatsapp", numero_id: "ofi", texto: "oi" }, null, NUMEROS))
      .toEqual(expect.arrayContaining([expect.stringMatching(/só envia template/), expect.stringMatching(/não manda texto livre/)]));
    expect(problemasWhatsApp({ tipo: "whatsapp", numero_id: "ofi", template: "qualificadoavaliacao", variaveis: { "1": "{primeiro_nome}" } }, null, NUMEROS, TEMPLATES)).toEqual([]);
  });

  it("template sem variável preenchida e número não oficial com template são barrados", () => {
    expect(problemasWhatsApp({ tipo: "whatsapp", numero_id: "ofi", template: "qualificadoavaliacao" }, null, NUMEROS, TEMPLATES))
      .toEqual([expect.stringMatching(/\{\{1\}\}/)]);
    expect(problemasWhatsApp({ tipo: "whatsapp", numero_id: "closer", template: "qualificadoavaliacao" }, null, NUMEROS))
      .toEqual(expect.arrayContaining([expect.stringMatching(/template é do número oficial/)]));
  });

  it("sem número no passo usa o padrão do fluxo", () => {
    expect(problemasWhatsApp({ tipo: "whatsapp", texto: "oi" }, "ofi", NUMEROS)[0]).toMatch(/só envia template/);
    expect(problemasWhatsApp({ tipo: "whatsapp", texto: "oi" }, "closer", NUMEROS)).toEqual([]);
  });

  it("validarConstrutor aponta o passo e o número oficial; compilado leva numero_id", () => {
    const arvore = [no({ tipo: "whatsapp", numero_id: "ofi", texto: "oi" })];
    const erros = validarConstrutor({ nome: "F", gatilhos: [{ tipo: "tag", valor: "x" }], arvore }, { numeros: NUMEROS });
    expect(erros.some((e) => /Enviar WhatsApp \(passo 1\).*template/.test(e))).toBe(true);
    const ok = [no({ tipo: "whatsapp", numero_id: "closer", texto: "oi {primeiro_nome}" })];
    expect(validarConstrutor({ nome: "F", gatilhos: [{ tipo: "tag", valor: "x" }], arvore: ok }, { numeros: NUMEROS })).toEqual([]);
    expect(compilarArvore(ok)[0]).toMatchObject({ tipo: "mensagem", numero_id: "closer", texto: "oi {primeiro_nome}" });
  });
});

describe("Gatilho por segmento / base de dados", () => {
  it("modo 'novos': a primeira passada só fotografa; depois entra só quem apareceu", () => {
    const r1 = inscricoesPorSegmento({ modo: "novos", membros: ["a", "b"], jaInscritos: new Set(), vistos: new Set(), vagas: 100 });
    expect(r1.inscrever).toEqual([]);
    expect(r1.fotografar).toEqual([MARCA_BASE, "a", "b"]);
    const vistos = new Set(r1.fotografar);
    const r2 = inscricoesPorSegmento({ modo: "novos", membros: ["a", "b", "c"], jaInscritos: new Set(), vistos, vagas: 100 });
    expect(r2.inscrever).toEqual(["c"]);
    expect(r2.fotografar).toEqual(["c"]);
  });

  it("segmento vazio na foto: quem chega depois é novo", () => {
    const r1 = inscricoesPorSegmento({ modo: "novos", membros: [], jaInscritos: new Set(), vistos: new Set(), vagas: 10 });
    const r2 = inscricoesPorSegmento({ modo: "novos", membros: ["x"], jaInscritos: new Set(), vistos: new Set(r1.fotografar), vagas: 10 });
    expect(r2.inscrever).toEqual(["x"]);
  });

  it("modo 'todos': inscreve a base respeitando o limite do dia e sem repetir", () => {
    const membros = ["a", "b", "c", "d", "e"];
    const r = inscricoesPorSegmento({ modo: "todos", membros, jaInscritos: new Set(["b"]), vistos: new Set(), vagas: vagasHoje({ limite_dia: 3 }, 1) });
    expect(r.inscrever).toEqual(["a", "c"]);
    expect(vagasHoje({ limite_dia: 3 }, 5)).toBe(0);
    expect(inscricoesPorSegmento({ modo: "todos", membros, jaInscritos: new Set(), vistos: new Set(), vagas: 0 }).inscrever).toEqual([]);
  });

  it("gatilho por base sem limite por dia não publica", () => {
    const sem = validarFluxo({ nome: "F", gatilhos: [{ tipo: "segmento", segmento_id: "s1", modo: "todos" }], passos: [{ tipo: "parar" }] });
    expect(sem.join(" ")).toMatch(/exige limite por dia/);
    const com = validarFluxo({ nome: "F", gatilhos: [{ tipo: "segmento", segmento_id: "s1", modo: "todos" }], config: { limite_dia: 50 }, passos: [{ tipo: "parar" }] });
    expect(com).toEqual([]);
  });

  it("vários gatilhos com 'Ou': registro grava a lista e o primeiro no campo antigo", () => {
    const r = registroParaSalvar({ nome: " F ", gatilhos: [{ tipo: "evento", valor: "lead_qualificado" }, { tipo: "tag", valor: "vip" }], arvore: [tag("t")] });
    expect(r).toMatchObject({ nome: "F", gatilho_tipo: "evento", gatilho_valor: "lead_qualificado" });
    expect((r.gatilhos as unknown[]).length).toBe(2);
    expect(r.passos).toEqual([{ tipo: "tag", acao: "por", tag: "t" }]);
  });
});

describe("Sem resposta, horário e lista", () => {
  it("sem resposta: só quem tem a última mensagem nossa, vencida depois de ligar", () => {
    const h = (x: number) => new Date(AGORA.getTime() - x * 3600_000).toISOString();
    const msgs = [
      { contact_phone: "a", direction: "outbound", created_at: h(30) },
      { contact_phone: "b", direction: "outbound", created_at: h(30) },
      { contact_phone: "b", direction: "inbound", created_at: h(29) },
      { contact_phone: "c", direction: "outbound", created_at: h(5) },
      { contact_phone: "d", direction: "outbound", created_at: h(100) },
    ];
    const alvos = alvosSemResposta(msgs, 24, new Date(AGORA.getTime() - 24 * 3600_000), AGORA);
    expect(alvos.map((x) => x.phone)).toEqual(["a"]);
  });

  it("horário permitido: fora da janela devolve a próxima abertura (Brasília)", () => {
    expect(proximaJanela(AGORA, { hora_inicio: 8, hora_fim: 20 })).toBeNull();
    const noite = new Date("2026-10-18T00:30:00Z"); // 21h30 de 17/10 em Brasília
    expect(proximaJanela(noite, { hora_inicio: 8, hora_fim: 20 })?.toISOString()).toBe("2026-10-18T11:00:00.000Z");
    const madrugada = new Date("2026-10-18T08:00:00Z"); // 5h em Brasília
    expect(proximaJanela(madrugada, { hora_inicio: 8, hora_fim: 20 })?.toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(inicioDiaBRT(noite).toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });

  it("abas Todos / Rascunhos / Excluídos, busca e pasta", () => {
    const l = [
      { id: "1", nome: "Leads qualificados", ativo: true, pasta_id: "p1", updated_at: "2026-10-02" },
      { id: "2", nome: "PagTrust Desafio", ativo: false, updated_at: "2026-10-03" },
      { id: "3", nome: "Velho", ativo: false, excluido_em: "2026-10-01" },
    ];
    expect(filtrarLista(l, "todos", "", null).map((x) => x.id)).toEqual(["2", "1"]);
    expect(filtrarLista(l, "rascunhos", "", null).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLista(l, "excluidos", "", null).map((x) => x.id)).toEqual(["3"]);
    expect(filtrarLista(l, "todos", "pagtrust", null).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLista(l, "todos", "", "p1").map((x) => x.id)).toEqual(["1"]);
  });
});

describe("Edição e teste da árvore", () => {
  it("inserir dentro do ramo Senão e remover", () => {
    let a = [se([], [], "s")];
    a = inserirNo(a, [{ id: "s", ramo: "nao" }], 0, tag("n", "t1"));
    expect((a[0].passo as { nao: NoFluxo[] }).nao[0].id).toBe("t1");
    a = removerNo(a, "t1");
    expect((a[0].passo as { nao: NoFluxo[] }).nao).toEqual([]);
  });

  it("Testar fluxo anda o ramo certo sem enviar nada", () => {
    const arvore = [se([tag("s", "ts")], [tag("n", "tn")]), no({ tipo: "parar" }, "fim1"), tag("nunca", "x")];
    expect(simularArvore(arvore, { respondeu: true, tags: [], etapa: "leads" }).map((c) => c.id)).toEqual(["se1", "ts", "fim1"]);
    expect(simularArvore(arvore, { respondeu: false, tags: [], etapa: "leads" }).map((c) => c.id)).toEqual(["se1", "tn", "fim1"]);
  });

  it("condição por campo do evento (dados.produto)", () => {
    const passos = compilarArvore([
      no({ tipo: "se", condicao: { tipo: "campo", campo: "dados.produto", operador: "contem", valor: "desafio" }, sim: [tag("d")], nao: [tag("o")] }),
    ]);
    const f = fluxo(passos);
    const e = exec({ dados: { produto: "Desafio Mais Slim" } });
    const d = decidir(f, e, { contato: { phone: e.contact_phone }, respondeuDesde: () => false }, AGORA);
    expect(d).toMatchObject({ fazer: "acao", passo: { tipo: "tag", tag: "d" } });
  });
});
