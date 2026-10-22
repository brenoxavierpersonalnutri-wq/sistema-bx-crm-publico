// "Conectar Instagram": com a função fora do ar ou sem credencial, aviso claro em vez do erro genérico.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const consulta = { select: () => consulta, order: () => Promise.resolve({ data: [], error: null }) };
  return {
    supabase: {
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
      from: () => consulta,
      rpc: () => Promise.resolve({ data: null, error: { message: "sem permissão" } }),
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { CanalInstagram, mensagemErroFuncao, AVISO_FUNCAO_FORA } from "@/components/crm/central/CanalInstagram";

class FunctionsFetchError extends Error {
  constructor() {
    super("Failed to send a request to the Edge Function");
    this.name = "FunctionsFetchError";
  }
}

describe("mensagemErroFuncao", () => {
  it("função não publicada (fetch falhou ou 404) vira aviso de configuração", async () => {
    expect(await mensagemErroFuncao(new FunctionsFetchError())).toBe(AVISO_FUNCAO_FORA);
    expect(await mensagemErroFuncao({ name: "FunctionsHttpError", message: "x", context: new Response("", { status: 404 }) })).toBe(AVISO_FUNCAO_FORA);
  });
  it("412 da função mostra o texto dela", async () => {
    const ctx = new Response(JSON.stringify({ error: "Instagram ainda não configurado: falta as credenciais." }), { status: 412 });
    expect(await mensagemErroFuncao({ name: "FunctionsHttpError", message: "non-2xx", context: ctx })).toMatch(/falta as credenciais/);
  });
});

describe("CanalInstagram", () => {
  beforeEach(() => invoke.mockReset());

  it("função fora do ar: mostra o aviso em cima do botão", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError() });
    render(<CanalInstagram />);
    await waitFor(() => expect(screen.getByTestId("instagram-falta").textContent).toBe(AVISO_FUNCAO_FORA));
  });

  it("função no ar sem credencial: lista o que falta", async () => {
    invoke.mockResolvedValue({ data: { configurado: false, faltam: ["as credenciais do app da Meta"] }, error: null });
    render(<CanalInstagram />);
    await waitFor(() => expect(screen.getByTestId("instagram-falta").textContent).toBe("Instagram ainda não configurado: falta as credenciais do app da Meta."));
  });

  it("tudo configurado: sem aviso", async () => {
    invoke.mockResolvedValue({ data: { configurado: true, faltam: [] }, error: null });
    render(<CanalInstagram />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.queryByTestId("instagram-falta")).toBeNull();
  });
});
