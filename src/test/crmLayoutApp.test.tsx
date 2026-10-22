import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fmtPct, inicioDoPeriodo, montarFunil, naoRespondidas, tempoDesde } from "@/lib/crm/dashboard";
import {
  SEGMENTOS_PADRAO, aplicarFiltro, hojeBRT, ligadosAoSegmento, limparBusca, normalizarSegmento, type ConsultaFiltravel,
} from "@/lib/crm/segmentos";
import { grupoSemNome, nomesDaResposta, resolverNomesGrupos } from "@/hooks/useNomesGrupos";
import { getModuleByPath, podeAbrirRota } from "@/lib/modules";
import { nomeExibido, type ContatoCRM } from "@/lib/crm/conversas";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false, allowedModules: [] }) }));
vi.mock("@/hooks/useSegmentos", () => ({ useSegmentos: () => ({ segmentos: null, provisorio: true, recarregar: vi.fn() }) }));

// importa depois dos mocks
const { default: LayoutCRM, itemAtivo, MENU_CRM } = await import("@/components/crm/layout/LayoutCRM");

const ETAPAS = [
  { id: "leads", title: "Leads" }, { id: "contato", title: "Em Contato" }, { id: "agendado", title: "Agendado" },
  { id: "compareceu", title: "Compareceu" }, { id: "fechou", title: "Fechou" },
];

describe("dashboard: funil", () => {
  it("acumula da etapa para frente e calcula conversão entre etapas", () => {
    const f = montarFunil({ leads: 50, contato: 20, agendado: 10, compareceu: 15, fechou: 5 }, ETAPAS);
    expect(f.map((e) => e.alcancaram)).toEqual([100, 50, 30, 20, 5]);
    expect(f[0].conversao).toBeNull();
    expect(f[1].conversao).toBeCloseTo(0.5);
    expect(f[4].conversao).toBeCloseTo(0.25);
    expect(fmtPct(f[2].conversao)).toBe("60%");
  });
  it("etapa anterior zerada não divide por zero", () => {
    const f = montarFunil({}, ETAPAS);
    expect(f.every((e) => e.alcancaram === 0 && (e.conversao === null))).toBe(true);
  });
});

describe("dashboard: não respondidas", () => {
  const agora = new Date("2026-10-17T15:00:00Z");
  it("pega só quem tem a última mensagem recebida e mais velha que X horas, sem grupos", () => {
    const r = naoRespondidas([
      { contact_phone: "5531900000001", direction: "inbound", created_at: "2026-10-17T05:00:00Z" },
      { contact_phone: "5531900000002", direction: "inbound", created_at: "2026-10-17T05:00:00Z" },
      { contact_phone: "5531900000002", direction: "outbound", created_at: "2026-10-17T06:00:00Z" },
      { contact_phone: "5531900000003", direction: "inbound", created_at: "2026-10-17T14:00:00Z" },
      { contact_phone: "123@g.us", direction: "inbound", created_at: "2026-10-16T00:00:00Z" },
    ], 6, agora);
    expect(r.map((x) => x.phone)).toEqual(["5531900000001"]);
    expect(r[0].horas).toBe(10);
    expect(tempoDesde(10)).toBe("há 10 h");
    expect(tempoDesde(72)).toBe("há 3 d");
  });
  it("período: hoje começa à meia-noite de Brasília; 7d conta 7 dias para trás", () => {
    expect(inicioDoPeriodo("hoje", agora)).toBe("2026-10-17T03:00:00.000Z");
    expect(inicioDoPeriodo("7d", agora)).toBe("2026-10-10T15:00:00.000Z");
  });
});

/** construtor falso que registra as chamadas */
function gravador() {
  const chamadas: unknown[][] = [];
  const q = new Proxy({} as Record<string, unknown>, {
    get: (_, nome: string) => (...args: unknown[]) => { chamadas.push([nome, ...args]); return q; },
  }) as unknown as ConsultaFiltravel<never>;
  return { q, chamadas };
}

