// Estúdio React (/conteudo/react): linha do tempo, upload retomável, câmera com plano B, módulo e a tela.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LinhaTempo, formatarTempo, resumoLinha } from "@/lib/conteudo/react/linhaTempo";
import { proximoPedaco, tituloDoArquivo, urlAbsoluta, REACT_API } from "@/lib/conteudo/react/api";
import { abrirCamera, escolherFormato, extensaoDoFormato, proximaCamera, restricoes } from "@/lib/conteudo/react/gravador";
import { getModuleByPath, podeAbrirRota } from "@/lib/modules";
import { OP_PADRAO, colunasOp, opcoesDoProjeto, resumoOpcoes } from "@/lib/conteudo/react/opcoes";
import type { ProjetoReact } from "@/lib/conteudo/react/api";

const auth = vi.hoisted(() => ({ isAdmin: false, allowedModules: [] as string[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = { select: () => consulta, order: () => consulta, limit: () => Promise.resolve({ data: [], error: null }) };
  return { supabase: { from: () => consulta, auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) } } };
});

describe("linha do tempo", () => {
  it("vira trechos tocando/comentário com o original congelado onde pausou", () => {
    const l = new LinhaTempo();
    l.iniciar(0, 0);
    l.tocando(0.2, 0);          // play demorou 0,2 s
    l.parado(5.2, 5.0);         // Pausar e comentar
    l.parado(5.3, 5.0);         // evento repetido (waiting) não abre trecho novo
    expect(l.pausas).toBe(1);
    l.tocando(9.0, 5.0);        // Voltar o vídeo
    l.parado(12.0, 8.0);        // buffering congela também
    l.tocando(12.5, 8.0);
    expect(l.tocandoAgora).toBe(true);
    const t = l.finalizar(14.0);
    expect(t).toEqual([
      { tipo: "comentario", ini: 0, fim: 0.2, orig: 0 },
      { tipo: "tocando", ini: 0.2, fim: 5.2, orig: 0 },
      { tipo: "comentario", ini: 5.2, fim: 9, orig: 5 },
      { tipo: "tocando", ini: 9, fim: 12, orig: 5 },
      { tipo: "comentario", ini: 12, fim: 12.5, orig: 8 },
      { tipo: "tocando", ini: 12.5, fim: 14, orig: 8 },
    ]);
    expect(resumoLinha(t)).toMatchObject({ pausas: 2, duracao: 14 });
    // depois de fechada, evento atrasado (o pause do Finalizar) não mexe
    l.parado(14.1, 9.5);
    expect(l.lista).toHaveLength(6);
  });

  it("pulo enquanto toca abre trecho novo a partir do ponto novo", () => {
    const l = new LinhaTempo();
    l.iniciar(0, 10);
    l.tocando(0, 10);
    l.pulou(3, 40);
    const t = l.finalizar(5);
    expect(t).toEqual([
      { tipo: "tocando", ini: 0, fim: 3, orig: 10 },
      { tipo: "tocando", ini: 3, fim: 5, orig: 40 },
    ]);
  });

  it("formata tempo", () => {
    expect(formatarTempo(0)).toBe("0:00");
    expect(formatarTempo(102.7)).toBe("1:42");
  });
});

describe("api", () => {
  it("pedaços de 8 MB até o fim, retomando de onde parou", () => {
    const MB = 1024 * 1024;
    expect(proximoPedaco(20 * MB, 0)).toEqual([0, 8 * MB]);
    expect(proximoPedaco(20 * MB, 16 * MB)).toEqual([16 * MB, 20 * MB]);
    expect(proximoPedaco(20 * MB, 20 * MB)).toBeNull();
  });
  it("título do arquivo e endereço absoluto", () => {
    expect(tituloDoArquivo("Treino_perna FINAL.MP4")).toBe("Treino perna FINAL");
    expect(tituloDoArquivo(".mp4")).toBe("React");
    expect(urlAbsoluta("/v1/arquivo/x/final.mp4?t=1")).toBe(`${REACT_API}/v1/arquivo/x/final.mp4?t=1`);
    expect(urlAbsoluta(undefined)).toBeUndefined();
  });
});

