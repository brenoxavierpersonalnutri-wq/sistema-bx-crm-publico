// Permissões do CRM, filtro Atendente, abas de departamento, Kanban por departamento, Gestão de equipe e o helper
// das edge functions (migrations 20261123100000/110000/120000). O banco tem os cenários de RLS em
// supabase/tests/permissoes/rodar.sh; aqui é a parte da tela.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  ACOES_CRM, AREAS_CRM, PERFIS_PRONTOS, acaoLigada, acessoTotal, aplicarPerfil, areaDaRota, pode, podeAcao, rotuloPerfil,
  type AcessoCrm, type MeuAcesso,
} from "@/lib/crm/acesso";
import {
  casaAtendente, conversaNoDepartamento, lerListaDepartamentos, reordenar, rotuloAtendente, type Departamento,
} from "@/lib/crm/departamentos";
import { filtrarConversas, montarConversas, type ContatoCRM } from "@/lib/crm/conversas";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";
import { EditorAcesso } from "@/components/crm/equipe/EditorAcesso";
import { AvisoIAAtendendo } from "@/components/crm/conversas/AvisoIAAtendendo";
import { KanbanDepartamentos, montarColunasKanban, POR_PAGINA_COLUNA, SEM_DEPARTAMENTO } from "@/components/crm/kanban/KanbanDepartamentos";
import { conferirAcessoCrm } from "../../supabase/functions/_shared/acessoCrm.ts";

const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
});

const NUMEROS = [
  { id: "n-closer", chave: "closer", apelido: "Pessoal Breno" },
  { id: "n-fit2", chave: "comercial-fit-2", apelido: "Comercial Fit 2" },
  { id: "n-impl", chave: "comercial-implementacao-1", apelido: "Comercial Implementação" },
  { id: "n-sup", chave: "suporte-consultoria-1", apelido: "Comercial Consultoria Sabrina" },
];
const DEP = (id: string, nome: string, extra: Partial<Departamento> = {}): Departamento => ({
  id, nome, cor: "#64748b", ativo: true, ordem: 10, regra: "manual", fixo: false, ...extra,
});
const DEPS: Departamento[] = [
  DEP("d-ia", "Em atendimento com IA", { regra: "ia", fixo: true, ordem: 0, cor: "#7c3aed" }),
  DEP("d-leads", "Leads", { ordem: 110, etapa_origem: "leads" }),
  DEP("d-qual", "Qualificação", { ordem: 115 }),
  DEP("d-agend", "Agendado", { ordem: 130, etapa_origem: "agendado" }),
  DEP("d-neg", "Negociação", { ordem: 135 }),
  DEP("d-sup", "Suporte Alunas", { ordem: 200 }),
];
const contato = (id: string, extra: Partial<ContatoCRM> = {}): ContatoCRM => ({
  id, phone: `55319${id.padStart(8, "0")}`, name: `Pessoa ${id}`, stage: "leads", tags: [], numero_id: "n-fit2",
  updated_at: `2026-11-20T10:${id.padStart(2, "0").slice(-2)}:00.000Z`, ...extra,
});

