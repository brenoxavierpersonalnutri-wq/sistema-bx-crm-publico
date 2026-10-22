import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

const pixel = vi.fn();
const beacon = vi.fn();
vi.mock("@/lib/novaavPixel", () => ({ initializeMetaPixel: () => pixel(), trackDesafioVariante: () => undefined }));
vi.mock("@/lib/pageBeacon", () => ({ iniciarBeaconDaPagina: (...a: unknown[]) => beacon(...a) }));

import DesafioPage from "@/pages/DesafioPage";
import { VARIANTES_DESAFIO, trechosDoSubtitulo, varianteDesafio } from "@/content/desafio/variantes";

function abrir(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/desafio/:variante" element={<DesafioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("promessas do desafio (copy)", () => {
  it("são 6, v1..v6, com títulos e subtítulos diferentes", () => {
    expect(VARIANTES_DESAFIO.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
    expect(new Set(VARIANTES_DESAFIO.map((v) => v.titulo + v.destaque)).size).toBe(6);
    expect(new Set(VARIANTES_DESAFIO.map((v) => v.subtitulo)).size).toBe(6);
  });
  it("sem travessão, sem quilos, 14 dias e nunca 27; v1..v5 citam R$29 no subtítulo", () => {
    for (const v of VARIANTES_DESAFIO) {
      const t = `${v.titulo} ${v.destaque} ${v.subtitulo}`;
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/\bkg\b|quilo/i);
      expect(t).not.toMatch(/27/);
      expect(t).toMatch(/14 dias/i);
      if (v.id !== "v6") expect(v.subtitulo).toContain("R$29");
    }
  });
  it("v6 é a dobra da página oficial, palavra por palavra, com os mesmos negritos", () => {
    const v6 = varianteDesafio("v6")!;
    expect(`${v6.titulo} ${v6.destaque}`).toBe("DEFINIÇÃO FEMININA EM 14 DIAS É IMPOSSÍVEL?");
    expect(v6.destaque).toBe("É IMPOSSÍVEL?");
    expect(v6.subtitulo).toBe(
      "Definição feminina para mulheres reais que enfrentam gordura abdominal teimosa e flacidez, e querem resultados duradouros mesmo com rotina corrida",
    );
    expect(trechosDoSubtitulo(v6).filter((t) => t.negrito).map((t) => t.texto)).toEqual([
      "Definição feminina para mulheres reais",
      "gordura abdominal",
      "flacidez",
      "rotina corrida",
    ]);
    expect(trechosDoSubtitulo(v6).map((t) => t.texto).join("")).toBe(v6.subtitulo);
  });
  it("subtítulo sem negritos vira um trecho só", () => {
    expect(trechosDoSubtitulo({ subtitulo: "abc" })).toEqual([{ texto: "abc", negrito: false }]);
  });
});

