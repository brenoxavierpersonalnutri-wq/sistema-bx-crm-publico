// Painel "Disparo em grupo" no desenho do SendFlow: visão geral (Mapa Números × Campanhas), detalhe da
// campanha com abas, ações por status e endereços antigos. Banco e edge falsos: o teste confere também que
// a tela nunca chama o disparador para enviar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

let dados: Record<string, unknown[]> = {};
let updates: { tabela: string; campos: unknown }[] = [];
let inserts: { tabela: string; linhas: unknown }[] = [];
const invoke = vi.fn();
const rpc = vi.fn();

function consulta(tabela: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  for (const m of ["select", "eq", "neq", "in", "not", "is", "order", "limit", "gte", "lte", "lt", "or", "delete", "maybeSingle"]) q[m] = () => q;
  q.insert = (linhas: unknown) => { inserts.push({ tabela, linhas }); return q; };
  q.update = (campos: unknown) => { updates.push({ tabela, campos }); return q; };
  q.single = () => Promise.resolve({ data: { id: "novo" }, error: null });
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve({ data: dados[tabela] ?? [], error: null, count: 0 }).then(ok, erro);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => consulta(t),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  },
}));

// recharts (ResponsiveContainer) precisa disto no jsdom
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const { default: DisparoGruposCRM } = await import("@/pages/crm/DisparoGruposCRM");

const base = { numero_id: "n1", encerrada: false, link_pausado: false, disparos_pausados: false, limite_por_grupo: 100, intervalo_min_s: 20, intervalo_max_s: 60, tag: "", url_lotado: null, created_at: "2026-10-20T10:00:00Z" };
const grupo = (id: string, campanha_id: string, extra: Record<string, unknown> = {}) => ({
  id, campanha_id, ordem: 0, nome: `Grupo ${id}`, link_convite: "https://chat.whatsapp.com/abc", chat_id: `12036300000000${id.length}@g.us`, ativo: true, cheio: false,
  cliques: 10, cliques_na_contagem: 0, participantes: 50, entradas: 5, saidas: 1, created_at: "2026-10-20T10:00:00Z", ...extra,
});

function renderizar(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/crm/disparo-grupos" element={<DisparoGruposCRM />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  updates = []; inserts = [];
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { versao: 2, grupos_alvo: true }, error: null });
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "grupos_metricas_periodo") return { data: [{ campanha_id: "c1", cliques: 200, cliques_grupo: 190, entradas: 150, saidas: 20 }], error: null };
    if (fn === "grupos_serie_diaria") return { data: [], error: null };
    return { data: null, error: null };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  dados = {
    crm_numeros: [{ id: "n1", apelido: "Grupos 1", tipo: "openwa", ativo: true, ordem: 60, sessao_openwa: "grupos-1" }],
    grupos_campanhas: [
      { ...base, id: "c1", nome: "Desafio Outubro", slug: "desafio-outubro", projeto: "Turbo" },
      { ...base, id: "c2", nome: "Masterclass", slug: "masterclass" },
    ],
    grupos_campanha_grupos: [grupo("g1", "c1"), grupo("g22", "c1", { cheio: true, participantes: 100 })],
    grupos_mensagens: [
      { id: "m1", campanha_id: "c1", agendado_para: "2099-01-01T10:00:00Z", tipo: "texto", texto: "Aula amanhã", status: "agendada", total_grupos: 2, enviados: 0, falhas: 0, link_preview: true, iniciado_em: null, concluido_em: null, motivo: null, midia_path: null, nome_arquivo: null },
      { id: "m2", campanha_id: "c1", agendado_para: "2026-10-10T10:00:00Z", tipo: "texto", texto: "Começou", status: "concluida", total_grupos: 2, enviados: 2, falhas: 0, link_preview: true, iniciado_em: "2026-10-10T10:00:00Z", concluido_em: "2026-10-10T10:03:00Z", motivo: null, midia_path: null, nome_arquivo: null },
    ],
    grupos_envios: [], grupos_membros_eventos: [], grupos_cliques: [], grupos_criacoes: [], crm_grupo_links: [],
  };
});

