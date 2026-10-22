// Semana de aulas: datas seguidas no mesmo horário (Brasília), nome da semana, validação, cota (playlist + 6 lives
// + 6 itens), corpo do playlists.insert e a tela (cria a playlist e depois as aulas NA ORDEM, uma por chamada;
// cota acabou = para e lista as que faltaram; Repetir semana preenche +7 dias). Nada fala com o YouTube.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClienteYouTube, corpoPlaylist } from "../../supabase/functions/_shared/youtube";
import { custoSemana, datasSeguidas, deslocarAulas, linkPlaylist, nomeDaSemana, programarEmOrdem, validarSemana } from "../../supabase/functions/_shared/semanaAulas";
import { deLocalBrt, paraLocalBrt } from "../../supabase/functions/_shared/reprises";

const liveAula = vi.fn();
vi.mock("@/lib/lives/aula", () => ({ liveAula: (...a: unknown[]) => liveAula(...a), arquivoParaBase64: async () => "AAAA" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
import { PainelSemana } from "@/components/lives/estudio/PainelSemana";

const AGORA = new Date("2026-10-21T12:00:00Z");
const V = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

describe("regras da semana", () => {
  it("6 dias seguidos no mesmo horário de Brasília", () => {
    expect(datasSeguidas("2026-10-27T20:00")).toEqual(["2026-10-27T20:00", "2026-10-28T20:00", "2026-10-29T20:00", "2026-10-30T20:00", "2026-10-31T20:00", "2026-11-01T20:00"]);
    expect(datasSeguidas("")).toEqual([]);
  });
  it("nome sugerido troca a data do nome pela da primeira aula", () => {
    expect(nomeDaSemana("LPSG – Semana 20/10", deLocalBrt("2026-10-27T20:00"))).toBe("LPSG – Semana 27/10");
    expect(nomeDaSemana("", deLocalBrt("2026-10-27T20:00"))).toBe("Semana 27/10");
    expect(nomeDaSemana("LPSG", deLocalBrt("2026-10-27T20:00"))).toBe("LPSG 27/10");
  });
  it("repetir semana desloca 7 dias mantendo título e vídeo", () => {
    expect(deslocarAulas([{ titulo: "A1", video_id: V(1), agendada_em: "2026-10-27T23:00:00.000Z" }])).toEqual([{ titulo: "A1", video_id: V(1), agendada_em: "2026-11-03T23:00:00.000Z" }]);
  });
  it("validação: nome, título, vídeo, data futura e sem horário repetido", () => {
    const a = (i: number, o: Partial<{ titulo: string; video_id: string; agendada_em: string }> = {}) => ({ titulo: `Aula ${i}`, video_id: V(i), agendada_em: new Date(AGORA.getTime() + i * 86_400_000).toISOString(), ...o });
    expect(validarSemana({ nome: "S", aulas: [a(1), a(2)] }, AGORA)).toBeNull();
    expect(validarSemana({ nome: " ", aulas: [a(1)] }, AGORA)).toMatch(/nome/);
    expect(validarSemana({ nome: "S", aulas: [a(1, { titulo: "" })] }, AGORA)).toMatch(/Aula 1: falta o título/);
    expect(validarSemana({ nome: "S", aulas: [a(1, { video_id: "" })] }, AGORA)).toMatch(/vídeo/);
    expect(validarSemana({ nome: "S", aulas: [a(1, { agendada_em: "2026-10-20T10:00:00Z" })] }, AGORA)).toMatch(/futuro/);
    expect(validarSemana({ nome: "S", aulas: [a(1), a(2, { agendada_em: a(1).agendada_em })] }, AGORA)).toMatch(/mesma data/);
    expect(validarSemana({ nome: "S", aulas: Array.from({ length: 8 }, (_, i) => a(i + 1)) }, AGORA)).toMatch(/no máximo 7/);
  });
  it("cota: playlist nova 50 + 6 x (3 + 50) = 368; com 6 miniaturas +300", () => {
    expect(custoSemana({ aulas: 6, criarPlaylist: true, miniaturas: 0 })).toBe(368);
    expect(custoSemana({ aulas: 6, criarPlaylist: false, miniaturas: 6 })).toBe(618);
  });
  it("playlist: corpo do playlists.insert e link", async () => {
    expect(corpoPlaylist("LPSG – Semana 27/10", "unlisted")).toEqual({ snippet: { title: "LPSG – Semana 27/10", description: "" }, status: { privacyStatus: "unlisted" } });
    expect(linkPlaylist("PLabc")).toBe("https://www.youtube.com/playlist?list=PLabc");
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "PLnovo", snippet: { title: "S" } }), { status: 200 }));
    expect(await new ClienteYouTube("at", f as unknown as typeof fetch).criarPlaylist("S", "unlisted")).toEqual({ id: "PLnovo", titulo: "S" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/youtube\/v3\/playlists\?part=id%2Csnippet%2Cstatus$/);
    expect(init.method).toBe("POST");
  });
});

