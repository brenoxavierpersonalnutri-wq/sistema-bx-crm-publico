// Tela Agente IA com agente de follow-up (18/10/2026): "Novo agente" escolhe o tipo, "Criar agente de follow-up"
// já grava o template, e o agente de follow-up mostra o simulador de mensagem (sem enviar) no lugar do chat.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const FU = {
  id: "fu1", tipo: "followup", slug: "follow-up-abc", nome: "Follow-up", prompt: "Você é do time comercial e está retomando", base_conhecimento: null,
  etapas: [], origens: [], gatilhos: [], modelo: "claude-sonnet-5-5", temperatura: 0.2, ativo: false, horario_inicio: null, horario_fim: null,
  dias_semana: [], limite_interacoes: 15, historico_mensagens: 20, atraso_segundos: 0, numero_id: null, link_agendamento: null,
  mensagem_fora_horario: null, politicas: null, frase_transferencia: null, palavras_transferencia: [],
};
const inserts: { tabela: string; linha: Record<string, unknown> }[] = [];
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = tabela === "crm_ai_agents" ? [FU] : tabela === "whatsapp_contacts" ? [{ phone: "5531988887777", name: "Ana Souza", stage: "contato" }] : [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit", "update", "delete", "in", "not", "or"]) q[m] = () => q;
    q.insert = (linha: Record<string, unknown>) => { inserts.push({ tabela, linha }); return q; };
    q.single = () => Promise.resolve({ data: { id: "novo1" }, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: dados, error: null }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }), functions: { invoke } } };
});

const { default: TreinarIA } = await import("@/pages/crm/TreinarIA");
const tela = () => render(<MemoryRouter initialEntries={["/crm/agente-ia?agente=fu1"]}><TreinarIA /></MemoryRouter>);

describe("tela Agente IA: follow-up", () => {
  beforeEach(() => { inserts.length = 0; invoke.mockReset(); });

  it("agente de follow-up: sem chave de ligar, explica que roda pelo fluxo e troca o simulador", async () => {
    tela();
    expect(await screen.findByText("Testar o follow-up (simulação, nada é enviado)")).toBeInTheDocument();
    expect(screen.getByTestId("status-agente").textContent).toMatch(/Mensagem da IA \(follow-up\)/);
    expect(screen.queryByLabelText("Ligar agente")).toBeNull();
    expect(screen.getByRole("button", { name: /Follow-up/ }).textContent).toMatch(/follow-up · usado nos fluxos/);
    // config enxuta: sem número/link/horário do agente
    expect(screen.queryByLabelText("Número do agente")).toBeNull();
    expect(screen.getByLabelText("Mensagens do histórico")).toHaveValue(20);
  });

  it("simulador: escolhe a conversa e mostra a mensagem que sairia, sem enviar (modo followup)", async () => {
    invoke.mockResolvedValue({ data: { ok: true, enviado: false, historico_usado: 7, followup: { enviaria: true, texto: "Ana, ainda faz sentido?" } }, error: null });
    tela();
    const conversa = await screen.findByRole("button", { name: /Ana Souza/ }, { timeout: 3000 });
    fireEvent.click(conversa);
    fireEvent.click(screen.getByRole("button", { name: /Ver a mensagem que seria enviada/ }));
    const r = await screen.findByTestId("resultado-followup");
    expect(within(r).getByText("Ana, ainda faz sentido?")).toBeInTheDocument();
    expect(r.textContent).toMatch(/leu 7 mensagens/);
    const [nome, { body }] = invoke.mock.calls[0];
    expect(nome).toBe("ai-agent-simular");
    expect(body).toMatchObject({ modo: "followup", contato_phone: "5531988887777", tentativa: 1, agente: { id: "fu1", prompt: FU.prompt } });
  });

  it("simulador mostra o motivo quando não mandaria (falha da IA)", async () => {
    invoke.mockResolvedValue({ data: { ok: true, historico_usado: 3, followup: { enviaria: false, motivo: "IA (Claude) falhou: HTTP 503: sem chave", falha_ia: true } }, error: null });
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Ana Souza/ }, { timeout: 3000 }));
    fireEvent.click(screen.getByRole("button", { name: /Ver a mensagem que seria enviada/ }));
    expect((await screen.findByTestId("resultado-followup")).textContent).toMatch(/Não mandaria: IA \(Claude\) falhou: HTTP 503/);
  });

  it("'Criar agente de follow-up' grava tipo followup, desligado, com o prompt pronto", async () => {
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Criar agente de follow-up/ }));
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0].tabela).toBe("crm_ai_agents");
    expect(inserts[0].linha).toMatchObject({ tipo: "followup", ativo: false, nome: "Follow-up" });
    expect(String(inserts[0].linha.prompt)).toContain("retomando uma conversa");
  });

  it("'Novo agente' deixa escolher o tipo e grava o escolhido", async () => {
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Novo agente/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nome"), { target: { value: "Recuperar leads" } });
    fireEvent.click(within(dialogo).getByRole("radio", { name: /Follow-up/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar agente" }));
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0].linha).toMatchObject({ tipo: "followup", nome: "Recuperar leads", ativo: false });
    expect(String(inserts[0].linha.slug)).toMatch(/^recuperar-leads-/);
  });

  it("'Novo agente' do tipo atendimento grava tipo atendimento", async () => {
    tela();
    fireEvent.click(await screen.findByRole("button", { name: /Novo agente/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nome"), { target: { value: "Triagem" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar agente" }));
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0].linha).toMatchObject({ tipo: "atendimento", nome: "Triagem", ativo: false });
  });
});
