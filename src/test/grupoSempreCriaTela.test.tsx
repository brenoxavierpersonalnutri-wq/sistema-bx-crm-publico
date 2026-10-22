// Tela (21/10/2026): o campo de URL virou só "link pausado" e a criação automática não tem mais liga/desliga.
// Banco falso: o teste confere o que a tela GRAVA (update/insert), nada sai daqui.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let gravacoes: { tabela: string; tipo: string; linhas: Record<string, unknown> }[] = [];
function consulta(tabela: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  for (const m of ["select", "eq", "neq", "in", "not", "is", "order", "limit", "gte", "lte", "or", "delete", "maybeSingle", "single"]) q[m] = () => q;
  q.insert = (linhas: Record<string, unknown>) => { gravacoes.push({ tabela, tipo: "insert", linhas }); return q; };
  q.update = (linhas: Record<string, unknown>) => { gravacoes.push({ tabela, tipo: "update", linhas }); return q; };
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve({ data: q._single ? { id: "c1" } : [], error: null }).then(ok, erro);
  q.single = () => { q._single = true; return q; };
  return q;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => consulta(t),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn() },
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  },
}));

import { CampanhaConfig } from "@/components/crm/grupos/CampanhaConfig";
import { FluxoGrupo } from "@/components/crm/grupos/FluxoGrupo";
import type { CampanhaGrupos } from "@/lib/grupos";

const campanha: CampanhaGrupos = {
  id: "c1", nome: "Desafio", slug: "grupo-desafio", numero_id: "n1", limite_por_grupo: 900, tag: "", link_pausado: false,
  disparos_pausados: false, encerrada: false, url_lotado: "https://pausa.exemplo", intervalo_min_s: 20, intervalo_max_s: 60,
  created_at: "2026-10-20T10:00:00Z", auto_criar: false, prefixo_nome: "", proximo_numero: 4, admins_telefones: [],
  folga_vagas: 30, max_grupos: 20, teto_por_minuto: 3,
};

beforeEach(() => { gravacoes = []; });

describe("campo de URL: só link pausado", () => {
  it("rótulo e explicação novos; lotado não usa a URL", () => {
    render(<CampanhaConfig campanha={campanha} numeros={[]} onSalvo={() => {}} />);
    expect(screen.getByLabelText("URL quando o link estiver pausado (opcional)")).toBeTruthy();
    expect(screen.queryByText(/lotado\/pausado/)).toBeNull();
    expect(screen.getByText(/Grupo lotado nunca usa esta URL: o CRM cria o próximo grupo sozinho/)).toBeTruthy();
  });
});

describe("criação automática sempre ligada", () => {
  it("sem liga/desliga: mostra \"sempre ligada\", avisa sem admin, prévia usa o nome da campanha, e salvar não grava auto_criar", async () => {
    render(<FluxoGrupo campanha={campanha} partes={["criacao"]} onSalvo={() => {}} />);
    expect(screen.getByText("sempre ligada")).toBeTruthy();
    expect(screen.queryByText("desligada")).toBeNull();
    expect(screen.queryByText("ligada")).toBeNull();
    expect(screen.getByText(/Sem admin, o grupo novo não nasce/)).toBeTruthy();
    expect(screen.getByText("Desafio 04")).toBeTruthy();
    expect(screen.getByText(/1 a cada 2 min e 10 por dia por número/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Salvar fluxo/ }));
    await waitFor(() => expect(gravacoes.length).toBe(1));
    expect(gravacoes[0].tabela).toBe("grupos_campanhas");
    expect(gravacoes[0].linhas).not.toHaveProperty("auto_criar");
  });
});
