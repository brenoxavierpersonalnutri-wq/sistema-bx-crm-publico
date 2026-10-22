// Setinha (^) de microfone/câmera na barra do estúdio: lista, check no atual, troca, devicechange com aviso
// discreto, pedido de permissão quando a lista vem sem nomes e a ajuda sobre o que o navegador enxerga.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BarraControles } from "@/components/lives/estudio/BarraControles";
import { TEXTO_PERMITIR, type ControleAparelhos } from "@/components/lives/estudio/MenuAparelhos";
import { AJUDA_AUDIO, AJUDA_VIDEO, aparelhoAtual, avisosNovosAparelhos, separarAparelhos, suportaEscolherSaida } from "@/lib/lives/dispositivos";

const avisos = vi.hoisted(() => ({ toast: vi.fn(), erro: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(avisos.toast, { error: avisos.erro, info: vi.fn() }) }));

const d = (kind: string, deviceId: string, label = "", groupId = "") => ({ kind, deviceId, label, groupId }) as MediaDeviceInfo;

const MAC = [
  d("videoinput", "facetime", "Câmera FaceTime HD", "g-ft"),
  d("videoinput", "iphone", "Câmera do iPhone de Breno", "g-ip"),
  d("videoinput", "desk", "Câmera da Visualização da Mesa iPhone de Breno", "g-desk"),
  d("audioinput", "default", "Padrão - Microfone (MacBook Air)", "g-mb"),
  d("audioinput", "mbmic", "Microfone (MacBook Air)", "g-mb"),
  d("audioinput", "iphonemic", "Microfone do iPhone de Breno", "g-ipm"),
  d("audiooutput", "alto", "Alto-falantes (MacBook Air)", "g-mb"),
];
const AIRPODS = [d("audioinput", "airpods-in", "AirPods de Breno", "g-air"), d("audiooutput", "airpods-out", "AirPods de Breno", "g-air")];
const SEM_PERMISSAO = [d("videoinput", ""), d("audioinput", ""), d("audiooutput", "")];

// o Node novo expõe um localStorage vazio que esconde o do jsdom
const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
});

beforeAll(() => {
  // o Radix (popper) mede o gatilho
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= () => undefined;
  (HTMLMediaElement.prototype as unknown as { setSinkId: () => Promise<void> }).setSinkId = () => Promise.resolve();
});
afterEach(() => {
  memoria.clear();
  avisos.toast.mockReset();
  avisos.erro.mockReset();
});

function mockMedia(inicial: MediaDeviceInfo[]) {
  const alvo = new EventTarget();
  let lista = inicial;
  const enumerateDevices = vi.fn(() => Promise.resolve(lista));
  const parar = vi.fn();
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: parar }] }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: Object.assign(alvo, { enumerateDevices, getUserMedia }) });
  return {
    getUserMedia,
    parar,
    trocarLista: (nova: MediaDeviceInfo[]) => (lista = nova),
    mudar: async (nova: MediaDeviceInfo[]) => {
      lista = nova;
      await act(async () => {
        alvo.dispatchEvent(new Event("devicechange"));
      });
    },
  };
}

function montar(controle: Partial<ControleAparelhos> = {}) {
  const onTrocar = vi.fn();
  const onConfig = vi.fn();
  const onDesfocar = vi.fn();
  const c: ControleAparelhos = { escolha: { micId: "mbmic", cameraId: "facetime" }, onTrocar, onDesfocar, desfocar: false, ...controle };
  const r = render(<BarraControles mic cam tela={false} onMic={vi.fn()} onCam={vi.fn()} onTela={vi.fn()} onConfig={onConfig} onSair={vi.fn()} aparelhos={c} />);
  return { ...r, onTrocar, onConfig, onDesfocar };
}

