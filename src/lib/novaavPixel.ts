// Meta Pixel das páginas públicas de captação (/avaliacao, /individual, /vsl).
// Portado do novaav (cloudflare-magic-replicator) — só inicializa quando uma
// página de captação monta; não roda nas rotas internas do CRM.
type FbqFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: (...args: unknown[]) => number;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: FbqFunction;
    _fbq?: FbqFunction;
    __metaPixelInitialized?: boolean;
  }
}

const META_PIXEL_ID = "SEU_PIXEL_ID";
const FBQ_SCRIPT_ID = "meta-pixel-script";
const FBQ_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";
const LEAD_EVENT_KEY = "lead_qualificado_fired";
const MAX_FBQ_RETRIES = 10;
const FBQ_RETRY_DELAY_MS = 300;

const ensureFbqStub = () => {
  if (typeof window.fbq === "function") return;

  const fbqStub = ((...args: unknown[]) => {
    if (typeof fbqStub.callMethod === "function") {
      fbqStub.callMethod(...args);
      return;
    }

    fbqStub.queue?.push(args);
  }) as FbqFunction;

  fbqStub.queue = [];
  fbqStub.push = (...args: unknown[]) => fbqStub.queue!.push(args);
  fbqStub.loaded = true;
  fbqStub.version = "2.0";

  window.fbq = fbqStub;
  if (!window._fbq) {
    window._fbq = fbqStub;
  }
};

const injectFbqScript = () => {
  if (document.getElementById(FBQ_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = FBQ_SCRIPT_ID;
  script.async = true;
  script.src = FBQ_SCRIPT_SRC;

  const firstScriptTag = document.getElementsByTagName("script")[0];
  if (firstScriptTag?.parentNode) {
    firstScriptTag.parentNode.insertBefore(script, firstScriptTag);
    return;
  }

  document.head.appendChild(script);
};

const getUtmParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_content: params.get("utm_content") || "",
    utm_term: params.get("utm_term") || "",
  };
};

const dispatchLeadEvents = (payload: Record<string, string>) => {
  window.fbq?.("trackCustom", "Lead_qualificado", payload);
  window.fbq?.("track", "Lead", payload);
};

export const initializeMetaPixel = () => {
  if (typeof window === "undefined") return;
  if (window.__metaPixelInitialized) return;

  window.__metaPixelInitialized = true;
  ensureFbqStub();
  injectFbqScript();

  window.fbq?.("init", META_PIXEL_ID);
  window.fbq?.("track", "PageView");
};

// `versao` (ex.: "avaliacao-v3") vai como parâmetro do Lead e do
// Lead_qualificado nas versões /avaliacao/vN. Sem ela, o payload é o de sempre.
export const trackLeadQualificado = (versao?: string) => {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(LEAD_EVENT_KEY)) return;

  const payload: Record<string, string> = {
    content_name: "Agendamento Avaliacao",
    status: "qualificado",
    ...getUtmParams(),
    ...(versao ? { versao } : {}),
  };

  const tryTrack = (attempt = 0) => {
    if (typeof window.fbq !== "function") {
      if (attempt < MAX_FBQ_RETRIES) {
        window.setTimeout(() => tryTrack(attempt + 1), FBQ_RETRY_DELAY_MS);
      }
      return;
    }

    dispatchLeadEvents(payload);
    sessionStorage.setItem(LEAD_EVENT_KEY, "true");
  };

  tryTrack();
};

// Desafio (DMD): eventos com a variação da página, para comparar as versões
// no Gerenciador (parâmetro `variante`). Nomes próprios, para não duplicar o
// InitiateCheckout/Purchase que o checkout da PagTrust já manda.
export const trackDesafioVariante = (evento: "DMD_VerPagina" | "DMD_CliqueCheckout", variante: string) => {
  if (typeof window === "undefined") return;
  window.fbq?.("trackCustom", evento, { variante, content_name: "Desafio Magra e Definida", ...getUtmParams() });
};
