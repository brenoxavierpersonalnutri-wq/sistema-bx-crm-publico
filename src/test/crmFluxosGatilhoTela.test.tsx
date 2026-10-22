import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProvedorFluxos } from "@/components/crm/fluxos/contexto";
import { PainelGatilho } from "@/components/crm/fluxos/PainelGatilho";
import { SeletorTags } from "@/components/crm/SeletorTags";
import { criarFonteDemo } from "@/lib/crm/fluxosDemo";
import type { GatilhoFluxo } from "@/lib/crm/fluxosConstrutor";

// cmdk (lista do seletor) usa ResizeObserver e scrollIntoView, que o jsdom não tem
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

function abrir(gatilho: GatilhoFluxo | null, onSalvar = vi.fn()) {
  const fonte = criarFonteDemo();
  render(
    <ProvedorFluxos fonte={fonte} base="/dev/automacao-v2">
      <PainelGatilho fluxoId="f-1" fluxoNome="Leads do site" aberto gatilho={gatilho} config={{ limite_dia: 50 }}
        catalogo={{ numeros: [], templates: [], segmentos: [], listas: ["sellflux", "avaliacao"], roteiros: [], passosRoteiro: [], agentes: [], atendentes: [], fluxos: [], eventosVistos: [{ valor: "wh_carrinho", total: 3, ultimo: null }] }}
        onFechar={() => {}} onSalvar={onSalvar} />
    </ProvedorFluxos>,
  );
  return { onSalvar };
}

describe("Editar gatilho", () => {
  it("Formulário / evento vazio: sem erro antes de tentar salvar; com lista para escolher; erro só ao salvar", async () => {
    const { onSalvar } = abrir({ tipo: "evento", valor: "" });
    expect(screen.getByText("Escolha o formulário ou evento")).toBeInTheDocument();
    expect(screen.queryByText(/escolha o formulário\/evento/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar gatilho" }));
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByText("escolha o formulário/evento.")).toBeInTheDocument();
  });

  it("evento escolhido salva direto e mostra o rótulo", () => {
    const { onSalvar } = abrir({ tipo: "evento", valor: "banco_formulario" });
    expect(screen.getByText("Banco: Formulário da avaliação")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar gatilho" }));
    expect(onSalvar).toHaveBeenCalledWith({ tipo: "evento", valor: "banco_formulario" });
  });

  it("Novo lead no banco: formulário com filtro de nível e origem", () => {
    const { onSalvar } = abrir({ tipo: "banco", fonte: "formulario", niveis: [], origens: [], criado_em: "2026-10-18T10:00:00Z" });
    expect(screen.getByText(/Só registros NOVOS/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: "individual" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar gatilho" }));
    expect(onSalvar).toHaveBeenCalledWith({ tipo: "banco", fonte: "formulario", niveis: ["A", "B"], origens: ["individual"], criado_em: "2026-10-18T10:00:00Z" });
  });

  it("Webhook: URL do fluxo, última requisição e prévia do mapeamento", async () => {
    abrir({ tipo: "webhook", criado_em: "2026-10-18T10:00:00Z" });
    expect(await screen.findByTitle(/fluxo-entrada\?f=a1b2c3d4e5f6a7b8c9&k=/)).toBeInTheDocument();
    expect(screen.getByText("Última requisição recebida")).toBeInTheDocument();
    expect(screen.getByText(/"phone": "\+55 \(31\) 99999-0000"/)).toBeInTheDocument();
    expect(screen.getByText(/Com a amostra: telefone 5531999990000 · Maria Silva · maria@exemplo.com · tags lead-site, ebook/)).toBeInTheDocument();
    expect(screen.getByText("webhook:leads-do-site")).toBeInTheDocument();
  });
});

describe("Seletor de tags", () => {
  it("lista as tags existentes com uso, busca e cria tag nova normalizada já selecionada", async () => {
    const onMudar = vi.fn();
    const fonte = { listar: vi.fn(async () => [{ tag: "comprou", uso: 30 }, { tag: "vip", uso: 2 }]), criar: vi.fn(async (n: string) => n) };
    render(<SeletorTags valor={[]} onMudar={onMudar} fonte={fonte} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Tag" }));
    expect(await screen.findByText("comprou")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Buscar ou criar tag..."), { target: { value: "Lead Ébook" } });
    fireEvent.click(await screen.findByText(/Criar tag/));
    await waitFor(() => expect(fonte.criar).toHaveBeenCalledWith("lead-ebook"));
    expect(onMudar).toHaveBeenCalledWith(["lead-ebook"]);
  });

  it("escolher uma existente", async () => {
    const onMudar = vi.fn();
    const fonte = { listar: async () => [{ tag: "comprou", uso: 30 }], criar: async (n: string) => n };
    render(<SeletorTags multiplo valor={["vip"]} onMudar={onMudar} fonte={fonte} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Tag" }));
    fireEvent.click(await screen.findByText("comprou"));
    expect(onMudar).toHaveBeenCalledWith(["vip", "comprou"]);
  });
});
