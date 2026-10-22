// Modal de destinos: YouTube abre com "Conectar conta do YouTube"; a chave manual fica em "Avançado";
// canal conectado mostra nome, foto e os campos da transmissão.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

let contas: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: async () => ({ data: contas, error: null }) }) }),
    functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
  },
}));

import { PainelDestinos } from "@/components/lives/estudio/PainelDestinos";
import type { LiveRoom } from "@/lib/lives/api";

const sala = {
  id: "s1", titulo: "Live de sábado", livekit_room: "s1", layout: "grade", cor: null, status: "rascunho", egress_id: null,
  gravacao_egress_id: null, cf_live_input_uid: "x", cf_hls_url: null, cf_conectado: false, ultimo_erro: null, iniciada_em: null, created_at: "",
} as LiveRoom;

describe("destino YouTube conectado", () => {
  beforeEach(() => { contas = []; });

  it("sem canal: botão Conectar e chave manual escondida até abrir o Avançado", async () => {
    render(<PainelDestinos sala={sala} destinos={[]} recarregar={() => undefined} />);
    expect(await screen.findByRole("button", { name: /Conectar conta do YouTube/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Chave de transmissão")).toBeNull();
    fireEvent.click(screen.getByText(/Avançado: colar servidor e chave/));
    expect(screen.getByPlaceholderText("Chave de transmissão")).toBeTruthy();
  });

  it("com canal: mostra o canal e os campos título/descrição/privacidade, título padrão = sala", async () => {
    contas = [{ id: "00000000-0000-0000-0000-000000000001", canal_id: "UC1", titulo: "Canal BX", foto_url: "https://yt3/f.jpg", status: "conectado", ultimo_erro: null }];
    render(<PainelDestinos sala={sala} destinos={[]} recarregar={() => undefined} />);
    await waitFor(() => expect(screen.getByText("Canal BX")).toBeTruthy());
    expect((screen.getByPlaceholderText("Título da transmissão") as HTMLInputElement).value).toBe("Live de sábado");
    expect(screen.getByRole("combobox", { name: "Privacidade" }).textContent).toContain("Não listado");
    expect(screen.getByRole("button", { name: "Adicionar destino YouTube" })).toBeTruthy();
  });

  it("destino conectado na lista: link ver no YouTube e sem final de chave", () => {
    render(<PainelDestinos sala={sala} destinos={[{ id: "d1", tipo: "youtube", nome: "YouTube · Canal BX", rtmp_url: "rtmps://a", chave_final: "conta conectada", ativo: true, no_ar: true, modo: "youtube_api", yt_privacidade: "unlisted", yt_video_id: "VID123", yt_estado: "ao_vivo" }]} recarregar={() => undefined} />);
    const link = screen.getByRole("link", { name: /ver no YouTube/ }) as HTMLAnchorElement;
    expect(link.href).toBe("https://www.youtube.com/watch?v=VID123");
    expect(screen.getByText(/YouTube conectado · Não listado · ao vivo no YouTube/)).toBeTruthy();
  });
});
