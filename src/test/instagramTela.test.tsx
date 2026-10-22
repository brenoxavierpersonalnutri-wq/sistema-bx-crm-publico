// Instagram Direct na tela Conversas: pílulas de canal, selo na foto e aviso da janela de 24 h.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Conversa, ContatoCRM } from "@/lib/crm/conversas";
import { ListaConversas } from "@/components/crm/conversas/ListaConversas";
import { AvatarContato } from "@/components/crm/conversas/AvatarContato";
import { AvisoJanelaInstagram } from "@/components/crm/conversas/AvisoJanelaInstagram";

const AGORA = new Date("2026-10-17T15:00:00Z");
const conv = (c: ContatoCRM): Conversa => ({ contato: c, ultima: null, naoLidas: 0, ordem: "2026-10-17T10:00:00Z", semConversa: false });
const ig: ContatoCRM = { id: "i1", phone: "ig:1234567890123456789", name: "Ana Paula", username: "ana.fit", stage: "leads", updated_at: "", canal: "instagram" };
const wa: ContatoCRM = { id: "w1", phone: "5531999998888", name: "Bia", stage: "leads", updated_at: "" };

describe("lista com Instagram", () => {
  it("mostra pílulas WhatsApp/Instagram só quando há conversa do Direct, e filtra", () => {
    const { rerender } = render(<ListaConversas conversas={[conv(wa)]} selecionado={null} onSelecionar={() => undefined} agora={AGORA} />);
    expect(screen.queryByRole("tab", { name: "Instagram" })).toBeNull();
    rerender(<ListaConversas conversas={[conv(wa), conv(ig)]} selecionado={null} onSelecionar={() => undefined} agora={AGORA} />);
    fireEvent.click(screen.getByRole("tab", { name: "Instagram" }));
    const itens = screen.getAllByTestId("item-conversa");
    expect(itens).toHaveLength(1);
    expect(itens[0].getAttribute("data-canal")).toBe("instagram");
    fireEvent.click(screen.getByRole("tab", { name: "WhatsApp" }));
    expect(screen.getAllByTestId("item-conversa")[0].getAttribute("data-phone")).toBe("5531999998888");
  });

  it("selo do Instagram na foto do Direct e não no WhatsApp", () => {
    const { unmount } = render(<AvatarContato contato={ig} />);
    expect(screen.getByTestId("selo-instagram")).toBeTruthy();
    expect(screen.getByTestId("avatar-contato").getAttribute("data-grupo")).toBe("nao");
    unmount();
    render(<AvatarContato contato={wa} />);
    expect(screen.queryByTestId("selo-instagram")).toBeNull();
  });
});

describe("aviso da janela", () => {
  it("aberta: mostra até quando; fechada: explica o motivo", () => {
    const { unmount } = render(<AvisoJanelaInstagram ultimaEntrada="2026-10-17T10:00:00Z" agora={AGORA} />);
    expect(screen.getByTestId("aviso-janela-instagram").getAttribute("data-aberta")).toBe("sim");
    expect(screen.getByText(/Janela do Direct aberta até 18\/10/)).toBeTruthy();
    unmount();
    render(<AvisoJanelaInstagram ultimaEntrada="2026-10-14T10:00:00Z" agora={AGORA} />);
    expect(screen.getByTestId("aviso-janela-instagram").getAttribute("data-aberta")).toBe("nao");
    expect(screen.getByText(/Passou de 24 h/)).toBeTruthy();
  });
});
