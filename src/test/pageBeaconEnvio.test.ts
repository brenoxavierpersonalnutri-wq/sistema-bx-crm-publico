import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Envio de ponta a ponta (cliente supabase real, fetch falso): a 'view' tem de
// sair uma vez também quando o navegador não roda rAF (aba em segundo plano)
// e quando a variação abriu por navegação interna vinda do /r/desafio.
const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

type Enviado = { url: string; body: Record<string, unknown> };

function corpos(fetchMock: ReturnType<typeof vi.fn>): Enviado[] {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).includes("/rest/v1/page_beacons"))
    .map(([u, init]) => ({ url: String(u), body: JSON.parse(String((init as RequestInit).body)) }));
}

describe("iniciarBeaconDaPagina (envio)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-publica-de-teste");
    fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("caminho do /r/ (spa) com aba oculta e rAF parado: manda 1 view, sem TTFB e sem tempo", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0); // aba oculta: rAF nunca roda
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.spyOn(performance, "getEntriesByType").mockImplementation(((t: string) =>
      t === "navigation" ? [{ name: "https://equipe.brenoxavier.com.br/r/desafio?utm_source=meta", responseStart: 140 }] : []) as unknown as typeof performance.getEntriesByType);
    window.history.replaceState(null, "", `/desafio/v1?cm_click=${UUID}&utm_source=meta&cm_variant=v1`);

    const { iniciarBeaconDaPagina } = await import("@/lib/pageBeacon");
    iniciarBeaconDaPagina("desafio", "v1");
    iniciarBeaconDaPagina("desafio", "v1"); // StrictMode: segunda montagem não duplica
    await vi.advanceTimersByTimeAsync(5000);

    const enviados = corpos(fetchMock);
    const views = enviados.filter((e) => e.body.kind === "view");
    expect(views).toHaveLength(1);
    expect(views[0].body).toMatchObject({ page: "desafio", variant: "v1", cm_click: UUID, nav: "spa", ttfb_ms: null, render_ms: null });
  });

  it("caminho do /r/ (spa) com aba visível: 1 view com tempo do /r/ até pintar", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(performance, "getEntriesByType").mockImplementation(((t: string) =>
      t === "navigation" ? [{ name: "https://equipe.brenoxavier.com.br/r/desafio", responseStart: 140 }] : []) as unknown as typeof performance.getEntriesByType);
    vi.spyOn(performance, "now").mockReturnValue(1234);
    window.history.replaceState(null, "", `/desafio/v2?cm_click=${UUID}&x=2`);

    const { iniciarBeaconDaPagina } = await import("@/lib/pageBeacon");
    iniciarBeaconDaPagina("desafio", "v2");
    await vi.advanceTimersByTimeAsync(5000); // passa também a reserva de 1 s: não pode duplicar

    const views = corpos(fetchMock).filter((e) => e.body.kind === "view");
    expect(views).toHaveLength(1);
    expect(views[0].body).toMatchObject({ variant: "v2", nav: "spa", ttfb_ms: null, render_ms: 1234 });
  });

  it("carga direta (doc): 1 view com TTFB", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(performance, "getEntriesByType").mockImplementation(((t: string) =>
      t === "navigation" ? [{ name: `http://localhost:3000/desafio/v3?cm_click=${UUID}`, responseStart: 88 }] : []) as unknown as typeof performance.getEntriesByType);
    window.history.replaceState(null, "", `/desafio/v3?cm_click=${UUID}`);

    const { iniciarBeaconDaPagina } = await import("@/lib/pageBeacon");
    iniciarBeaconDaPagina("desafio", "v3");
    await vi.advanceTimersByTimeAsync(5000);

    const views = corpos(fetchMock).filter((e) => e.body.kind === "view");
    expect(views).toHaveLength(1);
    expect(views[0].body).toMatchObject({ variant: "v3", nav: "doc", ttfb_ms: 88 });
  });
});