// a tela tem 6 aulas com selects e miniatura: no jsdom passa de 5 s
describe("PainelSemana", { timeout: 30_000 }, () => {
  const videos = [1, 2, 3, 4, 5, 6].map((n) => ({ id: V(n), nome: `Vídeo ${n}`, status: "pronto" })) as never[];
  const inicio = `${paraLocalBrt(new Date(Date.now() + 5 * 86_400_000)).slice(0, 10)}T20:00`;

  beforeEach(() => {
    liveAula.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  function preencher() {
    fireEvent.click(screen.getByRole("button", { name: /Semana de aulas/ }));
    fireEvent.change(screen.getByLabelText(/Primeira aula/), { target: { value: inicio } });
    for (let i = 1; i <= 6; i++) fireEvent.change(screen.getByLabelText(`Título da aula ${i}`), { target: { value: `Aula ${i}` } });
  }

  it("pré-preenche 6 dias seguidos e o nome da semana", () => {
    liveAula.mockResolvedValue({ semanas: [] });
    render(<PainelSemana salaId="s1" videos={videos} playlists={[]} temCanal />);
    preencher();
    expect((screen.getByLabelText("Data da aula 6") as HTMLInputElement).value).toBe(datasSeguidas(inicio)[5]);
    expect((screen.getByLabelText(/Nome da semana/) as HTMLInputElement).value).toMatch(/^Semana \d{2}\/\d{2}$/);
  });

  it("sem vídeo escolhido em todas as aulas, Programar semana fica travado", () => {
    liveAula.mockResolvedValue({ semanas: [] });
    render(<PainelSemana salaId="s1" videos={videos} playlists={[]} temCanal />);
    preencher();
    expect(screen.getByRole("button", { name: "Programar semana" })).toBeDisabled();
  });

  it("lista: link da playlist, links das aulas e Repetir semana preenche +7 dias com playlist nova", async () => {
    const d1 = new Date(Date.now() + 2 * 86_400_000);
    d1.setUTCMinutes(0, 0, 0);
    liveAula.mockResolvedValue({ semanas: [{
      id: "SEM1", nome: "LPSG – Semana 20/10", privacidade: "unlisted", playlist_id: "PL1", playlist_criada: true, playlist_link: "https://www.youtube.com/playlist?list=PL1",
      aulas: [{ id: "r1", ordem: 1, titulo: "Abertura", agendada_em: d1.toISOString(), video_id: V(1), estado: "programada", erro: null, link: "https://youtu.be/B1", pode_cancelar: true }],
    }] });
    render(<PainelSemana salaId="s1" videos={videos} playlists={[]} temCanal />);
    fireEvent.click(screen.getByRole("button", { name: /Semana de aulas/ }));
    const card = await screen.findByLabelText("Semana LPSG – Semana 20/10");
    expect(within(card).getByDisplayValue("https://www.youtube.com/playlist?list=PL1")).toBeInTheDocument();
    expect(within(card).getByDisplayValue("https://youtu.be/B1")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Repetir semana" }));
    const mais7 = paraLocalBrt(new Date(d1.getTime() + 7 * 86_400_000));
    await waitFor(() => expect((screen.getByLabelText("Data da aula 1") as HTMLInputElement).value).toBe(mais7));
    expect((screen.getByLabelText("Título da aula 1") as HTMLInputElement).value).toBe("Abertura");
    expect((screen.getByLabelText(/Nome da semana/) as HTMLInputElement).value).toBe(`LPSG – Semana ${mais7.slice(8, 10)}/${mais7.slice(5, 7)}`);
  });
});

describe("programarEmOrdem", () => {
  it("chama na ordem; cota na 4a para o resto sem quebrar", async () => {
    const ordem: number[] = [];
    const r = await programarEmOrdem([3, 1, 2, 4, 5, 6].map((o) => ({ ordem: o })), async ({ ordem: o }) => {
      ordem.push(o);
      if (o === 4) throw new Error("aula 4: cota diária do YouTube esgotada");
    });
    expect(ordem).toEqual([1, 2, 3, 4]);
    expect(r.feitas).toBe(3);
    expect(r.faltaram.map((f) => f.ordem)).toEqual([4, 5, 6]);
    expect(r.faltaram[1].motivo).toMatch(/não tentei/);
  });
  it("erro comum numa aula não para as outras", async () => {
    const r = await programarEmOrdem([1, 2, 3].map((o) => ({ ordem: o })), async ({ ordem: o }) => { if (o === 2) throw new Error("vídeo não está pronto"); });
    expect(r).toEqual({ feitas: 2, faltaram: [{ ordem: 2, motivo: "vídeo não está pronto" }] });
  });
});
