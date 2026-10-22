// =============================================================
// Beacon de páginas públicas (hoje: /desafio/v1..v5).
//
// Mede, de visitante real, duas coisas que o painel Teste de Página mostra
// por variação:
//  - conexão: a página da variação chegou a aparecer (linha kind='view');
//    dividido pelos cliques do rotador = taxa de conexão;
//  - velocidade: ttfb_ms e render_ms (tempo até a variação aparecer, contado
//    do início da navegação, que é o clique no anúncio quando veio pelo
//    /r/:slug) na linha 'view'; lcp_ms na linha 'vitals', mandada 3 s depois
//    ou quando a pessoa sai da aba, o que vier primeiro.
//
// Vai direto pro PostgREST (tabela page_beacons, anon só faz INSERT). Cliente
// próprio, sem sessão: sempre papel anon, e fetch com keepalive para a linha
// 'vitals' sobreviver à troca de aba. Falha aqui nunca quebra a página.
// =============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BeaconKind = "view" | "vitals";

export type BeaconRow = {
  page: string;
  variant: string;
  kind: BeaconKind;
  cm_click: string | null;
  nav: "doc" | "spa";
  ttfb_ms: number | null;
  render_ms: number | null;
  lcp_ms: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_MS = 120_000;

/** Milissegundos inteiros entre 0 e 120 s; fora disso (ou não número) vira null. */
export function msValido(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= 0 && r <= MAX_MS ? r : null;
}

/** cm_click só passa se for o uuid que a edge function gera. */
export function cmClickValido(v: string | null | undefined): string | null {
  return v && UUID_RE.test(v) ? v.toLowerCase() : null;
}

type NavLike = { name?: string; responseStart?: number } | undefined;

/**
 * 'spa' quando o documento foi carregado em outra URL (o /r/:slug) e a
 * variação abriu por navegação interna; 'doc' quando a variação é o próprio
 * documento carregado.
 */
export function tipoDeNavegacao(nav: NavLike, pathnameAtual: string): "doc" | "spa" {
  if (!nav?.name) return "doc";
  try {
    return new URL(nav.name).pathname === pathnameAtual ? "doc" : "spa";
  } catch {
    return "doc";
  }
}

/** Monta a linha validada. Devolve null se página ou variação forem inválidas. */
export function montarBeacon(input: {
  page: string;
  variant: string;
  kind: BeaconKind;
  search: string;
  nav: "doc" | "spa";
  ttfb?: unknown;
  render?: unknown;
  lcp?: unknown;
  /** Aba estava oculta quando mediu: conta a visita, mas o tempo não entra na mediana. */
  oculta?: boolean;
}): BeaconRow | null {
  const page = (input.page || "").toLowerCase();
  const variant = (input.variant || "").toLowerCase();
  if (!SLUG_RE.test(page) || !SLUG_RE.test(variant)) return null;
  let cm: string | null = null;
  try {
    cm = cmClickValido(new URLSearchParams(input.search).get("cm_click"));
  } catch {
    cm = null;
  }
  return {
    page,
    variant,
    kind: input.kind,
    cm_click: cm,
    nav: input.nav,
    // No caminho spa o TTFB seria o do documento /r/:slug, não o da variação: fica null.
    ttfb_ms: input.kind === "view" && input.nav === "doc" ? msValido(input.ttfb) : null,
    // render_ms conta do início da navegação: no spa é do clique no /r/ até a variação pintar.
    render_ms: input.kind === "view" && !input.oculta ? msValido(input.render) : null,
    lcp_ms: input.kind === "vitals" ? msValido(input.lcp) : null,
  };
}

/**
 * Roda `fn` uma única vez, no primeiro de: próximo quadro pintado (rAF, depois
 * setTimeout 0), ou `reservaMs` de espera, ou chamada manual do disparo
 * devolvido (pagehide/aba oculta). A reserva existe porque o navegador não
 * roda rAF em aba em segundo plano: a variação abria pelo /r/ numa aba oculta e
 * a linha 'view' nunca saía, e a conexão lia ~0 (achado na conferência ao vivo,
 * 12/10/2026).
 */
export function agendarUmaVez(
  fn: () => void,
  deps: {
    raf?: ((cb: () => void) => unknown) | undefined;
    timeout: (cb: () => void, ms: number) => unknown;
    reservaMs?: number;
  },
): () => void {
  let feito = false;
  const disparar = () => {
    if (feito) return;
    feito = true;
    fn();
  };
  try {
    deps.raf?.(() => deps.timeout(disparar, 0));
  } catch {
    /* sem rAF: fica a reserva */
  }
  deps.timeout(disparar, deps.reservaMs ?? 1000);
  return disparar;
}

// ---------- envio (efeitos colaterais; não roda em teste) ----------

let cliente: SupabaseClient | null = null;
function clienteDoBeacon(): SupabaseClient | null {
  if (cliente) return cliente;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const fetchKeepalive: typeof fetch = (input, init) =>
    fetch(input, { ...init, keepalive: true }).catch(() => fetch(input, init));
  cliente = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sb-page-beacon" },
    global: { fetch: fetchKeepalive },
  });
  return cliente;
}

async function enviar(row: BeaconRow | null) {
  if (!row) return;
  try {
    await clienteDoBeacon()?.from("page_beacons").insert(row);
  } catch {
    /* beacon nunca quebra a página */
  }
}

const jaMediu = new Set<string>();

/**
 * Chamar uma vez no mount da variação. Idempotente por página+variação+URL
 * (o StrictMode do dev monta duas vezes).
 */
export function iniciarBeaconDaPagina(page: string, variant: string) {
  if (typeof window === "undefined" || typeof performance === "undefined") return;
  const chave = `${page}:${variant}:${window.location.search}`;
  if (jaMediu.has(chave)) return;
  jaMediu.add(chave);

  const search = window.location.search;
  const navEntry = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  const nav = tipoDeNavegacao(navEntry, window.location.pathname);

  // LCP: o maior elemento pintado até agora (Chrome/Edge/Firefox; Safari sem suporte manda null).
  let lcp: number | null = null;
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcp = last.startTime;
    });
    obs.observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
  } catch {
    obs = null;
  }

  // 'view': uma vez por visita à variação, no primeiro quadro pintado ou na reserva de 1 s.
  const mandarView = agendarUmaVez(
    () =>
      void enviar(
        montarBeacon({
          page,
          variant,
          kind: "view",
          search,
          nav,
          ttfb: navEntry?.responseStart,
          render: performance.now(),
          oculta: document.visibilityState === "hidden",
        }),
      ),
    {
      raf: typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : undefined,
      timeout: (cb, ms) => window.setTimeout(cb, ms),
      reservaMs: 1000,
    },
  );

  // 'vitals': 3 s depois do load (ou do mount, se o load já passou), ou ao sair da aba.
  let mandouVitals = false;
  const mandarVitals = () => {
    mandarView();
    if (mandouVitals) return;
    mandouVitals = true;
    try { obs?.disconnect(); } catch { /* nada */ }
    document.removeEventListener("visibilitychange", aoEsconder);
    window.removeEventListener("pagehide", mandarVitals);
    if (lcp == null) return;
    void enviar(montarBeacon({ page, variant, kind: "vitals", search, nav, lcp }));
  };
  const aoEsconder = () => {
    if (document.visibilityState === "hidden") mandarVitals();
  };
  document.addEventListener("visibilitychange", aoEsconder);
  window.addEventListener("pagehide", mandarVitals);
  const agendar = () => window.setTimeout(mandarVitals, 3000);
  if (document.readyState === "complete") agendar();
  else window.addEventListener("load", agendar, { once: true });
}
