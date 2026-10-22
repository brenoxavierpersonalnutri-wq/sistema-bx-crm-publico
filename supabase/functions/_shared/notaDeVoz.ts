// Nota de voz (PTT) pelo proxy do OpenWA. Sem dependências: testado no vitest (src/test/notaDeVoz.test.ts).
//
// Desde 21/10/2026 TODO áudio do sistema (robô de IA, automação, fluxo, disparo, envio manual) vai como nota de voz:
// a rota `send-audio` do proxy baixa o arquivo (mp3, m4a, ogg...), converte para Ogg/Opus mono 48 kHz com ffmpeg
// (cache por hash) e manda { ptt: true, mimetype: "audio/ogg; codecs=opus" } ao OpenWA. Com `gravando` (padrão),
// o proxy mostra "gravando áudio…" antes, proporcional à duração.
//
// Cai para send-document (o lead recebe o arquivo, só não vira bolha) em dois casos: proxy sem a rota
// (404 "não existe") ou proxy que não conseguiu converter (422 motivo "conversao"). Qualquer outro erro sobe.

type Chamar = (rota: string, corpo: Record<string, unknown>) => Promise<{ messageId?: unknown } | null | undefined>;

export interface ResultadoVoz {
  messageId: string | null;
  /** "voz" = saiu como nota de voz; "documento" = proxy antigo, saiu como arquivo. */
  como: "voz" | "documento";
}

/**
 * O 404 do PRÓPRIO proxy (rota desconhecida: { error: "não existe" }), não um 404 repassado do OpenWA.
 * Lê o ErroProxy por forma, sem importar a classe: o vitest não carrega o waProxy.ts (Deno).
 */
export function proxySemRota(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { status, detalhe } = e as { status?: unknown; detalhe?: unknown };
  return status === 404 && !!detalhe && typeof detalhe === "object" && (detalhe as { error?: unknown }).error === "não existe";
}

/** O 422 do proxy que não conseguiu converter o áudio em Ogg/Opus (arquivo sem áudio, download falhou...). */
export function proxySemConversao(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { status, detalhe } = e as { status?: unknown; detalhe?: unknown };
  return status === 422 && !!detalhe && typeof detalhe === "object" && (detalhe as { motivo?: unknown }).motivo === "conversao";
}

export async function enviarNotaDeVoz(
  chamar: Chamar,
  corpo: { phone: string; url: string; filename?: string | null; gravando?: boolean } & Record<string, unknown>,
): Promise<ResultadoVoz> {
  const { filename, gravando, ...resto } = corpo;
  try {
    const r = await chamar("send-audio", { ...resto, ptt: true, ...(gravando === false ? { gravando: false } : {}) });
    return { messageId: r?.messageId ? String(r.messageId) : null, como: "voz" };
  } catch (e) {
    if (!proxySemRota(e) && !proxySemConversao(e)) throw e;
    const r = await chamar("send-document", { ...resto, ...(filename ? { filename } : {}) });
    return { messageId: r?.messageId ? String(r.messageId) : null, como: "documento" };
  }
}

/**
 * Arquivo já em Ogg/Opus pelo nome. Não decide mais se vira nota de voz (o proxy converte qualquer áudio);
 * fica para quem precisa saber se o arquivo já está no formato final.
 */
export function ehOggOpus(fileName: string | null | undefined, url: string): boolean {
  const nome = (fileName || "").toLowerCase();
  const caminho = url.split("?")[0].toLowerCase();
  return /\.(ogg|oga|opus)$/.test(nome) || /\.(ogg|oga|opus)$/.test(caminho);
}
