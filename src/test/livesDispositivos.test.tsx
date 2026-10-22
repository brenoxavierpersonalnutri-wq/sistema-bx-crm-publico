import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acharAparelho, aposMudanca, chavePrefs, escolhaDasPrefs, escolherResolucao, lerPrefs, observarAparelhos, prefsDaEscolha,
  RES_1080, RES_720, restricoesVideo, rotuloAparelho, salvarPrefs, separarAparelhos, trocarNaSala, type SalaTroca,
} from "@/lib/lives/dispositivos";
import { useAparelhos, useVigiaAparelhos } from "@/components/lives/estudio/Dispositivos";

const d = (kind: string, deviceId: string, label = "") => ({ kind, deviceId, label, groupId: "" }) as MediaDeviceInfo;

// Lista real do Mac do Breno (nomes como o Chrome/Safari mostram depois da permissão)
const MAC = [
  d("videoinput", "facetime", "Câmera FaceTime HD"),
  d("videoinput", "iphone", "Câmera do iPhone de Breno"),
  d("videoinput", "desk", "Câmera da Visualização da Mesa iPhone de Breno"),
  d("audioinput", "default", "Padrão - Microfone (MacBook Air)"),
  d("audioinput", "mbmic", "Microfone (MacBook Air)"),
  d("audioinput", "airpods", "AirPods de Breno"),
  d("audioinput", "agreg", "Dispositivo Agregado"),
  d("audiooutput", "alto", "Alto-falantes (MacBook Air)"),
];

function mockMediaDevices(listas: MediaDeviceInfo[][]) {
  const alvo = new EventTarget();
  const enumerateDevices = vi.fn();
  listas.forEach((l, i) => (i === listas.length - 1 ? enumerateDevices.mockResolvedValue(l) : enumerateDevices.mockResolvedValueOnce(l)));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: Object.assign(alvo, { enumerateDevices }) });
  return { alvo, enumerateDevices };
}

// O Node novo expõe um localStorage global vazio que esconde o do jsdom: usa um em memória.
const memoria = new Map<string, string>();
const armazenamento = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
};
vi.stubGlobal("localStorage", armazenamento);
afterEach(() => memoria.clear());

describe("separarAparelhos e rótulos", () => {
  it("lista as 3 câmeras do Mac pelo nome real e todos os microfones (AirPods, agregado)", () => {
    const l = separarAparelhos(MAC);
    expect(l.cameras.map((c) => c.label)).toEqual(["Câmera FaceTime HD", "Câmera do iPhone de Breno", "Câmera da Visualização da Mesa iPhone de Breno"]);
    expect(l.mics.map((m) => m.deviceId)).toEqual(["default", "mbmic", "airpods", "agreg"]);
    expect(l.saidas).toHaveLength(1);
  });
  it("sem permissão (deviceId vazio) não lista nada e ids repetidos contam uma vez", () => {
    expect(separarAparelhos([d("videoinput", ""), d("audioinput", "")]).cameras).toHaveLength(0);
    expect(separarAparelhos([d("videoinput", "a", "X"), d("videoinput", "a", "X")]).cameras).toHaveLength(1);
  });
  it("rótulo cai para 'Câmera 2' quando o navegador esconde o nome", () => {
    expect(rotuloAparelho(d("videoinput", "a"), 1)).toBe("Câmera 2");
    expect(rotuloAparelho(d("audioinput", "a", "  "), 0)).toBe("Microfone 1");
    expect(rotuloAparelho(d("videoinput", "a", "Câmera do iPhone de Breno"), 0)).toBe("Câmera do iPhone de Breno");
  });
});

