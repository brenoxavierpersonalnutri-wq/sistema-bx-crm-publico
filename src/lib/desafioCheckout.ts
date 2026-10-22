// Checkout do Desafio Magra e Definida (DMD, R$29). Destino único de todo
// botão de compra das páginas /desafio/v1..v6.
export const DESAFIO_CHECKOUT_URL = "https://pay.pagtrust.com.br/fnc35209fa";

/**
 * Leva as utm_* da visita para o checkout, para a venda chegar na PagTrust
 * com a origem do anúncio (e utm_content=vN quando veio pelo /r/desafio sem
 * utm_content próprio). Param vazio é ignorado; o que o checkout já trouxer
 * não é trocado. Qualquer erro devolve o checkout puro: botão nunca quebra.
 */
export function checkoutComUtms(search: string, checkoutUrl = DESAFIO_CHECKOUT_URL): string {
  try {
    const url = new URL(checkoutUrl);
    const veio = new URLSearchParams(search);
    veio.forEach((valor, chave) => {
      if (!/^utm_[a-z_]+$/i.test(chave)) return;
      if (!valor || url.searchParams.has(chave)) return;
      url.searchParams.set(chave, valor);
    });
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

// ---------------------------------------------------------------------------
// Atribuição da venda à variação do teste (/r/desafio).
//
// O clique do rotador (cm_click, uuid gerado pela edge function) vira um
// MARCADOR "cm_vN_<uuid>" que vai no link do checkout em três parâmetros:
//   - sck e src: parâmetros de rastreio do formato de webhook 2.0.0 (o mesmo
//     que a PagTrust manda: data.purchase / data.buyer / data.commissions).
//     Não são utm_*, então não tocam na atribuição do anúncio.
//   - utm_term: rede de segurança caso a PagTrust só devolva utm_*. O anúncio
//     manda utm_source/campaign/content (intactos); se ele mandar utm_term
//     também, o original fica e o marcador entra depois de "|"
//     ("<original>|cm_v3_<uuid>"). Custo: utm_term vira único por visita nos
//     relatórios da PagTrust/UTMify (agrupar por utm_term deixa de servir).
// O webhook (supabase/functions/*/rotatorVenda.ts) procura o marcador em
// qualquer campo do payload, então basta UM dos três sobreviver.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANTE_RE = /^v\d{1,3}$/i;

/** Parâmetros do checkout que recebem o marcador sozinho. */
export const PARAMS_DO_MARCADOR = ["sck", "src"] as const;

/** cm_click válido (uuid) da URL da visita, em minúsculas; senão null. */
export function cmClickDaVisita(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("cm_click");
    return v && UUID_RE.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** "cm_v3_<uuid>" (ou "cm_<uuid>" sem variação válida). Sem clique válido, null. */
export function marcadorDoClique(cmClick: string | null | undefined, variante?: string | null): string | null {
  if (!cmClick || !UUID_RE.test(cmClick)) return null;
  const v = variante && VARIANTE_RE.test(variante) ? `${variante.toLowerCase()}_` : "";
  return `cm_${v}${cmClick.toLowerCase()}`;
}

/**
 * Link do checkout da variação: utm_* da visita (checkoutComUtms) + marcador
 * do clique em sck, src e utm_term. Visita sem cm_click (acesso direto à
 * variação) recebe só as utm, como antes. Erro devolve o checkout puro.
 */
export function checkoutDoDesafio(search: string, variante: string | null, checkoutUrl = DESAFIO_CHECKOUT_URL): string {
  const base = checkoutComUtms(search, checkoutUrl);
  const marcador = marcadorDoClique(cmClickDaVisita(search), variante);
  if (!marcador) return base;
  try {
    const url = new URL(base);
    for (const p of PARAMS_DO_MARCADOR) {
      if (!url.searchParams.get(p)) url.searchParams.set(p, marcador);
    }
    const termo = url.searchParams.get("utm_term");
    if (!termo) url.searchParams.set("utm_term", marcador);
    else if (!termo.includes(marcador)) url.searchParams.set("utm_term", `${termo}|${marcador}`);
    return url.toString();
  } catch {
    return base;
  }
}

export type CorpoCheckoutRotador = {
  click_id: string;
  event_type: "checkout";
  value: 0;
  page_url: string;
};

/** Corpo do POST pro rotator-track no clique do botão de compra; null sem cm_click. */
export function corpoDoCheckout(search: string, pageUrl: string): CorpoCheckoutRotador | null {
  const click = cmClickDaVisita(search);
  if (!click) return null;
  return { click_id: click, event_type: "checkout", value: 0, page_url: pageUrl.slice(0, 2000) };
}

const checkoutsEnviados = new Set<string>();

/**
 * Registra o 'checkout' da variação no rotator-track. Uma vez por clique do
 * rotador nesta aba. fetch com keepalive: a requisição sobrevive à troca de
 * página, então o botão navega na hora (zero espera). Falha nunca quebra.
 */
export function enviarCheckoutDoRotador(search = window.location.search, pageUrl = window.location.href): boolean {
  try {
    const corpo = corpoDoCheckout(search, pageUrl);
    if (!corpo || checkoutsEnviados.has(corpo.click_id)) return false;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!base || !chave) return false;
    checkoutsEnviados.add(corpo.click_id);
    const url = `${String(base).replace(/\/$/, "")}/functions/v1/rotator-track`;
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: chave, Authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo),
    };
    fetch(url, { ...init, keepalive: true }).catch(() => fetch(url, init).catch(() => undefined));
    return true;
  } catch {
    return false;
  }
}

/**
 * Acrescenta `variante=vN` ao link do checkout (versões do teste de dobra),
 * para a venda chegar com a versão mesmo em visita direta, sem cm_click.
 * Não troca o que já existir; erro devolve o link como veio.
 */
export function checkoutComVariante(link: string, variante: string | null): string {
  if (!variante || !VARIANTE_RE.test(variante)) return link;
  try {
    const url = new URL(link);
    if (!url.searchParams.get("variante")) url.searchParams.set("variante", variante.toLowerCase());
    return url.toString();
  } catch {
    return link;
  }
}
