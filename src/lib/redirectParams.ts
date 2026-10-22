// =============================================================
// Mesclagem de parâmetros no redirect do rotador (/r/:slug).
//
// Portado do sales-win-watcher (fix 1ebd8be), com duas diferenças
// deliberadas para não mudar o comportamento dos links que já rodam aqui:
//
//  1. Em conflito vale o parâmetro do DESTINO (regra que este repo já
//     tinha: link de parceria pode cadastrar a UTM no destino e ela não
//     deve ser trocada pela que vier na URL de entrada).
//  2. utm_content=<variação> só é preenchido quando o rótulo é vN
//     (/desafio/v3 → "v3"). Destino como /avaliacao não ganha
//     utm_content=avaliacao, que sujaria o relatório das parcerias.
//
// O resto é igual ao do irmão:
//  - Todo parâmetro da URL de entrada (utm_*, fbclid, gclid...) vai para
//    a variação.
//  - cm_click é sempre o que a edge function gerou para este clique; o que
//    vier na entrada é descartado. cm_variant é sempre o rótulo do destino.
//  - Hash: o do destino; se o destino não tiver, o da entrada.
//  - URL relativa devolvida pelo rotador continua relativa.
// =============================================================

const PROTECTED_KEYS = new Set(["cm_click", "cm_variant"]);

/** "/v2", "/desafio/v2/" → "v2". Sem vN, usa o último segmento. Raiz → null. */
export function variantLabelFromUrl(url: string, base = "https://x.invalid"): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, base).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const vSeg = [...segments].reverse().find((s) => /^v\d+$/i.test(s));
  const label = (vSeg ?? segments[segments.length - 1]).toLowerCase();
  return label || null;
}

/**
 * Junta os params de `currentSearch` (window.location.search do /r/:slug)
 * na `redirectUrl` devolvida pelo rotador e marca a variação.
 */
export function mergeRedirectUrl(
  redirectUrl: string,
  currentSearch: string,
  currentHash = "",
  base = "https://x.invalid",
): string {
  const dest = new URL(redirectUrl, base);
  const incoming = new URLSearchParams(currentSearch);

  const incomingKeys = Array.from(new Set(Array.from(incoming.keys())));
  for (const key of incomingKeys) {
    if (PROTECTED_KEYS.has(key)) continue;
    if (dest.searchParams.has(key)) continue; // o destino vence
    incoming
      .getAll(key)
      .filter((v) => v !== "")
      .forEach((v) => dest.searchParams.append(key, v));
  }

  const label = variantLabelFromUrl(dest.toString(), base);
  if (label) {
    dest.searchParams.set("cm_variant", label);
    if (/^v\d+$/.test(label) && !dest.searchParams.get("utm_content")) {
      dest.searchParams.set("utm_content", label);
    }
  }

  if (!dest.hash && currentHash && currentHash !== "#") {
    dest.hash = currentHash;
  }

  if (dest.origin === new URL(base).origin && !/^[a-z][a-z0-9+.-]*:/i.test(redirectUrl)) {
    return dest.pathname + dest.search + dest.hash;
  }
  return dest.toString();
}

/**
 * Caminhos que o /r/:slug abre por navegação interna do React (sem baixar o
 * app de novo). Só páginas deste app, leves e feitas pra isso: cada recarga
 * completa no celular custa 1 a 2 segundos e derruba a taxa de conexão.
 * Qualquer outro destino (outro domínio, /mapamental/index.html...) continua
 * com redirect completo.
 */
const SPA_PREFIXES = ["/desafio/"];

/** Caminho interno (path+query+hash) se der pra abrir sem recarregar; senão null. */
export function spaPathFor(finalUrl: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(finalUrl, origin);
  } catch {
    return null;
  }
  if (u.origin !== new URL(origin).origin) return null;
  if (!SPA_PREFIXES.some((p) => u.pathname.startsWith(p))) return null;
  return u.pathname + u.search + u.hash;
}
