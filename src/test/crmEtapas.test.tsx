// Etapas configuráveis do CRM (crm_etapas): regras puras, registro de slugs válidos usado pelo motor e pela tela,
// hook useEtapas (com fallback às 5 de sempre) e tela "Configurar etapas".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ETAPAS_SISTEMA,
  SLUGS_SISTEMA,
  carregarEtapasValidas,
  colunasDoKanban,
  definirEtapasValidas,
  ehEtapaValida,
  etapasValidas,
  motivoNaoArquivar,
  moverEtapa,
  normalizarEtapas,
  slugDeEtapa,
  validarEtapa,
  type Etapa,
} from "../../supabase/functions/_shared/etapas.ts";
import { validarFluxo, validarGatilho, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";
import { validarAutomacao, type Automacao } from "../../supabase/functions/_shared/automacoes.ts";
import { interpretarResposta, protocoloDeAcoes } from "../../supabase/functions/_shared/agentesIA.ts";

// Radix Select aberto usa scrollIntoView/ResizeObserver, que o jsdom não tem
Element.prototype.scrollIntoView ??= function () {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

// ------------------------------------------------------------------ banco falso (supabase.from)
type Linha = Record<string, unknown>;
const banco: { lista: Linha[]; etapas: Linha[] | null; contatos: Record<string, number>; inseridos: Linha[]; atualizados: { slug: string; campos: Linha }[] } = {
  lista: [],
  etapas: null,
  contatos: {},
  inseridos: [],
  atualizados: [],
};
function consulta(tabela: string) {
  const filtros: Record<string, unknown> = {};
  let op: "select" | "update" | "insert" = "select";
  let campos: Linha = {};
  const q = {
    select: () => q,
    order: () => q,
    eq: (c: string, v: unknown) => {
      filtros[c] = v;
      return q;
    },
    insert: (l: Linha) => {
      op = "insert";
      banco.inseridos.push(l);
      if (banco.etapas) banco.etapas.push({ ...l });
      return q;
    },
    update: (c: Linha) => {
      op = "update";
      campos = c;
      return q;
    },
    then: (ok: (r: unknown) => unknown) => {
      if (tabela === "crm_etapas" && op === "select") {
        return Promise.resolve(banco.etapas ? { data: banco.etapas, error: null } : { data: null, error: { message: 'relation "crm_etapas" does not exist' } }).then(ok);
      }
      if (tabela === "crm_etapas" && op === "update") {
        banco.atualizados.push({ slug: String(filtros.slug), campos });
        const l = banco.etapas?.find((e) => e.slug === filtros.slug);
        if (l) Object.assign(l, campos);
        return Promise.resolve({ error: null }).then(ok);
      }
      if (op === "insert") return Promise.resolve({ error: null }).then(ok);
      if (tabela === "whatsapp_contacts" && filtros.stage === undefined) return Promise.resolve({ data: banco.lista, error: null }).then(ok);
      // contagem de contatos por etapa
      const n = tabela === "whatsapp_contacts" ? banco.contatos[String(filtros.stage)] ?? 0 : 0;
      return Promise.resolve({ count: n, error: null }).then(ok);
    },
  };
  return q;
}
const canal = { on: () => canal, subscribe: () => canal };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => consulta(t), channel: () => canal, removeChannel: () => {} } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

const { useEtapas, recarregarEtapas, NOMES_ETAPAS, __definirEtapasParaTeste } = await import("@/hooks/useEtapas");
const { ItensEtapa } = await import("@/components/crm/etapas/ItensEtapa");
const { ConfigurarEtapasModal } = await import("@/components/crm/etapas/ConfigurarEtapasModal");
const { default: KanbanBoard } = await import("@/components/crm/KanbanBoard");
const { Select, SelectContent, SelectTrigger, SelectValue } = await import("@/components/ui/select");

const linhasReais = (): Linha[] => [
  ...ETAPAS_SISTEMA.map((e) => ({ ...e })),
  { slug: "proposta", nome: "Proposta enviada", cor: "#ff0000", ordem: 6, ativo: true, sistema: false },
  { slug: "perdido", nome: "Perdido", cor: "#111111", ordem: 7, ativo: false, sistema: false },
];

beforeEach(() => {
  banco.lista = [];
  banco.etapas = null;
  banco.contatos = {};
  banco.inseridos = [];
  banco.atualizados = [];
  toastSpy.mockReset();
});
afterEach(() => {
  definirEtapasValidas(null);
  __definirEtapasParaTeste(null);
});

// ------------------------------------------------------------------ regras puras
describe("etapas: regras puras", () => {
  it("as 5 de sempre com os slugs reais do banco", () => {
    expect(SLUGS_SISTEMA).toEqual(["leads", "contato", "agendado", "compareceu", "fechou"]);
    expect(ETAPAS_SISTEMA.every((e) => e.sistema && e.ativo)).toBe(true);
  });

  it("normalizarEtapas: vazio/erro cai nas 5; ordena; descarta slug inválido e repetido", () => {
    expect(normalizarEtapas(null).map((e) => e.slug)).toEqual(SLUGS_SISTEMA);
    expect(normalizarEtapas([]).map((e) => e.slug)).toEqual(SLUGS_SISTEMA);
    const l = normalizarEtapas([
      { slug: "b", nome: "B", cor: "#000000", ordem: 2 },
      { slug: "a", nome: "", cor: "ruim", ordem: 1, ativo: false },
      { slug: "Nao Pode", nome: "x", ordem: 0 },
      { slug: "b", nome: "dup", ordem: 9 },
    ]);
    expect(l.map((e) => e.slug)).toEqual(["a", "b"]);
    expect(l[0]).toMatchObject({ nome: "a", cor: "#64748b", ativo: false, sistema: false });
  });

  it("slugDeEtapa tira acento/espaço e não colide", () => {
    expect(slugDeEtapa("Pós-venda 2")).toBe("pos_venda_2");
    expect(slugDeEtapa("Proposta", ["proposta"])).toBe("proposta_2");
    expect(slugDeEtapa("  !!! ")).toBe("etapa");
  });

  it("moverEtapa troca vizinhas e renumera; ponta não sai do lugar", () => {
    const l = normalizarEtapas(null);
    expect(moverEtapa(l, "contato", -1).map((e) => e.slug)).toEqual(["contato", "leads", "agendado", "compareceu", "fechou"]);
    expect(moverEtapa(l, "fechou", 1).map((e) => [e.slug, e.ordem])).toEqual(l.map((e, i) => [e.slug, i + 1]));
  });

  it("motivoNaoArquivar: sistema nunca; com contato pede para mover", () => {
    expect(motivoNaoArquivar({ sistema: true, nome: "Leads" }, 0)).toMatch(/padrão/);
    expect(motivoNaoArquivar({ sistema: false, nome: "Proposta" }, 3)).toMatch(/3 contatos\. Mova/);
    expect(motivoNaoArquivar({ sistema: false, nome: "Proposta" }, 0)).toBeNull();
  });

  it("validarEtapa: nome obrigatório, sem repetir, cor e slug válidos", () => {
    const outras = normalizarEtapas(null);
    expect(validarEtapa({ slug: "x", nome: "X", cor: "#123456" }, outras)).toEqual([]);
    expect(validarEtapa({ slug: "x", nome: " ", cor: "#123456" }, outras)).toContain("Dê um nome à etapa.");
    expect(validarEtapa({ slug: "x", nome: "leads", cor: "#123456" }, outras)).toContain("Já existe uma etapa com esse nome.");
    expect(validarEtapa({ slug: "X!", nome: "Y", cor: "azul" }, outras)).toEqual(["Identificador inválido.", "Cor inválida."]);
    // renomear a própria etapa para o mesmo nome não é "repetido"
    expect(validarEtapa({ ...outras[0] }, outras)).toEqual([]);
  });

  it("colunasDoKanban: ativas + arquivada com contato + stage desconhecido no fim", () => {
    const l = normalizarEtapas(linhasReais());
    expect(colunasDoKanban(l).map((e) => e.slug)).toEqual([...SLUGS_SISTEMA, "proposta"]);
    expect(colunasDoKanban(l, ["perdido", "legado", "leads"]).map((e) => e.slug)).toEqual([...SLUGS_SISTEMA, "proposta", "perdido", "legado"]);
  });
});

// ------------------------------------------------------------------ motor / validações
describe("etapas: registro de slugs válidos (motor e validações)", () => {
  const fluxo = (over: Partial<Fluxo>): Partial<Fluxo> => ({ nome: "F", gatilho_tipo: "etapa", gatilho_valor: "leads", passos: [{ tipo: "parar" }], ...over });
  const aut = (over: Partial<Automacao>): Partial<Automacao> => ({ nome: "A", gatilho_tipo: "etapa", gatilho_valor: "leads", acoes: [{ tipo: "tag", tag: "x" }], ...over });

  it("sem tabela: só as 5 valem (comportamento antigo)", () => {
    expect(etapasValidas()).toEqual(SLUGS_SISTEMA);
    expect(validarFluxo(fluxo({ gatilho_valor: "proposta" })).length).toBe(1);
    expect(validarAutomacao(aut({ gatilho_valor: "proposta" })).length).toBe(1);
  });

  it("com crm_etapas: etapa nova vale em gatilho, condição, passo e ação; inexistente continua barrada", () => {
    definirEtapasValidas(["leads", "contato", "agendado", "compareceu", "fechou", "proposta"]);
    expect(validarFluxo(fluxo({ gatilho_valor: "proposta" }))).toEqual([]);
    expect(validarFluxo(fluxo({ passos: [{ tipo: "etapa", etapa: "proposta" }] }))).toEqual([]);
    expect(validarFluxo(fluxo({ passos: [{ tipo: "condicao", condicao: { tipo: "etapa", valor: "proposta" }, se_sim: "continuar", se_nao: "parar" }] }))).toEqual([]);
    expect(validarGatilho({ tipo: "etapa", valor: "proposta" }, 1, {})).toEqual([]);
    expect(validarAutomacao(aut({ gatilho_valor: "proposta", acoes: [{ tipo: "etapa", etapa: "fechou" }] }))).toEqual([]);
    expect(validarFluxo(fluxo({ gatilho_valor: "xyz" })).length).toBe(1);
    expect(validarAutomacao(aut({ acoes: [{ tipo: "etapa", etapa: "xyz" }] }))).toContain("Escolha a etapa de destino.");
  });

  it("lista explícita vence o registro", () => {
    expect(validarFluxo(fluxo({ gatilho_valor: "proposta" }), ["proposta"])).toEqual([]);
    expect(ehEtapaValida("leads", ["proposta"])).toBe(false);
  });

  it("agente de IA: [ETAPA:x] aceita etapa nova e o protocolo lista as etapas reais", () => {
    expect(interpretarResposta("ok [ETAPA:proposta]").etapa).toBeNull();
    definirEtapasValidas([...SLUGS_SISTEMA, "proposta"]);
    expect(interpretarResposta("ok [ETAPA:proposta]").etapa).toBe("proposta");
    expect(protocoloDeAcoes()).toContain("proposta");
  });

  it("carregarEtapasValidas: lê crm_etapas; tabela ausente ou erro volta às 5", async () => {
    const ok = { from: () => ({ select: () => Promise.resolve({ data: [{ slug: "leads" }, { slug: "proposta" }], error: null }) }) };
    expect(await carregarEtapasValidas(ok)).toEqual(["leads", "proposta"]);
    expect(ehEtapaValida("proposta")).toBe(true);
    const ausente = { from: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'relation "crm_etapas" does not exist' } }) }) };
    expect(await carregarEtapasValidas(ausente)).toBeNull();
    expect(etapasValidas()).toEqual(SLUGS_SISTEMA);
    const explode = { from: () => { throw new Error("rede"); } };
    expect(await carregarEtapasValidas(explode as never)).toBeNull();
    expect(etapasValidas()).toEqual(SLUGS_SISTEMA);
  });
});

