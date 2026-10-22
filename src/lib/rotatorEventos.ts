// =============================================================
// Eventos do rotador (rotator-track) nas páginas deste app.
//
// Faz aqui dentro o que o snippet "BXMetrics Tracking Pixel" do painel faz em
// site de fora (rotatorApi.getTrackingPixelSnippet): com o cm_click da URL,
// manda 'pageview' ao abrir a página e deixa window.cmTrack pronto para o
// 'checkout' e o 'purchase' que o formulário da avaliação já chama.
//
// Por que existe: o teste /r/avaliacao-4v (destinos /avaliacao/v1..v4, regra
// "URL contém agendar") mostrava só visitas. Nenhuma página do app mandava
// pageview, e o cm_click morria no quiz: o link do /agendar não levava o
// clique. Agora o quiz das versões leva cm_click e cm_variant até o /agendar
// (paramsDoRotadorParaAgendar) e o /agendar manda o pageview que casa a regra.
//
// Regras:
//  - Só age com cm_click válido NA URL (uuid da edge function). Nada de
//    cookie ou localStorage: visita sem clique na URL não vira evento de teste
//    nenhum (a /avaliacao base e o /agendar de quem não veio do rotador ficam
//    exatamente como estavam).
//  - page_url vai sem dado pessoal: origem + caminho + utm_* e cm_*. O
//    /agendar recebe nome, WhatsApp e respostas na query; isso não vai pro
//    rotator_events. A regra por URL olha o caminho ("/agendar").
//  - 'pageview' uma vez por clique+caminho; 'checkout'/'purchase' uma vez por
//    clique (quem clica três vezes conta uma). fetch com keepalive, falha
//    nunca quebra a página.
// =============================================================
import { cmClickDaVisita } from "@/lib/desafioCheckout";

export type TipoDeEventoDoRotador = "pageview" | "checkout" | "purchase";

export type CorpoDoEventoDoRotador = {
  click_id: string;
  event_type: TipoDeEventoDoRotador;
  value: number;
  page_url: string;
};

const VARIANTE_RE = /^[a-z0-9-]{1,40}$/i;

/** cm_variant da URL, se tiver formato de rótulo (v1, desafio-a...); senão null. */
export function cmVariantDaVisita(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("cm_variant");
    return v && VARIANTE_RE.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Pares que o link do /agendar ganha para o clique do rotador sobreviver ao
 * quiz. Sem cm_click válido, nada (cm_variant sozinho não atribui nada).
 */
export function paramsDoRotadorParaAgendar(search: string): Array<[string, string]> {
  const click = cmClickDaVisita(search);
  if (!click) return [];
  const out: Array<[string, string]> = [["cm_click", click]];
  const variante = cmVariantDaVisita(search);
  if (variante) out.push(["cm_variant", variante]);
  return out;
}

/** URL da página sem dado pessoal: origem + caminho + utm_* e cm_*. */
export function urlSemDadoPessoal(href: string): string {
  try {
    const u = new URL(href);
    const limpa = new URL(u.origin + u.pathname);
    u.searchParams.forEach((valor, chave) => {
      if (/^(utm_[a-z_]+|cm_click|cm_variant)$/i.test(chave) && valor) limpa.searchParams.append(chave, valor);
    });
    return limpa.toString().slice(0, 2000);
  } catch {
    return "";
  }
}

/** Corpo do POST pro rotator-track; null sem cm_click válido na URL. */
export function corpoDoEventoDoRotador(
  tipo: TipoDeEventoDoRotador,
  search: string,
  href: string,
  valor = 0,
): CorpoDoEventoDoRotador | null {
  const click = cmClickDaVisita(search);
  if (!click) return null;
  const value = typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0;
  return { click_id: click, event_type: tipo, value, page_url: urlSemDadoPessoal(href) };
}

// ---------- envio (efeitos colaterais) ----------

const jaEnviados = new Set<string>();

function chaveDoEnvio(c: CorpoDoEventoDoRotador): string {
  if (c.event_type !== "pageview") return `${c.click_id}:${c.event_type}`;
  try {
    return `${c.click_id}:pageview:${new URL(c.page_url).pathname}`;
  } catch {
    return `${c.click_id}:pageview:${c.page_url}`;
  }
}

/** Manda o evento (uma vez por chave). Devolve true se saiu a requisição. */
export function enviarEventoDoRotador(
  tipo: TipoDeEventoDoRotador,
  valor = 0,
  search = typeof window !== "undefined" ? window.location.search : "",
  href = typeof window !== "undefined" ? window.location.href : "",
): boolean {
  try {
    const corpo = corpoDoEventoDoRotador(tipo, search, href, valor);
    if (!corpo) return false;
    const chave = chaveDoEnvio(corpo);
    if (jaEnviados.has(chave)) return false;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const publica = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!base || !publica) return false;
    jaEnviados.add(chave);
    const url = `${String(base).replace(/\/$/, "")}/functions/v1/rotator-track`;
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: publica, Authorization: `Bearer ${publica}` },
      body: JSON.stringify(corpo),
    };
    fetch(url, { ...init, keepalive: true }).catch(() => fetch(url, init).catch(() => undefined));
    return true;
  } catch {
    return false;
  }
}

type JanelaComCmTrack = Window & { cmTrack?: (tipo: string, valor?: number) => void };

/**
 * Chamar no mount da página que é destino (ou fim de funil) do rotador.
 * Com cm_click na URL: manda o 'pageview' e instala window.cmTrack ligado a
 * este clique. Devolve a função de limpeza (tira o cmTrack se ainda for o
 * nosso). Sem cm_click: não faz nada e não mexe em window.cmTrack.
 */
export function iniciarEventosDoRotador(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const search = window.location.search;
  if (!cmClickDaVisita(search)) return () => undefined;

  const w = window as JanelaComCmTrack;
  const cmTrack = (tipo: string, valor?: number) => {
    if (tipo !== "pageview" && tipo !== "checkout" && tipo !== "purchase") return;
    enviarEventoDoRotador(tipo, valor ?? 0, search, window.location.href);
  };
  w.cmTrack = cmTrack;
  enviarEventoDoRotador("pageview", 0, search, window.location.href);

  return () => {
    if (w.cmTrack === cmTrack) delete w.cmTrack;
  };
}

/** Só para teste: zera a trava de duplicados. */
export function __zerarEnviosDoRotador() {
  jaEnviados.clear();
}
