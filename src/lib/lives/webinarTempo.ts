// Relógio do webinário ao vivo e regras do chat — funções puras.
//
// O espectador assiste por HLS, que chega atrasado em relação ao estúdio (latência do
// Cloudflare Stream, em geral 10-30 s). "Tempo do conteúdo" é o ponto da transmissão que
// ELE está vendo agora: agora - início real da sessão - offset do HLS (configurável).
// Oferta por tempo e mensagem roteirizada usam esse relógio, para aparecerem no mesmo
// instante em que o apresentador fala delas no vídeo.

export interface OfertaWebinar {
  id: string;
  titulo: string;
  descricao?: string | null;
  preco_texto?: string | null;
  cta_texto?: string | null;
  checkout_link_id?: string | null;
  url?: string | null;
  modo: "manual" | "tempo";
  aparece_em_seg?: number | null;
  dura_seg?: number | null;
  liberada_em?: string | null;
  encerrada_em?: string | null;
  liberada_session_id?: string | null;
  ativo?: boolean;
  ordem?: number;
}

export interface MensagemRoteiro {
  id: string;
  aos_seg: number;
  autor_nome: string;
  texto: string;
}

/** Segundos de conteúdo que o espectador está vendo (nunca negativo). */
export function tempoDoConteudo(iniciadaEm: string | null | undefined, agoraMs: number, offsetHlsSeg: number): number {
  if (!iniciadaEm) return 0;
  const inicio = Date.parse(iniciadaEm);
  if (!Number.isFinite(inicio)) return 0;
  const off = Number.isFinite(offsetHlsSeg) ? Math.max(0, Math.min(offsetHlsSeg, 600)) : 0;
  return Math.max(0, Math.floor((agoraMs - inicio) / 1000 - off));
}

/**
 * Ofertas visíveis agora para esta sessão.
 *  - tempo: aparece em aparece_em_seg (relógio do conteúdo) e some depois de dura_seg (sem
 *    dura_seg = fica até o fim);
 *  - manual: liberada pelo produtor nesta sessão; aparece offset segundos DEPOIS do clique
 *    (para casar com o vídeo atrasado) e some quando encerrada.
 */
export function ofertasVisiveis(
  ofertas: OfertaWebinar[],
  ctx: { sessionId: string; iniciadaEm: string | null; agoraMs: number; offsetHlsSeg: number },
): OfertaWebinar[] {
  const t = tempoDoConteudo(ctx.iniciadaEm, ctx.agoraMs, ctx.offsetHlsSeg);
  const off = Math.max(0, ctx.offsetHlsSeg || 0) * 1000;
  return ofertas
    .filter((o) => o.ativo !== false)
    .filter((o) => {
      if (o.modo === "tempo") {
        if (!ctx.iniciadaEm || o.aparece_em_seg == null) return false;
        if (t < o.aparece_em_seg) return false;
        return o.dura_seg == null || o.dura_seg <= 0 || t < o.aparece_em_seg + o.dura_seg;
      }
      if (!o.liberada_em || o.liberada_session_id !== ctx.sessionId) return false;
      const lib = Date.parse(o.liberada_em) + off;
      if (ctx.agoraMs < lib) return false;
      if (o.encerrada_em && ctx.agoraMs >= Date.parse(o.encerrada_em) + off) return false;
      return true;
    })
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

/** Segundos restantes de uma oferta por tempo (null = sem prazo). */
export function restanteOferta(o: OfertaWebinar, tempoConteudo: number): number | null {
  if (o.modo !== "tempo" || o.aparece_em_seg == null || !o.dura_seg || o.dura_seg <= 0) return null;
  return Math.max(0, o.aparece_em_seg + o.dura_seg - tempoConteudo);
}

/** Destino do botão da oferta: checkout do gateway (/checkout/:id) ou URL https. */
export function destinoOferta(o: OfertaWebinar, origem: string, utm?: Record<string, string>): string | null {
  let url: URL | null = null;
  if (o.checkout_link_id) url = new URL(`/checkout/${encodeURIComponent(o.checkout_link_id)}`, origem);
  else if (o.url && /^https:\/\//i.test(o.url)) url = new URL(o.url);
  if (!url) return null;
  for (const [k, v] of Object.entries(utm ?? {})) if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  return url.toString();
}

export const roteiroVisivel = (roteiro: MensagemRoteiro[], tempoConteudo: number) =>
  roteiro.filter((m) => m.aos_seg <= tempoConteudo).sort((a, b) => a.aos_seg - b.aos_seg);

// ------------------------------------------------------------------ limite do chat
// Mesma regra da RPC webinar_chat_enviar (SQL é quem manda; aqui o front avisa antes).

export const LIMITE_CHAT = { intervaloMinSeg: 3, maxPorMinuto: 6, maxCaracteres: 500 } as const;

export type MotivoChat = "ok" | "vazia" | "longa" | "rapido" | "limite";

export function podeEnviarChat(
  texto: string,
  enviadasMs: number[],
  agoraMs: number,
  regra: { intervaloMinSeg: number; maxPorMinuto: number; maxCaracteres: number } = LIMITE_CHAT,
): { ok: boolean; motivo: MotivoChat; esperarSeg: number } {
  const t = (texto ?? "").trim();
  if (!t) return { ok: false, motivo: "vazia", esperarSeg: 0 };
  if (t.length > regra.maxCaracteres) return { ok: false, motivo: "longa", esperarSeg: 0 };
  const ultima = enviadasMs.length ? Math.max(...enviadasMs) : -Infinity;
  const desde = (agoraMs - ultima) / 1000;
  if (desde < regra.intervaloMinSeg) {
    return { ok: false, motivo: "rapido", esperarSeg: Math.ceil(regra.intervaloMinSeg - desde) };
  }
  const noMinuto = enviadasMs.filter((ms) => agoraMs - ms < 60_000).sort((a, b) => a - b);
  if (noMinuto.length >= regra.maxPorMinuto) {
    return { ok: false, motivo: "limite", esperarSeg: Math.ceil((noMinuto[0] + 60_000 - agoraMs) / 1000) };
  }
  return { ok: true, motivo: "ok", esperarSeg: 0 };
}

/** Presentes = pings nos últimos `janelaSeg` segundos (o ping sai a cada 30 s). */
export function contarPresentes(ultimosPingsMs: number[], agoraMs: number, janelaSeg = 75): number {
  return ultimosPingsMs.filter((ms) => agoraMs - ms <= janelaSeg * 1000).length;
}

/** "45", "12:30" ou "1:02:03" -> segundos. null se inválido. */
export function lerTempo(txt: string): number | null {
  const t = (txt ?? "").trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
  const partes = t.split(":").map(Number);
  if (partes.slice(1).some((n) => n >= 60)) return null;
  return partes.reduce((acc, n) => acc * 60 + n, 0);
}

/** segundos -> "m:ss" ou "h:mm:ss". */
export function formatarTempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