// ------------------------------------------------------------------ hook + telas
function Sonda() {
  const { colunas, tabelaOk, nomeEtapa } = useEtapas();
  return <p data-testid="sonda">{`${tabelaOk}|${colunas.map((c) => c.id).join(",")}|${nomeEtapa("perdido")}`}</p>;
}

describe("useEtapas", () => {
  it("antes da migration (tabela não existe): 5 de sempre, tabelaOk=false, sem quebrar", async () => {
    render(<Sonda />);
    await waitFor(() => expect(screen.getByTestId("sonda").textContent).toBe(`false|${SLUGS_SISTEMA.join(",")}|perdido`));
  });

  it("com a tabela: colunas ativas na ordem, nome de arquivada, alimenta validações e NOMES_ETAPAS", async () => {
    banco.etapas = linhasReais();
    render(<Sonda />);
    await act(() => recarregarEtapas());
    expect(screen.getByTestId("sonda").textContent).toBe(`true|${SLUGS_SISTEMA.join(",")},proposta|Perdido`);
    expect(ehEtapaValida("perdido")).toBe(true); // arquivada ainda vale no motor
    expect(NOMES_ETAPAS.proposta).toBe("Proposta enviada");
  });

  it("ItensEtapa: só ativas; mantém o valor salvo arquivado marcado como (arquivada)", async () => {
    __definirEtapasParaTeste(normalizarEtapas(linhasReais()) as Etapa[]);
    render(
      <Select value="perdido" open onValueChange={() => {}}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><ItensEtapa incluir="perdido" /></SelectContent>
      </Select>,
    );
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opcoes).toEqual(["Leads", "Em Contato", "Agendado", "Compareceu", "Fechou", "Proposta enviada", "Perdido (arquivada)"]);
  });
});