const soVersao = () => { for (const c of invoke.mock.calls) expect((c[1] as { body: { modo: string } }).body.modo).toBe("versao"); };

describe("painel Disparo em grupo (estilo SendFlow)", () => {
  it("visão geral: KPIs do período, colunas Números/Campanhas e o que precisa de atenção", async () => {
    renderizar("/crm/disparo-grupos");
    const campanhas = await screen.findByRole("region", { name: "Campanhas" });
    expect(await within(campanhas).findByText("Desafio Outubro")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Números" })).getByText("Grupos 1")).toBeTruthy();
    // cliques do período (RPC) e % de entrada 150/200
    await waitFor(() => expect(screen.getAllByText("200").length).toBeGreaterThan(0));
    expect(screen.getAllByText("75").length).toBeGreaterThan(0);
    // campanha sem grupos vira alerta
    expect(within(screen.getByRole("region", { name: "O que precisa de atenção" })).getByText(/"Masterclass" não tem grupos/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("grupos_metricas_periodo", expect.objectContaining({ p_desde: expect.any(String) }));
    soVersao();
  });

  it("sem a migração (RPC falha) mostra os totais acumulados e avisa", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    renderizar("/crm/disparo-grupos?aba=campanhas");
    expect(await screen.findByText(/rode a migração/)).toBeTruthy();
  });

  it("detalhe da campanha: abas do SendFlow e marcar grupo como cheio grava só no banco", async () => {
    renderizar("/crm/disparo-grupos?aba=campanhas&campanha=c1&sub=grupos");
    const abas = await screen.findByRole("tablist", { name: "Abas da campanha" });
    for (const t of ["Visão geral", "Grupos", "Diagnóstico", "Criação de grupos", "Configuração dos grupos", "Mensagens", "Automações", "Calendário", "Atividades", "Cliques"]) {
      expect(within(abas).getByRole("tab", { name: t })).toBeTruthy();
    }
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar Grupo g1" }));
    fireEvent.click(screen.getByRole("button", { name: /Marcar como cheio/ }));
    await waitFor(() => expect(updates).toEqual([{ tabela: "grupos_campanha_grupos", campos: { cheio: true } }]));
    soVersao();
  });

  it("endereço antigo ?aba=membros abre a campanha na aba Atividades", async () => {
    renderizar("/crm/disparo-grupos?aba=membros&campanha=c1");
    const abas = await screen.findByRole("tablist", { name: "Abas da campanha" });
    expect(within(abas).getByRole("tab", { name: "Atividades" }).getAttribute("aria-selected")).toBe("true");
  });

  it("ações: filtro por status e cancelar usa a RPC que já existe", async () => {
    renderizar("/crm/disparo-grupos?aba=acoes");
    const status = await screen.findByRole("tablist", { name: "Status" });
    fireEvent.click(within(status).getByRole("tab", { name: /Agendado/ }));
    expect(await screen.findByText("Aula amanhã")).toBeTruthy();
    expect(screen.queryByText("Começou")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("grupos_cancelar_mensagem", { p_id: "m1" }));
    soVersao();
  });

  it("duplicar campanha cria a cópia com link pausado", async () => {
    renderizar("/crm/disparo-grupos?aba=campanhas&campanha=c1");
    fireEvent.click(await screen.findByRole("button", { name: /Duplicar/ }));
    await waitFor(() => expect(inserts.length).toBe(1));
    expect(inserts[0]).toEqual({ tabela: "grupos_campanhas", linhas: expect.objectContaining({ slug: "desafio-outubro-copia", link_pausado: true }) });
    expect(inserts[0].linhas).not.toHaveProperty("auto_criar");
  });
});
