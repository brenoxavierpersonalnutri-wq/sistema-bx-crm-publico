// Mensagem que o SISTEMA manda pelo nosso número (robô de IA, automações, fluxos, disparos, follow-up, lembretes do
// webinário) nunca conta como atendimento humano. Desde 21/10/2026 (pausaHumana.ts) humano entrou = IA pausada; o eco
// de um envio do sistema chega no openwa-webhook como fromMe igual ao do celular, e sem registro ele era lido como
// "mensagem manual pelo celular do número" e pausava a IA (os lembretes do webinário não deixavam rastro nenhum).
//
// Regra: todo envio do sistema deixa o message_id registrado. Ou numa linha de whatsapp_messages com sender_type de
// sistema (robô, automações) ou numa linha de crm_automacao_log (automações e, agora, lembretes). O webhook espera uns
// segundos pelo registro e confere DUAS vezes antes de concluir que foi humano (o registro sai depois da resposta do
// proxy, que pode demorar mais que o eco). Lógica sem Deno: o vitest importa direto.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** sender_type de linha gravada pelo sistema. "human"/"user"/vazio = pessoa (celular ou CRM). */
export const SENDER_TYPES_SISTEMA: ReadonlySet<string> = new Set(["bot", "ia", "automacao", "sistema", "lembrete"]);

export function senderTypeDeSistema(t: string | null | undefined): boolean {
  return SENDER_TYPES_SISTEMA.has(String(t ?? "").trim().toLowerCase());
}

/**
 * Mensagem nossa (fromMe) que o webhook não conhecia: veio de humano (celular)? false quando o sistema mandou
 * (linha com sender_type de sistema ou log de automação com o message_id).
 */
export function ehMensagemDeHumano(p: { senderTypeDaLinha: string | null; temLogDeAutomacao: boolean }): boolean {
  if (p.temLogDeAutomacao) return false;
  if (senderTypeDeSistema(p.senderTypeDaLinha)) return false;
  return true;
}

/** O que o banco diz sobre o message_id: sender_type da linha e se há log de envio do sistema. */
export async function origemDoMessageId(db: Db, messageId: string): Promise<{ senderTypeDaLinha: string | null; temLogDeAutomacao: boolean }> {
  const { data: linha } = await db.from("whatsapp_messages").select("sender_type").eq("message_id", messageId).maybeSingle();
  const { count } = await db.from("crm_automacao_log").select("id", { count: "exact", head: true }).eq("message_id", messageId);
  return { senderTypeDaLinha: linha?.sender_type ?? null, temLogDeAutomacao: (count ?? 0) > 0 };
}

/** Espera padrão antes de cada conferência: 6 s (como antes) e mais 8 s antes de concluir "humano". */
export const ESPERAS_FROM_ME_MS = [6000, 8000] as const;

/**
 * Decide se um fromMe é humano, conferindo o registro em cada espera. Basta UMA conferência achar o registro do
 * sistema para ser sistema; humano só quando nenhuma achou. Sem message_id não há como conferir: humano (como antes).
 */
export async function fromMeEhHumano(
  db: Db,
  messageId: string | null,
  opcoes: { esperas?: readonly number[]; dormir?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  if (!messageId) return true;
  const esperas = opcoes.esperas ?? ESPERAS_FROM_ME_MS;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const ms of esperas.length ? esperas : [0]) {
    if (ms > 0) await dormir(ms);
    const origem = await origemDoMessageId(db, messageId);
    if (!ehMensagemDeHumano(origem)) {
      // o eco chegou antes do registro e o webhook gravou a linha como "human": corrige para "bot", senão ela
      // conta como resposta humana no gatilho (ultimaAcaoHumana) e no robô (humanoJaRespondeu)
      if (origem.senderTypeDaLinha === "human") {
        const { error } = await db.from("whatsapp_messages").update({ sender_type: "bot" }).eq("message_id", messageId).eq("sender_type", "human");
        if (error) console.error("envio-sistema: corrigir linha", error.message);
      }
      return false;
    }
  }
  return true;
}

/**
 * Registra um envio do sistema que não grava linha própria em whatsapp_messages (ex.: lembretes do webinário):
 * uma linha em crm_automacao_log (canal whatsapp, conta no limite de envios como os outros envios do número) e, se
 * o eco do webhook já gravou a mensagem como "human", corrige para "bot". Nunca lança: o envio já saiu.
 */
export async function registrarEnvioSistema(
  db: Db,
  p: { messageId: string | null; telefone: string; origem: string; tipo?: string },
): Promise<boolean> {
  if (!p.messageId) {
    console.error(`envio-sistema: ${p.origem} saiu sem message_id; o eco pode ser lido como humano`);
    return false;
  }
  try {
    const { error } = await db.from("crm_automacao_log").insert({
      contact_phone: String(p.telefone ?? "").replace(/\D/g, "") || String(p.telefone ?? ""),
      canal: "whatsapp",
      tipo: p.tipo ?? "text",
      status: "ok",
      detalhe: p.origem.slice(0, 1000),
      message_id: p.messageId,
    });
    if (error) console.error("envio-sistema: log", error.message);
    const { error: e2 } = await db.from("whatsapp_messages").update({ sender_type: "bot" })
      .eq("message_id", p.messageId).eq("sender_type", "human");
    if (e2) console.error("envio-sistema: linha", e2.message);
    return !error;
  } catch (e) {
    console.error("envio-sistema:", e instanceof Error ? e.message : e);
    return false;
  }
}
