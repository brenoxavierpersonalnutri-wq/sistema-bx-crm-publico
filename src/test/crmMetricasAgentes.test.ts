// Métricas dos cartões da tela Agente IA (21/10/2026): agrupa contatos e eventos por slug do agente.
import { describe, expect, it } from "vitest";
import { agruparMetricas } from "@/lib/crm/metricasAgentes";

describe("métricas por agente", () => {
  it("conta com a IA, atendidas (contatos distintos), respostas e transferidas", () => {
    const m = agruparMetricas(
      [{ ai_agent_slug: "a" }, { ai_agent_slug: "a" }, { ai_agent_slug: "b" }, { ai_agent_slug: null }],
      [
        { agent_slug: "a", tipo: "resposta", contact_phone: "1" },
        { agent_slug: "a", tipo: "resposta", contact_phone: "1" },
        { agent_slug: "a", tipo: "resposta", contact_phone: "2" },
        { agent_slug: "a", tipo: "transferido", contact_phone: "2" },
        { agent_slug: "c", tipo: "resposta", contact_phone: "9" },
        { agent_slug: null, tipo: "resposta", contact_phone: "8" },
      ],
    );
    expect(m.get("a")).toEqual({ comIA: 2, atendidasHoje: 2, respostasHoje: 3, transferidasHoje: 1 });
    expect(m.get("b")).toEqual({ comIA: 1, atendidasHoje: 0, respostasHoje: 0, transferidasHoje: 0 });
    expect(m.get("c")?.atendidasHoje).toBe(1);
    expect(m.size).toBe(3);
  });
});