describe("opções da montagem", () => {
  it("padrão com IA ligada até 90 s; a tabela só recebe as colunas antigas", () => {
    expect(OP_PADRAO).toEqual({ layout: "dividido", legenda: true, cortar_silencio: true, ia: true, duracao_max: 90, modelo: "nativo" });
    expect(colunasOp(OP_PADRAO)).toEqual({ layout: "dividido", legenda: true, cortar_silencio: true });
    expect(resumoOpcoes({ ...OP_PADRAO, ia: false })).toBe("Tela dividida · legenda · sem silêncios · sem IA");
  });
  it("projeto antigo (sem as colunas da IA) abre com a IA ligada", () => {
    const p = { layout: "cheia_longos", legenda: false, cortar_silencio: true } as ProjetoReact;
    expect(opcoesDoProjeto(p)).toEqual({ layout: "cheia_longos", legenda: false, cortar_silencio: true, ia: true, duracao_max: 90, modelo: "nativo" });
    expect(opcoesDoProjeto({ ...p, modelo_edicao: "classico" }).modelo).toBe("classico");
    expect(resumoOpcoes({ ...OP_PADRAO, modelo: "classico" })).toContain("modelo classico");
    expect(opcoesDoProjeto({ ...p, edicao_ia: false, duracao_max_seg: 60 })).toMatchObject({ ia: false, duracao_max: 60 });
  });
});

