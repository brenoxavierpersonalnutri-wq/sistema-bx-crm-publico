// "Ligar câmera" do estúdio que não falha em silêncio (21/10/2026): aparelho salvo que sumiu (iPhone da
// Câmera de Continuidade), restrição `exact` guardada na faixa, processador do desfoque quebrando, pedido
// pendurado no navegador e os erros do getUserMedia sempre traduzidos. O participante abaixo imita o
// caminho do LiveKit (unmute reabre o aparelho com a restrição guardada) por cima de um
// navigator.mediaDevices.getUserMedia falso.
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroMidia, ehErroAparelho, ligarMidia, mensagemErroMidia, mensagemErroSala, type ParticipanteMidia } from "@/lib/lives/ligarMidia";
import { aplicarDesfoque } from "@/lib/lives/fundo";
import { useStreamLocal } from "@/components/lives/estudio/Dispositivos";

vi.mock("@livekit/track-processors", () => ({
  supportsBackgroundProcessors: () => true,
  BackgroundProcessor: () => ({ nome: "blur" }),
}));

const erroDom = (name: string, message = "") => new DOMException(message, name);

/** getUserMedia falso: só existem os aparelhos da lista; `exact` de aparelho ausente dá OverconstrainedError. */
function midiaFalsa(opcoes: { cameras?: string[]; mics?: string[]; erro?: DOMException; travar?: boolean } = {}) {
  const cameras = opcoes.cameras ?? ["mac"];
  const mics = opcoes.mics ?? ["mac-mic"];
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    if (opcoes.travar) return new Promise<never>(() => undefined);
    if (opcoes.erro) throw opcoes.erro;
    const pedido = (c.video || c.audio) as MediaTrackConstraints | true;
    const lista = c.video ? cameras : mics;
    if (!lista.length) throw erroDom("NotFoundError", "Requested device not found");
    const dev = pedido === true ? undefined : (pedido.deviceId as ConstrainDOMStringParameters | string | undefined);
    const exato = typeof dev === "object" ? dev.exact : undefined;
    const ideal = typeof dev === "object" ? dev.ideal : dev;
    if (exato && !lista.includes(exato as string)) throw erroDom("OverconstrainedError");
    const id = (exato as string) ?? (lista.includes(ideal as string) ? (ideal as string) : lista[0]);
    return { id, getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] };
  });
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia, enumerateDevices: vi.fn(async () => []) } });
  return getUserMedia;
}

interface FaixaFalsa {
  restricao: MediaTrackConstraints;
  muda: boolean;
  processador?: unknown;
  processadorQuebra?: boolean;
  stopProcessor: ReturnType<typeof vi.fn>;
  getProcessor: () => unknown;
}