// ------------------------------------------------------------------------------------------------ acesso
describe("acesso por área e ação", () => {
  const meu = (areas: Partial<MeuAcesso["areas"]>, acoes: Partial<MeuAcesso["acoes"]> = {}): MeuAcesso => ({
    ...acessoTotal(), areas: { ...acessoTotal().areas, ...areas } as MeuAcesso["areas"], acoes: { ...acessoTotal().acoes, ...acoes } as MeuAcesso["acoes"],
  });

  it("nível: ver não é editar; admin pode tudo; sem acesso carregado não pode", () => {
    const m = meu({ automacao: "ver", base_leads: "nenhum" });
    expect(pode(m, "automacao")).toBe(true);
    expect(pode(m, "automacao", "editar")).toBe(false);
    expect(pode(m, "base_leads")).toBe(false);
    expect(pode({ ...m, admin: true }, "base_leads", "editar")).toBe(true);
    expect(pode(null, "conversas")).toBe(false);
  });

  it("ação só vale com a área em editar; ausente = ligada; desligada = não", () => {
    const a: AcessoCrm = { todos_numeros: true, numeros: [], areas: { conversas: "editar", kanban: "ver" }, acoes: { "conversas.transferir": false }, so_minhas: false, so_departamentos: false };
    expect(acaoLigada(a, "conversas.enviar")).toBe(true);
    expect(acaoLigada(a, "conversas.transferir")).toBe(false);
    expect(acaoLigada(a, "kanban.mover")).toBe(false); // Kanban só "ver"
    expect(podeAcao(meu({}, { "conversas.assumir_ia": false }), "conversas.assumir_ia")).toBe(false);
  });

  it("área da rota (Kanban novo e o link antigo /crm/funil)", () => {
    expect(areaDaRota("/crm/kanban")).toBe("kanban");
    expect(areaDaRota("/crm/funil")).toBe("kanban");
    expect(areaDaRota("/crm/banco/alunas")).toBe("banco");
    expect(areaDaRota("/crm/automacao/fluxos/1")).toBe("automacao");
    expect(areaDaRota("/crm/grupos")).toBe("disparo");
    expect(areaDaRota("/crm")).toBeNull();
    expect(areaDaRota("/crm/equipe")).toBeNull();
  });

  it("toda área e ação do front existe no banco (crm_areas / crm_acoes)", () => {
    expect(AREAS_CRM.map((a) => a.key)).toEqual(["conversas", "kanban", "automacao", "disparo", "agente_ia", "banco", "base_leads", "conexao", "configuracoes", "lives"]);
    expect(ACOES_CRM.map((a) => a.key)).toEqual(["conversas.enviar", "conversas.transferir", "conversas.assumir_ia", "kanban.mover", "agente_ia.editar_prompt", "disparo.enviar", "conexao.conectar"]);
  });
});

