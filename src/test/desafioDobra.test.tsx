import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

const pixel = vi.fn();
const evento = vi.fn();
const beacon = vi.fn();
vi.mock("@/lib/novaavPixel", () => ({
  initializeMetaPixel: () => pixel(),
  trackDesafioVariante: (...a: unknown[]) => evento(...a),
}));
vi.mock("@/lib/pageBeacon", () => ({ iniciarBeaconDaPagina: (...a: unknown[]) => beacon(...a) }));

import DesafioPage from "@/pages/DesafioPage";
import {
  BENEFICIOS_DOBRA,
  HEAD_CAMPEA,
  SUBHEAD_CURTA,
  VARIANTES_DOBRA,
  faltaAte,
} from "@/content/desafio/dobras";
import { VARIANTES_DESAFIO } from "@/content/desafio/variantes";
import { checkoutComVariante } from "@/lib/desafioCheckout";

const CHECKOUT = "https://pay.pagtrust.com.br/fnc35209fa";

function abrir(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/desafio/:variante" element={<DesafioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("teste de dobra do desafio (v7..v9)", () => {
  beforeEach(() => {
    cleanup();
    pixel.mockClear();
    evento.mockClear();
    beacon.mockClear();
  });

  it("são 3 versões, v7..v9, sem colidir com as promessas v1..v6", () => {
    expect(VARIANTES_DOBRA.map((v) => v.id)).toEqual(["v7", "v8", "v9"]);
    const promessas = new Set(VARIANTES_DESAFIO.map((v) => v.id as string));
    for (const v of VARIANTES_DOBRA) expect(promessas.has(v.id)).toBe(false);
  });

  it("copy sem travessão, sem quilos e sem prazo de resultado garantido", () => {
    const t = [HEAD_CAMPEA.titulo, HEAD_CAMPEA.destaque, SUBHEAD_CURTA, ...BENEFICIOS_DOBRA.map((b) => b.forte + b.resto)].join(" ");
    expect(t).not.toMatch(/[—–]/);
    expect(t).not.toMatch(/\bkg\b|quilo/i);
    expect(t).not.toMatch(/n[ãa]o [ée] .*, [ée] /i);
  });

  for (const v of VARIANTES_DOBRA) {
    it(`${v.id}: mesma head, botão na dobra com variante, corpo das outras versões, pixel com variante`, () => {
      const { container } = abrir(`/desafio/${v.id}`);
      expect(container.querySelector("h1")?.textContent).toBe(`${HEAD_CAMPEA.titulo} ${HEAD_CAMPEA.destaque}`);

      const hero = container.querySelector("main.dmd > section:first-child")!;
      const cta = hero.querySelector<HTMLAnchorElement>('[data-testid="cta-dobra"]')!;
      expect(cta).not.toBeNull();
      const u = new URL(cta.href);
      expect(u.origin + u.pathname).toBe(CHECKOUT);
      expect(u.searchParams.get("variante")).toBe(v.id);
      expect(hero.textContent).toContain("R$29");
      expect(hero.textContent).toContain("Garantia de 7 dias");

      // Todo botão da página vai pro mesmo checkout com a variante.
      const ctas = Array.from(container.querySelectorAll<HTMLAnchorElement>("a.dmd-cta"));
      expect(ctas.length).toBeGreaterThanOrEqual(5);
      for (const a of ctas) expect(new URL(a.href).searchParams.get("variante")).toBe(v.id);

      // Garantia da oferta continua lá.
      expect(container.querySelector('#oferta [data-testid="garantia-preco"]')).not.toBeNull();
      // Sem a contagem de 10 minutos que reinicia sozinha.
      expect(hero.textContent).not.toMatch(/Expira em/);

      expect(pixel).toHaveBeenCalledTimes(1);
      expect(evento).toHaveBeenCalledWith("DMD_VerPagina", v.id);
      expect(beacon).toHaveBeenCalledWith("desafio", v.id);

      const bloquear = (e: Event) => e.preventDefault();
      document.addEventListener("click", bloquear);
      fireEvent.click(cta);
      document.removeEventListener("click", bloquear);
      expect(evento).toHaveBeenCalledWith("DMD_CliqueCheckout", v.id);
    });
  }

  it("o que muda na dobra: prova abaixo do botão (v7), antes e depois (v8), 3 benefícios (v9)", () => {
    const ordem = (id: string, a: string, b: string) => {
      const { container } = abrir(`/desafio/${id}`);
      const ea = container.querySelector(`[data-testid="${a}"]`)!;
      const eb = container.querySelector(`[data-testid="${b}"]`)!;
      const pos = ea.compareDocumentPosition(eb);
      cleanup();
      return pos;
    };
    expect(ordem("v7", "cta-dobra", "prova-dobra") & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ordem("v8", "antes-depois-dobra", "cta-dobra") & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ordem("v9", "beneficios-dobra", "cta-dobra") & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const { container } = abrir("/desafio/v9");
    expect(container.querySelectorAll('[data-testid="beneficios-dobra"] li')).toHaveLength(3);
    // Sem prazo definido, nada de contagem.
    expect(container.querySelector('[data-testid="prazo-real"]')).toBeNull();
  });

  it("do bloco Dores para baixo, v7..v9 são iguais às promessas", () => {
    const corpo = (id: string) => {
      const { container } = abrir(`/desafio/${id}`);
      const html = Array.from(container.querySelectorAll("main.dmd > section")).slice(1).map((s) => s.outerHTML).join("");
      cleanup();
      return html.replace(/variante=v\d+/g, "").replace(/[?&]"/g, '"');
    };
    const base = corpo("v1");
    for (const v of VARIANTES_DOBRA) expect(corpo(v.id)).toBe(base);
  });

  it("faltaAte: só conta até prazo real e futuro", () => {
    const agora = Date.parse("2026-10-21T12:00:00-03:00");
    expect(faltaAte(null, agora)).toBeNull();
    expect(faltaAte("2026-10-21T11:00:00-03:00", agora)).toBeNull();
    expect(faltaAte("2026-10-23T14:05:00-03:00", agora)).toBe("2d 2h 05min");
    expect(faltaAte("2026-10-21T13:30:00-03:00", agora)).toBe("1h 30min");
  });

  it("checkoutComVariante não troca o que existe e ignora id inválido", () => {
    expect(checkoutComVariante(`${CHECKOUT}?variante=v1`, "v8")).toBe(`${CHECKOUT}?variante=v1`);
    expect(checkoutComVariante(CHECKOUT, "x")).toBe(CHECKOUT);
    expect(checkoutComVariante("nao-url", "v7")).toBe("nao-url");
  });

  it("nenhum outro link de checkout nos arquivos novos", () => {
    const raiz = path.resolve(__dirname, "..");
    for (const f of ["components/desafio/DesafioDobra.tsx", "content/desafio/dobras.ts"]) {
      const src = readFileSync(path.join(raiz, f), "utf8");
      expect(src.match(/https:\/\/[a-z.]*pagtrust[^"'\s]*/g) ?? []).toEqual([]);
    }
  });
});
