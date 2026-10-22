// Live programada com vídeo: o tick só liga a transmissão depois que o "Vídeo da aula" publica imagem, e o quadro
// que vai pro ar nunca mostra "Ninguém no palco" (nem as iniciais do vídeo enquanto a imagem não chega).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ESPERA_VIDEO_PUBLICAR_MS, videoAulaPublicado } from "../../supabase/functions/_shared/aulaVideo";
import { QuadroCena } from "@/components/lives/QuadroCena";

const ID = "aula-video-0123abcd";

describe("videoAulaPublicado", () => {
  it("só conta com faixa de vídeo publicada e não mutada do participante do vídeo", () => {
    expect(videoAulaPublicado([], ID)).toBe(false);
    expect(videoAulaPublicado([{ identity: ID, tracks: [] }], ID)).toBe(false);
    expect(videoAulaPublicado([{ identity: ID, tracks: [{ type: 0 }] }], ID)).toBe(false); // só áudio
    expect(videoAulaPublicado([{ identity: ID, tracks: [{ type: "VIDEO", muted: true }] }], ID)).toBe(false);
    expect(videoAulaPublicado([{ identity: ID, tracks: [{ type: 1 }] }], ID)).toBe(true);
    expect(videoAulaPublicado([{ identity: ID, tracks: [{ type: "VIDEO" }] }], ID)).toBe(true);
    expect(videoAulaPublicado([{ identity: "outra", tracks: [{ type: 1 }] }], ID)).toBe(false);
    expect(videoAulaPublicado(null, ID)).toBe(false);
  });
  it("teto da espera é curto (a live não atrasa mais que isso)", () => {
    expect(ESPERA_VIDEO_PUBLICAR_MS).toBeLessThanOrEqual(30_000);
  });
});

const base = { overlays: [], nomeDe: () => "Vídeo da aula", renderVideo: () => null };
const blocoVideo = { key: "v", identity: ID, fonte: "camera" as const, x: 0, y: 0, w: 1, h: 1, z: 1 };

describe("QuadroCena", () => {
  it("estúdio: palco vazio avisa 'Ninguém no palco'", () => {
    render(<QuadroCena {...base} blocos={[]} />);
    expect(screen.getByText("Ninguém no palco")).toBeInTheDocument();
  });
  it("no ar (render): palco vazio fica preto e limpo", () => {
    const { container } = render(<QuadroCena {...base} blocos={[]} transmissao />);
    expect(screen.queryByText("Ninguém no palco")).toBeNull();
    expect(container.textContent).toBe("");
  });
  it("no ar: vídeo da aula sem imagem ainda não mostra iniciais", () => {
    const { container } = render(<QuadroCena {...base} blocos={[blocoVideo] as never} transmissao />);
    expect(container.textContent).toBe("");
    render(<QuadroCena {...base} blocos={[blocoVideo] as never} />);
    expect(screen.getByText("VD")).toBeInTheDocument(); // no estúdio continua o avatar
  });
});
