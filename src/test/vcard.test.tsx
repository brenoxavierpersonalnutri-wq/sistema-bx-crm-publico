import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ehVCard, lerVCards } from "@/lib/crm/vcard";
import { previaDaMensagem, type MensagemCRM } from "@/lib/crm/conversas";
import { BolhaMensagem } from "@/components/crm/conversas/BolhaMensagem";

const VCARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Souza;Gabriele;;;",
  "FN:Gabriele Souza",
  "item1.TEL;type=CELL;waid=5511987654321:+55 11 98765-4321",
  "item1.X-ABLabel:Celular",
  "END:VCARD",
].join("\n");

const msg = (body: string): MensagemCRM => ({
  id: "1", contact_phone: "5511900000000", body, created_at: "2026-10-17T22:00:00Z",
  direction: "inbound", sender_type: "lead",
});

describe("vCard", () => {
  it("lê nome e telefone (waid tem prioridade)", () => {
    expect(ehVCard(VCARD)).toBe(true);
    expect(lerVCards(VCARD)).toEqual([
      { nome: "Gabriele Souza", telefones: [{ digitos: "5511987654321", original: "+55 11 98765-4321" }] },
    ]);
  });
  it("sem FN usa o N; sem waid usa os dígitos do TEL; vários cartões", () => {
    const dois = `BEGIN:VCARD\nN:Lima;Ana;;;\nTEL:+55 (21) 3333-4444\nEND:VCARD\n${VCARD}`;
    const r = lerVCards(dois);
    expect(r.map((c) => c.nome)).toEqual(["Ana Lima", "Gabriele Souza"]);
    expect(r[0].telefones[0].digitos).toBe("552133334444");
  });
  it("texto comum não é vCard", () => {
    expect(lerVCards("oi, tudo bem?")).toEqual([]);
    expect(lerVCards("BEGIN:VCARD sem fim")).toEqual([]);
  });
  it("prévia da lista mostra o nome, não o texto cru", () => {
    expect(previaDaMensagem(msg(VCARD)).texto).toBe("Contato: Gabriele Souza");
  });
  it("bolha desenha o cartão e o botão abre a conversa do número", () => {
    const abrir = vi.fn();
    render(<BolhaMensagem msg={msg(VCARD)} primeiraDoGrupo ultimaDoGrupo onAbrirConversa={abrir} />);
    expect(screen.getByTestId("cartao-contato")).toBeTruthy();
    expect(screen.getByText("Gabriele Souza")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VCARD/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /abrir conversa/i }));
    expect(abrir).toHaveBeenCalledWith("5511987654321");
  });
});