const abrir = async (rotulo: string) => {
  const gatilho = screen.getByRole("button", { name: rotulo });
  await act(async () => {
    fireEvent.pointerDown(gatilho, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  if (gatilho.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.keyDown(gatilho, { key: "Enter" });
    });
  }
  return screen.findByRole("menu");
};

const item = (nome: string | RegExp) => {
  const itens = Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  const achado = itens.find((el) => (typeof nome === "string" ? el.textContent?.includes(nome) : nome.test(el.textContent ?? "")));
  if (!achado) throw new Error(`item "${nome}" não está no menu: ${itens.map((el) => el.textContent).join(" | ")}`);
  return achado;
};

describe("regras puras do menu", () => {
  it("AirPods que conectam viram um aviso só (microfone + alto-falante)", () => {
    const antes = separarAparelhos(MAC);
    expect(avisosNovosAparelhos(antes, separarAparelhos([...MAC, ...AIRPODS]))).toEqual(["AirPods conectados"]);
  });
  it("iPhone aparece: 'Câmera do iPhone disponível'; sem permissão ou primeira leitura não fala", () => {
    const semIphone = MAC.filter((x) => !/iPhone/.test(x.label));
    expect(avisosNovosAparelhos(separarAparelhos(semIphone), separarAparelhos(MAC))).toContain("Câmera do iPhone disponível");
    expect(avisosNovosAparelhos(separarAparelhos(SEM_PERMISSAO), separarAparelhos(MAC))).toEqual([]);
    expect(avisosNovosAparelhos(separarAparelhos([]), separarAparelhos(MAC))).toEqual([]);
    expect(avisosNovosAparelhos(separarAparelhos(MAC), separarAparelhos(MAC))).toEqual([]);
  });
  it("aparelho atual: o escolhido se existe; senão o primeiro", () => {
    const { mics } = separarAparelhos(MAC);
    expect(aparelhoAtual(mics, "mbmic")).toBe("mbmic");
    expect(aparelhoAtual(mics, "sumiu")).toBe("default");
    expect(aparelhoAtual([], "x")).toBeUndefined();
  });
  it("setSinkId detectado pelo protótipo", () => {
    expect(suportaEscolherSaida({ setSinkId: () => undefined })).toBe(true);
    expect(suportaEscolherSaida({})).toBe(false);
  });
});

describe("setinha do microfone", () => {
  it("lista os microfones com check no atual, alto-falante, Configurações de áudio e a ajuda", async () => {
    mockMedia([...MAC, ...AIRPODS]);
    const { onConfig } = montar();
    const menu = await abrir("Opções de áudio");
    await waitFor(() => expect(menu.textContent).toContain("AirPods de Breno"));
    for (const nome of ["Microfone (MacBook Air)", "Microfone do iPhone de Breno", "Padrão - Microfone (MacBook Air)", "Alto-falantes (MacBook Air)"]) {
      expect(menu.textContent).toContain(nome);
    }
    expect(item(/^Microfone \(MacBook Air\)$/).getAttribute("aria-checked")).toBe("true");
    expect(item("Microfone do iPhone").getAttribute("aria-checked")).toBe("false");
    expect(menu.textContent).toContain("Alto-falante");
    expect(screen.getByTestId("ajuda-aparelhos").textContent).toContain(AJUDA_AUDIO);
    await act(async () => {
      fireEvent.click(item("Configurações de áudio…"));
    });
    expect(onConfig).toHaveBeenCalled();
  });

  it("trocar pelo menu chama a troca ao vivo com o aparelho novo e mantém o resto", async () => {
    mockMedia([...MAC, ...AIRPODS]);
    const { onTrocar } = montar();
    await abrir("Opções de áudio");
    await waitFor(() => item("AirPods de Breno"));
    await act(async () => {
      fireEvent.click(item("AirPods de Breno"));
    });
    expect(onTrocar).toHaveBeenCalledWith({ micId: "airpods-in", cameraId: "facetime" });
  });

  it("devicechange: AirPods conectam com o menu fechado -> aviso discreto e entram na lista", async () => {
    const m = mockMedia(MAC);
    montar();
    await act(async () => undefined);
    await m.mudar([...MAC, ...AIRPODS]);
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith("AirPods conectados", expect.anything()));
    expect(avisos.toast).toHaveBeenCalledTimes(1);
    const menu = await abrir("Opções de áudio");
    expect(menu.textContent).toContain("AirPods de Breno");
  });

  it("sem permissão: 'Permitir acesso para ver os aparelhos' pede o microfone e relê a lista", async () => {
    const m = mockMedia(SEM_PERMISSAO);
    montar({ escolha: {} });
    await abrir("Opções de áudio");
    m.trocarLista([...MAC, ...AIRPODS]);
    await act(async () => {
      fireEvent.click(item(TEXTO_PERMITIR));
    });
    expect(m.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(m.parar).toHaveBeenCalled();
    const menu = await abrir("Opções de áudio");
    await waitFor(() => expect(menu.textContent).toContain("AirPods de Breno"));
    expect(menu.textContent).not.toContain(TEXTO_PERMITIR);
  });
});

describe("setinha da câmera", () => {
  it("lista as câmeras do Mac (FaceTime, iPhone, Visualização da Mesa) com check, desfoque, Configurações de vídeo e ajuda", async () => {
    mockMedia(MAC);
    const { onTrocar, onDesfocar, onConfig } = montar();
    const menu = await abrir("Opções de vídeo");
    await waitFor(() => expect(menu.textContent).toContain("Câmera do iPhone de Breno"));
    expect(menu.textContent).toContain("Câmera da Visualização da Mesa iPhone de Breno");
    expect(item("Câmera FaceTime HD").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("ajuda-aparelhos").textContent).toContain(AJUDA_VIDEO);
    expect(AJUDA_VIDEO).toMatch(/cabo USB.*Safari/);

    await act(async () => {
      fireEvent.click(item("Desfocar meu plano de fundo"));
    });
    expect(onDesfocar).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("menu")).not.toBeNull(); // continua aberto

    await act(async () => {
      fireEvent.click(item("Câmera do iPhone de Breno"));
    });
    expect(onTrocar).toHaveBeenCalledWith({ micId: "mbmic", cameraId: "iphone" });
    expect(localStorage.getItem("lives:camera")).toBe("iphone");

    await abrir("Opções de vídeo");
    await act(async () => {
      fireEvent.click(item("Configurações de vídeo…"));
    });
    expect(onConfig).toHaveBeenCalled();
  });

  it("iPhone aparece no devicechange: aviso 'Câmera do iPhone disponível'", async () => {
    const semIphone = MAC.filter((x) => !/iPhone/.test(x.label));
    const m = mockMedia(semIphone);
    montar();
    await act(async () => undefined);
    await m.mudar(MAC);
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith("Câmera do iPhone disponível", expect.anything()));
  });

  it("sem permissão pede a câmera", async () => {
    const m = mockMedia(SEM_PERMISSAO);
    montar({ escolha: {} });
    await abrir("Opções de vídeo");
    await act(async () => {
      fireEvent.click(item(TEXTO_PERMITIR));
    });
    expect(m.getUserMedia).toHaveBeenCalledWith({ video: true });
  });

  it("sem `aparelhos` a barra continua sem setinhas", () => {
    mockMedia(MAC);
    render(<BarraControles mic cam tela={false} onMic={vi.fn()} onCam={vi.fn()} onTela={vi.fn()} onSair={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Opções de áudio" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mudo" })).toBeTruthy();
  });
});
