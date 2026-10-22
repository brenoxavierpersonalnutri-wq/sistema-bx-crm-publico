// Passo "Atribuir" do fluxo passa a levar o id do usuário (migration 20261123140000): renomear-se não desvia mais a conversa.
import { describe, expect, it } from "vitest";
import { idDoAtendente } from "@/lib/crm/fluxosConstrutor";
import { resumoPasso, validarFluxo, type Fluxo } from "../../supabase/functions/_shared/fluxos.ts";

const ID_GABI = "aaaaaaaa-0000-0000-0000-000000000002";
const catalogo = {
  atendentesIds: [
    { id: ID_GABI, nome: "Gabi Closer" },
    { id: "aaaaaaaa-0000-0000-0000-000000000003", nome: "Ana" },
    { id: "aaaaaaaa-0000-0000-0000-000000000004", nome: "ana" },
  ],
};

const fluxo = (passos: Fluxo["passos"]): Fluxo => ({
  id: "f1", nome: "Fluxo", ativo: true, gatilho_tipo: "evento", gatilho_valor: "lead_qualificado",
  parar_se_responder: false, permitir_repetir: false, passos, ligado_em: new Date().toISOString(),
});

describe("idDoAtendente", () => {
  it("nome da lista vira o id do usuário (sem caixa nem espaços)", () => {
    expect(idDoAtendente(catalogo, "Gabi Closer")).toBe(ID_GABI);
    expect(idDoAtendente(catalogo, "  gabi closer ")).toBe(ID_GABI);
  });
  it("nome repetido, fora da lista ou vazio não vincula", () => {
    expect(idDoAtendente(catalogo, "Ana")).toBeNull();
    expect(idDoAtendente(catalogo, "Fulano")).toBeNull();
    expect(idDoAtendente(catalogo, " ")).toBeNull();
    expect(idDoAtendente(null, "Gabi Closer")).toBeNull();
  });
});

describe("validarFluxo: atribuir", () => {
  it("aceita só nome (fluxo antigo) e nome + id", () => {
    expect(validarFluxo(fluxo([{ tipo: "atribuir", atendente: "Gabi Closer" }]))).toEqual([]);
    expect(validarFluxo(fluxo([{ tipo: "atribuir", atendente: "Gabi Closer", atendente_id: ID_GABI }]))).toEqual([]);
  });
  it("recusa id que não é uuid", () => {
    expect(validarFluxo(fluxo([{ tipo: "atribuir", atendente: "Gabi", atendente_id: "Gabi" }])).join(" ")).toContain("atendente inválido");
  });
  it("o resumo continua mostrando o nome", () => {
    expect(resumoPasso({ tipo: "atribuir", atendente: "Gabi Closer", atendente_id: ID_GABI })).toBe("Atribuir a Gabi Closer");
  });
});
