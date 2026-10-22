// Tela "Disparo em grupo" (/crm/disparo-grupos): monta o disparo e grava em grupos_mensagens com grupos_alvo.
// Nada sai para o WhatsApp aqui: o banco e a edge são falsos, e o teste confere que a tela NUNCA chama o
// proxy/disparador para enviar (a única chamada à edge é a de versão).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const CHAT_A = "120363000000000001@g.us";
const CHAT_B = "120363000000000002@g.us";
let dados: Record<string, unknown[]> = {};
let inserts: { tabela: string; linhas: unknown }[] = [];
const invoke = vi.fn();

function consulta(tabela: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  for (const m of ["select", "eq", "neq", "in", "not", "is", "order", "limit", "gte", "lte", "or", "update", "delete", "maybeSingle", "single"]) q[m] = () => q;
  q.insert = (linhas: unknown) => { inserts.push({ tabela, linhas }); return q; };
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve({ data: dados[tabela] ?? [], error: null, count: 0 }).then(ok, erro);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => consulta(t),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  },
}));

const { default: DisparoGruposCRM } = await import("@/pages/crm/DisparoGruposCRM");

const campanha = {
  id: "c1", nome: "Avulsos", slug: "avulsos-n1", numero_id: "n1", avulsa: true, encerrada: false, link_pausado: true,
  disparos_pausados: false, limite_por_grupo: 900, intervalo_min_s: 20, intervalo_max_s: 60, tag: "", url_lotado: null, created_at: "2026-10-20T10:00:00Z",
};
const grupo = (id: string, nome: string, chat_id: string, extra: Record<string, unknown> = {}) => ({
  id, campanha_id: "c1", ordem: 0, nome, link_convite: null, chat_id, ativo: true, cheio: false, cliques: 0, cliques_na_contagem: 0,
  participantes: 30, created_at: "2026-10-20T10:00:00Z", ...extra,
});

function renderizar(url = "/crm/disparo-grupos?aba=disparos") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/crm/disparo-grupos" element={<DisparoGruposCRM />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  inserts = [];
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { versao: 2, grupos_alvo: true }, error: null });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  dados = {
    crm_numeros: [{ id: "n1", apelido: "Grupos 1", tipo: "openwa", ativo: true, ordem: 60, sessao_openwa: "grupos-1" }],
    grupos_campanhas: [campanha],
    grupos_campanha_grupos: [
      grupo("g1", "Turma A", CHAT_A, { sou_admin: true, anuncio: true }),
      grupo("g2", "Turma B", CHAT_B, { sou_admin: false, anuncio: true }),
    ],
    grupos_mensagens: [],
    grupos_envios: [],
  };
});

describe("tela Disparo em grupo", () => {
  it("mostra o aviso de risco, o número Grupos 1 em destaque e o que o número pode em cada grupo", async () => {
    renderizar();
    expect(screen.getByRole("heading", { name: "Disparo em grupo" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/banir o número/);
    expect(await screen.findByText("recomendado p/ grupos")).toBeTruthy();
    expect(await screen.findByText("Turma A")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByText("só admins enviam — sem permissão")).toBeTruthy();
    // grupo em que o número não pode enviar não dá para marcar
    expect((screen.getByRole("checkbox", { name: "Selecionar Turma B" }) as HTMLButtonElement).disabled).toBe(true);
    const nav = screen.getByRole("navigation", { name: "Seções do disparo em grupo" });
    for (const t of ["Visão geral", "Campanhas", "Enviar mensagem", "Ações", "Calendário", "Automações", "Leads", "Deep links", "Histórico", "Segurança"]) {
      expect(within(nav).getByRole("button", { name: t })).toBeTruthy();
    }
  });

  it("disparo de texto agora grava grupos_mensagens com grupos_alvo e NÃO chama envio nenhum", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar Turma A" }));
    fireEvent.change(screen.getByPlaceholderText(/Texto da mensagem/), { target: { value: "Aula hoje às 20h" } });
    expect(within(screen.getByTestId("previa-disparo")).getByText("Aula hoje às 20h")).toBeTruthy();
    const botao = await screen.findByRole("button", { name: /Disparar agora \(1 grupo\)/ });
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(botao);
    await waitFor(() => expect(inserts.length).toBe(1));
    const { tabela, linhas } = inserts[0];
    expect(tabela).toBe("grupos_mensagens");
    expect(linhas).toEqual([expect.objectContaining({
      campanha_id: "c1", tipo: "texto", texto: "Aula hoje às 20h", grupos_alvo: ["g1"], midia_path: null, disparo_id: expect.any(String),
    })]);
    // a tela só pergunta a versão da edge; envio é do disparador (pg_cron), nunca daqui
    for (const chamada of invoke.mock.calls) expect((chamada[1] as { body: { modo: string } }).body.modo).toBe("versao");
  });

  it("enquete com uma opção só não deixa disparar", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar Turma A" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de mensagem" }), { target: { value: "enquete" } });
    fireEvent.change(screen.getByPlaceholderText("Qual horário é melhor pra você?"), { target: { value: "Qual horário?" } });
    fireEvent.change(screen.getByPlaceholderText(/19h/), { target: { value: "19h" } });
    expect(within(screen.getByTestId("problemas-disparo")).getByText("Enquete precisa de 2 a 12 opções.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Disparar agora/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(inserts).toEqual([]);
  });

  it("edge antiga publicada (sem grupos_alvo): bloqueia o disparo", async () => {
    invoke.mockResolvedValue({ data: { error: "modo inválido" }, error: null });
    renderizar();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar Turma A" }));
    fireEvent.change(screen.getByPlaceholderText(/Texto da mensagem/), { target: { value: "oi" } });
    expect(await screen.findByText(/função do disparador publicada ainda é a antiga/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Disparar agora/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
