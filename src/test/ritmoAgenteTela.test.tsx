// Seção "Tempo de resposta (delay)" na aba Configuração do agente: campos, prévia e banco sem a migration.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null }) } }));

const { ConfigAgente } = await import("@/components/crm/ia/ConfigAgente");
const { RitmoAgente } = await import("@/components/crm/ia/RitmoAgente");

const base = {
  id: "a1", slug: "avaliacao", nome: "Agente", prompt: "p", base_conhecimento: null, etapas: [], origens: [], gatilhos: [],
  modelo: null as string | null, temperatura: 0.2, ativo: false, horario_inicio: null, horario_fim: null, dias_semana: [],
  limite_interacoes: 15, historico_mensagens: 20, atraso_segundos: 0, numero_id: null, link_agendamento: null,
  mensagem_fora_horario: null, politicas: null, frase_transferencia: null, palavras_transferencia: [],
};
const migrado = {
  ...base, debounce_segundos: 30, debounce_max_segundos: 90, atraso_min_segundos: 20, atraso_max_segundos: 60,
  digitando_ligado: true, digitando_cps: 8, intervalo_min_segundos: 3, intervalo_max_segundos: 8,
};

describe("Tempo de resposta (delay) na Configuração", () => {
  it("aparece na aba Configuração do agente de atendimento", () => {
    render(<ConfigAgente form={migrado} numeros={[]} set={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Tempo de resposta (delay)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Esperar a lead terminar de escrever (segundos)")).toHaveValue(30);
    expect(screen.getByLabelText("Atraso mínimo antes de responder (segundos)")).toHaveValue(20);
    expect(screen.getByLabelText("Atraso máximo antes de responder (segundos)")).toHaveValue(60);
    expect(screen.getByLabelText("Velocidade do digitando (caracteres por segundo)")).toHaveValue(8);
  });
  it("não aparece no agente de follow-up", () => {
    render(<ConfigAgente form={{ ...migrado, tipo: "followup" }} numeros={[]} set={vi.fn()} followup />);
    expect(screen.queryByRole("region", { name: "Tempo de resposta (delay)" })).toBeNull();
  });
  it("prévia do tempo total com os padrões", () => {
    render(<RitmoAgente form={migrado} set={vi.fn()} />);
    const previa = screen.getByTestId("previa-ritmo");
    expect(previa).toHaveTextContent("a primeira bolha sai entre 1 min 9 s e 1 min 49 s");
    expect(previa).toHaveTextContent("termina entre 1 min 24 s e 2 min 9 s");
  });
  it("mudar um campo chama set com o número; valor fora da faixa avisa o ajuste", () => {
    const set = vi.fn();
    const { rerender } = render(<RitmoAgente form={migrado} set={set} />);
    fireEvent.change(screen.getByLabelText("Esperar a lead terminar de escrever (segundos)"), { target: { value: "45" } });
    expect(set).toHaveBeenCalledWith("debounce_segundos", 45);
    rerender(<RitmoAgente form={{ ...migrado, debounce_segundos: 120, debounce_max_segundos: 60 }} set={set} />);
    expect(screen.getByText(/máximo de mensagens picadas 60 vira 120/)).toBeInTheDocument();
  });
  it("desligar o digitando esconde a velocidade", () => {
    render(<RitmoAgente form={{ ...migrado, digitando_ligado: false }} set={vi.fn()} />);
    expect(screen.queryByLabelText("Velocidade do digitando (caracteres por segundo)")).toBeNull();
  });
  it("banco sem a migration: avisa e só deixa editar a primeira espera", () => {
    render(<RitmoAgente form={base} set={vi.fn()} />);
    expect(screen.getByText(/migration 20261105100000/)).toBeInTheDocument();
    expect(screen.getByLabelText("Esperar a lead terminar de escrever (segundos)")).not.toBeDisabled();
    expect(screen.getByLabelText("Atraso mínimo antes de responder (segundos)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Usar o recomendado" })).toBeNull();
  });
});
