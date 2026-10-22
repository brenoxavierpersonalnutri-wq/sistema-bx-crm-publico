// Tela do robô de IA (18/10/2026): no chat, "Transferir para IA" lista só os agentes de atendimento do MESMO número
// e chama a RPC; "Assumir (humano)" aparece quando a IA atende; selo na lista; aviso quando o robô do número está
// desligado; seção "Transferência para humano" do agente e chave do robô por número na tela Agente IA.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const NUM = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const AGENTES = [
  { id: "a1", slug: "avaliacao", nome: "Avaliação", tipo: "atendimento", ativo: false, numero_id: NUM },
  { id: "a2", slug: "individual", nome: "Individual", tipo: "atendimento", ativo: true, numero_id: OUTRO },
  { id: "a3", slug: "fu", nome: "Follow-up", tipo: "followup", ativo: false, numero_id: NUM },
];
const rpc = vi.fn();
const estado = { robo: false };

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    let dados: unknown = [];
    if (tabela === "crm_ai_agents") dados = AGENTES;
    if (tabela === "crm_numeros") dados = { robo_ia_ligado: estado.robo };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit", "update", "in", "not", "or", "is", "gte"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: dados, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(dados) ? dados : [], error: null, count: 0 }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } } };
});

const { ControleIA } = await import("@/components/crm/conversas/ControleIA");
const { SeloIA } = await import("@/components/crm/conversas/SeloIA");

const CONTATO = { id: "c1", phone: "5531988887777", numero_id: NUM, name: "Ana", stage: "leads", updated_at: "2026-10-18T12:00:00Z" };

describe("chat: Transferir para IA / Assumir (humano)", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: "ok", error: null }); estado.robo = false; });

  it("lista só os agentes de atendimento do número da conversa e transfere pela RPC", async () => {
    const atualizado = vi.fn();
    render(<ControleIA contato={CONTATO} onContatoAtualizado={atualizado} />);
    fireEvent.click(screen.getByTestId("transferir-ia"));
    expect(await screen.findByText("Avaliação")).toBeInTheDocument();
    expect(screen.queryByText("Individual")).toBeNull(); // outro número
    expect(screen.queryByText("Follow-up")).toBeNull(); // follow-up não atende conversa
    expect(screen.getByText(/robô de IA deste número está desligado/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Avaliação"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("crm_ai_transferir_para_ia", { p_numero_id: NUM, p_phone: CONTATO.phone, p_agent_slug: "avaliacao" }));
    expect(atualizado).toHaveBeenCalledWith("c1", expect.objectContaining({ ai_agent_slug: "avaliacao", ai_pausado: false, ai_precisa_humano: false }));
  });

  it("conversa com a IA: mostra o selo e 'Assumir (humano)', que pausa pela RPC", async () => {
    const atualizado = vi.fn();
    render(<ControleIA contato={{ ...CONTATO, ai_agent_slug: "avaliacao", ai_pausado: false }} onContatoAtualizado={atualizado} />);
    expect(screen.getByTestId("selo-ia").textContent).toContain("IA atendendo");
    expect(screen.queryByTestId("transferir-ia")).toBeNull();
    fireEvent.click(screen.getByTestId("assumir-humano"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("crm_ai_assumir", { p_numero_id: NUM, p_phone: CONTATO.phone }));
    expect(atualizado).toHaveBeenCalledWith("c1", expect.objectContaining({ ai_pausado: true, ai_precisa_humano: false }));
  });

  it("erro da RPC aparece e não marca a conversa", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "o agente Avaliação responde em outro número" } });
    const atualizado = vi.fn();
    render(<ControleIA contato={CONTATO} onContatoAtualizado={atualizado} />);
    fireEvent.click(screen.getByTestId("transferir-ia"));
    fireEvent.click(await screen.findByText("Avaliação"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(atualizado).not.toHaveBeenCalled();
  });

  it("selo 'Precisa de humano' tem prioridade; conversa só humana não tem selo", () => {
    const { rerender } = render(<SeloIA contato={{ ai_agent_slug: "avaliacao", ai_pausado: true, ai_precisa_humano: true }} />);
    expect(screen.getByTestId("selo-ia").textContent).toContain("Precisa de humano");
    rerender(<SeloIA contato={{ ai_agent_slug: "avaliacao", ai_pausado: true, ai_precisa_humano: false }} />);
    expect(screen.queryByTestId("selo-ia")).toBeNull();
  });
});

describe("tela Agente IA: transferência para humano", () => {
  it("seção com prompt de transferência (modelo pronto), despedida/silêncio, para quem, tag, etapa e fluxo", async () => {
    const { TransferenciaAgente } = await import("@/components/crm/ia/TransferenciaAgente");
    const set = vi.fn();
    const form = { id: "a1", slug: "avaliacao", nome: "Avaliação", prompt_transferencia: "", frase_transferencia: "", palavras_transferencia: [], limite_interacoes: 15 } as never;
    render(<MemoryRouter><TransferenciaAgente form={form} set={set} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Usar modelo pronto"));
    expect(set).toHaveBeenCalledWith("prompt_transferencia", expect.stringContaining("Transfira para o atendimento humano"));
    fireEvent.click(screen.getByLabelText("Não mandar nada ao transferir"));
    expect(set).toHaveBeenCalledWith("transferir_sem_mensagem", true);
    expect(screen.getByLabelText("Para quem transferir")).toBeInTheDocument();
    expect(screen.getByLabelText("Etapa ao transferir")).toBeInTheDocument();
    expect(screen.getByLabelText("Fluxo ao transferir")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ao transferir: aplicar a tag" })).toBeInTheDocument();
  });
});
