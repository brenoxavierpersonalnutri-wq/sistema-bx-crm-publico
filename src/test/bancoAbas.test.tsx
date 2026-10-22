// Banco de dados com 3 abas (Pessoas · Registros · Importar CSV) e o fim da tela "Base de leads".
// O lado SQL (sincronização, backfill, produto na cópia, RPCs) é testado em scripts/teste-sql-banco-unico.sh.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  DESTINO_BASE_LEADS, abaDaUrl, aplicarFiltrosRegistros, contatosParaKanban, rotuloOrigem, type ConsultaRegistros,
} from "@/lib/crm/bancoAbas";
import { erroColunaAusente, hostDaRequisicao, hostEhDoBreno } from "../../supabase/functions/_shared/hostsBreno";

// jsdom não tem AbortSignal.timeout (o navegador tem; a tela usa para não ficar presa em "Carregando")
if (typeof (AbortSignal as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
}

// ---------------------------------------------------------------- supabase de mentira
type Chamada = { metodo: string; args: unknown[] };
const consultas: { tabela: string; chamadas: Chamada[] }[] = [];
const upserts: { tabela: string; linhas: unknown[]; opcoes: unknown }[] = [];
let registrosFalsos: Record<string, unknown>[] = [];
let totalRegistros = 0;
const rpc = vi.fn();

function construtor(tabela: string) {
  const reg = { tabela, chamadas: [] as Chamada[] };
  consultas.push(reg);
  const q: Record<string, unknown> = {};
  const encadear = (metodo: string) => (...args: unknown[]) => { reg.chamadas.push({ metodo, args }); return q; };
  for (const m of ["select", "eq", "overlaps", "contains", "not", "gte", "lte", "or", "order", "in", "ilike"]) q[m] = encadear(m);
  q.range = (...args: unknown[]) => { reg.chamadas.push({ metodo: "range", args }); return q; };
  q.abortSignal = () => q;
  q.upsert = async (linhas: unknown[], opcoes: unknown) => { upserts.push({ tabela, linhas, opcoes }); return { error: null }; };
  q.then = (ok: (v: unknown) => unknown) => {
    const r = reg.chamadas.find((c) => c.metodo === "range")?.args as [number, number] | undefined;
    const data = r ? registrosFalsos.slice(r[0], r[1] + 1) : registrosFalsos;
    return Promise.resolve({ data, count: totalRegistros, error: null }).then(ok);
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => construtor(t) },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/crm/SeletorTags", () => ({ SeletorTags: () => <div data-testid="seletor-tags" /> }));
vi.mock("@/lib/crm/tags", () => ({ fonteTagsSupabase: { listar: async () => [] }, variantesDasTags: (_l: unknown, t: string[]) => t }));

const SEGMENTO = { id: "s1", slug: "todos", nome: "Todos os leads", descricao: null, filtro: {}, gatilhos: [], ordem: 1, ativo: true };
const PESSOAS = [
  { chave: "+5531999990001", telefone_e164: "+5531999990001", email: "a@x.invalid", nome: "Ana", primeira_entrada: null,
    ultima_entrada: "2026-10-20T12:00:00Z", origens: ["avaliacao", "agendamento"], tags: ["agendou", "nivel-A"], nivel: "A",
    comprador: false, produto: "Avaliação", total: 2 },
  { chave: "+5531999990002", telefone_e164: "+5531999990002", email: null, nome: "Bia", primeira_entrada: null,
    ultima_entrada: "2026-10-19T12:00:00Z", origens: ["crm_whatsapp"], tags: [], nivel: null, comprador: false, produto: null, total: 2 },
];

function rpcPadrao(nome: string, args?: Record<string, unknown>) {
  if (nome === "crm_segmento_contar") return { data: 2, error: null };
  if (nome === "crm_segmento_listar") return { data: (args?.p_pagina ?? 0) === 0 ? PESSOAS : [], error: null };
  if (nome === "crm_banco_atualizado_em") return { data: "2026-10-21T14:00:00Z", error: null };
  if (nome === "base_leads_produtos") return { data: [{ produto: "Avaliação", linhas: 62 }], error: null };
  if (nome === "base_leads_resumo_origens")
    return { data: [{ origem: "avaliacao", linhas: 664, ultimo_importado: "2026-10-21T14:00:00Z", ultima_entrada: "2026-10-21T13:58:00Z" },
                    { origem: "sellflux", linhas: 12000, ultimo_importado: "2026-10-17T18:07:00Z", ultima_entrada: "2026-10-16T10:00:00Z" }], error: null };
  return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
}

vi.mock("@/hooks/useSegmentos", async (orig) => {
  const real = await orig<typeof import("@/hooks/useSegmentos")>();
  const estavel = { segmentos: [SEGMENTO], provisorio: false, recarregar: () => Promise.resolve() }; // mesma referência a cada render
  return { ...real, useSegmentos: () => estavel };
});

const { default: BancoCRM } = await import("@/pages/crm/BancoCRM");

function Onde() {
  const l = useLocation();
  return <p data-testid="onde">{l.pathname + l.search}</p>;
}
function abrir(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/crm/banco" element={<><BancoCRM /><Onde /></>} />
        <Route path="/crm/banco/:slug" element={<><BancoCRM /><Onde /></>} />
        <Route path="/crm/base-leads" element={<Navigate to={DESTINO_BASE_LEADS} replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  consultas.length = 0;
  upserts.length = 0;
  registrosFalsos = [];
  totalRegistros = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (n: string, a?: Record<string, unknown>) => rpcPadrao(n, a));
});

// ---------------------------------------------------------------- lógica pura
describe("abas e regras puras", () => {
  it("?aba= da URL: só registros/importar mudam a aba; o resto é Pessoas", () => {
    expect(abaDaUrl(null)).toBe("pessoas");
    expect(abaDaUrl("registros")).toBe("registros");
    expect(abaDaUrl("importar")).toBe("importar");
    expect(abaDaUrl("qualquer")).toBe("pessoas");
    expect(DESTINO_BASE_LEADS).toBe("/crm/banco?aba=registros");
  });
  it("rótulo de origem, inclusive webhook:<fluxo>", () => {
    expect(rotuloOrigem("crm_whatsapp")).toBe("WhatsApp");
    expect(rotuloOrigem("webhook:meta-ads")).toBe("Webhook (meta-ads)");
    expect(rotuloOrigem("nova")).toBe("nova");
  });
  it("kanban: um contato por telefone, sem quem não tem telefone, origem base_leads", () => {
    const c = contatosParaKanban([
      { telefone_e164: "+5531999990001", nome: " Ana " }, { telefone_e164: "+5531999990001", nome: "Ana 2" },
      { telefone_e164: null, nome: "Sem" }, { telefone_e164: "+55319", nome: "Curto" },
    ]);
    expect(c).toEqual([{ phone: "5531999990001", name: "Ana", stage: "leads", source: "base_leads" }]);
  });
  it("filtros da aba Registros viram filtros do PostgREST (no servidor)", () => {
    const feitas: string[] = [];
    type Q = ConsultaRegistros<Q>;
    const q: Q = {
      eq: (c, v) => { feitas.push(`eq ${c} ${v}`); return q; },
      overlaps: (c, v) => { feitas.push(`ov ${c} ${v.join("|")}`); return q; },
      not: (c, o, v) => { feitas.push(`not ${c} ${o} ${v}`); return q; },
      gte: (c, v) => { feitas.push(`gte ${c} ${v}`); return q; },
      lte: (c, v) => { feitas.push(`lte ${c} ${v}`); return q; },
      or: (f) => { feitas.push(`or ${f}`); return q; },
    };
    aplicarFiltrosRegistros(q, { origem: "avaliacao", tag: "Comprou", tagVariantes: ["Comprou", "comprou"], produto: "Avaliação",
      comTelefone: true, de: "2026-10-17", ate: "2026-10-21", busca: "ana, 3199" });
    expect(feitas).toEqual([
      "eq origem avaliacao", "ov tags Comprou|comprou", "eq produto Avaliação", "not telefone_e164 is null",
      "gte criado_origem 2026-10-17T03:00:00.000Z", "lte criado_origem 2026-10-22T02:59:59.999Z",
      "or nome.ilike.*ana  3199*,email.ilike.*ana  3199*,telefone_e164.ilike.*3199*",
    ]);
  });
});

describe("host do formulário (mesma lista do SellFlux, gravada para o Full Funnel)", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  it("lê Origin, depois Referer; malformado passa para o próximo", () => {
    expect(hostDaRequisicao(h({ origin: "https://Equipe.BrenoXavier.com.br" }))).toBe("equipe.brenoxavier.com.br");
    expect(hostDaRequisicao(h({ referer: "https://novaav.brenoxavier.com.br/avaliacao?x=1" }))).toBe("novaav.brenoxavier.com.br");
    expect(hostDaRequisicao(h({ origin: "lixo", referer: "https://brenoxavier.com.br/" }))).toBe("brenoxavier.com.br");
    expect(hostDaRequisicao(h({}))).toBeNull();
  });
  it("só host exato do Breno; subdomínio de cliente e sem host ficam de fora", () => {
    for (const ok of ["novaav.brenoxavier.com.br", "equipe.brenoxavier.com.br", "brenoxavier.com.br", "www.brenoxavier.com.br"]) expect(hostEhDoBreno(ok)).toBe(true);
    for (const nao of ["bgimplementacao.brenoxavier.com.br", "novav.com.br", "site-cliente.lovable.app", "brenoxavier.com.br.evil.com", "", null])
      expect(hostEhDoBreno(nao)).toBe(false);
  });
  it("reconhece coluna ausente (migration ainda não rodou) para gravar sem ela", () => {
    expect(erroColunaAusente({ code: "PGRST204", message: "Could not find the 'host_breno' column of 'lead_form_responses'" })).toBe(true);
    expect(erroColunaAusente({ code: "23505", message: "duplicate" })).toBe(false);
    expect(erroColunaAusente(null)).toBe(false);
  });
});