describe("página /desafio/:variante", () => {
  beforeEach(() => {
    cleanup();
    pixel.mockClear();
    beacon.mockClear();
  });

  for (const v of VARIANTES_DESAFIO) {
    it(`${v.id}: promessa própria, todo botão vai pro checkout, pixel e beacon uma vez`, () => {
      const { container } = abrir(`/desafio/${v.id}`);
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(h1.textContent).toBe(`${v.titulo} ${v.destaque}`);
      expect(container.textContent).toContain(v.subtitulo);

      const ctas = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.dmd-cta"));
      expect(ctas.length).toBeGreaterThanOrEqual(5);
      for (const a of ctas) expect(a.getAttribute("href")).toBe("https://pay.pagtrust.com.br/fnc35209fa");

      expect(container.textContent).toContain("R$29");
      expect(container.textContent).not.toMatch(/R\$ ?27\b/);
      expect(container.textContent).not.toMatch(/[—–]/);
      expect(container.textContent).not.toMatch(/companhamento/i);
      expect(container.textContent).toContain("Metodologia completa de personal e nutri");
      expect(container.textContent).toContain("R$297");

      // Garantia logo abaixo do preço, dentro da oferta (casa com os criativos de devolução).
      const garantia = container.querySelector('#oferta [data-testid="garantia-preco"]');
      expect(garantia?.textContent).toContain("Garantia de resultado");
      expect(garantia?.textContent).toContain("devolvo cada centavo do seu dinheiro");

      expect(pixel).toHaveBeenCalledTimes(1);
      expect(beacon).toHaveBeenCalledWith("desafio", v.id);
    });
  }

  it("v6 mostra o título oficial com o destaque em amarelo e os negritos", () => {
    const { container } = abrir("/desafio/v6");
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("DEFINIÇÃO FEMININA EM 14 DIAS É IMPOSSÍVEL?");
    expect(h1.querySelector(".dmd-gold")?.textContent).toBe("É IMPOSSÍVEL?");
    const negritos = Array.from(container.querySelectorAll("main.dmd section:first-child p.text-lg .dmd-strong")).map((e) => e.textContent);
    expect(negritos).toEqual(["Definição feminina para mulheres reais", "gordura abdominal", "flacidez", "rotina corrida"]);
  });

  it("o corpo é idêntico nas 6 variações (só a dobra muda)", () => {
    const corpos = VARIANTES_DESAFIO.map((v) => {
      const { container } = abrir(`/desafio/${v.id}`);
      const secoes = Array.from(container.querySelectorAll("main.dmd > section")).slice(1);
      const html = secoes.map((s) => s.outerHTML).join("");
      cleanup();
      return html;
    });
    expect(new Set(corpos).size).toBe(1);
  });

  it("visita pelo /r/: todo botão leva o marcador do clique e o clique registra 1 checkout no rotator-track", () => {
    const clique = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    vi.stubEnv("VITE_SUPABASE_URL", "https://teste.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-publica");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const bloquear = (e: Event) => e.preventDefault(); // jsdom não navega
    document.addEventListener("click", bloquear);
    window.history.replaceState(null, "", `/desafio/v3?utm_source=FB&utm_content=AD1&cm_click=${clique}&cm_variant=v3`);
    try {
      const { container } = abrir("/desafio/v3");
      const ctas = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.dmd-cta"));
      expect(ctas.length).toBeGreaterThanOrEqual(5);
      for (const a of ctas) {
        const u = new URL(a.href);
        expect(u.origin + u.pathname).toBe("https://pay.pagtrust.com.br/fnc35209fa");
        expect(u.searchParams.get("utm_source")).toBe("FB");
        expect(u.searchParams.get("utm_content")).toBe("AD1");
        expect(u.searchParams.get("sck")).toBe(`cm_v3_${clique}`);
        expect(u.searchParams.get("src")).toBe(`cm_v3_${clique}`);
        expect(u.searchParams.get("utm_term")).toBe(`cm_v3_${clique}`);
      }
      fireEvent.click(ctas[0]);
      fireEvent.click(ctas[1]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://teste.supabase.co/functions/v1/rotator-track");
      expect(init.keepalive).toBe(true);
      expect(init.headers.apikey).toBe("chave-publica");
      expect(JSON.parse(init.body)).toMatchObject({ click_id: clique, event_type: "checkout", value: 0 });
    } finally {
      document.removeEventListener("click", bloquear);
      window.history.replaceState(null, "", "/");
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("clique fora do botão de compra não registra checkout", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_SUPABASE_URL", "https://teste.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-publica");
    window.history.replaceState(null, "", "/desafio/v1?cm_click=1b4e28ba-2fa1-41d2-883f-0016d3cca427");
    try {
      const { container } = abrir("/desafio/v1");
      fireEvent.click(container.querySelector("h1")!);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("variação inexistente não abre a página nem dispara pixel", () => {
    const { container } = abrir("/desafio/v99");
    expect(container.querySelector("main.dmd")).toBeNull();
    expect(pixel).not.toHaveBeenCalled();
  });

  it("nenhum arquivo do desafio diz \"acompanhamento\"", () => {
    const raiz = path.resolve(__dirname, "..");
    for (const f of ["components/desafio/DesafioSecoes.tsx", "pages/DesafioPage.tsx", "content/desafio/variantes.ts"]) {
      expect(readFileSync(path.join(raiz, f), "utf8")).not.toMatch(/companhamento/i);
    }
  });

  it("nenhum outro link de checkout no código do desafio", () => {
    const raiz = path.resolve(__dirname, "..");
    const arquivos = [
      "components/desafio/DesafioSecoes.tsx",
      "pages/DesafioPage.tsx",
      "lib/desafioCheckout.ts",
      "content/desafio/variantes.ts",
    ];
    for (const f of arquivos) {
      const src = readFileSync(path.join(raiz, f), "utf8");
      const links = src.match(/https:\/\/[a-z.]*pagtrust[^"'\s]*/g) ?? [];
      for (const l of links) expect(l).toBe("https://pay.pagtrust.com.br/fnc35209fa");
    }
  });
});
