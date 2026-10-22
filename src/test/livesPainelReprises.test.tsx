// Tela das reprises: adicionar/remover datas, pré-visualização, "Programar reprises" manda as datas (ou a
// recorrência) com os campos herdados, lista com link e Cancelar. liveAula é falso (nada chega ao YouTube).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const liveAula = vi.fn();
vi.mock("@/lib/lives/aula", () => ({ liveAula: (...a: unknown[]) => liveAula(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { PainelReprises } from "@/components/lives/estudio/PainelReprises";
import { deLocalBrt, paraLocalBrt } from "../../supabase/functions/_shared/reprises";

// datas dentro do horizonte (1 ano): daqui a 10 e 17 dias, 19:00 em Brasília
const diaBrt = (dias: number) => `${paraLocalBrt(new Date(Date.now() + dias * 86_400_000)).slice(0, 10)}T19:00`;
const D1 = diaBrt(10);
const D2 = diaBrt(17);
const utc = (local: string) => deLocalBrt(local)!.toISOString();

const LISTA = {
  reprises: [
    { id: "r1", titulo: "Aula (10/11 19h)", agendada_em: "2099-11-10T22:00:00Z", status: "rascunho", serie_id: null, estado: "programada", erro: null, link: "https://youtu.be/BCAST1", pode_cancelar: true },
    { id: "r2", titulo: "Aula", agendada_em: "2099-11-17T22:00:00Z", status: "rascunho", serie_id: null, estado: "cancelada", erro: null, link: null, pode_cancelar: false },
  ],
  series: [],
};

function montar() {
  const corpoBase = vi.fn(async () => ({ auto_iniciar: true, aula_video_id: "v1", titulo: "Aula", privacidade: "unlisted" }));
  render(<MemoryRouter><PainelReprises salaId="s1" corpoBase={corpoBase} temMiniatura={false} temPlaylist destinosYt={1} /></MemoryRouter>);
  return { corpoBase };
}

beforeEach(() => {
  liveAula.mockReset();
  liveAula.mockImplementation(async (acao: string) => {
    if (acao === "reprises") return LISTA;
    if (acao === "reprisar") return { criadas: [{ room_id: "n1", agendada_em: "2099-01-01T22:00:00Z", links: [] }], faltaram: [{ agendada_em: "2099-01-08T22:00:00Z", motivo: "cota diária do YouTube esgotada: não tentei" }], avisos: [], cota_esgotou: true };
    if (acao === "reprise-cancelar") return { avisos: [] };
    return {};
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("PainelReprises", () => {
  it("várias datas: adiciona, remove, mostra a prévia e manda as datas em UTC com os campos herdados", async () => {
    const { corpoBase } = montar();
    fireEvent.change(screen.getByLabelText("Data da reprise 1"), { target: { value: D1 } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar data/ }));
    fireEvent.change(screen.getByLabelText("Data da reprise 2"), { target: { value: D2 } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar data/ }));
    fireEvent.click(screen.getByLabelText("Remover data 3"));
    expect(screen.queryByLabelText("Data da reprise 3")).toBeNull();
    expect(screen.getByLabelText("Pré-visualização das reprises")).toHaveTextContent("2 reprises");
    expect(screen.getByLabelText("Pré-visualização das reprises")).toHaveTextContent("cerca de 106 de 10.000");
    fireEvent.click(screen.getByRole("button", { name: /Programar reprises \(2\)/ }));
    await waitFor(() => expect(liveAula).toHaveBeenCalledWith("reprisar", expect.objectContaining({
      room_id: "s1", datas: [utc(D1), utc(D2)], aula_video_id: "v1", auto_iniciar: true, sufixo_data: true,
    })));
    expect(corpoBase).toHaveBeenCalled();
    // cota acabou: lista o que faltou, sem quebrar
    expect(await screen.findByText(/Não criadas/)).toBeInTheDocument();
    expect(screen.getByText(/esgotada: não tentei/)).toBeInTheDocument();
  });

  it("recorrência: manda a regra (o servidor recalcula), não a lista", async () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: "Repetir" }));
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: D1 } });
    expect(screen.getByLabelText("Pré-visualização das reprises")).toHaveTextContent("8 reprises");
    fireEvent.click(screen.getByRole("button", { name: /Programar reprises \(8\)/ }));
    await waitFor(() => expect(liveAula).toHaveBeenCalledWith("reprisar", expect.objectContaining({
      recorrencia: { frequencia_dias: 7, inicio: utc(D1), quantidade: 8 },
    })));
  });

  it("lista: link copiável, estado e Cancelar só na que pode", async () => {
    montar();
    expect(await screen.findByDisplayValue("https://youtu.be/BCAST1")).toBeInTheDocument();
    expect(screen.getByText("Programada")).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    const cancelar = screen.getAllByRole("button", { name: "Cancelar" });
    expect(cancelar).toHaveLength(1);
    fireEvent.click(cancelar[0]);
    await waitFor(() => expect(liveAula).toHaveBeenCalledWith("reprise-cancelar", { room_id: "r1" }));
    expect(screen.getByRole("button", { name: /Cancelar todas as futuras/ })).toBeInTheDocument();
  });
});