describe("segmentos", () => {
  it("qualificados: origem avaliação e nível A-D", () => {
    const s = SEGMENTOS_PADRAO.find((x) => x.slug === "avaliacao-qualificados")!;
    const { q, chamadas } = gravador();
    aplicarFiltro(q, s.filtro);
    expect(chamadas).toEqual([["overlaps", "origens", ["avaliacao"]], ["in", "nivel", ["A", "B", "C", "D"]]]);
  });
  it("caminho antigo do ex (comprador sem plano) tira os telefones das ativas e a busca não injeta filtro", () => {
    const { q, chamadas } = gravador();
    aplicarFiltro(q, { comprador: true, alunas: "ex" }, { busca: "ana,(x)*", comTelefone: true }, ["+5531999990000"]);
    expect(chamadas).toContainEqual(["eq", "comprador", true]);
    expect(chamadas).toContainEqual(["not", "telefone_e164", "in", '("+5531999990000")']);
    expect(chamadas).toContainEqual(["not", "telefone_e164", "is", "null"]);
    const or = chamadas.find((c) => c[0] === "or")!;
    expect(String(or[1])).not.toMatch(/[()]/);
    expect(limparBusca('a,b(c)"d*')).toBe("a b c  d");
  });
  it("fluxo do template qualificadoavaliacao aparece dentro de Avaliação qualificados", () => {
    const s = SEGMENTOS_PADRAO.find((x) => x.slug === "avaliacao-qualificados")!;
    const r = ligadosAoSegmento(s, [
      { id: "1", nome: "Leads qualificados – Breno Xavier (FF)", ativo: false, gatilho_tipo: "evento", gatilho_valor: "lead_qualificado" },
      { id: "2", nome: "Outro", ativo: true, gatilho_tipo: "evento", gatilho_valor: "pagtrust_desafio_compra_aprovada" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });
  it("normaliza linha do banco e descarta lixo do filtro", () => {
    const s = normalizarSegmento({ id: "u", slug: "x", nome: "X", filtro: { origens: ["a", 3, ""], alunas: "talvez", comprador: "sim" }, gatilhos: [{ tipo: "tag", valor: "t" }, { tipo: "hack" }] });
    expect(s?.filtro).toEqual({ origens: ["a"] });
    expect(s?.gatilhos).toEqual([{ tipo: "tag", valor: "t" }]);
    expect(normalizarSegmento({ nome: "sem id" })).toBeNull();
  });
  it("hoje em Brasília", () => {
    expect(hojeBRT(new Date("2026-10-18T02:00:00Z"))).toBe("2026-10-17");
  });
  it("Banco de dados exige o módulo crm-banco (inclusive nos segmentos)", () => {
    expect(getModuleByPath("/crm/banco")).toBe("crm-banco");
    expect(getModuleByPath("/crm/banco/ex-alunas")).toBe("crm-banco");
    expect(podeAbrirRota("/crm/banco/ex-alunas", false, [])).toBe(false);
    expect(podeAbrirRota("/crm/banco/ex-alunas", false, ["crm-banco"])).toBe(true);
    expect(podeAbrirRota("/crm/conexoes", false, [])).toBe(true);
  });
});

const grupo = (id: string, phone: string, name: string): ContatoCRM =>
  ({ id, phone, name, is_group: true, stage: "leads", tags: [] } as unknown as ContatoCRM);

describe("nome dos grupos", () => {
  it("reconhece grupo sem nome (vazio, JID ou 'Grupo')", () => {
    expect(grupoSemNome(grupo("1", "1@g.us", "Grupo"))).toBe(true);
    expect(grupoSemNome(grupo("1", "1@g.us", "1@g.us"))).toBe(true);
    expect(grupoSemNome(grupo("1", "1@g.us", "Turma VIP"))).toBe(false);
    expect(nomesDaResposta({ grupos: [{ chatId: "1@g.us", name: " Turma " }, { chatId: "x", name: "y" }] })).toEqual(new Map([["1@g.us", "Turma"]]));
  });
  it("lista os grupos uma vez, pede info do que faltou, aplica e grava", async () => {
    const invocar = vi.fn(async (b: Record<string, unknown>) =>
      b.modo === "listar_grupos" ? { grupos: [{ chatId: "1@g.us", name: "Turma A" }] } : { chatId: b.chat_id, name: "Turma B" });
    const gravar = vi.fn(async () => {});
    const aplicados: [string, string][] = [];
    const n = await resolverNomesGrupos(
      [grupo("a", "1@g.us", "Grupo"), grupo("b", "2@g.us", ""), grupo("c", "3@g.us", "Já tem")],
      (id, nome) => aplicados.push([id, nome]),
      { invocar, gravar },
    );
    expect(n).toBe(2);
    expect(aplicados).toEqual([["a", "Turma A"], ["b", "Turma B"]]);
    expect(invocar).toHaveBeenCalledTimes(2);
    expect(gravar).toHaveBeenCalledWith("b", "Turma B");
  });
  it("falha da ponte não quebra: fica 'Grupo'", async () => {
    const n = await resolverNomesGrupos([grupo("a", "1@g.us", "")], () => {}, { invocar: async () => { throw new Error("502"); }, gravar: async () => {} });
    expect(n).toBe(0);
    expect(nomeExibido(grupo("a", "1@g.us", ""))).toBe("Grupo");
  });
});

describe("menu lateral do CRM", () => {
  it("acende o item certo por rota", () => {
    const [dash, conversas, , automacao] = MENU_CRM;
    expect(itemAtivo(dash, "/crm")).toBe(true);
    expect(itemAtivo(dash, "/crm/conversas")).toBe(false);
    expect(itemAtivo(conversas, "/crm/conversas")).toBe(true);
    // /crm/grupos virou "Disparo em grupo" (item próprio, logo abaixo de Automação)
    expect(itemAtivo(automacao, "/crm/grupos")).toBe(false);
  });
  it("Disparo em grupo: item próprio logo abaixo de Automação, rota /crm/disparo-grupos (e /crm/grupos antigo)", () => {
    const i = MENU_CRM.findIndex((x) => x.rotulo === "Automação");
    const disparo = MENU_CRM[i + 1];
    expect(disparo.rotulo).toBe("Disparo em grupo");
    expect(disparo.to).toBe("/crm/disparo-grupos");
    expect(itemAtivo(disparo, "/crm/disparo-grupos")).toBe(true);
    expect(itemAtivo(disparo, "/crm/grupos")).toBe(true);
    expect(itemAtivo(MENU_CRM[i], "/crm/disparo-grupos")).toBe(false);
  });
  it("Agente IA tem item próprio (rota /crm/agente-ia; /crm/ia antigo acende ele, não Automação)", () => {
    const agente = MENU_CRM.find((i) => i.rotulo === "Agente IA")!;
    const automacao = MENU_CRM.find((i) => i.rotulo === "Automação")!;
    expect(agente.to).toBe("/crm/agente-ia");
    expect(itemAtivo(agente, "/crm/agente-ia")).toBe(true);
    expect(itemAtivo(agente, "/crm/ia")).toBe(true);
    expect(itemAtivo(automacao, "/crm/agente-ia")).toBe(false);
    expect(itemAtivo(automacao, "/crm/ia")).toBe(false);
    // mesma regra de acesso da tela antiga: rota sem módulo, livre para aprovado
    expect(podeAbrirRota("/crm/agente-ia", false, [])).toBe(podeAbrirRota("/crm/ia", false, []));
  });
  it("mostra os itens, esconde Banco sem permissão e recolhe", () => {
    render(
      <MemoryRouter initialEntries={["/crm/conexoes"]}>
        <Routes><Route path="/crm" element={<LayoutCRM />}><Route path="conexoes" element={<p>tela conexões</p>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("tela conexões")).toBeInTheDocument();
    const menu = screen.getByTestId("menu-crm");
    for (const r of ["Dashboard", "Conversas", "Kanban", "Automação", "Agente IA", "Conexão WhatsApp", "Configurações"]) {
      expect(menu.textContent).toContain(r);
    }
    // 21/10/2026: Base de leads virou a aba Registros do Banco de dados
    expect(menu.textContent).not.toContain("Base de leads");
    expect(menu.textContent).not.toContain("Banco de dados");
    expect(menu.querySelector('[aria-current="page"]')?.textContent).toContain("Conexão WhatsApp");
    fireEvent.click(screen.getByLabelText("Recolher menu"));
    expect(menu.dataset.recolhido).toBe("1");
    expect(menu.textContent).not.toContain("Conversas");
  });
});
