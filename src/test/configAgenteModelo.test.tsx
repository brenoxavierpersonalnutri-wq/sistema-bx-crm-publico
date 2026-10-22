// Aba Configuração do agente: seletor de modelo Claude (Sonnet padrão) e aviso de modelo antigo do Gemini.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null }) } }));

const { ConfigAgente } = await import("@/components/crm/ia/ConfigAgente");

const base = {
  id: "a1", slug: "avaliacao", nome: "Agente", prompt: "p", base_conhecimento: null, etapas: [], origens: [], gatilhos: [],
  modelo: null as string | null, temperatura: 0.2, ativo: false, horario_inicio: null, horario_fim: null, dias_semana: [],
  limite_interacoes: 15, historico_mensagens: 20, atraso_segundos: 0, numero_id: null, link_agendamento: null,
  mensagem_fora_horario: null, politicas: null, frase_transferencia: null, palavras_transferencia: [],
};

describe("ConfigAgente: modelo de IA", () => {
  it("sem modelo mostra Claude Sonnet 5.5 (padrão)", () => {
    render(<ConfigAgente form={base} numeros={[]} set={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Modelo de IA" })).toHaveTextContent("Claude Sonnet 5.5 (padrão)");
    expect(screen.queryByText(/modelo antigo/)).toBeNull();
  });

  it("modelo antigo do Gemini aparece como Sonnet e avisa para salvar", () => {
    render(<ConfigAgente form={{ ...base, modelo: "google/gemini-2.5-flash" }} numeros={[]} set={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Modelo de IA" })).toHaveTextContent("Claude Sonnet 5.5 (padrão)");
    expect(screen.getByText(/modelo antigo \(google\/gemini-2.5-flash\)/)).toBeInTheDocument();
  });

  it("Opus escolhido aparece no seletor", () => {
    render(<ConfigAgente form={{ ...base, modelo: "claude-opus-5-5" }} numeros={[]} set={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Modelo de IA" })).toHaveTextContent("Claude Opus 5.5 (mais caro)");
  });
});
