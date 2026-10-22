// Tela Agente IA > Configuração > "Quando a IA começa a atender" (20/10/2026): escolher "Ativar sozinha pelo gatilho",
// pré-preencher com o modelo da avaliação e salvar grava modo, ativo = false, regra e atalhos.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const NUM = "11111111-1111-1111-1111-111111111111";
const AG = {
  id: "ag1", tipo: "atendimento", slug: "avaliacao", nome: "Avaliação fitness", prompt: "x", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: [], modelo: "claude-sonnet-5-5", temperatura: 0.1, ativo: false,
  horario_inicio: "00:00", horario_fim: "23:59", dias_semana: [0, 1, 2, 3, 4, 5, 6], limite_interacoes: 15, historico_mensagens: 20,
  atraso_segundos: 0, numero_id: NUM, link_agendamento: "https://equipe.brenoxavier.com.br/avaliacao", mensagem_fora_horario: null,
  politicas: null, frase_transferencia: null, palavras_transferencia: [],
  ativacao_modo: "transferidas", ativacao_quando: null, ativacao_max_mensagens: 3, ativacao_humano_horas: 12,
};
const updates: { tabela: string; valores: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = tabela === "crm_ai_agents" ? [AG]
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
  return { supabase: { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }), functions: { invoke: vi.fn() } } };
});

const { default: TreinarIA } = await import("@/pages/crm/TreinarIA");

describe("tela Agente IA: ativar sozinha pelo gatilho", () => {
  it("escolhe o modo, usa o modelo da avaliação e salva", async () => {
    render(<MemoryRouter initialEntries={["/crm/agente-ia?agente=ag1&aba=config"]}><TreinarIA /></MemoryRouter>);
    const radio = await screen.findByRole("radio", { name: /Ativar sozinha pelo gatilho/ });
    expect(screen.getByTestId("modo-agente").textContent).toMatch(/Só conversas transferidas/);
    fireEvent.click(radio);
    fireEvent.click(await screen.findByRole("button", { name: "Usar o modelo da avaliação" }));
    expect((screen.getByLabelText(/^Quando ativar \(regra/) as HTMLTextAreaElement).value).toMatch(/formulário de avaliação/);
    expect((screen.getByLabelText(/^Atalhos:/) as HTMLTextAreaElement).value).toMatch(/Fui qualificada no formulário de avaliação/);
    fireEvent.click(screen.getByRole("button", { name: /Salvar agente/ }));
    await waitFor(() => expect(updates.find((u) => u.tabela === "crm_ai_agents")).toBeTruthy());
    const v = updates.find((u) => u.tabela === "crm_ai_agents")!.valores;
    expect(v).toMatchObject({ ativacao_modo: "gatilho", ativo: false, ativacao_max_mensagens: 3, ativacao_humano_horas: 12 });
    expect(String(v.ativacao_quando)).toMatch(/Não ative para "oi"/);
    expect(v.gatilhos).toEqual(expect.arrayContaining(["Fui qualificada no formulário de avaliação", "Fui aprovada na avaliação"]));
  });
});
