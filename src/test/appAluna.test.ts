import { describe, it, expect } from "vitest";
import { parseYoutubeId, youtubeEmbed, youtubeThumb } from "@/lib/appAluna/types";

// Este parser espelha o trigger `exercicio_preenche_youtube` no Postgres.
// Se um formato passar aqui e falhar lá (ou vice-versa), o preview do
// formulário mente para quem está cadastrando o exercício.
describe("parseYoutubeId", () => {
  it("aceita os formatos que o Breno costuma colar", () => {
    const casos: [string, string][] = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ];
    for (const [url, esperado] of casos) {
      expect(parseYoutubeId(url), url).toBe(esperado);
    }
  });

  it("ignora parâmetros extras na URL", () => {
    expect(parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1"))
      .toBe("dQw4w9WgXcQ");
  });

  it("tolera espaços em volta", () => {
    expect(parseYoutubeId("  https://youtu.be/dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });

  it("devolve null para entrada vazia ou inválida", () => {
    expect(parseYoutubeId(null)).toBeNull();
    expect(parseYoutubeId(undefined)).toBeNull();
    expect(parseYoutubeId("")).toBeNull();
    expect(parseYoutubeId("https://vimeo.com/12345")).toBeNull();
    expect(parseYoutubeId("não é link")).toBeNull();
  });

  it("não aceita id de tamanho errado", () => {
    expect(parseYoutubeId("abc123")).toBeNull();
    expect(parseYoutubeId("dQw4w9WgXcQextra")).toBeNull();
  });
});

describe("URLs derivadas do id", () => {
  it("monta thumbnail e embed sem cookies de rastreio", () => {
    expect(youtubeThumb("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youtubeEmbed("dQw4w9WgXcQ")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("devolve null quando não há vídeo", () => {
    expect(youtubeThumb(null)).toBeNull();
    expect(youtubeEmbed(null)).toBeNull();
  });
});