describe("gravador", () => {
  it("prefere MP4 H.264/AAC e cai para WebM", () => {
    expect(escolherFormato((m) => m.startsWith("video/mp4;codecs=\"avc1.42E01E"))).toContain("avc1.42E01E");
    expect(escolherFormato((m) => m === "video/webm;codecs=vp8,opus")).toBe("video/webm;codecs=vp8,opus");
    expect(escolherFormato(() => { throw new Error("x"); })).toBeNull();
    expect(extensaoDoFormato("video/webm;codecs=vp9")).toBe("webm");
  });

  it("aparelho sempre como ideal (nunca exact) e com cancelamento de eco", () => {
    const r = restricoes({ cameraId: "cam1", micId: "mic1" });
    expect((r.video as MediaTrackConstraints).deviceId).toEqual({ ideal: "cam1" });
    expect((r.audio as MediaTrackConstraints).deviceId).toEqual({ ideal: "mic1" });
    expect((r.audio as MediaTrackConstraints).echoCancellation).toBe(true);
    expect((restricoes({ lado: "environment" }).video as MediaTrackConstraints).facingMode).toEqual({ ideal: "environment" });
  });

  it("trocar câmera: próxima da lista; sem lista, frente/traseira", () => {
    const lista = { cameras: [{ deviceId: "a", label: "A", kind: "videoinput" }, { deviceId: "b", label: "B", kind: "videoinput" }], mics: [], saidas: [] };
    expect(proximaCamera(lista, { cameraId: "a" }).cameraId).toBe("b");
    expect(proximaCamera(lista, { cameraId: "b" }).cameraId).toBe("a");
    expect(proximaCamera({ cameras: [], mics: [], saidas: [] }, { lado: "user" }).lado).toBe("environment");
  });

  const faixa = () => ({ stop: vi.fn() });
  const stream = (v = 1, a = 1) => ({ getVideoTracks: () => Array(v).fill(faixa()), getAudioTracks: () => Array(a).fill(faixa()), getTracks: () => [] }) as unknown as MediaStream;

  it("aparelho escolhido sumiu: cai para o padrão sem erro", async () => {
    const gum = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error(""), { name: "OverconstrainedError" }))
      .mockResolvedValueOnce(stream());
    const s = await abrirCamera({ cameraId: "iphone" }, { getUserMedia: gum } as unknown as MediaDevices);
    expect(s).toBeTruthy();
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it("permissão negada: não insiste e explica em português", async () => {
    const gum = vi.fn().mockRejectedValue(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
    await expect(abrirCamera({}, { getUserMedia: gum } as unknown as MediaDevices)).rejects.toThrow(/Permissão de câmera\/microfone negada/);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("câmera em uso por outro app: mensagem clara depois de tentar o padrão", async () => {
    const gum = vi.fn().mockRejectedValue(Object.assign(new Error("Could not start video source"), { name: "NotReadableError" }));
    await expect(abrirCamera({}, { getUserMedia: gum } as unknown as MediaDevices)).rejects.toThrow(/em uso por outro app/);
    expect(gum).toHaveBeenCalledTimes(3);
  });

  it("sem microfone liberado: recusa (o react precisa dos dois)", async () => {
    const gum = vi.fn().mockResolvedValue(stream(1, 0));
    await expect(abrirCamera({}, { getUserMedia: gum } as unknown as MediaDevices)).rejects.toThrow(/precisa dos dois/);
  });
});

describe("módulo e tela", () => {
  it("/conteudo/react exige o módulo Conteúdo; o board continua aberto", () => {
    expect(getModuleByPath("/conteudo/react")).toBe("conteudo");
    expect(getModuleByPath("/conteudo")).toBeNull();
    expect(podeAbrirRota("/conteudo/react", false, [])).toBe(false);
    expect(podeAbrirRota("/conteudo/react", false, ["conteudo"])).toBe(true);
    expect(podeAbrirRota("/conteudo", false, [])).toBe(true);
  });

  beforeEach(() => { auth.isAdmin = false; auth.allowedModules = []; });
  afterEach(() => vi.restoreAllMocks());

  it("sem o módulo: explica e não mostra o estúdio", async () => {
    const { default: EstudioReact } = await import("@/pages/conteudo/EstudioReact");
    render(<MemoryRouter><EstudioReact /></MemoryRouter>);
    expect(screen.getByText(/não tem acesso ao Conteúdo/)).toBeTruthy();
    expect(screen.queryByText("Começar gravação")).toBeNull();
  });

  it("com o módulo: escolher vídeo no player, câmera na janelinha, botão logo abaixo, opções recolhidas", async () => {
    auth.allowedModules = ["conteudo"];
    const { default: EstudioReact } = await import("@/pages/conteudo/EstudioReact");
    render(<MemoryRouter><EstudioReact /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Estúdio React" })).toBeTruthy();
    // os cartões "1. Vídeo" e "3. Como montar" saíram da tela principal
    expect(screen.queryByText("1. Vídeo que você vai reagir")).toBeNull();
    expect(screen.queryByText("3. Como montar")).toBeNull();
    const palco = screen.getByTestId("palco");
    expect(palco.textContent).toContain("Escolher vídeo");                              // botão sobre o player vazio
    expect(screen.getByTestId("camera-pip").textContent).toContain("Ligar câmera e microfone");
    expect(palco.contains(screen.getByTestId("camera-pip"))).toBe(true);                 // câmera colada ao vídeo
    const comecar = screen.getByRole("button", { name: /Começar gravação/ });
    expect((comecar as HTMLButtonElement).disabled).toBe(true);
    // o botão vem logo depois do palco, antes das opções
    expect(palco.compareDocumentPosition(comecar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Escolha o vídeo no player.")).toBeTruthy();
    // opções recolhidas com o padrão: tela dividida, legenda, sem silêncios e IA até 90 s
    expect(screen.getByText("Tela dividida · legenda · sem silêncios · IA até 90 s")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Edição com IA" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Opções/ }));
    const ia = await screen.findByRole("switch", { name: "Edição com IA" });
    expect(ia.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("tab", { name: /Já gravei separado/ })).toBeTruthy();
    expect(await screen.findByText("Nenhum react ainda.")).toBeTruthy();
  });
});