describe("acharAparelho / aposMudanca", () => {
  const l = separarAparelhos(MAC);
  it("acha pelo id e, se o id mudou (Safari), pelo nome", () => {
    expect(acharAparelho(l.cameras, "iphone")?.deviceId).toBe("iphone");
    expect(acharAparelho(l.cameras, "id-velho", "Câmera do iPhone de Breno")?.deviceId).toBe("iphone");
    expect(acharAparelho(l.cameras, "id-velho", "Câmera que não existe")).toBeUndefined();
  });
  it("iPhone saiu de perto: volta para a primeira câmera e avisa o que sumiu", () => {
    const semIphone = separarAparelhos(MAC.filter((x) => !/iPhone/.test(x.label)));
    const m = aposMudanca({ cameraId: "iphone", micId: "airpods" }, semIphone);
    expect(m.escolha).toEqual({ cameraId: "facetime", micId: "airpods" });
    expect(m.sumiram).toEqual([{ tipo: "videoinput", id: "iphone" }]);
  });
  it("lista sem nomes (sem permissão) não troca nada", () => {
    const cega = separarAparelhos([d("videoinput", "x")]);
    expect(aposMudanca({ cameraId: "iphone" }, cega).sumiram).toHaveLength(0);
  });
});

describe("devicechange", () => {
  it("observarAparelhos assina e desassina", () => {
    const alvo = new EventTarget();
    const cb = vi.fn();
    const sair = observarAparelhos(alvo as unknown as MediaDevices, cb);
    alvo.dispatchEvent(new Event("devicechange"));
    sair();
    alvo.dispatchEvent(new Event("devicechange"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(observarAparelhos(undefined, cb)()).toBeUndefined();
  });

  it("useAparelhos: iPhone (Continuity Camera) aparece ao vivo no devicechange", async () => {
    const soMac = MAC.filter((x) => !/iPhone/.test(x.label));
    const { alvo, enumerateDevices } = mockMediaDevices([soMac, MAC]);
    const { result } = renderHook(() => useAparelhos());
    await act(async () => {});
    expect(result.current.cameras.map((c) => c.deviceId)).toEqual(["facetime"]);
    await act(async () => {
      alvo.dispatchEvent(new Event("devicechange"));
    });
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    expect(result.current.cameras.map((c) => c.deviceId)).toEqual(["facetime", "iphone", "desk"]);
  });

  it("useVigiaAparelhos: câmera escolhida some -> aoSumir com a próxima", async () => {
    const semIphone = MAC.filter((x) => !/iPhone/.test(x.label));
    const { alvo } = mockMediaDevices([MAC, semIphone]);
    const aoSumir = vi.fn();
    renderHook(() => useVigiaAparelhos({ cameraId: "iphone" }, aoSumir));
    await act(async () => {});
    expect(aoSumir).not.toHaveBeenCalled();
    await act(async () => {
      alvo.dispatchEvent(new Event("devicechange"));
    });
    expect(aoSumir).toHaveBeenCalledTimes(1);
    expect(aoSumir.mock.calls[0][0].escolha.cameraId).toBe("facetime");
  });
});

describe("resolução", () => {
  it("1080p só se a câmera aguenta; senão 720p; sempre 30 fps", () => {
    expect(escolherResolucao({ width: { max: 1920 }, height: { max: 1080 } })).toEqual(RES_1080);
    expect(escolherResolucao({ width: { max: 1280 }, height: { max: 720 } })).toEqual(RES_720);
    expect(escolherResolucao(undefined)).toEqual(RES_720);
    expect(RES_720.frameRate).toBe(30);
    expect(RES_1080.frameRate).toBe(30);
  });
  it("restrições pedem o aparelho exato e a resolução como ideal", () => {
    expect(restricoesVideo("iphone", RES_1080)).toEqual({ deviceId: { ideal: "iphone" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    expect(restricoesVideo(undefined)).not.toHaveProperty("deviceId");
  });
});

describe("trocarNaSala (LiveKit sem sair da sala)", () => {
  const sala = (switchActiveDevice: SalaTroca["switchActiveDevice"], restartTrack?: () => Promise<void>) => ({
    switchActiveDevice,
    localParticipant: { getTrackPublication: vi.fn(() => (restartTrack ? { track: { restartTrack } } : undefined)) },
  });
  it("usa o switchActiveDevice com ideal (exact=false: aparelho que sumiu não trava o religar)", async () => {
    const s = sala(vi.fn().mockResolvedValue(true));
    expect(await trocarNaSala(s, "videoinput", "iphone")).toBe(true);
    expect(s.switchActiveDevice).toHaveBeenCalledWith("videoinput", "iphone", false);
  });
  it("se o switch recusa, reinicia a faixa publicada com o aparelho novo", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const s = sala(vi.fn().mockResolvedValue(false), restart);
    expect(await trocarNaSala(s, "videoinput", "desk", { camera: "camera", mic: "microphone" })).toBe(true);
    expect(s.localParticipant.getTrackPublication).toHaveBeenCalledWith("camera");
    expect(restart).toHaveBeenCalledWith({ deviceId: { ideal: "desk" } });
  });
  it("se o switch lança e não há faixa, repassa o erro", async () => {
    const s = sala(vi.fn().mockRejectedValue(new Error("sem permissão")));
    await expect(trocarNaSala(s, "audioinput", "airpods")).rejects.toThrow("sem permissão");
  });
  it("saída de áudio não tem plano B", async () => {
    const restart = vi.fn();
    const s = sala(vi.fn().mockResolvedValue(false), restart);
    expect(await trocarNaSala(s, "audiooutput", "alto")).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe("preferências por usuário", () => {
  it("padrão: prévia ligada, câmera e microfone ligados, sem desfoque", () => {
    expect(lerPrefs("u1")).toMatchObject({ sempreMostrarPrevia: true, cam: true, mic: true, desfocar: false });
  });
  it("salva por usuário, sem misturar usuários", () => {
    salvarPrefs("u1", { sempreMostrarPrevia: false, cameraId: "iphone", cameraNome: "Câmera do iPhone de Breno", desfocar: true });
    expect(lerPrefs("u1")).toMatchObject({ sempreMostrarPrevia: false, cameraId: "iphone", desfocar: true });
    expect(lerPrefs("u2").sempreMostrarPrevia).toBe(true);
    expect(localStorage.getItem(chavePrefs("u1"))).toContain("iphone");
  });
  it("JSON quebrado ou storage que lança não derruba a tela", () => {
    localStorage.setItem(chavePrefs("u1"), "{quebrado");
    expect(lerPrefs("u1").sempreMostrarPrevia).toBe(true);
    const s = vi.spyOn(armazenamento, "setItem").mockImplementation(() => { throw new Error("cheio"); });
    const g = vi.spyOn(armazenamento, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
    expect(() => salvarPrefs("u1", { desfocar: true })).not.toThrow();
    expect(lerPrefs("u1").desfocar).toBe(false);
    s.mockRestore();
    g.mockRestore();
  });
  it("guarda o nome do aparelho e reencontra quando o id muda", () => {
    const l = separarAparelhos(MAC);
    const p = prefsDaEscolha({ cameraId: "iphone", micId: "airpods" }, l);
    expect(p).toMatchObject({ cameraNome: "Câmera do iPhone de Breno", micNome: "AirPods de Breno" });
    const novaSessao = separarAparelhos(MAC.map((x) => ({ ...x, deviceId: `${x.deviceId}-2` }) as MediaDeviceInfo));
    expect(escolhaDasPrefs({ ...lerPrefs("x"), ...p }, novaSessao)).toEqual({ cameraId: "iphone-2", micId: "airpods-2", saidaId: undefined });
  });
});

describe("OpcoesVideo", () => {
  it("desfocar alterna, enquadrar fica desligado com 'em breve', checkbox da prévia salva", async () => {
    const { OpcoesVideo } = await import("@/components/lives/estudio/OpcoesVideo");
    const onDesfocar = vi.fn();
    const onSempre = vi.fn();
    render(<OpcoesVideo desfocar={false} onDesfocar={onDesfocar} sempreMostrar onSempreMostrar={onSempre} />);
    screen.getByRole("switch", { name: /Desfocar meu plano de fundo/ }).click();
    expect(onDesfocar).toHaveBeenCalledWith(true);
    const enquadrar = screen.getByRole("switch", { name: /Enquadrar meu vídeo automaticamente/ });
    expect(enquadrar).toBeDisabled();
    expect(screen.getByText(/em breve/i)).toBeInTheDocument();
    screen.getByRole("checkbox", { name: /Sempre mostrar essa prévia ao entrar/ }).click();
    expect(onSempre).toHaveBeenCalledWith(false);
  });
});

describe("aplicarDesfoque", () => {
  it("carrega a biblioteca só ao ligar, não duplica e desliga", async () => {
    vi.resetModules();
    const BackgroundProcessor = vi.fn(() => ({ nome: "blur" }));
    vi.doMock("@livekit/track-processors", () => ({ supportsBackgroundProcessors: () => true, BackgroundProcessor }));
    const { aplicarDesfoque } = await import("@/lib/lives/fundo");
    let proc: unknown = null;
    const faixa = {
      setProcessor: vi.fn(async (p: unknown) => { proc = p; }),
      stopProcessor: vi.fn(async () => { proc = null; }),
      getProcessor: () => proc,
    };
    await aplicarDesfoque(faixa, false);
    expect(BackgroundProcessor).not.toHaveBeenCalled();
    await aplicarDesfoque(faixa, true);
    await aplicarDesfoque(faixa, true);
    expect(faixa.setProcessor).toHaveBeenCalledTimes(1);
    expect(BackgroundProcessor).toHaveBeenCalledWith({ mode: "background-blur", blurRadius: 12 });
    await aplicarDesfoque(faixa, false);
    expect(faixa.stopProcessor).toHaveBeenCalledTimes(1);
    vi.doUnmock("@livekit/track-processors");
  });
  it("navegador sem suporte: erro em português", async () => {
    vi.resetModules();
    vi.doMock("@livekit/track-processors", () => ({ supportsBackgroundProcessors: () => false, BackgroundProcessor: vi.fn() }));
    const { aplicarDesfoque } = await import("@/lib/lives/fundo");
    const faixa = { setProcessor: vi.fn(), stopProcessor: vi.fn(), getProcessor: () => null };
    await expect(aplicarDesfoque(faixa, true)).rejects.toThrow(/não consegue desfocar/);
    vi.doUnmock("@livekit/track-processors");
  });
});

describe("PreSala (prévia estilo Zoom)", () => {
  it("mostra a prévia com Áudio, Vídeo, Planos de fundo, seletores com nome real e grava 'sempre mostrar'", async () => {
    mockMediaDevices([MAC]);
    const { MemoryRouter } = await import("react-router-dom");
    const { PreSala, TITULO_PREVIA } = await import("@/components/lives/estudio/PreSala");
    const onEntrar = vi.fn();
    render(<MemoryRouter><PreSala titulo="Live teste" usuario="u9" semCamera onEntrar={onEntrar} /></MemoryRouter>);
    await act(async () => {});
    expect(screen.getByText(TITULO_PREVIA)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Áudio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parar vídeo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Planos de fundo/ })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Desfocar meu plano de fundo/ })).toBeInTheDocument();
    expect((await screen.findAllByText("Câmera FaceTime HD")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Padrão - Microfone (MacBook Air)").length).toBeGreaterThan(0);
    screen.getByRole("button", { name: "Áudio" }).click();
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Áudio mudo" })).toBeInTheDocument();
    screen.getByRole("checkbox", { name: /Sempre mostrar essa prévia ao entrar/ }).click();
    await act(async () => {});
    expect(lerPrefs("u9").sempreMostrarPrevia).toBe(false);
    screen.getByRole("button", { name: "Entrar no estúdio" }).click();
    expect(onEntrar).toHaveBeenCalledWith(expect.objectContaining({ mic: false, cam: true, desfocar: false, resolucao: RES_720 }));
    expect(lerPrefs("u9")).toMatchObject({ mic: false, sempreMostrarPrevia: false });
  }, 20_000); // primeiro import da tela inteira é lento com a suíte toda rodando

  it("entradaSemPrevia: com a prévia desligada entra com o aparelho salvo (reencontrado pelo nome)", async () => {
    mockMediaDevices([MAC]);
    const { entradaSemPrevia } = await import("@/components/lives/estudio/PreSala");
    expect(await entradaSemPrevia("u3")).toBeNull();
    salvarPrefs("u3", { sempreMostrarPrevia: false, cameraId: "id-velho", cameraNome: "Câmera do iPhone de Breno", hd1080: true, desfocar: true });
    const c = await entradaSemPrevia("u3");
    expect(c).toMatchObject({ cameraId: "iphone", desfocar: true, resolucao: RES_1080, cam: true, mic: true });
    expect(await entradaSemPrevia("u3", true)).toBeNull(); // convidado sem nome salvo vê a prévia
  });
});