describe("Configurar etapas (tela)", () => {
  it("cria etapa com slug gerado e cor; aparece na lista", async () => {
    banco.etapas = linhasReais();
    render(<ConfigurarEtapasModal aberto onFechar={() => {}} />);
    await screen.findByTestId("etapa-proposta");
    fireEvent.change(screen.getByLabelText("Nome da nova etapa"), { target: { value: "Pós-venda" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar/ }));
    await waitFor(() => expect(banco.inseridos).toHaveLength(1));
    expect(banco.inseridos[0]).toMatchObject({ slug: "pos_venda", nome: "Pós-venda", ordem: 8, ativo: true, sistema: false });
    expect(await screen.findByTestId("etapa-pos_venda")).toBeInTheDocument();
  });

  it("etapa padrão não arquiva (botão desligado); com contatos pede para mover; sem contatos arquiva", async () => {
    banco.etapas = linhasReais();
    banco.contatos = { proposta: 2 };
    render(<ConfigurarEtapasModal aberto onFechar={() => {}} />);
    await screen.findByTestId("etapa-proposta");
    expect(screen.getByRole("button", { name: "Arquivar Leads" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Arquivar Proposta enviada" }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0][0].description).toMatch(/tem 2 contatos\. Mova para outra etapa/);
    expect(banco.atualizados).toEqual([]);
    banco.contatos = {};
    toastSpy.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Arquivar Proposta enviada" }));
    await waitFor(() => expect(banco.atualizados).toEqual([{ slug: "proposta", campos: { ativo: false } }]));
  });

  it("renomeia etapa padrão e reordena pelas setas", async () => {
    banco.etapas = linhasReais();
    render(<ConfigurarEtapasModal aberto onFechar={() => {}} />);
    await screen.findByTestId("etapa-proposta");
    const nome = screen.getByLabelText("Nome de Em Contato");
    fireEvent.change(nome, { target: { value: "Conversando" } });
    fireEvent.blur(nome);
    await waitFor(() => expect(banco.atualizados).toContainEqual({ slug: "contato", campos: { nome: "Conversando" } }));
    banco.atualizados = [];
    fireEvent.click(await screen.findByRole("button", { name: "Subir Proposta enviada" }));
    await waitFor(() => expect(banco.atualizados).toEqual([
      { slug: "proposta", campos: { ordem: 5 } },
      { slug: "fechou", campos: { ordem: 6 } },
    ]));
  });

  it("sem a tabela: avisa que a migration está pendente e não deixa editar", async () => {
    render(<ConfigurarEtapasModal aberto onFechar={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/migration pendente/);
    expect(screen.queryByLabelText("Nome da nova etapa")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome de Leads")).toBeDisabled();
  });
});

describe("Kanban com etapas configuráveis", () => {
  it("mostra a etapa nova como coluna e a arquivada só enquanto tem contato", async () => {
    banco.etapas = linhasReais();
    const agora = new Date().toISOString();
    banco.lista = [
      { id: "1", phone: "5531911110000", name: "Ana", stage: "proposta", notes: "", created_at: agora, updated_at: agora },
      { id: "2", phone: "5531922220000", name: "Bia", stage: "perdido", notes: "", created_at: agora, updated_at: agora },
    ];
    await act(() => recarregarEtapas());
    render(<KanbanBoard />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    const titulos = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent).filter((t) => t !== "Ana" && t !== "Bia"); // CardTitle também é h3
    expect(titulos).toEqual(["Leads", "Em Contato", "Agendado", "Compareceu", "Fechou", "Proposta enviada", "Perdido"]);
  });
});
