// =============================================================
// UTM capture compartilhado entre páginas públicas do funil.
//
// Por que existe: o track.js do projeto só captura UTMs quando
// window.FUNNEL_TRACK_TOKEN está definido (linha 73-76 do
// public/track.js retorna early sem token). Como o token não está
// configurado, UTMs vindos de social_selling, anúncios pagos, etc
// nunca eram salvos — e o /agendar sempre marcava as consultas
// como "Orgânico / Link da Bio".
//
// Esta lib reproduz a parte de captura+persistência do track.js
// (sem precisar de token nem chamada à edge function).
//
// REGRA DO CONJUNTO (13/10/2026): as UTMs são lidas e gravadas como
// um conjunto, nunca campo a campo. Antes cada campo caía sozinho no
// fallback URL > sessionStorage > cookie, e um link de social selling
// com só utm_source+utm_campaign herdava utm_medium/utm_content de um
// cookie antigo de anúncio (112 leads com origem misturada).
//  - URL com QUALQUER utm_*  → vale só a URL; campo ausente = null.
//    Sessão e cookie são regravados com o conjunto inteiro (campo
//    ausente é apagado), então a visita nova substitui a anterior.
//  - URL sem utm_*            → vale o conjunto guardado da visita
//    anterior (sessionStorage se tiver algum, senão os cookies).
//  - URL só com a marca do rotator (utm_content=vN igual ao cm_variant,
//    sem nenhuma outra utm_*) → conta como URL sem utm_*. O /r/:slug põe
//    utm_content=vN em todo clique sem utm_content próprio
//    (lib/redirectParams); isso marca a VERSÃO, não a origem. O conjunto
//    guardado fica intacto, inclusive o utm_content: trocar só ele por vN
//    voltaria a misturar origem (source do anúncio + content da versão), e
//    a versão já viaja na própria URL (cm_variant/cm_click/utm_content),
//    de onde o checkout (lib/desafioCheckout) e o beacon a leem.
// =============================================================

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmSet = Record<UtmKey, string | null>;

const COOKIE_PREFIX = "ft_";
const COOKIE_DAYS = 30;

/**
 * Domínio raiz pra setar cookie compartilhado entre subdomínios.
 * Ex: "bgimplementacao.brenoxavier.com.br" → ".brenoxavier.com.br".
 * Assim o /agendar lê o cookie setado pela LP mesmo se eles
 * estiverem em subdomínios diferentes.
 */
function getRootDomain(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.hostname.split(".");
  if (parts.length >= 3) return "." + parts.slice(-3).join(".");
  if (parts.length === 2) return "." + parts.join(".");
  return window.location.hostname;
}

function setCookie(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;domain=${getRootDomain()};SameSite=Lax`;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  const past = "Thu, 01 Jan 1970 00:00:00 GMT";
  // No domínio raiz (onde todo escritor deste app grava) e host-only, por garantia.
  document.cookie = `${name}=;expires=${past};path=/;domain=${getRootDomain()};SameSite=Lax`;
  document.cookie = `${name}=;expires=${past};path=/;SameSite=Lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function emptySet(): UtmSet {
  return { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null };
}

function hasAny(set: UtmSet): boolean {
  return UTM_KEYS.some((k) => !!set[k]);
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

/**
 * UTMs da URL como conjunto. Devolve null se a URL não traz nenhuma
 * utm_* com valor (aí quem decide é o que está guardado).
 */
export function utmsFromSearch(search: string): UtmSet | null {
  const params = new URLSearchParams(search);
  const set = emptySet();
  UTM_KEYS.forEach((k) => {
    const v = params.get(k);
    set[k] = v ? v : null;
  });
  if (!hasAny(set) || soMarcaDoRotator(params)) return null;
  return set;
}

/**
 * true quando a única utm_* da URL é o utm_content=vN que o rotator injeta
 * (igual ao cm_variant). Qualquer outra utm_* com valor (source, medium,
 * campaign, term) ou utm_content diferente do cm_variant = visita com UTM.
 */
export function soMarcaDoRotator(params: URLSearchParams): boolean {
  const content = params.get("utm_content");
  const variant = params.get("cm_variant");
  if (!content || !variant) return false;
  if (!/^v\d+$/i.test(content) || content.toLowerCase() !== variant.toLowerCase()) return false;
  return UTM_KEYS.every((k) => k === "utm_content" || !params.get(k));
}

/** Conjunto guardado: sessionStorage se tiver algum campo, senão os cookies ft_utm_*. */
function storedUtms(): UtmSet {
  const ss = safeSession();
  const fromSession = emptySet();
  if (ss) UTM_KEYS.forEach((k) => (fromSession[k] = ss.getItem(k) || null));
  if (hasAny(fromSession)) return fromSession;
  const fromCookie = emptySet();
  UTM_KEYS.forEach((k) => (fromCookie[k] = getCookie(COOKIE_PREFIX + k) || null));
  return fromCookie;
}

/**
 * Lê UTMs da URL e, se houver QUALQUER utm_*, regrava sessionStorage +
 * cookie (ft_utm_*, 30 dias, root domain) com o conjunto inteiro:
 * o que veio é gravado, o que não veio é apagado.
 * URL sem utm_* não mexe em nada (a atribuição anterior continua).
 * Chamar no useEffect de qualquer página pública de entrada (LP).
 */
export function captureUtmsFromUrl(search: string = currentSearch()): void {
  if (typeof window === "undefined") return;
  const fromUrl = utmsFromSearch(search);
  if (!fromUrl) return;
  const ss = safeSession();
  UTM_KEYS.forEach((k) => {
    const v = fromUrl[k];
    if (v) {
      ss?.setItem(k, v);
      setCookie(COOKIE_PREFIX + k, v, COOKIE_DAYS);
    } else {
      ss?.removeItem(k);
      deleteCookie(COOKIE_PREFIX + k);
    }
  });
}

/**
 * Os 5 UTMs como conjunto: da URL se ela trouxer algum (campo ausente =
 * null), senão o conjunto guardado da visita anterior.
 */
export function getAllUtms(search: string = currentSearch()): UtmSet {
  if (typeof window === "undefined") return emptySet();
  return utmsFromSearch(search) ?? storedUtms();
}

/**
 * Um UTM só, tirado do conjunto de getAllUtms (nunca mistura a URL com
 * o guardado). Usar quando precisar do valor no submit.
 */
export function getUtmFromAnywhere(key: UtmKey, search: string = currentSearch()): string | null {
  return getAllUtms(search)[key];
}

/** Só os campos com valor — formato usado pra repassar na URL do redirect. */
export function getUtmsPresentes(search: string = currentSearch()): Partial<Record<UtmKey, string>> {
  const out: Partial<Record<UtmKey, string>> = {};
  const all = getAllUtms(search);
  UTM_KEYS.forEach((k) => {
    const v = all[k];
    if (v) out[k] = v;
  });
  return out;
}
