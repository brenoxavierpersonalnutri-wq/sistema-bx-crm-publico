import { describe, it, expect, vi } from "vitest";
import { enviarNotaDeVoz, ehOggOpus, proxySemConversao, proxySemRota } from "../../supabase/functions/_shared/notaDeVoz";

class ErroFalso extends Error {
  constructor(public status: number, public detalhe: unknown) { super(`proxy ${status}`); }
}

describe("enviarNotaDeVoz", () => {
  const corpo = { phone: "5531999998888", url: "https://x.supabase.co/v.ogg", filename: "audio.ogg" };

  it("manda pela rota send-audio com ptt e sem filename", async () => {
    const chamar = vi.fn().mockResolvedValue({ messageId: "abc" });
    await expect(enviarNotaDeVoz(chamar, corpo)).resolves.toEqual({ messageId: "abc", como: "voz" });
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(chamar).toHaveBeenCalledWith("send-audio", { phone: corpo.phone, url: corpo.url, ptt: true });
  });

  it("proxy antigo (404 não existe): cai para send-document com o nome do arquivo", async () => {
    const chamar = vi.fn()
      .mockRejectedValueOnce(new ErroFalso(404, { error: "não existe" }))
      .mockResolvedValueOnce({ messageId: 7 });
    await expect(enviarNotaDeVoz(chamar, corpo)).resolves.toEqual({ messageId: "7", como: "documento" });
    expect(chamar).toHaveBeenLastCalledWith("send-document", { phone: corpo.phone, url: corpo.url, filename: "audio.ogg" });
  });

  it("proxy não conseguiu converter (422 conversao): cai para send-document", async () => {
    const chamar = vi.fn()
      .mockRejectedValueOnce(new ErroFalso(422, { error: "não consegui converter", motivo: "conversao" }))
      .mockResolvedValueOnce({ messageId: "d1" });
    await expect(enviarNotaDeVoz(chamar, { ...corpo, url: "https://x/a.mp3", filename: "a.mp3" }))
      .resolves.toEqual({ messageId: "d1", como: "documento" });
    expect(chamar).toHaveBeenLastCalledWith("send-document", { phone: corpo.phone, url: "https://x/a.mp3", filename: "a.mp3" });
  });

  it("gravando: false vai ao proxy; padrão não manda o campo (o proxy liga sozinho)", async () => {
    const chamar = vi.fn().mockResolvedValue({ messageId: "v" });
    await enviarNotaDeVoz(chamar, { ...corpo, gravando: false });
    expect(chamar).toHaveBeenLastCalledWith("send-audio", { phone: corpo.phone, url: corpo.url, ptt: true, gravando: false });
    await enviarNotaDeVoz(chamar, { ...corpo, gravando: true });
    expect(chamar).toHaveBeenLastCalledWith("send-audio", { phone: corpo.phone, url: corpo.url, ptt: true });
  });

  it("404 vindo do OpenWA, 429 e 502 não trocam de rota: o erro sobe", async () => {
    for (const e of [new ErroFalso(404, { error: "openwa", status: 404 }), new ErroFalso(429, {}), new ErroFalso(502, {})]) {
      const chamar = vi.fn().mockRejectedValue(e);
      await expect(enviarNotaDeVoz(chamar, corpo)).rejects.toBe(e);
      expect(chamar).toHaveBeenCalledTimes(1);
    }
  });

  it("proxySemRota e ehOggOpus", () => {
    expect(proxySemRota(new ErroFalso(404, { error: "não existe" }))).toBe(true);
    expect(proxySemRota(new Error("x"))).toBe(false);
    expect(proxySemConversao(new ErroFalso(422, { motivo: "conversao" }))).toBe(true);
    expect(proxySemConversao(new ErroFalso(422, { error: "openwa" }))).toBe(false);
    expect(ehOggOpus("voz.ogg", "https://a/x")).toBe(true);
    expect(ehOggOpus(null, "https://a/b/1-x.opus?token=1")).toBe(true);
    expect(ehOggOpus("musica.mp3", "https://a/musica.mp3")).toBe(false);
  });
});
