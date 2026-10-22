import { describe, it, expect } from "vitest";
import {
  DESAFIO_CHECKOUT_URL,
  checkoutComUtms,
  checkoutDoDesafio,
  cmClickDaVisita,
  corpoDoCheckout,
  marcadorDoClique,
} from "@/lib/desafioCheckout";
import { extrairMarcadorDoRotador } from "../../supabase/functions/pagtrust-webhook/rotatorVenda.ts";

describe("checkoutComUtms", () => {
  it("checkout é o da PagTrust combinado", () => {
    expect(DESAFIO_CHECKOUT_URL).toBe("https://pay.pagtrust.com.br/fnc35209fa");
  });
  it("sem UTM devolve o checkout puro", () => {
    expect(checkoutComUtms("")).toBe("https://pay.pagtrust.com.br/fnc35209fa");
    expect(checkoutComUtms("?cm_click=abc&fbclid=x")).toBe("https://pay.pagtrust.com.br/fnc35209fa");
  });
  it("leva só utm_* e ignora vazio", () => {
    const u = new URL(checkoutComUtms("?utm_source=meta&utm_content=v2&utm_term=&fbclid=F&cm_variant=v2"));
    expect(u.origin + u.pathname).toBe("https://pay.pagtrust.com.br/fnc35209fa");
    expect(u.searchParams.get("utm_source")).toBe("meta");
    expect(u.searchParams.get("utm_content")).toBe("v2");
    expect(u.searchParams.has("utm_term")).toBe(false);
    expect(u.searchParams.has("fbclid")).toBe(false);
    expect(u.searchParams.has("cm_variant")).toBe(false);
  });
  it("não troca parâmetro que o checkout já traga e não duplica", () => {
    const u = new URL(checkoutComUtms("?utm_source=meta&utm_source=outro", "https://pay.x.com/c?utm_source=fixo"));
    expect(u.searchParams.getAll("utm_source")).toEqual(["fixo"]);
  });
  it("URL de checkout inválida devolve ela mesma", () => {
    expect(checkoutComUtms("?utm_source=a", "nao-e-url")).toBe("nao-e-url");
  });
});


const CLIQUE = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("marcador do clique do rotador", () => {
  it("cm_click válido vira cm_vN_<uuid> em minúsculas", () => {
    expect(marcadorDoClique(CLIQUE, "v3")).toBe(`cm_v3_${CLIQUE}`);
    expect(marcadorDoClique(CLIQUE.toUpperCase(), "V3")).toBe(`cm_v3_${CLIQUE}`);
    expect(marcadorDoClique(CLIQUE, null)).toBe(`cm_${CLIQUE}`);
    expect(marcadorDoClique(CLIQUE, "desafio")).toBe(`cm_${CLIQUE}`);
  });
  it("sem clique válido não há marcador", () => {
    expect(marcadorDoClique(null, "v1")).toBeNull();
    expect(marcadorDoClique("abc", "v1")).toBeNull();
    expect(cmClickDaVisita("?cm_click=nao-e-uuid")).toBeNull();
    expect(cmClickDaVisita(`?cm_click=${CLIQUE}`)).toBe(CLIQUE);
  });
  it("o marcador que a página monta é o que o webhook reconhece", () => {
    const m = marcadorDoClique(CLIQUE, "v5")!;
    expect(extrairMarcadorDoRotador({ data: { purchase: { origin: { sck: m } } } })).toEqual({ clickId: CLIQUE, variante: "v5" });
  });
});

describe("checkoutDoDesafio", () => {
  it("visita pelo rotador: utm do anúncio intactas, marcador em sck, src e utm_term", () => {
    const search = `?utm_source=FB&utm_campaign=camp&utm_content=AD%2001&cm_click=${CLIQUE}&cm_variant=v2&fbclid=X`;
    const u = new URL(checkoutDoDesafio(search, "v2"));
    expect(u.origin + u.pathname).toBe(DESAFIO_CHECKOUT_URL);
    expect(u.searchParams.get("utm_source")).toBe("FB");
    expect(u.searchParams.get("utm_campaign")).toBe("camp");
    expect(u.searchParams.get("utm_content")).toBe("AD 01");
    expect(u.searchParams.get("sck")).toBe(`cm_v2_${CLIQUE}`);
    expect(u.searchParams.get("src")).toBe(`cm_v2_${CLIQUE}`);
    expect(u.searchParams.get("utm_term")).toBe(`cm_v2_${CLIQUE}`);
    expect(u.searchParams.has("cm_click")).toBe(false);
    expect(u.searchParams.has("fbclid")).toBe(false);
  });
  it("utm_term do anúncio fica, com o marcador depois de |", () => {
    const u = new URL(checkoutDoDesafio(`?utm_term=Instagram_Reels&cm_click=${CLIQUE}`, "v1"));
    expect(u.searchParams.get("utm_term")).toBe(`Instagram_Reels|cm_v1_${CLIQUE}`);
    expect(extrairMarcadorDoRotador({ utm_term: u.searchParams.get("utm_term") })?.clickId).toBe(CLIQUE);
  });
  it("sem cm_click é igual ao checkoutComUtms (acesso direto)", () => {
    expect(checkoutDoDesafio("", "v1")).toBe(DESAFIO_CHECKOUT_URL);
    expect(checkoutDoDesafio("?utm_source=a", "v1")).toBe(checkoutComUtms("?utm_source=a"));
  });
  it("não troca sck/src que o checkout já traga", () => {
    const u = new URL(checkoutDoDesafio(`?cm_click=${CLIQUE}`, "v1", "https://pay.x.com/c?sck=parceiro"));
    expect(u.searchParams.get("sck")).toBe("parceiro");
    expect(u.searchParams.get("src")).toBe(`cm_v1_${CLIQUE}`);
  });
  it("checkout inválido devolve ele mesmo", () => {
    expect(checkoutDoDesafio(`?cm_click=${CLIQUE}`, "v1", "nao-e-url")).toBe("nao-e-url");
  });
});

describe("corpoDoCheckout", () => {
  it("monta o evento checkout do rotator-track", () => {
    expect(corpoDoCheckout(`?cm_click=${CLIQUE}`, "https://equipe.brenoxavier.com.br/desafio/v2?cm_click=x")).toEqual({
      click_id: CLIQUE,
      event_type: "checkout",
      value: 0,
      page_url: "https://equipe.brenoxavier.com.br/desafio/v2?cm_click=x",
    });
  });
  it("sem cm_click não manda nada", () => {
    expect(corpoDoCheckout("?utm_source=a", "https://x")).toBeNull();
  });
});
