import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAparelhos } from "@/components/lives/estudio/Dispositivos";
import { cameraSugeridaIphone, escolherCameraInicial, lerCameraSalva, salvarCamera, soCameraDoMac } from "@/lib/lives/cameras";

const cam = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" }) as MediaDeviceInfo;

describe("useAparelhos", () => {
  it("relê a lista no devicechange (iPhone aparece depois)", async () => {
    const alvo = new EventTarget();
    const enumerateDevices = vi.fn().mockResolvedValueOnce([cam("mac", "FaceTime HD")]).mockResolvedValue([cam("mac", "FaceTime HD"), cam("ip", "Câmera do iPhone de Breno")]);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: Object.assign(alvo, { enumerateDevices }) });
    const { result } = renderHook(() => useAparelhos());
    await act(async () => {});
    expect(result.current.cameras).toHaveLength(1);
    await act(async () => {
      alvo.dispatchEvent(new Event("devicechange"));
    });
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    expect(result.current.cameras.map((c) => c.deviceId)).toEqual(["mac", "ip"]);
    await act(async () => {
      await result.current.reler();
    });
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
  });
});

describe("cameras", () => {
  it("lembra a câmera salva só se ainda existir", () => {
    expect(escolherCameraInicial([{ deviceId: "a" }], "a")).toBe("a");
    expect(escolherCameraInicial([{ deviceId: "a" }], "b")).toBeNull();
    expect(escolherCameraInicial([{ deviceId: "a" }], null)).toBeNull();
  });
  it("localStorage que lança não quebra", () => {
    const s = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("x"); });
    const g = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("x"); });
    expect(() => salvarCamera("a")).not.toThrow();
    expect(lerCameraSalva()).toBeNull();
    s.mockRestore(); g.mockRestore();
  });
  it("detecta iPhone e dica só com câmera do Mac", () => {
    expect(cameraSugeridaIphone([cam("m", "FaceTime HD"), cam("i", "iPhone Câmera")])?.deviceId).toBe("i");
    expect(soCameraDoMac([cam("m", "FaceTime HD")])).toBe(true);
    expect(soCameraDoMac([cam("m", "FaceTime HD"), cam("i", "Câmera do iPhone")])).toBe(false);
    expect(soCameraDoMac([cam("m", "")])).toBe(false);
  });
});

describe("dica do iPhone (sem QR)", () => {
  it("só com a câmera do Mac: mostra a dica do cabo/Safari e o botão Atualizar; nenhum QR", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { SeletoresDispositivo } = await import("@/components/lives/estudio/Dispositivos");
    const reler = vi.fn().mockResolvedValue(undefined);
    render(
      <SeletoresDispositivo
        escolha={{}}
        onTrocar={() => undefined}
        aparelhos={{ cameras: [cam("mac", "FaceTime HD")], mics: [], saidas: [], reler }}
      />,
    );
    expect(screen.getByTestId("dica-iphone").textContent).toMatch(/cabo.*Safari/);
    expect(screen.queryByText(/celular como câmera/i)).toBeNull();
    expect(screen.queryByAltText(/QR/i)).toBeNull();
    screen.getByRole("button", { name: /Atualizar dispositivos/ }).click();
    expect(reler).toHaveBeenCalled();
  });

  it("com o iPhone na lista: sem dica, com o atalho Usar iPhone", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { SeletoresDispositivo } = await import("@/components/lives/estudio/Dispositivos");
    render(
      <SeletoresDispositivo
        escolha={{ cameraId: "mac" }}
        onTrocar={() => undefined}
        aparelhos={{ cameras: [cam("mac", "FaceTime HD"), cam("ip", "Câmera do iPhone")], mics: [], saidas: [], reler: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId("dica-iphone")).toBeNull();
    expect(screen.getByRole("button", { name: /Usar Câmera do iPhone/ })).toBeInTheDocument();
  });
});
