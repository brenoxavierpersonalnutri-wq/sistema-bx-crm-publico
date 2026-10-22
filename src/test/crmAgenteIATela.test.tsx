// Tela "Agente IA" (/crm/agente-ia, 18/10/2026): mesma tela do Treinar IA, com o simulador em destaque ao lado
// e o selo de cenário offline. /crm/ia antigo redireciona. Banco falso: nada sai daqui.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

const AGENTE = {
  id: "a1", slug: "avaliacao", nome: "Agente Avaliação", prompt: "Você é a assistente.", base_conhecimento: null,
  etapas: ["leads"], origens: null, gatilhos: null, modelo: null, temperatura: 0.4, ativo: false,
  horario_inicio: "08:00", horario_fim: "20:00", dias_semana: [1, 2, 3, 4, 5], limite_interacoes: 10,
  historico_mensagens: 20, atraso_segundos: 0, numero_id: null, link_agendamento: null, mensagem_fora_horario: null,
  politicas: null, frase_transferencia: null, palavras_transferencia: [],
};

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = tabela === "crm_ai_agents" ? [AGENTE] : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit", "insert", "update", "delete", "in"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: dados, error: null }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }), functions: { invoke } } };
});

const { default: TreinarIA } = await import("@/pages/crm/TreinarIA");

function Redireciona() {
  const { search } = useLocation();
  return <Navigate to={`/crm/agente-ia${search}`} replace />;
}
function Onde() {
  const { pathname, search } = useLocation();
  return <span data-testid="onde">{pathname + search}</span>;
}

describe("tela Agente IA", () => {
  it("mostra Treinar IA e o simulador em destaque com o selo offline, sem enviar nada", async () => {
    render(
      <MemoryRouter initialEntries={["/crm/ia?agente=a1"]}>
        <Routes>
          <Route path="/crm/ia" element={<Redireciona />} />
          <Route path="/crm/agente-ia" element={<><Onde /><TreinarIA /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Testar a IA (simulação, nada é enviado)")).toBeInTheDocument();
    expect(screen.getByTestId("onde").textContent).toBe("/crm/agente-ia?agente=a1");
    expect(screen.getByRole("heading", { name: /Agente IA/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Treinar IA" })).toBeInTheDocument();
    const sim = screen.getByTestId("simulador-agente-ia");
    expect(within(sim).getByText(/Cenário offline, não envia mensagem/)).toBeInTheDocument();
    expect(within(sim).getByLabelText("Mensagem da lead")).toBeInTheDocument();
    // as abas de treino continuam; o simulador saiu das abas e ficou visível ao lado
    for (const t of ["Configuração", "Prompt", "Base de conhecimento"]) expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Simulador" })).toBeNull();
    expect(screen.getByRole("button", { name: /Agente Avaliação/ })).toHaveAttribute("aria-pressed", "true");
    expect(invoke).not.toHaveBeenCalled();
  });
});