// ---------------------------------------------------------------- tela
describe("tela do Banco de dados", () => {
  it("abre em Pessoas com Tags, Produto, filtro de Produto e Enviar para o kanban", async () => {
    abrir("/crm/banco");
    expect(screen.getByTestId("aba-pessoas")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getAllByTestId("linha-pessoa")).toHaveLength(2));
    const tabela = screen.getAllByRole("table")[0];
    expect(within(tabela).getByText("Tags")).toBeInTheDocument();
    expect(within(tabela).getByText("Produto")).toBeInTheDocument();
    expect(screen.getAllByTestId("tags-pessoa")[0]).toHaveTextContent("agendou, nivel-A");
    expect(within(tabela).getByText("Avaliação")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Produto")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Enviar para o kanban/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar para disparo/ })).toBeInTheDocument();
  });

  it("filtro de Produto vai para a RPC da cópia materializada", async () => {
    abrir("/crm/banco");
    await waitFor(() => expect(screen.getByLabelText("Produto")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Produto"), { target: { value: "Avaliação" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("crm_segmento_listar", expect.objectContaining({ p_filtros: { produto: "Avaliação" } })));
  });

  it("Enviar para o kanban cria um contato por telefone (sem duplicar), sem tocar em quem já existe", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    abrir("/crm/banco");
    await waitFor(() => expect(screen.getAllByTestId("linha-pessoa")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /Enviar para o kanban/ }));
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].tabela).toBe("whatsapp_contacts");
    expect(upserts[0].linhas).toEqual([
      { phone: "5531999990001", name: "Ana", stage: "leads", source: "base_leads" },
      { phone: "5531999990002", name: "Bia", stage: "leads", source: "base_leads" },
    ]);
    expect(upserts[0].opcoes).toEqual({ onConflict: "numero_id,phone", ignoreDuplicates: true });
    confirmar.mockRestore();
  });

  it("/crm/base-leads redireciona para a aba Registros, que pagina no servidor (50 por vez) com a coluna Origem", async () => {
    registrosFalsos = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, origem: i % 2 ? "agendamento" : "avaliacao", origem_id: `${i}`, nome: `Pessoa ${i}`,
      telefone_e164: null, email: null, tags: ["t"], produto: null, status: null, criado_origem: "2026-10-20T12:00:00Z" }));
    totalRegistros = 42682;
    abrir("/crm/base-leads");
    expect(screen.getByTestId("onde")).toHaveTextContent("/crm/banco?aba=registros");
    expect(screen.getByTestId("aba-registros")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getAllByTestId("linha-registro")).toHaveLength(50));
    expect(screen.getByTestId("total-registros")).toHaveTextContent("42.682");
    expect(screen.getAllByText("Formulário de avaliação").length).toBeGreaterThan(0);
    const leituras = consultas.filter((c) => c.tabela === "base_leads");
    expect(leituras).toHaveLength(1); // uma página, não as 42 mil linhas
    const range = leituras[0].chamadas.find((c) => c.metodo === "range")!.args;
    expect(range).toEqual([0, 49]);
    expect(leituras[0].chamadas.find((c) => c.metodo === "select")!.args[1]).toEqual({ count: "exact" });
    // a Pessoas não carrega nada enquanto está em Registros
    expect(rpc).not.toHaveBeenCalledWith("crm_segmento_listar", expect.anything());
    await waitFor(() => expect(screen.getByTestId("resumo-origens")).toHaveTextContent("SellFlux (CSV)"));
  });

  it("aba Importar CSV: upsert por origem + id e histórico por origem", async () => {
    abrir("/crm/banco?aba=importar");
    await waitFor(() => expect(screen.getAllByTestId("linha-historico")).toHaveLength(2));
    expect(screen.getAllByTestId("linha-historico")[1]).toHaveTextContent("CSV");
    expect(screen.getAllByTestId("linha-historico")[0]).toHaveTextContent("automático");
    const csv = "id,name,phone,email,tags,nome-do-produto,status,created_at\n" +
      "sf1,Ana,31999990001,a@x.invalid,quente,Low,ativo,16/10/2026 10:00:00\nsf1,Ana,31999990001,a@x.invalid,quente,Low,ativo,16/10/2026 10:00:00\n,sem id,,,,,,\n";
    const arquivo = new File([csv], "sellflux.csv", { type: "text/csv" });
    Object.defineProperty(arquivo, "text", { value: async () => csv });
    fireEvent.change(screen.getByTestId("arquivo-csv"), { target: { files: [arquivo] } });
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].tabela).toBe("base_leads");
    expect(upserts[0].opcoes).toEqual({ onConflict: "origem,origem_id" });
    expect(upserts[0].linhas).toHaveLength(1);
    expect(upserts[0].linhas[0]).toMatchObject({ origem: "sellflux", origem_id: "sf1", telefone_e164: "+5531999990001", produto: "Low" });
  });

  it("trocar de aba mexe só no ?aba= (Pessoas some da URL)", async () => {
    abrir("/crm/banco/todos?aba=importar");
    fireEvent.click(screen.getByTestId("aba-pessoas"));
    expect(screen.getByTestId("onde")).toHaveTextContent(/^\/crm\/banco\/todos$/);
    fireEvent.click(screen.getByTestId("aba-registros"));
    expect(screen.getByTestId("onde")).toHaveTextContent("/crm/banco/todos?aba=registros");
  });
});
