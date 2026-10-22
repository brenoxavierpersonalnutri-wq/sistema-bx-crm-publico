import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CartaoNumero } from "@/components/crm/central/CartaoNumero";
import { VisaoGeral } from "@/components/crm/central/VisaoGeral";
import { NUMEROS_PADRAO } from "@/lib/crm/central";
import type { DadosCentral } from "@/hooks/useCentralAutomacao";

describe("Central de Automação (tela)", () => {
  it("cartão mostra apelido, tipo, status, uso do dia e ligados", () => {
    const onClick = vi.fn();
    render(
      <CartaoNumero numero={NUMEROS_PADRAO[4]} status={{ estado: "oficial", rotulo: "API oficial", telefone: null, aviso: null }}
        envios={12} fluxos={3} automacoes={1} selecionado={false} onClick={onClick} />,
    );
    expect(screen.getByText("Oficial (Full Funnel)")).toBeTruthy();
    expect(screen.getByText(/\(31\) 7000-0102/)).toBeTruthy();
    expect(screen.getByText("oficial")).toBeTruthy();
    expect(screen.getByText("API oficial")).toBeTruthy();
    expect(screen.getByText("12 / 200")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });

  it("visão geral mostra totais, próximos disparos e alerta clicável", () => {
    const onAbrir = vi.fn();
    const dados = {
      numeros: NUMEROS_PADRAO,
      resumo: { enviados: 7, respondidos: 2, falhas: 1, pausas: 0 },
      agendados: [{ id: 1, origem: "automacao", contact_phone: "5531999991234", agendado_para: "2026-10-17T15:00:00Z", numero_id: null, automacao_id: "a1", campanha_id: null }],
      alertas: [{ nivel: "erro", numeroId: "seed-closer", texto: "Closer desconectado com 2 automação(ões)/fluxo(s) ligado(s)" }],
      automacoes: [{ id: "a1", nome: "Boas-vindas" }],
      campanhas: [],
      fluxos: [],
    } as unknown as DadosCentral;
    render(<MemoryRouter><VisaoGeral dados={dados} onAbrirNumero={onAbrir} /></MemoryRouter>);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/Boas-vindas · …1234/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Closer desconectado/));
    expect(onAbrir).toHaveBeenCalledWith("seed-closer");
  });
});
