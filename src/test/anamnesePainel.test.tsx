import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Bug de 20/10/2026: o time preencheu a anamnese da aluna de teste e a ficha
// continuou em "Aguardando resposta". Uma linha pendente mais nova (gerada
// depois da resposta) ficava por cima e escondia as respostas.

const banco = vi.hoisted(() => ({ linhas: [] as Record<string, unknown>[] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    order: () => Promise.resolve({ data: banco.linhas, error: null }),
  };
  return { supabase: { from: () => consulta } };
});

import { AnamnesePainel, escolherAnamnese } from "@/components/alunas/AnamnesePainel";

const respondida = {
  id: "r1", token: "tokenrespondida", status: "respondida",
  created_at: "2026-10-20T16:15:00Z", respondida_em: "2026-10-20T16:20:00Z",
  nome_completo: "TESTE Nome", rotina_alimentar: "TESTE rotina",
};
const pendenteNova = { id: "p2", token: "tokennova", status: "pendente", created_at: "2026-10-20T16:26:52Z" };
const pendenteVelha = { id: "p0", token: "tokenvelha", status: "pendente", created_at: "2026-10-20T16:00:00Z" };

describe("escolherAnamnese", () => {
  it("resposta vence pendente mais nova; pendente nova continua com link", () => {
    const r = escolherAnamnese([pendenteNova, respondida]);
    expect(r.respondida?.id).toBe("r1");
    expect(r.pendente?.id).toBe("p2");
  });
  it("pendente mais velha que a resposta é link morto", () => {
    const r = escolherAnamnese([respondida, pendenteVelha]);
    expect(r.respondida?.id).toBe("r1");
    expect(r.pendente).toBeUndefined();
  });
  it("sem resposta, mostra a pendente mais nova", () => {
    const r = escolherAnamnese([pendenteNova, pendenteVelha]);
    expect(r.respondida).toBeUndefined();
    expect(r.pendente?.id).toBe("p2");
  });
  it("sem linha nenhuma, nada", () => {
    expect(escolherAnamnese([])).toEqual({ respondida: undefined, pendente: undefined });
  });
});

describe("AnamnesePainel", () => {
  beforeEach(() => { banco.linhas = []; });

  it("pendente nova por cima não esconde as respostas", async () => {
    banco.linhas = [pendenteNova, respondida];
    render(<AnamnesePainel alunaId="a1" alunaNome="TESTE – Treinamento" />);
    expect(await screen.findByText("Respondida")).toBeTruthy();
    expect(screen.queryByText("Aguardando resposta")).toBeNull();
    expect(screen.getByText("TESTE rotina")).toBeTruthy();
    expect(screen.getByText(/anamnese nova aguardando resposta/)).toBeTruthy();
    expect(screen.getByText(/\/anamnese\/tokennova/)).toBeTruthy();
  });

  it("só pendente: aguardando, com o link dela", async () => {
    banco.linhas = [pendenteNova];
    render(<AnamnesePainel alunaId="a1" alunaNome="TESTE – Treinamento" />);
    expect(await screen.findByText("Aguardando resposta")).toBeTruthy();
    expect(screen.getByText(/\/anamnese\/tokennova/)).toBeTruthy();
    expect(screen.queryByText(/anamnese nova aguardando resposta/)).toBeNull();
  });

  it("só respondida: respostas e nenhum link", async () => {
    banco.linhas = [respondida, pendenteVelha];
    render(<AnamnesePainel alunaId="a1" alunaNome="TESTE – Treinamento" />);
    expect(await screen.findByText("Respondida")).toBeTruthy();
    expect(screen.getByText("TESTE rotina")).toBeTruthy();
    expect(screen.queryByText(/\/anamnese\/token/)).toBeNull();
  });
});
