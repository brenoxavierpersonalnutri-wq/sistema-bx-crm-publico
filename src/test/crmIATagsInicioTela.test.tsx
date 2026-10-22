// Tela Agente IA > Configuração > "Quando a IA começa a atender" > "Tags ao começar" (21/10/2026): chips com as tags
// do agente, autocomplete das tags do CRM, "+ Criar tag" e salvar grava tags_ao_iniciar sem quebrar os outros campos.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// cmdk (lista do seletor) usa ResizeObserver e scrollIntoView, que o jsdom não tem
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

const NUM = "11111111-1111-1111-1111-111111111111";
const AG: Record<string, unknown> = {
  id: "ag1", tipo: "atendimento", slug: "avaliacao", nome: "Avaliação fitness", prompt: "x", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: ["Fui aprovada"], modelo: "claude-sonnet-5-5", temperatura: 0.1, ativo: false,
  horario_inicio: "00:00", horario_fim: "23:59", dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15, historico_mensagens: 20,
  atraso_segundos: 0, numero_id: NUM, link_agendamento: "https://equipe.brenoxavier.com.br/avaliacao", mensagem_fora_horario: null,
  politicas: null, frase_transferencia: null, palavras_transferencia: [],
  ativacao_modo: "gatilho", ativacao_quando: null, ativacao_max_mensagens: 3, ativacao_humano_horas: 12,
  tags_ao_iniciar: ["vip"],
};
const estado = { semColuna: false };
const updates: { tabela: string; valores: Record<string, unknown> }[] = [];
const rpcs: { fn: string; args?: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const linha = () => {
      if (!estado.semColuna) return AG;
      const { tags_ao_iniciar: _t, ...resto } = AG;
      return resto;
    };
    const dados = tabela === "crm_ai_agents" ? [linha()]
      : tabela === "crm_numeros" ? [{ id: NUM, apelido: "Comercial Fit 2", chave: "comercial-fit-2", tipo: "openwa", ativo: true, robo_ia_ligado: true, ordem: 1 }]
      : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit", "delete", "in", "not", "or", "gte", "is"]) q[m] = () => q;
    q.update = (valores: Record<string, unknown>) => { updates.push({ tabela, valores }); return q; };
    q.insert = () => q;
    q.maybeSingle = () => Promise.resolve({ data: dados[0] ?? null, error: null });
    q.single = q.maybeSingle;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: dados, error: null, count: 0 }).then(ok);
    return q;
  };
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    if (fn === "crm_tags_existentes") return Promise.resolve({ data: [{ tag: "vip", uso: 3 }, { tag: "comprou", uso: 10 }], error: null });
    if (fn === "crm_tag_criar") return Promise.resolve({ data: args?.p_nome, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return { supabase: { from: consulta, rpc, functions: { invoke: vi.fn() } } };
});

const { default: TreinarIA } = await import("@/pages/crm/TreinarIA");

describe("tela Agente IA: Tags ao começar", () => {
  it("mostra as tags do agente, escolhe uma existente, cria uma nova e salva tudo junto", async () => {
    updates.length = 0;
    render(<MemoryRouter initialEntries={["/crm/agente-ia?agente=ag1&aba=config"]}><TreinarIA /></MemoryRouter>);
    const bloco = await screen.findByTestId("tags-ao-comecar");
    expect(within(bloco).getByText("vip")).toBeTruthy();
    fireEvent.click(within(bloco).getByRole("combobox", { name: "Tags ao começar" }));
    fireEvent.click(await screen.findByText("comprou")); // autocomplete das tags do CRM
    fireEvent.change(screen.getByPlaceholderText("Buscar ou criar tag..."), { target: { value: "Lead IA" } });
    fireEvent.click(await screen.findByText(/Criar tag/));
    await waitFor(() => expect(rpcs.some((r) => r.fn === "crm_tag_criar" && r.args?.p_nome === "lead-ia")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /Salvar agente/ }));
    await waitFor(() => expect(updates.find((u) => u.tabela === "crm_ai_agents")).toBeTruthy());
    const v = updates.find((u) => u.tabela === "crm_ai_agents")!.valores;
    expect(v.tags_ao_iniciar).toEqual(["vip", "comprou", "lead-ia"]);
    // os outros campos seguem iguais
    expect(v).toMatchObject({ nome: "Avaliação fitness", ativacao_modo: "gatilho", ativo: false, gatilhos: ["Fui aprovada"], numero_id: NUM });
  });
  it("banco sem a migration: avisa e não manda o campo no update", async () => {
    updates.length = 0;
    estado.semColuna = true;
    render(<MemoryRouter initialEntries={["/crm/agente-ia?agente=ag1&aba=config"]}><TreinarIA /></MemoryRouter>);
    const bloco = await screen.findByTestId("tags-ao-comecar");
    expect(within(bloco).getByText(/20261113100000_crm_ai_tags_ao_iniciar\.sql/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Atalhos:/), { target: { value: "Fui aprovada\nOutro atalho" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar agente/ }));
    await waitFor(() => expect(updates.find((u) => u.tabela === "crm_ai_agents")).toBeTruthy());
    const v = updates.find((u) => u.tabela === "crm_ai_agents")!.valores;
    expect(v).not.toHaveProperty("tags_ao_iniciar");
    expect(v.gatilhos).toEqual(["Fui aprovada", "Outro atalho"]);
    estado.semColuna = false;
  });
});
