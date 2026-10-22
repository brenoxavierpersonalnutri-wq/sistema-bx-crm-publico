import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  corpoDoEventoDoRotador,
  paramsDoRotadorParaAgendar,
  urlSemDadoPessoal,
} from "@/lib/rotatorEventos";
import { casaRegra } from "@/lib/rotatorResultados";

// Teste /r/avaliacao-4v: o clique do rotador tem de chegar ao /agendar e o
// pageview de lá tem de casar a regra "URL contém agendar", sem levar nome e
// WhatsApp da lead pro rotator_events.
const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const REGRA = { type: "url_contains" as const, value: "agendar" };

describe("paramsDoRotadorParaAgendar", () => {
  it("leva cm_click e cm_variant da versão", () => {
    expect(paramsDoRotadorParaAgendar(`?cm_click=${UUID}&cm_variant=v3&utm_source=meta&utm_content=v3`)).toEqual([
      ["cm_click", UUID],
      ["cm_variant", "v3"],
    ]);
  });

  it("uuid em maiúsculas vira minúsculas (formato da edge function)", () => {
    expect(paramsDoRotadorParaAgendar(`?cm_click=${UUID.toUpperCase()}`)).toEqual([["cm_click", UUID]]);
  });

  it("sem cm_click válido não leva nada, nem o cm_variant", () => {
    expect(paramsDoRotadorParaAgendar("?cm_variant=v1&utm_source=meta")).toEqual([]);
    expect(paramsDoRotadorParaAgendar("?cm_click=abc&cm_variant=v1")).toEqual([]);
    expect(paramsDoRotadorParaAgendar("")).toEqual([]);
  });

  it("cm_variant com lixo fica de fora, o clique vai", () => {
    expect(paramsDoRotadorParaAgendar(`?cm_click=${UUID}&cm_variant=<script>`)).toEqual([["cm_click", UUID]]);
  });
});

describe("urlSemDadoPessoal", () => {
  it("tira nome, WhatsApp e respostas; mantém caminho, utm_* e cm_*", () => {
    const href = `https://equipe.brenoxavier.com.br/agendar?origem=avaliacao&nome=Maria+Teste&whatsapp=%2B5531999999999&score=70&utm_source=meta&utm_content=v2&cm_click=${UUID}&cm_variant=v2`;
    const limpa = urlSemDadoPessoal(href);
    expect(limpa).toBe(`https://equipe.brenoxavier.com.br/agendar?utm_source=meta&utm_content=v2&cm_click=${UUID}&cm_variant=v2`);
    expect(limpa).not.toMatch(/Maria|5531|whatsapp|nome|score/);
  });

  it("URL inválida vira vazio", () => {
    expect(urlSemDadoPessoal("não é url")).toBe("");
  });
});

describe("corpoDoEventoDoRotador", () => {
  it("pageview do /agendar casa a regra do teste e carrega o clique", () => {
    const search = `?nome=Maria&whatsapp=5531999999999&cm_click=${UUID}&cm_variant=v1`;
    const corpo = corpoDoEventoDoRotador("pageview", search, `https://equipe.brenoxavier.com.br/agendar${search}`);
    expect(corpo).toMatchObject({ click_id: UUID, event_type: "pageview", value: 0 });
    expect(casaRegra(corpo!.page_url, REGRA)).toBe(true);
    expect(corpo!.page_url).not.toMatch(/Maria|5531/);
  });

  it("pageview da própria versão não conta como conversão", () => {
    const search = `?cm_click=${UUID}&cm_variant=v1&utm_content=v1`;
    const corpo = corpoDoEventoDoRotador("pageview", search, `https://equipe.brenoxavier.com.br/avaliacao/v1${search}`);
    expect(casaRegra(corpo!.page_url, REGRA)).toBe(false);
  });

  it("sem cm_click na URL não há evento", () => {
    expect(corpoDoEventoDoRotador("pageview", "?utm_source=meta", "https://equipe.brenoxavier.com.br/agendar")).toBeNull();
  });

  it("valor negativo ou não número vira 0", () => {
    const s = `?cm_click=${UUID}`;
    expect(corpoDoEventoDoRotador("purchase", s, "https://x.com/a", -5)!.value).toBe(0);
    expect(corpoDoEventoDoRotador("purchase", s, "https://x.com/a", NaN)!.value).toBe(0);
    expect(corpoDoEventoDoRotador("purchase", s, "https://x.com/a", 97)!.value).toBe(97);
  });
});

describe("iniciarEventosDoRotador (envio)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-publica-de-teste");
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    delete (window as unknown as { cmTrack?: unknown }).cmTrack;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { cmTrack?: unknown }).cmTrack;
  });

  const corpos = () =>
    fetchMock.mock.calls
      .filter(([u]) => String(u).endsWith("/functions/v1/rotator-track"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it("com cm_click: 1 pageview, cmTrack pronto, checkout/purchase uma vez cada", async () => {
    window.history.replaceState(null, "", `/avaliacao/v2?cm_click=${UUID}&cm_variant=v2&utm_source=teste`);
    const { iniciarEventosDoRotador } = await import("@/lib/rotatorEventos");
    // StrictMode: monta, desmonta, monta de novo. O pageview não duplica.
    iniciarEventosDoRotador()();
    const limpar = iniciarEventosDoRotador();
    const w = window as unknown as { cmTrack?: (t: string, v?: number) => void };
    expect(typeof w.cmTrack).toBe("function");
    w.cmTrack!("checkout", 0);
    w.cmTrack!("checkout", 0);
    w.cmTrack!("purchase", 0);
    w.cmTrack!("lixo", 0);

    const c = corpos();
    expect(c.map((x) => x.event_type)).toEqual(["pageview", "checkout", "purchase"]);
    expect(c.every((x) => x.click_id === UUID)).toBe(true);
    expect(c[0].page_url).toBe(`${window.location.origin}/avaliacao/v2?cm_click=${UUID}&cm_variant=v2&utm_source=teste`);

    limpar();
    expect(w.cmTrack).toBeUndefined();
  });

  it("sem cm_click: nada sai e window.cmTrack de terceiro fica intacto", async () => {
    const deFora = vi.fn();
    (window as unknown as { cmTrack?: unknown }).cmTrack = deFora;
    window.history.replaceState(null, "", "/agendar?nome=Maria&utm_source=meta");
    const { iniciarEventosDoRotador } = await import("@/lib/rotatorEventos");
    const limpar = iniciarEventosDoRotador();
    limpar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((window as unknown as { cmTrack?: unknown }).cmTrack).toBe(deFora);
  });

  it("/agendar com o clique: pageview que casa a regra, sem dado pessoal", async () => {
    window.history.replaceState(null, "", `/agendar?origem=avaliacao&nome=Maria&whatsapp=%2B5531999999999&cm_click=${UUID}&cm_variant=v4`);
    const { iniciarEventosDoRotador } = await import("@/lib/rotatorEventos");
    iniciarEventosDoRotador();
    const c = corpos();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ click_id: UUID, event_type: "pageview" });
    expect(casaRegra(c[0].page_url, REGRA)).toBe(true);
    expect(c[0].page_url).not.toMatch(/Maria|5531/);
  });
});