/** Participante local que imita o LiveKit 2.x (setTrackEnabled / unmute / restart / publicação pendente). */
function participanteFalso(opcoes: { pendurado?: boolean } = {}) {
  const pubs: Record<string, { track: FaixaFalsa } | undefined> = {};
  const novaFaixa = (restricao: MediaTrackConstraints): FaixaFalsa => {
    const f: FaixaFalsa = {
      restricao,
      muda: false,
      stopProcessor: vi.fn(async () => {
        f.processador = undefined;
      }),
      getProcessor: () => f.processador,
    };
    return f;
  };
  const ligarFonte = async (fonte: "camera" | "microphone", ligar: boolean, o?: { deviceId?: ConstrainDOMString }) => {
    const pub = pubs[fonte];
    if (!ligar) {
      if (pub) pub.track.muda = true;
      return;
    }
    if (pub) {
      // unmute da câmera do LiveKit: reabre o aparelho com a restrição GUARDADA na faixa (ignora as opções)
      await navigator.mediaDevices.getUserMedia(fonte === "camera" ? { video: pub.track.restricao } : { audio: pub.track.restricao });
      if (pub.track.processador && pub.track.processadorQuebra) throw new Error("processor restart failed");
      pub.track.muda = false;
      return;
    }
    if (opcoes.pendurado) return; // publicação pendente: o LiveKit espera e devolve sem erro e sem ligar
    const restricao: MediaTrackConstraints = { ...(o?.deviceId ? { deviceId: o.deviceId } : {}) };
    await navigator.mediaDevices.getUserMedia(fonte === "camera" ? { video: restricao } : { audio: restricao });
    pubs[fonte] = { track: novaFaixa(restricao) };
  };
  const part = {
    pubs,
    get isCameraEnabled() {
      return !!pubs.camera && !pubs.camera.track.muda;
    },
    get isMicrophoneEnabled() {
      return !!pubs.microphone && !pubs.microphone.track.muda;
    },
    setCameraEnabled: vi.fn((l: boolean, o?: { deviceId?: ConstrainDOMString }) => ligarFonte("camera", l, o)),
    setMicrophoneEnabled: vi.fn((l: boolean, o?: { deviceId?: ConstrainDOMString }) => ligarFonte("microphone", l, o)),
    getTrackPublication: vi.fn((fonte: string) => pubs[fonte]),
    unpublishTrack: vi.fn(async (faixa: FaixaFalsa) => {
      for (const k of Object.keys(pubs)) if (pubs[k]?.track === faixa) pubs[k] = undefined;
    }),
  };
  return part;
}

