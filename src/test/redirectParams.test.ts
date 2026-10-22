import { describe, it, expect } from "vitest";
import { mergeRedirectUrl, spaPathFor, variantLabelFromUrl } from "@/lib/redirectParams";

const ORIGIN = "https://equipe.brenoxavier.com.br";
const params = (url: string) => new URL(url, ORIGIN).searchParams;

describe("variantLabelFromUrl", () => {
  it("deriva vN do path", () => {
    expect(variantLabelFromUrl(`${ORIGIN}/desafio/v2?cm_click=x`)).toBe("v2");
    expect(variantLabelFromUrl(`${ORIGIN}/desafio/V5/`)).toBe("v5");
  });
  it("sem vN usa o último segmento; raiz devolve null", () => {
    expect(variantLabelFromUrl(`${ORIGIN}/avaliacao`)).toBe("avaliacao");
    expect(variantLabelFromUrl(`${ORIGIN}/`)).toBeNull();
  });
});

describe("mergeRedirectUrl", () => {
  it("repassa utm/fbclid, mantém cm_click do rotador e marca a variação", () => {
    const out = mergeRedirectUrl(
      `${ORIGIN}/desafio/v3?cm_click=abc`,
      "?utm_source=meta&utm_campaign=dmd&fbclid=FB1",
      "",
      ORIGIN,
    );
    const p = params(out);
    expect(new URL(out).pathname).toBe("/desafio/v3");
    expect(p.get("cm_click")).toBe("abc");
    expect(p.get("utm_source")).toBe("meta");
    expect(p.get("utm_campaign")).toBe("dmd");
    expect(p.get("fbclid")).toBe("FB1");
    expect(p.get("cm_variant")).toBe("v3");
    expect(p.get("utm_content")).toBe("v3");
  });

  it("utm_content do anúncio fica; a variação vai só no cm_variant", () => {
    const p = params(mergeRedirectUrl(`${ORIGIN}/desafio/v1?cm_click=c`, "?utm_content=criativo_7", "", ORIGIN));
    expect(p.getAll("utm_content")).toEqual(["criativo_7"]);
    expect(p.get("cm_variant")).toBe("v1");
  });

  it("cm_click e cm_variant da entrada nunca entram", () => {
    const p = params(mergeRedirectUrl(`${ORIGIN}/desafio/v4?cm_click=novo`, "?cm_click=velho&cm_variant=v9", "", ORIGIN));
    expect(p.getAll("cm_click")).toEqual(["novo"]);
    expect(p.getAll("cm_variant")).toEqual(["v4"]);
  });

  it("em conflito vale o parâmetro do destino (regra antiga deste repo)", () => {
    const p = params(
      mergeRedirectUrl(`${ORIGIN}/avaliacao?utm_source=parceira-x&cm_click=c`, "?utm_source=instagram&utm_medium=bio", "", ORIGIN),
    );
    expect(p.getAll("utm_source")).toEqual(["parceira-x"]);
    expect(p.get("utm_medium")).toBe("bio");
  });

  it("destino sem vN ganha cm_variant mas não ganha utm_content", () => {
    const p = params(mergeRedirectUrl(`${ORIGIN}/avaliacao?cm_click=c`, "?utm_source=parceira", "", ORIGIN));
    expect(p.get("cm_variant")).toBe("avaliacao");
    expect(p.has("utm_content")).toBe(false);
  });

  it("ignora param vazio e preserva acento/espaço", () => {
    const p = params(mergeRedirectUrl(`${ORIGIN}/desafio/v2?cm_click=a`, "?utm_term=&utm_campaign=promoção%20out", "", ORIGIN));
    expect(p.has("utm_term")).toBe(false);
    expect(p.get("utm_campaign")).toBe("promoção out");
  });

  it("hash: o do destino; senão o da entrada", () => {
    expect(new URL(mergeRedirectUrl(`${ORIGIN}/desafio/v2?cm_click=a#oferta`, "", "#x", ORIGIN)).hash).toBe("#oferta");
    expect(new URL(mergeRedirectUrl(`${ORIGIN}/desafio/v2?cm_click=a`, "", "#x", ORIGIN)).hash).toBe("#x");
  });

  it("URL relativa continua relativa; outro domínio continua absoluto", () => {
    expect(mergeRedirectUrl("/desafio/v1?cm_click=r", "?a=1", "", ORIGIN).startsWith("/desafio/v1?")).toBe(true);
    expect(mergeRedirectUrl("https://outro.com/v2?cm_click=r", "", "", ORIGIN).startsWith("https://outro.com/v2?")).toBe(true);
  });
});

describe("spaPathFor", () => {
  it("abre sem recarregar só /desafio/ do mesmo domínio", () => {
    expect(spaPathFor(`${ORIGIN}/desafio/v2?cm_click=a&utm_source=meta#o`, ORIGIN)).toBe("/desafio/v2?cm_click=a&utm_source=meta#o");
    expect(spaPathFor("/desafio/v5?x=1", ORIGIN)).toBe("/desafio/v5?x=1");
  });
  it("outro domínio ou outra rota: redirect completo (null)", () => {
    expect(spaPathFor("https://bgimplementacao.brenoxavier.com.br/desafio/v1", ORIGIN)).toBeNull();
    expect(spaPathFor(`${ORIGIN}/avaliacao?x=1`, ORIGIN)).toBeNull();
    expect(spaPathFor(`${ORIGIN}/mapamental/index.html`, ORIGIN)).toBeNull();
    expect(spaPathFor(`${ORIGIN}/desafio`, ORIGIN)).toBeNull();
  });
});
