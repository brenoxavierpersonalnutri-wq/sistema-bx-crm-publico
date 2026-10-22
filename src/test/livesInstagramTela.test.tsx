// Cartão Instagram Live e interruptor por destino: a chave é campo senha, a guardada aparece só mascarada,
// e o aviso de que a chave muda a cada live está na tela.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
  },
}));

import { PainelDestinos } from "@/components/lives/estudio/PainelDestinos";
import type { LiveDestino, LiveRoom } from "@/lib/lives/api";

const sala = {
  id: "s1", titulo: "Live", livekit_room: "s1", layout: "grade", cor: null, status: "rascunho", egress_id: null,
  gravacao_egress_id: null, cf_live_input_uid: "x", cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: null, created_at: "",
} as LiveRoom;
const ig: LiveDestino = { id: "ig1", tipo: "instagram", nome: "Instagram Live", rtmp_url: "rtmps://edgetee-upload.xx.fbcdn.net:443/rtmp/", chave_final: "••••1234", ativo: true, no_ar: false };
const yt: LiveDestino = { id: "yt1", tipo: "youtube", nome: "YouTube · Canal BX", rtmp_url: "rtmps://a", chave_final: "conta conectada", ativo: true, no_ar: false, modo: "youtube_api" };

describe("Instagram Live no painel de destinos", () => {
  it("um interruptor por destino com o rótulo da live", () => {
    render(<PainelDestinos sala={sala} destinos={[yt, ig]} recarregar={() => undefined} />);
    expect(screen.getByRole("switch", { name: /Transmitir para este destino nesta live: YouTube/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Transmitir para este destino nesta live: Instagram Live/ })).toBeTruthy();
    expect(screen.getByText(/Vai ao ar em: YouTube · Canal BX, Instagram Live\./)).toBeTruthy();
  });

  it("colar a chave desta live abre o cartão: passos, aviso, faixas, chave mascarada e campo senha", () => {
    render(<PainelDestinos sala={sala} destinos={[yt, ig]} recarregar={() => undefined} />);
    fireEvent.click(screen.getByText("colar a chave desta live"));
    expect(screen.getByText(/Transmitir via RTMP\/software/)).toBeTruthy();
    expect(screen.getByText("A chave muda a cada live: cole uma nova antes de ir ao vivo.")).toBeTruthy();
    expect(screen.getByText(/Aparece com faixas no Instagram/)).toBeTruthy();
    expect(screen.getByText("Chave guardada: ••••1234")).toBeTruthy();
    expect(screen.queryByText(/AbSecreto/)).toBeNull();
    const chave = screen.getByPlaceholderText("Cole a chave desta live") as HTMLInputElement;
    expect(chave.type).toBe("password");
    expect((screen.getByPlaceholderText("rtmps://...:443/rtmp/") as HTMLInputElement).value).toBe(ig.rtmp_url);
  });

  it("salvar manda a chave pro live-control editando o MESMO destino (id) e limpa o campo", async () => {
    const recarregar = vi.fn();
    render(<PainelDestinos sala={sala} destinos={[ig]} recarregar={recarregar} />);
    fireEvent.click(screen.getByText("colar a chave desta live"));
    fireEvent.change(screen.getByPlaceholderText("Cole a chave desta live"), { target: { value: "nova-chave-5678" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar a chave do Instagram" }));
    await vi.waitFor(() => expect(recarregar).toHaveBeenCalled());
    const corpo = (invoke.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])[1].body;
    expect(corpo).toMatchObject({ acao: "salvar-destino", tipo: "instagram", id: "ig1", chave: "nova-chave-5678" });
    expect((screen.getByPlaceholderText("Cole a chave desta live") as HTMLInputElement).value).toBe("");
  });

  it("ao vivo, Instagram que caiu mostra o motivo", () => {
    render(<PainelDestinos sala={{ ...sala, status: "ao_vivo" }} destinos={[{ ...ig, yt_erro: "a plataforma recusou o vídeo" }]} recarregar={() => undefined} />);
    expect(screen.getByText(/caiu: a plataforma recusou o vídeo/)).toBeTruthy();
  });
});
