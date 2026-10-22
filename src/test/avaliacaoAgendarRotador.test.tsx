import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// Quiz real da avaliação até a tela de "selecionada", com banco e envio
// falsos (nenhuma requisição sai). Confere o link do /agendar:
//  - versão do teste (/avaliacao/vN com cm_click): leva cm_click e cm_variant;
//  - /avaliacao base (sem versão): link igual ao de antes, sem cm_*.
const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

vi.mock("@/integrations/supabase/client", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { supabase: { from: () => consulta } };
});
vi.mock("@/lib/novaavPixel", () => ({ trackLeadQualificado: vi.fn(), initializeMetaPixel: vi.fn() }));

import QualificationForm from "@/components/novaav/QualificationForm";

const clicar = (texto: string) => fireEvent.click(screen.getByText(texto));
const digitar = (placeholder: string, valor: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: valor } });

async function escolher(texto: string) {
  clicar(texto);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

async function responderQuizQualificado() {
  await escolher("Perder gordura e definir o corpo");
  digitar("Ex: Não gosto de olhar o meu corpo no espelho...", "teste");
  clicar("Próxima");
  digitar("escreva com o que você está trabalhando atualmente", "teste");
  clicar("Próxima");
  digitar("Ex: 165", "165");
  digitar("Ex: 70", "60");
  digitar("Ex: 35", "30");
  clicar("Próxima");
  await escolher("Infelizmente não, as estratégias não entregam resultado justo");
  await escolher("Sim, faço uso atualmente");
  await escolher("Sim - os dois (consultoria de treino e nutricionista particular)");
  await escolher("Mais de R$1.000/mês");
  await escolher("Estou sem acompanhamento, e preciso começar a ver resultado de verdade");
  await escolher("Iniciaria de imediato — é minha principal prioridade");
  await escolher("Acima de R$15.000");
  digitar("Digite seu nome completo", "Teste Beacon");
  digitar("Ex: 31 99999-9999", "31999999999");
  digitar("Ex: @seunome", "@teste");
  clicar("Enviar");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await waitFor(() => expect(screen.getByText(/Marcar minha consulta/)).toBeTruthy());
  const link = screen.getByText(/Marcar minha consulta/).closest("a")!;
  return new URL(link.getAttribute("href")!, "https://equipe.brenoxavier.com.br");
}

describe("quiz da avaliação → link do /agendar", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-publica-de-teste");
    fetchMock = vi.fn(async (url: string) =>
      String(url).includes("submit-form-response")
        ? new Response(JSON.stringify({ id: "resposta-de-teste" }), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("versão do teste: /agendar leva cm_click e cm_variant do rotador", async () => {
    window.history.replaceState(null, "", `/avaliacao/v3?cm_click=${UUID}&cm_variant=v3&utm_source=teste_beacon&utm_content=v3`);
    render(<QualificationForm onDisqualified={() => undefined} versao="avaliacao-v3" />);
    const url = await responderQuizQualificado();
    expect(url.pathname).toBe("/agendar");
    expect(url.searchParams.get("cm_click")).toBe(UUID);
    expect(url.searchParams.get("cm_variant")).toBe("v3");
    expect(url.searchParams.get("utm_source")).toBe("teste_beacon");
    expect(url.searchParams.get("form_response_id")).toBe("resposta-de-teste");
    // a regra do teste ("URL contém agendar") casa o caminho
    expect(url.toString()).toContain("agendar");
  });

  it("/avaliacao base (sem versão): link sem cm_*, mesmo com cm_click na URL", async () => {
    window.history.replaceState(null, "", `/avaliacao?v=v2&cm_click=${UUID}&cm_variant=avaliacao&utm_source=meta`);
    render(<QualificationForm onDisqualified={() => undefined} />);
    const url = await responderQuizQualificado();
    expect(url.pathname).toBe("/agendar");
    expect(url.searchParams.has("cm_click")).toBe(false);
    expect(url.searchParams.has("cm_variant")).toBe(false);
    expect(url.searchParams.get("origem")).toBe("avaliacao");
  });

  it("versão sem cm_click (acesso direto): link sem cm_*", async () => {
    window.history.replaceState(null, "", "/avaliacao/v1?utm_source=meta");
    render(<QualificationForm onDisqualified={() => undefined} versao="avaliacao-v1" />);
    const url = await responderQuizQualificado();
    expect(url.searchParams.has("cm_click")).toBe(false);
    expect(url.searchParams.has("cm_variant")).toBe(false);
  });
});
