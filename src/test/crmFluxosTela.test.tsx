import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProvedorFluxos } from "@/components/crm/fluxos/contexto";
import { ListaFluxos } from "@/components/crm/fluxos/ListaFluxos";
import { ConstrutorFluxo } from "@/components/crm/fluxos/ConstrutorFluxo";
import { criarFonteDemo } from "@/lib/crm/fluxosDemo";

function montar(rota: string, fonte = criarFonteDemo()) {
  return render(
    <ProvedorFluxos fonte={fonte} base="/dev/automacao-v2">
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/dev/automacao-v2" element={<ListaFluxos />} />
          <Route path="/dev/automacao-v2/fluxos/:id" element={<ConstrutorFluxo />} />
        </Routes>
      </MemoryRouter>
    </ProvedorFluxos>,
  );
}

describe("Lista de fluxos", () => {
  it("mostra os 5 espelhos do Full Funnel com o número de lá como referência", async () => {
    montar("/dev/automacao-v2");
    await screen.findByText("Leads qualificados – Breno Xavier (FF)");
    expect(screen.getByText("no Full Funnel: 70 inscritos")).toBeInTheDocument();
    for (const n of [23, 10, 2, 1]) expect(screen.getByText(`no Full Funnel: ${n} inscritos`)).toBeInTheDocument();
    expect(screen.getAllByText("Rascunho").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Publicado")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total inscritos" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Inscritos ativos" })).toBeInTheDocument();
  });

  it("abas Rascunhos/Excluídos e busca", async () => {
    montar("/dev/automacao-v2");
    await screen.findByText("Recuperação de Pix (exemplo)");
    fireEvent.click(screen.getByRole("tab", { name: /Rascunhos/ }));
    expect(screen.queryByText("Recuperação de Pix (exemplo)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Excluídos/ }));
    expect(screen.getByText("Teste antigo (excluído)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Todos/ }));
    fireEvent.change(screen.getByLabelText("Buscar fluxo"), { target: { value: "low ticket" } });
    expect(screen.getAllByRole("row").length).toBe(3); // cabeçalho + 2
  });
});

describe("Construtor", () => {
  it("desenha gatilhos com 'Ou', ramos Sim/Senão e FIM", async () => {
    montar("/dev/automacao-v2/fluxos/f-recup");
    await screen.findByLabelText("Canvas do fluxo");
    expect(screen.getByText("Gatilhos")).toBeInTheDocument();
    expect(screen.getByText("Ou")).toBeInTheDocument();
    expect(screen.getByText("Sim")).toBeInTheDocument();
    expect(screen.getByText("Senão")).toBeInTheDocument();
    expect(screen.getByText("FIM")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico de inscrição" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Logs de execução" })).toBeInTheDocument();
  });

  it("número oficial com texto livre impede publicar", async () => {
    const fonte = criarFonteDemo();
    const id = await fonte.criar("Teste oficial", null);
    const f = (await fonte.obter(id))!;
    await fonte.salvar({
      ...f,
      gatilhos: [{ tipo: "tag", valor: "vip" }],
      arvore: [{ id: "w1", passo: { tipo: "whatsapp", numero_id: "num-oficial", texto: "oi" } }],
    });
    montar(`/dev/automacao-v2/fluxos/${id}`, fonte);
    await screen.findByLabelText("Canvas do fluxo");
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/só envia template/)).toBeInTheDocument();
  });

  it("histórico de inscrição lista os contatos e status", async () => {
    montar("/dev/automacao-v2/fluxos/f-recup");
    await screen.findByLabelText("Canvas do fluxo");
    fireEvent.click(screen.getByRole("tab", { name: "Histórico de inscrição" }));
    await waitFor(() => expect(screen.getByText("Ana Paula")).toBeInTheDocument());
    expect(screen.getByText("Parou (respondeu)")).toBeInTheDocument();
  });
});