const FONTES = { camera: "camera", mic: "microphone" };
const restricoesPedidas = (gum: ReturnType<typeof vi.fn>) => gum.mock.calls.map(([c]) => JSON.stringify(c));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ligarMidia: câmera", () => {
  it("iPhone salvo com exact na faixa e desconectado: descarta a faixa e liga a câmera padrão, com aviso", async () => {
    const gum = midiaFalsa({ cameras: ["mac"] });
    const p = participanteFalso();
    // a faixa nasceu no iPhone com exact (trocada pelo seletor antigo) e foi desligada
    p.pubs.camera = { track: { restricao: { deviceId: { exact: "iphone" } }, muda: true, stopProcessor: vi.fn(), getProcessor: () => undefined } };
    const r = await ligarMidia(p as unknown as ParticipanteMidia, "camera", { deviceId: "iphone", fontes: FONTES, tempoLimite: 500 });
    expect(p.isCameraEnabled).toBe(true);
    expect(p.unpublishTrack).toHaveBeenCalledTimes(1);
    // nova faixa nunca pede exact
    expect(p.pubs.camera?.track.restricao).toEqual({ deviceId: { ideal: "iphone" } });
    expect(restricoesPedidas(gum).slice(1).some((c) => c.includes("exact"))).toBe(false);
    expect(r.aviso).toBeUndefined(); // ideal já cai na padrão sozinho, sem precisar do terceiro plano
  });

  it("sem faixa, aparelho salvo que não existe mais: pede como ideal e liga na padrão", async () => {
    const gum = midiaFalsa({ cameras: ["mac"] });
    const p = participanteFalso();
    await ligarMidia(p as unknown as ParticipanteMidia, "camera", { deviceId: "iphone-velho", fontes: FONTES, resolucao: { width: 1280, height: 720, frameRate: 30 } });
    expect(p.isCameraEnabled).toBe(true);
    expect(p.setCameraEnabled).toHaveBeenCalledWith(true, { deviceId: { ideal: "iphone-velho" }, resolution: { width: 1280, height: 720, frameRate: 30 } });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("aparelho escolhido falha de outro jeito: terceiro plano é a câmera padrão, com aviso", async () => {
    midiaFalsa({ cameras: ["mac"] });
    const p = participanteFalso();
    let n = 0;
    p.setCameraEnabled.mockImplementation(async (l: boolean, o?: { deviceId?: ConstrainDOMString }) => {
      if (l && o?.deviceId) {
        n += 1;
        throw erroDom("NotReadableError", "Could not start video source");
      }
      p.pubs.camera = { track: { restricao: {}, muda: false, stopProcessor: vi.fn(), getProcessor: () => undefined } };
    });
    const r = await ligarMidia(p as unknown as ParticipanteMidia, "camera", { deviceId: "iphone", fontes: FONTES });
    expect(n).toBe(2);
    expect(p.isCameraEnabled).toBe(true);
    expect(r.aviso).toMatch(/câmera padrão/);
  });

  it("processador do desfoque quebra ao religar: tira o processador, descarta e publica sem ele", async () => {
    midiaFalsa({ cameras: ["mac"] });
    const p = participanteFalso();
    const stop = vi.fn(async () => undefined);
    p.pubs.camera = { track: { restricao: {}, muda: true, processador: { blur: true }, processadorQuebra: true, stopProcessor: stop, getProcessor: () => ({ blur: true }) } };
    await ligarMidia(p as unknown as ParticipanteMidia, "camera", { fontes: FONTES });
    expect(stop).toHaveBeenCalled();
    expect(p.unpublishTrack).toHaveBeenCalled();
    expect(p.isCameraEnabled).toBe(true);
    expect(p.pubs.camera?.track.processador).toBeUndefined();
  });

  it("permissão negada no navegador: mensagem clara e nenhuma tentativa a mais", async () => {
    const gum = midiaFalsa({ erro: erroDom("NotAllowedError", "Permission denied") });
    const p = participanteFalso();
    const e = await ligarMidia(p as unknown as ParticipanteMidia, "camera", { deviceId: "mac", fontes: FONTES }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroMidia);
    expect(e.message).toMatch(/^Permissão da câmera negada no navegador/);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("bloqueio do macOS (Permission denied by system) aponta os Ajustes do Sistema", async () => {
    midiaFalsa({ erro: erroDom("NotAllowedError", "Permission denied by system") });
    const e = await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "camera", { fontes: FONTES }).catch((x) => x);
    expect(e.message).toMatch(/macOS bloqueou a câmera/);
  });

  it("câmera em uso por outro app", async () => {
    midiaFalsa({ erro: erroDom("NotReadableError", "Could not start video source") });
    const e = await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "camera", { fontes: FONTES }).catch((x) => x);
    expect(e.message).toMatch(/^Câmera em uso por outro app/);
  });

  it("nenhuma câmera", async () => {
    midiaFalsa({ cameras: [] });
    const e = await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "camera", { deviceId: "iphone", fontes: FONTES }).catch((x) => x);
    expect(e.message).toMatch(/^Nenhuma câmera encontrada/);
  });

  it("LiveKit devolve sem erro e sem ligar (publicação pendente): avisa em vez de ficar calado", async () => {
    midiaFalsa();
    const p = participanteFalso({ pendurado: true });
    const e = await ligarMidia(p as unknown as ParticipanteMidia, "camera", { fontes: FONTES, tempoLimite: 200 }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroMidia);
    expect(e.message).toMatch(/A câmera não respondeu/);
    expect(p.setCameraEnabled).toHaveBeenCalledTimes(1);
  });

  it("navegador pendurado no getUserMedia: estoura o teto e avisa", async () => {
    midiaFalsa({ travar: true });
    const e = await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "camera", { fontes: FONTES, tempoLimite: 100 }).catch((x) => x);
    expect(e.message).toMatch(/A câmera não respondeu/);
  });
});

