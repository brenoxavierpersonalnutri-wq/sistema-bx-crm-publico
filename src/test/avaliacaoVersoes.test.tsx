import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const pixel = vi.fn();
vi.mock("@/lib/novaavPixel", () => ({
  initializeMetaPixel: () => pixel(),
  trackLeadQualificado: vi.fn(),
}));
// Beacon da página e eventos do rotador: aqui só importa quem chama e com o quê.
const beacon = vi.fn();
vi.mock("@/lib/pageBeacon", () => ({ iniciarBeaconDaPagina: (...a: unknown[]) => beacon(...a) }));
const eventosRotador = vi.fn(() => () => undefined);
vi.mock("@/lib/rotatorEventos", () => ({ iniciarEventosDoRotador: () => eventosRotador() }));
// O formulário real é pesado e fala com o banco; aqui só importa a prop.
const formProps = vi.fn();
vi.mock("@/components/novaav/QualificationForm", () => ({
  default: (p: { versao?: string }) => {
    formProps(p);
    return <div data-testid="form">form {p.versao ?? "sem-versao"}</div>;
  },
}));

import CaptacaoAvaliacao from "@/pages/CaptacaoAvaliacao";
import CaptacaoAvaliacaoVersao from "@/pages/CaptacaoAvaliacaoVersao";
import { AVALIACAO_VERSOES, avaliacaoVersao } from "@/config/avaliacaoVersoes";

const Onde = () => {
  const l = useLocation();
  return <div data-testid="onde">{l.pathname + l.search}</div>;
};

function abrir(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/avaliacao" element={<><CaptacaoAvaliacao /><Onde /></>} />
        <Route path="/avaliacao/:versao" element={<CaptacaoAvaliacaoVersao />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TITULOS: Record<string, [string, string]> = {
  v1: ["TODO MUNDO TE ACHA MAGRA. SÓ VOCÊ SABE O QUE INCOMODA", "SÓ VOCÊ SABE O QUE INCOMODA"],
  v2: ["AQUELA GORDURINHA DO SUTIÃ QUE NINGUÉM CONSEGUE TIRAR TEM EXPLICAÇÃO", "TEM EXPLICAÇÃO"],
  v3: ["MAGRA VOCÊ JÁ É. AGORA É SECAR E DEFINIR", "AGORA É SECAR E DEFINIR"],
  v4: ["MAIS DE 800 MULHERES JÁ SECARAM A BARRIGA COM PEQUENOS AJUSTES", "COM PEQUENOS AJUSTES"],
  v5: ["JUNTEI EDUCAÇÃO FÍSICA E NUTRIÇÃO NUM MÉTODO SÓ PRA FALSA MAGRA", "SÓ PRA FALSA MAGRA"],
  v6: [
    "SE VOCÊ PARECE MAGRA E A GORDURA LOCALIZADA NÃO SAI, O PROBLEMA NUNCA FOI O PESO",
    "O PROBLEMA NUNCA FOI O PESO",
  ],
};
const FOTOS: Record<string, string | null> = {
  v1: "resultado-1",
  v2: "resultado-3",
  v3: "resultado-2",
  v4: "resultado-4",
  v5: "breno-quem-sou-eu",
  v6: null,
};

// O Node novo expõe um localStorage global vazio que esconde o do jsdom; o
// selo de vagas usa localStorage, então o teste usa um em memória.
const memoria = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
});

beforeEach(() => {
  pixel.mockClear();
  formProps.mockClear();
  beacon.mockClear();
  eventosRotador.mockClear();
  memoria.clear();
});
afterEach(cleanup);

describe("versões da avaliação (config)", () => {
  it("são 6, v1..v6, com o título e a foto do pedido", () => {
    expect(AVALIACAO_VERSOES.map((v) => v.key)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
    for (const v of AVALIACAO_VERSOES) {
      const [titulo, amarelo] = TITULOS[v.key];
      expect(v.headlineBefore + v.headlineHighlight).toBe(titulo);
      expect(v.headlineHighlight).toBe(amarelo);
      expect(v.rotulo).toBe(`avaliacao-${v.key}`);
      if (FOTOS[v.key] === null) expect(v.photo).toBeNull();
      else expect(v.photo).toContain(FOTOS[v.key]);
    }
  });
  it("versão desconhecida não existe", () => {
    expect(avaliacaoVersao("v7")).toBeUndefined();
    expect(avaliacaoVersao(undefined)).toBeUndefined();
    expect(avaliacaoVersao("V3")?.key).toBe("v3");
  });
});

describe("páginas /avaliacao/vN", () => {
  for (const key of ["v1", "v2", "v3", "v4", "v5", "v6"]) {
    it(`${key}: título, foto, resto igual e versão no formulário`, async () => {
      const { container } = abrir(`/avaliacao/${key}`);
      const h1 = container.querySelector("h1")!;
      expect(h1.textContent).toBe(TITULOS[key][0]);
      expect(h1.querySelector("span")!.textContent).toBe(TITULOS[key][1]);
      const img = container.querySelector("section")!.querySelector("img") as HTMLImageElement | null;
      if (FOTOS[key] === null) {
        expect(img).toBeNull();
        expect(h1.className).toContain("text-4xl");
      } else {
        expect(img!.getAttribute("src")).toContain(FOTOS[key]!);
        expect(h1.className).toContain("text-3xl");
      }
      // Igual à /avaliacao: selo, botão e linha de baixo da variação padrão.
      expect(screen.getByText(/Restam/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Quero minha avaliação gratuita/i })).toBeTruthy();
      expect(screen.getByText("especialista em falsa magra")).toBeTruthy();
      expect(await screen.findByTestId("form")).toBeTruthy();
      expect(formProps).toHaveBeenLastCalledWith(expect.objectContaining({ versao: `avaliacao-${key}` }));
      expect(pixel).toHaveBeenCalled();
      // Teste /r/avaliacao-4v: conexão/velocidade e eventos do rotador da versão.
      expect(beacon).toHaveBeenCalledWith("avaliacao", key);
      expect(eventosRotador).toHaveBeenCalled();
    });
  }

  it("versão inexistente cai na /avaliacao com a query string", async () => {
    abrir("/avaliacao/v9?utm_source=fb&utm_content=x");
    expect((await screen.findByTestId("onde")).textContent).toBe("/avaliacao?utm_source=fb&utm_content=x");
  });

  it("/avaliacao (controle) continua igual: título, foto e formulário sem versão", async () => {
    const { container } = abrir("/avaliacao");
    expect(container.querySelector("h1")!.textContent).toBe("PARABÉNS, VOCÊ GANHOU UMA AVALIAÇÃO 100% GRATUITA");
    expect((container.querySelector("section")!.querySelector("img") as HTMLImageElement).getAttribute("src")).toContain("antes-depois-hero");
    expect(await screen.findByTestId("form")).toBeTruthy();
    expect(formProps).toHaveBeenLastCalledWith(expect.not.objectContaining({ versao: expect.anything() }));
    // A base não ganhou beacon nem eventos do rotador.
    expect(beacon).not.toHaveBeenCalled();
    expect(eventosRotador).not.toHaveBeenCalled();
  });
});
