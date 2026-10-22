// =============================================================
// Venda aprovada -> evento 'purchase' do rotador (teste de página).
//
// CÓPIA IDÊNTICA em três pastas, porque cada edge function é publicada
// sozinha e o import entre pastas não é garantido no deploy do Lovable:
//   supabase/functions/pagtrust-webhook/rotatorVenda.ts   (original)
//   supabase/functions/pagtrust-webhook-2/rotatorVenda.ts
//   supabase/functions/webhook-receiver/rotatorVenda.ts
// O teste src/test/rotatorVenda.test.ts falha se as três divergirem.
//
// Como o clique chega aqui: a página da variação (/desafio/vN) põe no link do
// checkout um MARCADOR "cm_vN_<cm_click>" em sck, src e utm_term (ver
// src/lib/desafioCheckout.ts). Não sabemos ao certo em que campo a PagTrust
// devolve cada um desses parâmetros no webhook, então a busca é pelo marcador
// em qualquer texto do payload (profundidade e tamanho limitados). O prefixo
// "cm_" evita confundir com outros uuid do payload (id do evento, ucode do
// produto), e o clique ainda precisa existir em rotator_clicks.
//
// Idempotência: rotator_events.order_id + índice único (event_type, order_id)
// (migration 20261013120000_rotator_compra_por_pedido.sql). Reenvio do mesmo
// pedido, ou o mesmo pedido chegando por dois webhooks, vira 'duplicada'.
//
// Nada aqui lança erro: a função devolve um status e o webhook segue igual.
// =============================================================

export const MARCADOR_RE =
  /cm_(?:(v\d{1,3})_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export type MarcadorDoRotador = { clickId: string; variante: string | null };

const MAX_NOS = 5000;
const MAX_PROFUNDIDADE = 10;

function procurarNoTexto(texto: string): MarcadorDoRotador | null {
  const tentativas = [texto];
  if (texto.includes("%")) {
    try {
      tentativas.push(decodeURIComponent(texto));
    } catch {
      /* texto com % solto: fica só o original */
    }
  }
  for (const t of tentativas) {
    const m = MARCADOR_RE.exec(t);
    if (m) return { clickId: m[2].toLowerCase(), variante: m[1] ? m[1].toLowerCase() : null };
  }
  return null;
}

/** Primeiro marcador cm_[vN_]<uuid> encontrado em qualquer texto do payload (busca em largura). */
export function extrairMarcadorDoRotador(payload: unknown): MarcadorDoRotador | null {
  const fila: Array<{ v: unknown; d: number }> = [{ v: payload, d: 0 }];
  let nos = 0;
  while (fila.length > 0 && nos < MAX_NOS) {
    const { v, d } = fila.shift()!;
    nos++;
    if (typeof v === "string") {
      const achado = procurarNoTexto(v);
      if (achado) return achado;
      continue;
    }
    if (v === null || typeof v !== "object" || d >= MAX_PROFUNDIDADE) continue;
    const filhos = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const f of filhos) fila.push({ v: f, d: d + 1 });
  }
  return null;
}

function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Código do pedido/transação. Formato 2.0.0 (data.purchase.transaction) primeiro; id do evento por último. */
export function extrairIdDoPedido(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidatos = [
    payload.data?.purchase?.transaction,
    payload.data?.purchase?.order_id,
    payload.data?.purchase?.code,
    payload.orderId,
    payload.order_id,
    payload.transaction_id,
    payload.transaction?.id,
    payload.transaction?.code,
    payload.sale?.id,
    payload.sale?.code,
    payload.purchase?.transaction,
    payload.purchase?.id,
    payload.order?.id,
    payload.id,
  ];
  for (const c of candidatos) {
    const t = texto(c);
    if (t) return t.slice(0, 200);
  }
  return null;
}

export type ResultadoCompraRotador =
  | { status: "sem-marcador" }
  | { status: "clique-desconhecido"; click_id: string }
  | { status: "registrada" | "duplicada"; click_id: string; order_id: string; variante: string | null }
  | { status: "erro"; mensagem: string };

// deno-lint-ignore no-explicit-any
type ClienteSupabase = { from: (tabela: string) => any };

/**
 * Se a venda aprovada trouxer o marcador de um clique do rotador, grava
 * rotator_events {click_id, event_type:'purchase', value, order_id}.
 * Chamar só para venda APROVADA. Nunca lança.
 */
export async function registrarCompraDoRotador(
  supabase: ClienteSupabase,
  payload: unknown,
  valor: number,
): Promise<ResultadoCompraRotador> {
  try {
    const marca = extrairMarcadorDoRotador(payload);
    if (!marca) return { status: "sem-marcador" };

    const { data: clique, error: erroClique } = await supabase
      .from("rotator_clicks")
      .select("click_id")
      .eq("click_id", marca.clickId)
      .maybeSingle();
    if (erroClique) return { status: "erro", mensagem: String(erroClique.message ?? erroClique) };
    if (!clique) return { status: "clique-desconhecido", click_id: marca.clickId };

    const valorOk = Number.isFinite(valor) && valor > 0 ? valor : 0;
    const orderId = extrairIdDoPedido(payload) ?? `sem-pedido:${marca.clickId}:${valorOk}`;

    const { error } = await supabase.from("rotator_events").insert({
      click_id: marca.clickId,
      event_type: "purchase",
      value: valorOk,
      page_url: null,
      order_id: orderId,
    });
    if (error) {
      if (error.code === "23505") {
        return { status: "duplicada", click_id: marca.clickId, order_id: orderId, variante: marca.variante };
      }
      return { status: "erro", mensagem: String(error.message ?? error) };
    }
    return { status: "registrada", click_id: marca.clickId, order_id: orderId, variante: marca.variante };
  } catch (e) {
    return { status: "erro", mensagem: e instanceof Error ? e.message : String(e) };
  }
}