describe("perfis prontos (parte D)", () => {
  const perfil = (slug: string) => PERFIS_PRONTOS.find((p) => p.slug === slug)!;

  it("SDR: só números comerciais, departamento de leads/qualificação, só as dele, sem IA/disparo/conexão/banco", () => {
    const a = aplicarPerfil(perfil("sdr"), NUMEROS, DEPS);
    expect(a.acesso.todos_numeros).toBe(false);
    expect(a.acesso.numeros.sort()).toEqual(["n-fit2", "n-impl"]);
    expect(a.departamentos.sort()).toEqual(["d-leads", "d-qual"]);
    expect(a.acesso.so_minhas).toBe(true);
    expect(a.acesso.so_departamentos).toBe(true);
    for (const area of ["agente_ia", "disparo", "conexao", "banco", "base_leads"] as const) expect(a.acesso.areas[area]).toBe("nenhum");
    expect(acaoLigada(a.acesso, "kanban.mover")).toBe(true);
    expect(acaoLigada(a.acesso, "conversas.assumir_ia")).toBe(true);
  });

  it("Closer: negociação/agendado + leitura de Banco, Base e histórico da IA", () => {
    const a = aplicarPerfil(perfil("closer"), NUMEROS, DEPS);
    expect(a.departamentos.sort()).toEqual(["d-agend", "d-neg"]);
    expect(a.acesso.areas.banco).toBe("ver");
    expect(a.acesso.areas.base_leads).toBe("ver");
    expect(a.acesso.areas.agente_ia).toBe("ver");
    expect(acaoLigada(a.acesso, "agente_ia.editar_prompt")).toBe(false);
  });

  it("CS: só o número de suporte (Sabrina), departamentos de alunas/suporte, Gestão de Alunas; nada comercial", () => {
    const a = aplicarPerfil(perfil("cs"), NUMEROS, DEPS);
    expect(a.acesso.numeros).toEqual(["n-sup"]);
    expect(a.acesso.numeros).not.toContain("n-fit2");
    expect(a.departamentos).toEqual(["d-sup"]);
    expect(a.modulos).toEqual(["alunas"]);
  });

  it("Admin: tudo, todos os números, sem restrição de departamento", () => {
    const a = aplicarPerfil(perfil("admin"), NUMEROS, DEPS).acesso;
    expect(a.todos_numeros).toBe(true);
    expect(AREAS_CRM.every((x) => a.areas[x.key] === "editar")).toBe(true);
    expect(a.so_departamentos).toBe(false);
  });

  it('etiqueta: "SDR" igual ao perfil; "SDR (ajustado)" se mudou algo; nada sem perfil', () => {
    const a = aplicarPerfil(perfil("sdr"), NUMEROS, DEPS);
    expect(rotuloPerfil(a.acesso, a.departamentos, NUMEROS, DEPS)).toBe("SDR");
    expect(rotuloPerfil({ ...a.acesso, areas: { ...a.acesso.areas, banco: "ver" } }, a.departamentos, NUMEROS, DEPS)).toBe("SDR (ajustado)");
    expect(rotuloPerfil(a.acesso, ["d-leads"], NUMEROS, DEPS)).toBe("SDR (ajustado)");
    expect(rotuloPerfil({ ...a.acesso, perfil: null }, [], NUMEROS, DEPS)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------ atendente e departamento
describe("filtro Atendente e abas de departamento", () => {
  const cs = [
    contato("1", { atendente_id: "u-ana", departamento_id: "d-leads" }),
    contato("2", { departamento_id: "d-leads" }),
    contato("3", { ai_agent_slug: "sdr-ia", ai_pausado: false, departamento_id: "d-leads" }),
    contato("4", { ai_agent_slug: "sdr-ia", ai_pausado: true, atendente_id: "u-bia", departamento_id: "d-agend" }),
    contato("5", { numero_id: "n-sup", departamento_id: "d-sup" }),
  ];
  const conversas = montarConversas(cs, cs.map((c) => ({
    id: `m${c.id}`, contact_phone: c.phone, numero_id: c.numero_id, body: "oi", created_at: c.updated_at, direction: "inbound", sender_type: "lead", status: null,
  })), {}, null, null);

  it("Todos · Sem atendente · IA · colaborador", () => {
    expect(cs.filter((c) => casaAtendente(c, "todos"))).toHaveLength(5);
    expect(cs.filter((c) => casaAtendente(c, "sem")).map((c) => c.id)).toEqual(["2", "5"]); // IA atendendo não é "sem"
    expect(cs.filter((c) => casaAtendente(c, "ia")).map((c) => c.id)).toEqual(["3"]); // pausada não é IA
    expect(cs.filter((c) => casaAtendente(c, "u:u-bia")).map((c) => c.id)).toEqual(["4"]);
    expect(rotuloAtendente([{ id: "u-ana", nome: "Ana" }], "u-ana")).toBe("Ana");
    expect(rotuloAtendente([], null)).toBe("Sem atendente");
  });

  it("aba da IA é regra; abas manuais não mostram quem está com a IA", () => {
    expect(conversaNoDepartamento(cs[2], DEPS[0])).toBe(true);
    expect(conversaNoDepartamento(cs[2], DEPS[1])).toBe(false);
    expect(conversaNoDepartamento(cs[3], DEPS[3])).toBe(true); // IA pausada: volta para Agendado
  });

  it("filtro combina número + atendente + aba", () => {
    const deps = DEPS;
    const r = filtrarConversas(conversas, "", "dep:d-leads", "n-fit2", { departamentos: deps, atendente: "sem" });
    expect(r.map((c) => c.contato.id)).toEqual(["2"]);
    expect(filtrarConversas(conversas, "", "dep:d-ia", null, { departamentos: deps }).map((c) => c.contato.id)).toEqual(["3"]);
    expect(filtrarConversas(conversas, "", "dep:d-sup", "n-fit2", { departamentos: deps })).toHaveLength(0);
    expect(filtrarConversas(conversas, "", "nao-lidas", null, { atendente: "u:u-ana" }).map((c) => c.contato.id)).toEqual([]);
  });

  it("arrastar aba reordena com ordem 10, 20, 30", () => {
    const r = reordenar(DEPS.slice(0, 3), "d-qual", "d-ia");
    expect(r.map((d) => d.id)).toEqual(["d-qual", "d-ia", "d-leads"]);
    expect(r.map((d) => d.ordem)).toEqual([10, 20, 30]);
  });

  it("importar lista: JSON ou uma por linha, sem repetidos, cor só válida", () => {
    expect(lerListaDepartamentos("Comercial;#2563eb\nSuporte\ncomercial\n\nCS;azul")).toEqual([
      { nome: "Comercial", cor: "#2563eb" }, { nome: "Suporte" }, { nome: "CS" },
    ]);
    expect(lerListaDepartamentos('[{"name":"Vendas","color":"#16a34a","id":42},"Pós-venda"]')).toEqual([
      { nome: "Vendas", cor: "#16a34a", origem_id: "42" }, { nome: "Pós-venda" },
    ]);
    expect(lerListaDepartamentos("[quebrado")).toEqual([]);
  });

  it("lista: filtro Atendente abaixo do número e abas depois de Tudo/Não lidas/Grupos", () => {
    const onAt = vi.fn();
    render(
      <ListaConversas
        conversas={conversas} selecionado={null} onSelecionar={() => {}}
        numeros={NUMEROS.map((n) => ({ ...n, tipo: "openwa" as const }))}
        departamentos={DEPS}
        atendentes={[{ id: "u-ana", nome: "Ana" }, { id: "u-bia", nome: "Bia" }]}
        atendenteFiltro="todos" onAtendenteFiltro={onAt}
      />,
    );
    const sel = screen.getByTestId("filtro-atendente");
    expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos os atendentes", "Sem atendente", "IA (agente atendendo)", "Ana", "Bia"]);
    // logo abaixo do seletor de número
    expect(screen.getByTestId("seletor-numero").compareDocumentPosition(sel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(sel, { target: { value: "u:u-bia" } });
    expect(onAt).toHaveBeenCalledWith("u:u-bia");
    const abas = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\s\d+$/, ""));
    expect(abas.slice(0, 3)).toEqual(["Tudo", "Não lidas", "Grupos"]);
    expect(abas).toContain("Em atendimento com IA");
    expect(abas).not.toContain("Leads".concat(" ")); // pílula de etapa não duplica a aba
    // sem ações de admin: sem "+"
    expect(screen.queryByTestId("criar-departamento")).toBeNull();
    fireEvent.click(screen.getAllByTestId("aba-departamento").find((b) => b.textContent?.includes("Em atendimento com IA"))!);
    expect(screen.getAllByTestId("item-conversa").map((b) => b.getAttribute("data-phone"))).toEqual([cs[2].phone]);
  });

  it('admin vê o "+" e o lápis; Tudo/Não lidas/Grupos não têm edição', () => {
    const acoes = { criar: vi.fn(async () => {}), editar: vi.fn(async () => {}), excluir: vi.fn(async () => {}), reordenar: vi.fn(async () => {}) };
    render(<ListaConversas conversas={conversas} selecionado={null} onSelecionar={() => {}} departamentos={DEPS} acoesDepartamento={acoes} />);
    expect(screen.getByTestId("criar-departamento")).toBeTruthy();
    expect(screen.getByLabelText("Editar Leads")).toBeTruthy();
    expect(screen.queryByLabelText("Editar Tudo")).toBeNull();
    expect(screen.queryByLabelText("Editar Grupos")).toBeNull();
  });

  it("sem departamentos (banco sem a migration): as pílulas de etapa voltam e não há filtro Atendente", () => {
    render(<ListaConversas conversas={conversas} selecionado={null} onSelecionar={() => {}} />);
    expect(screen.queryByTestId("filtro-atendente")).toBeNull();
    expect(screen.queryAllByTestId("aba-departamento")).toHaveLength(0);
  });
});

describe("HUMANO ASSUME DAQUI", () => {
  it("chama assumir; sem a ação, mostra o aviso sem botão", async () => {
    const assumir = vi.fn(async () => {});
    const { unmount } = render(<AvisoIAAtendendo onAssumir={assumir} />);
    expect(screen.getByText("A IA está atendendo esta conversa")).toBeTruthy();
    fireEvent.click(screen.getByTestId("humano-assume"));
    expect(assumir).toHaveBeenCalledTimes(1);
    unmount();
    render(<AvisoIAAtendendo onAssumir={assumir} podeAssumir={false} />);
    expect(screen.queryByTestId("humano-assume")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------- Kanban (parte C)
describe("Kanban por departamento", () => {
  it("colunas = departamentos na ordem + IA por regra + Sem departamento; sem grupo, sem Direct, sem duplicado", () => {
    const cs = [
      contato("1", { departamento_id: "d-leads" }),
      contato("2", { departamento_id: "d-leads", ai_agent_slug: "x", ai_pausado: false }),
      contato("3", { phone: "1203630@g.us", is_group: true, departamento_id: "d-leads" }),
      contato("4", { phone: "ig:123", canal: "instagram" }),
      contato("5"),
      contato("6", { departamento_id: "d-sumiu" }),
      contato("7", { phone: contato("1").phone, departamento_id: "d-leads" }), // mesmo contato e número: 1 card
      contato("8", { phone: contato("1").phone, numero_id: "n-impl", departamento_id: "d-leads" }), // outro número: outro card
    ];
    const cols = montarColunasKanban(cs, DEPS, null);
    expect(cols.map((c) => c.nome)).toEqual([...DEPS.map((d) => d.nome), "Sem departamento"]);
    const por = Object.fromEntries(cols.map((c) => [c.id, c.cards.map((x) => x.id).sort()]));
    expect(por["d-ia"]).toEqual(["2"]);
    expect(por["d-leads"]).toEqual(["1", "8"]);
    expect(por[SEM_DEPARTAMENTO]).toEqual(["5", "6"]);
    expect(montarColunasKanban(cs, DEPS, "n-impl").find((c) => c.id === "d-leads")!.cards.map((x) => x.id)).toEqual(["8"]);
  });

  it("1000+ cards: cada coluna mostra 50 e carrega mais; contagem é a real", () => {
    const muitos = Array.from({ length: 1200 }, (_, i) => contato(String(i + 1), { departamento_id: "d-leads", updated_at: new Date(2026, 10, 1, 0, i).toISOString() }));
    render(
      <KanbanDepartamentos contatos={muitos} departamentos={DEPS} numeros={[]} onAbrir={() => {}} podeMover podeAssumir
        mover={async () => {}} assumir={async () => {}} />,
    );
    const col = screen.getAllByTestId("kanban-coluna").find((c) => c.getAttribute("data-coluna") === "d-leads")!;
    expect(within(col).getByTestId("kanban-total").textContent).toBe("1200");
    expect(within(col).getAllByTestId("kanban-card")).toHaveLength(POR_PAGINA_COLUNA);
    fireEvent.click(within(col).getByTestId("kanban-mais"));
    expect(within(col).getAllByTestId("kanban-card")).toHaveLength(POR_PAGINA_COLUNA * 2);
  });

  it("seletor de número só com os números visíveis", () => {
    render(
      <KanbanDepartamentos contatos={[contato("1", { departamento_id: "d-leads" }), contato("2", { numero_id: "n-sup", departamento_id: "d-leads" })]}
        departamentos={DEPS} numeros={NUMEROS.slice(1, 4).map((n) => ({ ...n, tipo: "openwa" as const }))} onAbrir={() => {}} podeMover podeAssumir
        mover={async () => {}} assumir={async () => {}} />,
    );
    const sel = screen.getByTestId("kanban-seletor-numero");
    expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos os números", "Comercial Fit 2", "Comercial Implementação", "Comercial Consultoria Sabrina"]);
    fireEvent.change(sel, { target: { value: "n-sup" } });
    expect(screen.getAllByTestId("kanban-card").map((c) => c.getAttribute("data-phone"))).toEqual([contato("2").phone]);
  });
});

// ------------------------------------------------------------------------------------- Gestão de equipe (parte D)
describe("editor de acesso", () => {
  const base: AcessoCrm = { todos_numeros: true, numeros: [], areas: { conversas: "editar" }, acoes: {}, so_minhas: false, so_departamentos: false };

  it("muda nível da área; ações só aparecem com editar", () => {
    const onChange = vi.fn();
    render(<EditorAcesso valor={base} onChange={onChange} numeros={NUMEROS} departamentos={DEPS} membroDe={[]} onMembroDe={() => {}} />);
    expect(within(screen.getByTestId("area-conversas")).getByLabelText("Enviar mensagem")).toBeTruthy();
    expect(within(screen.getByTestId("area-kanban")).queryByLabelText("Mover card")).toBeNull();
    fireEvent.click(screen.getByLabelText("Automação: Ver"));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, areas: { conversas: "editar", automacao: "ver" } });
  });

  it("perfil SDR com um clique; números e departamentos aparecem para escolher", () => {
    const aplicar = vi.fn();
    render(
      <EditorAcesso valor={{ ...base, todos_numeros: false }} onChange={() => {}} numeros={NUMEROS} departamentos={DEPS}
        membroDe={[]} onMembroDe={() => {}} onAplicarPerfil={aplicar} rotuloPerfil="SDR (ajustado)" />,
    );
    expect(screen.getByTestId("rotulo-perfil").textContent).toBe("SDR (ajustado)");
    fireEvent.click(screen.getByTestId("perfil-sdr"));
    expect(aplicar.mock.calls[0][0].acesso.numeros.sort()).toEqual(["n-fit2", "n-impl"]);
    expect(screen.getAllByTestId("numero-opcao")).toHaveLength(NUMEROS.length);
    // a aba da IA é regra: não é departamento de que alguém é membro
    expect(screen.getAllByTestId("departamento-opcao").map((l) => l.textContent)).not.toContain("Em atendimento com IA");
  });
});

// ------------------------------------------------------------------------------------- helper das edge functions
describe("conferirAcessoCrm (edge functions)", () => {
  const cli = (respostas: Record<string, { data: unknown; error: unknown }>) => ({
    rpc: vi.fn(async (fn: string) => respostas[fn] ?? { data: null, error: null }),
  });

  it("conversa permitida + ação ligada passa; número de outro recusa com 403", async () => {
    expect(await conferirAcessoCrm(cli({ crm_acesso_conferir: { data: true, error: null }, crm_acao_minha: { data: true, error: null } }),
      { conversa: { numeroId: "n", phone: "55" }, acao: "conversas.enviar" })).toEqual({ ok: true });
    const r = await conferirAcessoCrm(cli({ crm_acesso_conferir: { data: false, error: null } }), { conversa: { numeroId: "n", phone: "55" } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(403);
  });

  it("ação desligada recusa", async () => {
    const r = await conferirAcessoCrm(cli({ crm_acesso_conferir: { data: true, error: null }, crm_acao_minha: { data: false, error: null } }),
      { area: "conexao", acao: "conexao.conectar" });
    expect(r.ok === false && r.erro).toMatch(/desligada/);
  });

  it("RPC ausente (SQL ainda não rodou) passa; outro erro recusa com 500", async () => {
    expect((await conferirAcessoCrm(cli({ crm_acesso_conferir: { data: null, error: { code: "PGRST202" } } }), { area: "conversas" })).ok).toBe(true);
    const r = await conferirAcessoCrm(cli({ crm_acesso_conferir: { data: null, error: { code: "XX000", message: "caiu" } } }), { area: "conversas" });
    expect(r.ok === false && r.status).toBe(500);
  });

  it("manda número e telefone para o banco conferir", async () => {
    const c = cli({ crm_acesso_conferir: { data: true, error: null } });
    await conferirAcessoCrm(c, { conversa: { numeroId: null, phone: "5531" }, nivel: 2 });
    expect(c.rpc).toHaveBeenCalledWith("crm_acesso_conferir", { p_area: "conversa", p_nivel: 2, p_numero_id: null, p_phone: "5531" });
  });
});
