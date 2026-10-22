// Regra do conjunto de UTMs (13/10/2026). Defeito: cada campo caía sozinho no
// fallback URL > sessionStorage > cookie, e um link de social selling com só
// utm_source+utm_campaign herdava utm_medium/utm_content de um cookie antigo
// de anúncio. Estes testes reprovam no código antigo.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureUtmsFromUrl, getAllUtms, getUtmFromAnywhere, getUtmsPresentes } from "@/lib/utmCapture";

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function clearCookies() {
  for (const k of KEYS) {
    document.cookie = `ft_${k}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    document.cookie = `ft_${k}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${location.hostname}`;
  }
}

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

function goTo(pathAndSearch: string) {
  window.history.replaceState({}, "", pathAndSearch);
}

/** Visita antiga de anúncio: cookies de 30 dias com o conjunto completo. */
function seedOldAdCookies() {
  const exp = new Date(Date.now() + 86400000).toUTCString();
  const old: Record<string, string> = {
    utm_source: "fb",
    utm_medium: "paid",
    utm_campaign: "campanha_anuncio",
    utm_content: "criativo_07",
    utm_term: "publico_frio",
  };
  for (const [k, v] of Object.entries(old)) {
    document.cookie = `ft_${k}=${encodeURIComponent(v)};expires=${exp};path=/;domain=${location.hostname}`;
  }
}

beforeEach(() => {
  sessionStorage.clear();
  clearCookies();
  goTo("/");
});

describe("conjunto de UTMs — URL com utm_* vale sozinha", () => {
  it("cookie antigo com medium/content + URL só com source/campaign → sem medium/content", () => {
    seedOldAdCookies();
    expect(cookie("ft_utm_medium")).toBe("paid"); // pré-condição: cookie antigo existe
    goTo("/individual?utm_source=social_selling&utm_campaign=social_selling");

    expect(getAllUtms()).toEqual({
      utm_source: "social_selling",
      utm_medium: null,
      utm_campaign: "social_selling",
      utm_content: null,
      utm_term: null,
    });
    expect(getUtmFromAnywhere("utm_medium")).toBeNull();
    expect(getUtmFromAnywhere("utm_content")).toBeNull();
    expect(getUtmsPresentes()).toEqual({ utm_source: "social_selling", utm_campaign: "social_selling" });
  });

  it("captura regrava o conjunto inteiro e apaga o que não veio (sessão e cookie)", () => {
    seedOldAdCookies();
    sessionStorage.setItem("utm_medium", "paid");
    sessionStorage.setItem("utm_content", "criativo_07");
    goTo("/individual?utm_source=social_selling&utm_campaign=social_selling");
    captureUtmsFromUrl();

    expect(sessionStorage.getItem("utm_source")).toBe("social_selling");
    expect(sessionStorage.getItem("utm_campaign")).toBe("social_selling");
    expect(sessionStorage.getItem("utm_medium")).toBeNull();
    expect(sessionStorage.getItem("utm_content")).toBeNull();
    expect(sessionStorage.getItem("utm_term")).toBeNull();
    expect(cookie("ft_utm_source")).toBe("social_selling");
    expect(cookie("ft_utm_campaign")).toBe("social_selling");
    expect(cookie("ft_utm_medium")).toBeNull();
    expect(cookie("ft_utm_content")).toBeNull();
    expect(cookie("ft_utm_term")).toBeNull();

    // Próxima página sem UTM na URL (outra aba: sem sessão) lê só o conjunto novo.
    sessionStorage.clear();
    goTo("/agendar");
    expect(getAllUtms()).toEqual({
      utm_source: "social_selling",
      utm_medium: null,
      utm_campaign: "social_selling",
      utm_content: null,
      utm_term: null,
    });
  });

  it("nova URL com UTM diferente substitui tudo o que estava guardado", () => {
    goTo("/avaliacao?utm_source=social_selling&utm_campaign=social_selling&utm_term=dm_maria");
    captureUtmsFromUrl();
    goTo("/avaliacao?utm_source=ig&utm_medium=paid&utm_campaign=c2&utm_content=ad9");
    captureUtmsFromUrl();
    goTo("/agendar");
    expect(getAllUtms()).toEqual({
      utm_source: "ig",
      utm_medium: "paid",
      utm_campaign: "c2",
      utm_content: "ad9",
      utm_term: null,
    });
    expect(cookie("ft_utm_source")).toBe("ig");
    expect(cookie("ft_utm_term")).toBeNull();
  });

  it("aceita o search explícito (react-router no /agendar)", () => {
    seedOldAdCookies();
    expect(getAllUtms("?utm_source=social_selling").utm_medium).toBeNull();
    expect(getAllUtms("?utm_source=social_selling").utm_source).toBe("social_selling");
  });

  it("utm_* vazio na URL não conta como UTM", () => {
    seedOldAdCookies();
    goTo("/individual?utm_source=&utm_medium=");
    expect(getAllUtms().utm_source).toBe("fb");
    captureUtmsFromUrl();
    expect(cookie("ft_utm_medium")).toBe("paid");
  });
});

describe("conjunto de UTMs — URL sem utm_* mantém o guardado", () => {
  it("sem UTM na URL usa o conjunto dos cookies da visita anterior", () => {
    seedOldAdCookies();
    goTo("/agendar?nome=Ana&score=80");
    expect(getAllUtms()).toEqual({
      utm_source: "fb",
      utm_medium: "paid",
      utm_campaign: "campanha_anuncio",
      utm_content: "criativo_07",
      utm_term: "publico_frio",
    });
  });

  it("captura sem UTM na URL não apaga nada", () => {
    seedOldAdCookies();
    sessionStorage.setItem("utm_source", "fb");
    goTo("/individual");
    captureUtmsFromUrl();
    expect(cookie("ft_utm_medium")).toBe("paid");
    expect(sessionStorage.getItem("utm_source")).toBe("fb");
  });

  it("sessão com algum campo vale como conjunto (não completa com cookie antigo)", () => {
    seedOldAdCookies();
    sessionStorage.setItem("utm_source", "social_selling");
    sessionStorage.setItem("utm_campaign", "social_selling");
    goTo("/agendar");
    expect(getAllUtms()).toEqual({
      utm_source: "social_selling",
      utm_medium: null,
      utm_campaign: "social_selling",
      utm_content: null,
      utm_term: null,
    });
  });
});

const UUID_CLIQUE = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const CONJUNTO_ANUNCIO = {
  utm_source: "fb",
  utm_medium: "paid",
  utm_campaign: "campanha_anuncio",
  utm_content: "criativo_07",
  utm_term: "publico_frio",
};

describe("marca do rotator (utm_content=vN + cm_variant) não é visita nova", () => {
  it("URL só com a marca do rotator mantém o conjunto guardado, inclusive o utm_content", () => {
    seedOldAdCookies();
    goTo(`/desafio/v3?utm_content=v3&cm_variant=v3&cm_click=${UUID_CLIQUE}`);
    expect(getAllUtms()).toEqual(CONJUNTO_ANUNCIO);
    captureUtmsFromUrl();
    expect(cookie("ft_utm_source")).toBe("fb");
    expect(cookie("ft_utm_medium")).toBe("paid");
    expect(cookie("ft_utm_content")).toBe("criativo_07");
    expect(cookie("ft_utm_term")).toBe("publico_frio");
    expect(sessionStorage.getItem("utm_content")).toBeNull();
  });

  it("vale também sem cm_click e com caixa diferente (V3/v3)", () => {
    seedOldAdCookies();
    expect(getAllUtms("?utm_content=V3&cm_variant=v3")).toEqual(CONJUNTO_ANUNCIO);
  });

  it("marca do rotator sem nada guardado → conjunto vazio, nada é gravado", () => {
    goTo("/desafio/v2?utm_content=v2&cm_variant=v2");
    captureUtmsFromUrl();
    expect(getAllUtms().utm_content).toBeNull();
    expect(cookie("ft_utm_content")).toBeNull();
  });

  it("com utm_source ou utm_campaign do link vale a regra nova inteira", () => {
    seedOldAdCookies();
    goTo(`/desafio/v3?utm_source=ig&utm_content=v3&cm_variant=v3&cm_click=${UUID_CLIQUE}`);
    expect(getAllUtms()).toEqual({ utm_source: "ig", utm_medium: null, utm_campaign: null, utm_content: "v3", utm_term: null });
    captureUtmsFromUrl();
    expect(cookie("ft_utm_source")).toBe("ig");
    expect(cookie("ft_utm_medium")).toBeNull();
    expect(cookie("ft_utm_content")).toBe("v3");

    expect(getAllUtms("?utm_campaign=social_selling&utm_content=v3&cm_variant=v3").utm_campaign).toBe("social_selling");
    expect(getAllUtms("?utm_campaign=social_selling&utm_content=v3&cm_variant=v3").utm_medium).toBeNull();
  });

  it("utm_content que não é a marca do rotator (≠ cm_variant ou sem cm_variant) é visita com UTM", () => {
    seedOldAdCookies();
    expect(getAllUtms("?utm_content=criativo_99&cm_variant=v3").utm_source).toBeNull();
    expect(getAllUtms("?utm_content=v3").utm_source).toBeNull();
    expect(getAllUtms("?utm_content=v4&cm_variant=v3").utm_source).toBeNull();
    expect(getAllUtms("?utm_term=x&utm_content=v3&cm_variant=v3").utm_source).toBeNull();
  });
});

describe("track.js público segue a mesma regra", () => {
  async function runTrack(): Promise<Record<string, unknown>> {
    const src = readFileSync(join(process.cwd(), "public/track.js"), "utf8");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const w = window as unknown as Record<string, unknown>;
    delete w.FunnelTrack;
    w.FUNNEL_TRACK_TOKEN = "tok_teste";
    w.FUNNEL_TRACK_API_URL = "https://x.invalid/funnel-track";
    try {
      // localStorage do Node (experimental, sem arquivo) sombreia o do jsdom: passa um em memória.
      const mem = new Map<string, string>();
      const fakeLocal = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
      new Function("localStorage", "sessionStorage", "fetch", src)(fakeLocal, sessionStorage, fetchMock);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      return JSON.parse(fetchMock.mock.calls[0][1].body as string);
    } finally {
      delete w.FUNNEL_TRACK_TOKEN;
      delete w.FUNNEL_TRACK_API_URL;
      delete w.FunnelTrack;
    }
  }

  it("cookie antigo + URL só com source/campaign → payload e cookies sem medium/content", async () => {
    seedOldAdCookies();
    goTo("/lp?utm_source=social_selling&utm_campaign=social_selling");
    const payload = await runTrack();
    expect(payload.utm_source).toBe("social_selling");
    expect(payload.utm_medium).toBeNull();
    expect(payload.utm_content).toBeNull();
    expect(cookie("ft_utm_medium")).toBeNull();
    expect(cookie("ft_utm_content")).toBeNull();
  });

  it("URL só com a marca do rotator mantém o conjunto guardado", async () => {
    seedOldAdCookies();
    goTo(`/desafio/v3?utm_content=v3&cm_variant=v3&cm_click=${UUID_CLIQUE}`);
    const payload = await runTrack();
    expect(payload.utm_source).toBe("fb");
    expect(payload.utm_content).toBe("criativo_07");
    expect(cookie("ft_utm_medium")).toBe("paid");
    expect(cookie("ft_utm_content")).toBe("criativo_07");
  });

  it("sem UTM na URL mantém o conjunto guardado", async () => {
    seedOldAdCookies();
    goTo("/lp");
    const payload = await runTrack();
    expect(payload.utm_medium).toBe("paid");
    expect(payload.utm_content).toBe("criativo_07");
  });
});

describe("nenhum leitor de UTM fora da lib faz fallback campo a campo", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }

  it("só src/lib/utmCapture.ts lê sessionStorage/cookie de utm_*", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((f) => !f.includes(`${join("src", "test")}`) && !f.endsWith(join("lib", "utmCapture.ts")))
      .filter((f) => {
        const s = readFileSync(f, "utf8");
        return (
          /sessionStorage\.(getItem|setItem)\(\s*(key|k|["']utm_)/.test(s) ||
          /["']ft_["']\s*\+\s*(key|k)\b/.test(s) ||
          /["']ft_utm_/.test(s.replace(/\/\/.*$/gm, ""))
        );
      })
      .map((f) => relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });
});
