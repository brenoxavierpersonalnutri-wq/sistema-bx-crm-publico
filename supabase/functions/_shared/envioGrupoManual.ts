// Envio MANUAL a grupo do WhatsApp (18/10/2026): o atendente digitando na tela Conversas.
// Sem Deno, sem rede: roda nas edge functions whatsapp-send / whatsapp-send-media e no vitest
// (src/test/envioGrupoManual.test.ts).
//
// Regras:
//  - Só com `manual: true` no corpo E usuário logado (as funções já exigem o JWT). Sem a flag, destino
//    @g.us é recusado como antes (nenhum caminho automático manda pra grupo por aqui).
//  - Vai pelas rotas send-group-manual-* do proxy (infra/wa-proxy): sem allowlist, qualquer grupo em que a
//    sessão do número é membro, limite anti-loop de 60/min. A allowlist e os 6/min continuam só no disparo
//    automático do módulo Grupos (send-group-text / send-group-media).
//  - Automações, fluxos e a IA não passam por aqui (usam _shared/waEnvio.ts, que exige telefone).

/** Grupo do WhatsApp: `120363...@g.us` (novo) ou `<criador>-<epoch>@g.us` (antigo). Mesma regra do proxy. */
export const jidGrupo = (v: unknown): v is string =>
  typeof v === "string" && /^\d{5,25}(-\d{5,15})?@g\.us$/.test(v);

export type Destino =
  | { tipo: "grupo"; chatId: string }
  | { tipo: "telefone"; numero: string }
  | { erro: string; status: number };

/** Para onde vai a mensagem: grupo (só manual) ou telefone (10 a 15 dígitos, com 55 na frente). */
export function destinoEnvio(phone: unknown, manual: unknown): Destino {
  const bruto = String(phone ?? "").trim();
  if (bruto.endsWith("@g.us")) {
    if (!jidGrupo(bruto)) return { erro: "id de grupo inválido", status: 400 };
    if (manual !== true) return { erro: "envio a grupo só manual, pela tela Conversas", status: 403 };
    return { tipo: "grupo", chatId: bruto };
  }
  const digitos = bruto.replace(/\D/g, "");
  const numero = digitos.startsWith("55") ? digitos : `55${digitos}`;
  if (!/^\d{10,15}$/.test(numero)) return { erro: "phone inválido", status: 400 };
  return { tipo: "telefone", numero };
}

export type TipoMidia = "image" | "video" | "audio" | "document";

/**
 * Corpo da rota send-group-manual-media. Mesma escolha do envio a telefone: imagem como imagem; nota de
 * voz (ptt; o proxy converte para Ogg/Opus) como áudio de voz; vídeo e áudio com ptt false como documento.
 */
export function corpoMidiaGrupoManual(
  chatId: string,
  m: { tipo: TipoMidia; url: string; legenda?: string; fileName?: string | null; ptt?: boolean },
): Record<string, unknown> {
  if (m.ptt) return { chatId, kind: "audio", url: m.url, ptt: true };
  const legenda = m.legenda?.trim() ? { caption: m.legenda } : {};
  if (m.tipo === "image") return { chatId, kind: "image", url: m.url, ...legenda };
  return { chatId, kind: "document", url: m.url, ...(m.fileName ? { filename: m.fileName } : {}), ...legenda };
}

/** Mensagem de erro do 429 do proxy, conforme o destino. */
export const avisoLimite = (grupo: boolean): string =>
  grupo ? "Limite de envio em grupo atingido (60/min)" : "Limite de envio atingido (20/min, 300/dia)";