describe("ligarMidia: microfone", () => {
  it("AirPods salvo e desconectado: liga no microfone padrão", async () => {
    const gum = midiaFalsa({ mics: ["mac-mic"] });
    const p = participanteFalso();
    await ligarMidia(p as unknown as ParticipanteMidia, "mic", { deviceId: "airpods", fontes: FONTES });
    expect(p.isMicrophoneEnabled).toBe(true);
    expect(p.setMicrophoneEnabled).toHaveBeenCalledWith(true, { deviceId: { ideal: "airpods" } });
    expect(restricoesPedidas(gum).some((c) => c.includes("exact"))).toBe(false);
  });

  it("microfone mudo com exact de aparelho que saiu: religa no padrão", async () => {
    midiaFalsa({ mics: ["mac-mic"] });
    const p = participanteFalso();
    p.pubs.microphone = { track: { restricao: { deviceId: { exact: "airpods" } }, muda: true, stopProcessor: vi.fn(), getProcessor: () => undefined } };
    await ligarMidia(p as unknown as ParticipanteMidia, "mic", { deviceId: "airpods", fontes: FONTES });
    expect(p.isMicrophoneEnabled).toBe(true);
  });

  it("permissão do microfone negada / em uso / inexistente", async () => {
    midiaFalsa({ erro: erroDom("NotAllowedError", "Permission denied") });
    expect((await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "mic", { fontes: FONTES }).catch((x) => x)).message).toMatch(/^Permissão do microfone negada no navegador/);
    midiaFalsa({ erro: erroDom("NotReadableError") });
    expect((await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "mic", { fontes: FONTES }).catch((x) => x)).message).toMatch(/^Microfone em uso por outro app/);
    midiaFalsa({ mics: [] });
    expect((await ligarMidia(participanteFalso() as unknown as ParticipanteMidia, "mic", { fontes: FONTES }).catch((x) => x)).message).toMatch(/^Nenhum microfone encontrado/);
  });
});

describe("mensagens", () => {
  it("OverconstrainedError com mensagem vazia nunca vira toast em branco", () => {
    expect(mensagemErroMidia(erroDom("OverconstrainedError", ""), "camera")).toMatch(/Nenhuma câmera encontrada/);
    expect(mensagemErroMidia(new Error(""), "camera")).toBe("Não foi possível ligar a câmera: Error");
    expect(mensagemErroMidia({}, "mic")).toBe("Não foi possível ligar o microfone: erro desconhecido");
  });
  it("token sem canPublish", () => {
    expect(mensagemErroMidia(new Error("failed to publish track, insufficient permissions"), "camera")).toMatch(/sem permissão de publicar/);
  });
  it("onError da sala: aparelho traduzido, o resto com a mensagem", () => {
    expect(mensagemErroSala(erroDom("NotAllowedError", "Permission denied"))).toMatch(/Permissão de câmera\/microfone negada/);
    expect(mensagemErroSala(new Error("could not establish signal connection"))).toBe("could not establish signal connection");
    expect(mensagemErroSala(new Error(""))).toBe("Error");
    expect(ehErroAparelho(new Error("x"))).toBe(false);
  });
});

describe("prévia (useStreamLocal) com aparelho salvo", () => {
  it("pede ideal (nunca exact) e cai na padrão", async () => {
    const gum = midiaFalsa({ cameras: ["mac"], mics: ["mac-mic"] });
    const { result } = renderHook(() => useStreamLocal({ cameraId: "iphone", micId: "airpods" }, { cam: true, mic: true }));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(gum).toHaveBeenCalledWith({ video: { deviceId: { ideal: "iphone" } }, audio: { deviceId: { ideal: "airpods" } } });
    expect(result.current.erro).toBeNull();
  });
  it("erro da prévia sai traduzido", async () => {
    midiaFalsa({ erro: erroDom("NotReadableError", "Could not start video source") });
    const { result } = renderHook(() => useStreamLocal({}, { cam: true, mic: false }));
    await waitFor(() => expect(result.current.erro).toMatch(/^Câmera em uso por outro app/));
  });
});

describe("desfoque que quebra ao iniciar", () => {
  it("tira o processador e repassa o erro (a câmera fica sem ele)", async () => {
    const faixa = {
      setProcessor: vi.fn(async () => {
        throw new Error("");
      }),
      stopProcessor: vi.fn(async () => undefined),
      getProcessor: () => undefined,
    };
    await expect(aplicarDesfoque(faixa, true)).rejects.toThrow("O desfoque do fundo não iniciou neste navegador");
    expect(faixa.stopProcessor).toHaveBeenCalled();
  });
});
