import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  contarChips,
  filtrosAtivos,
  passaFiltros,
  FILTROS_PADRAO,
  type ContextoFiltro,
  type LinhaFiltravel,
} from "@/lib/respostasFiltros";

// Base fictícia (nenhum dado real): o caso do print de 14/10 em miniatura —
// as Individuais são todas DQ e "Não agendou" só conta qualificadas.
type L = LinhaFiltravel & { agendou?: boolean; wpp?: boolean; created_at: string; score: number };
const agora = new Date().toISOString();
const lead = (id: string, nivel: string, origem: string | null, extra: Partial<L> = {}): L => ({
  id, nome: `Teste ${id}`, telefone: null, nivel, origem, p9_prioridade: null, created_at: agora, score: 0, ...extra,
});
const BASE: L[] = [
  ...[1, 2, 3, 4, 5].map((i) => lead(`ind${i}`, "DQ", "individual")),
  lead("q1", "A", "avaliacao"),
  lead("q2", "B", "avaliacao", { p9_prioridade: "imediato" }),
  lead("q3", "C", "avaliacao"),
  lead("ag1", "A", "avaliacao", { agendou: true, wpp: false }),
  lead("ag2", "B", "avaliacao", { agendou: true, wpp: true }),
  lead("dq1", "DQ", "avaliacao"),
  lead("velha", "A", null), // antes da unificação: sem rastreio
];
const ctx: ContextoFiltro<L> = {
  jornada: (r) => ({ agendou: !!r.agendou, foiPraWpp: !!r.wpp }),
  recuperacao: () => "nao_trabalhado",
  casaFunil: () => true,
};
const lista = (f = FILTROS_PADRAO) => BASE.filter((r) => passaFiltros(r, f, ctx));

describe("contarChips (contagem facetada)", () => {
  it("sem filtro ligado, os números são os de sempre", () => {
    const c = contarChips(BASE, FILTROS_PADRAO, ctx);
    expect(c).toMatchObject({
      todas: 12, individual: 5, individualQualificadas: 0, qualificadas: 6, naoQualificadas: 6,
      semAgendar: 3, agendou: 2, semWpp: 1, imediato: 1,
    });
  });

  it("com 'Não agendou' ligado, Individual mostra 0 — o caso do print", () => {
    const f = { ...FILTROS_PADRAO, etapa: "sem_agendar" as const };
    const c = contarChips(BASE, f, ctx);
    expect(c.individual).toBe(0);
    expect(c.qualificadas).toBe(3);
    expect(c.todas).toBe(3);
    // a própria linha "Travou em" não se filtra por ela mesma
    expect(c.semAgendar).toBe(3);
    expect(c.agendou).toBe(2);
  });

  it("com 'Individual' ligado, a linha Travou em zera", () => {
    const c = contarChips(BASE, { ...FILTROS_PADRAO, nivel: "individual" }, ctx);
    expect(c).toMatchObject({ semAgendar: 0, agendou: 0, semWpp: 0, imediato: 0, individual: 5 });
  });

  it("o número de cada botão bate com o tamanho da lista ao clicar nele", () => {
    const comEtapa = { ...FILTROS_PADRAO, etapa: "sem_agendar" as const, imediato: true };
    const c = contarChips(BASE, comEtapa, ctx);
    expect(lista({ ...comEtapa, nivel: "individual" }).length).toBe(c.individual);
    expect(lista({ ...comEtapa, nivel: "qualified" }).length).toBe(c.qualificadas);
    expect(lista({ ...comEtapa, nivel: "disqualified" }).length).toBe(c.naoQualificadas);
    expect(lista({ ...comEtapa, nivel: "all" }).length).toBe(c.todas);
    expect(lista({ ...comEtapa, etapa: "agendou" }).length).toBe(c.agendou);
    expect(lista({ ...comEtapa, etapa: "sem_wpp" }).length).toBe(c.semWpp);
    expect(lista({ ...comEtapa, imediato: true }).length).toBe(c.imediato);
  });

  it("'Todas' ignora busca e funil (o botão limpa os dois), os outros respeitam", () => {
    const f = { ...FILTROS_PADRAO, busca: "Teste ind1" };
    const c = contarChips(BASE, f, ctx);
    expect(c.todas).toBe(12);
    expect(c.individual).toBe(1);
  });
});

describe("filtrosAtivos", () => {
  it("nomeia os filtros ligados", () => {
    expect(filtrosAtivos({ ...FILTROS_PADRAO, nivel: "individual", etapa: "sem_agendar" })).toEqual([
      "Individual",
      "Travou em: Não agendou",
    ]);
    expect(filtrosAtivos(FILTROS_PADRAO)).toEqual([]);
  });
});

// ---------- Tela inteira, com banco falso ----------
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/integrations/supabase/client", () => {
  const resposta = (tabela: string) => {
    if (tabela === "lead_form_responses") {
      return {
        data: BASE.map(({ agendou, wpp, ...r }) => ({ ...r, consultation_id: agendou ? `c-${r.id}` : null })),
        error: null,
      };
    }
    if (tabela === "consultations") {
      return {
        data: BASE.filter((r) => r.agendou).map((r) => ({
          id: `c-${r.id}`, client_phone: null, client_name: null, date: agora.slice(0, 10),
          whatsapp_clicked_at: r.wpp ? agora : null, instagram: null,
        })),
        error: null,
      };
    }
    if (tabela === "app_settings") return { data: null, error: null };
    return { data: [], error: null };
  };
  const builder = (tabela: string): any =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            const r = resposta(tabela);
            return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko);
          }
          return () => builder(tabela);
        },
      },
    );
  return { supabase: { from: (t: string) => builder(t) } };
});

beforeAll(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

import RespostasForm from "@/pages/RespostasForm";

const botao = (re: RegExp) => screen.getByRole("button", { name: re });

describe("RespostasForm — Individual com 'Não agendou' ligado", () => {
  it("o número do chip acompanha o outro filtro e o vazio explica e oferece limpar", async () => {
    render(<MemoryRouter><RespostasForm /></MemoryRouter>);
    await waitFor(() => expect(botao(/Individual \(5\)/)).toBeInTheDocument());
    expect(botao(/^Todas \(12\)/)).toBeInTheDocument();
    expect(botao(/Não agendou \(3\)/)).toBeInTheDocument();

    fireEvent.click(botao(/Não agendou \(3\)/));
    // o chip agora diz 0: não promete o que a lista não vai mostrar
    expect(botao(/Individual \(0\)/)).toBeInTheDocument();

    fireEvent.click(botao(/Individual \(0\)/));
    const vazio = screen.getByTestId("vazio-filtros");
    expect(within(vazio).getByText("Individual")).toBeInTheDocument();
    expect(within(vazio).getByText("Travou em: Não agendou")).toBeInTheDocument();
    expect(vazio).toHaveTextContent("Sem ele, a lista mostra 5 lead(s).");

    fireEvent.click(within(vazio).getByRole("button", { name: "Limpar filtro Travou em" }));
    expect(screen.queryByTestId("vazio-filtros")).not.toBeInTheDocument();
    expect(botao(/Não agendou \(0\)/)).toBeInTheDocument();
    expect(screen.getAllByTitle(/^Teste ind\d$/)).toHaveLength(5);
    expect(screen.queryByTitle("Teste q1")).not.toBeInTheDocument();
  });
});
