// Mídia das mensagens do WhatsApp (só Deno): baixa pelo proxy da VPS, guarda no bucket PRIVADO
// whatsapp-media e grava em whatsapp_messages o caminho (media_path) — o front assina na leitura.
//
// Desde 17/10/2026 a mídia vem pela rota `media-id` do proxy, PELO ID da mensagem (infra/wa-proxy):
//  1) o arquivo que o OpenWA guardou quando a mensagem chegou (vale para qualquer idade);
//  2) sem arquivo: o proxy acha a posição da mensagem nas 100 mais recentes do chat e pede ao
//     WhatsApp Web o histórico com mídia só até ela (antes era um histórico fixo de 30 mensagens,
//     e tudo que estava além da 30ª virava 'falhou').
// O OpenWA v0.24.0 não tem download por id direto no WhatsApp: além das 100 mais recentes, sem
// arquivo guardado, não há como baixar — vira 'falhou' na hora com o motivo (não gasta 3 tentativas).
// Retry (waMidiaRegras.ts): 5xx/timeout espera 1 s, 3 s, 8 s; "Session is not connected" espera a
// sessão voltar (até 30 s) e, se não voltar, a linha fica 'pendente' sem gastar tentativa.
// O webhook baixa NA CHEGADA (base64 do corpo ou media-id), então mensagem nova nunca sai da janela.
// Sessão (17/10/2026): sempre a do NÚMERO da mensagem (whatsapp_messages.numero_id) — o arquivo só existe
// no aparelho que recebeu; pela sessão closer, a mídia de outro número nunca vem. Sessão fora do ar para
// só as mídias DAQUELE número; as dos outros seguem.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ErroProxy } from "./waProxy.ts";
import { chamarProxyNaSessao, sessaoLeitura } from "./waNumero.ts";
import { extensaoDoMime } from "./openwa.ts";
import { chatIdDaMensagem } from "./waBackfill.ts";
import {
  atualizacaoDeFalha, baixarComRetry, classificarErroMidia, type TipoErroMidia,
} from "./waMidiaRegras.ts";

export const BUCKET_MIDIA = "whatsapp-media";
export const TETO_MIDIA = 25 * 1024 * 1024;
export const MAX_TENTATIVAS_MIDIA = 3;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Caminho no bucket: <chave do contato>/openwa-<id>.<ext> (grupo: 120363…@g.us -> 120363…_g_us). */
export function caminhoMidia(telefone: string, messageId: string, mime: string | null, fileName: string | null): string {
  const id = messageId.replace(/[^A-Za-z0-9_-]/g, "_").slice(-80);
  const pasta = telefone.replace(/[^A-Za-z0-9-]/g, "_");
  return `${pasta}/openwa-${id}.${extensaoDoMime(mime, fileName)}`;
}

export async function guardarBytes(
  supabase: SupabaseClient,
  caminho: string,
  bytes: Uint8Array,
  mime: string | null,
): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_MIDIA)
    .upload(caminho, bytes, { contentType: mime || "application/octet-stream", upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
}

/** Lê bytes + mime de uma resposta binária do proxy (rota media ou media-id). */
async function bytesDaResposta(res: Response): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new ErroProxy(404, "vazio");
  if (bytes.byteLength > TETO_MIDIA) throw new ErroProxy(413, "grande demais");
  const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return { bytes, mime: ct && ct !== "application/octet-stream" ? ct : null };
}

/** Rota media antiga (só o arquivo guardado): fallback quando o proxy ainda não tem media-id. */
export async function baixarPelaRotaMedia(
  chatId: string,
  messageId: string,
  sessao: string | null = null,
): Promise<{ bytes: Uint8Array; mime: string | null }> {
  return bytesDaResposta(await chamarProxyNaSessao("media", { chatId, messageId }, sessao, { binario: true, timeoutMs: 40_000 }));
}

/** Uma ida à rota media-id (arquivo guardado, senão histórico com mídia até a mensagem). */
export async function baixarPelaRotaMediaId(
  chatId: string,
  messageId: string,
  timeoutMs = 120_000,
  sessao: string | null = null,
): Promise<{ bytes: Uint8Array; mime: string | null }> {
  return bytesDaResposta(await chamarProxyNaSessao("media-id", { chatId, messageId }, sessao, { binario: true, timeoutMs }));
}

async function statusSessao(sessao: string | null): Promise<string | null> {
  const r = await chamarProxyNaSessao("status", {}, sessao, { timeoutMs: 10_000 });
  return typeof r?.status === "string" ? r.status : null;
}

/** media-id com retry (5xx/timeout, sessão fora do ar) e fallback para a rota media do proxy antigo. */
export function baixarMidiaPorId(
  chatId: string,
  messageId: string,
  // sessao: a do número da mensagem (null = padrão)
  opcoes: { timeoutMs?: number; esperas?: number[]; sessao?: string | null } = {},
): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const sessao = opcoes.sessao ?? null;
  return baixarComRetry({
    baixar: () => baixarPelaRotaMediaId(chatId, messageId, opcoes.timeoutMs, sessao),
    baixarLegado: () => baixarPelaRotaMedia(chatId, messageId, sessao),
    statusSessao: () => statusSessao(sessao),
    dormir,
  }, opcoes.esperas);
}

export type LinhaMidia = {
  id: string;
  /** Número da mensagem (sem a coluna, banco antigo: a sessão padrão). */
  numero_id?: string | null;
  contact_phone: string;
  message_id: string;
  mime_type: string | null;
  file_name: string | null;
  media_tentativas: number;
};

async function marcarOk(supabase: SupabaseClient, linha: LinhaMidia, caminho: string, mime: string | null) {
  await supabase.from("whatsapp_messages").update({
    media_path: caminho,
    media_status: "ok",
    media_erro: null,
    ...(mime && !linha.mime_type ? { mime_type: mime } : {}),
  }).eq("id", linha.id);
}

async function marcarFalha(supabase: SupabaseClient, linha: LinhaMidia, tipo: TipoErroMidia, erro: string) {
  await supabase.from("whatsapp_messages")
    .update(atualizacaoDeFalha(linha.media_tentativas ?? 0, tipo, erro, MAX_TENTATIVAS_MIDIA))
    .eq("id", linha.id);
}

async function guardarEMarcar(supabase: SupabaseClient, linha: LinhaMidia, bytes: Uint8Array, mimeBaixado: string | null) {
  const m = linha.mime_type ?? mimeBaixado;
  const caminho = caminhoMidia(linha.contact_phone, linha.message_id, m, linha.file_name);
  await guardarBytes(supabase, caminho, bytes, m);
  await marcarOk(supabase, linha, caminho, mimeBaixado);
}

/**
 * Mídia de uma mensagem que acabou de chegar pelo webhook (roda em segundo plano, depois do 200):
 * base64 do próprio webhook, senão media-id com retry. O OpenWA às vezes ainda está guardando o
 * arquivo quando dispara o evento: a mensagem recém-chegada está no topo do chat, então o histórico
 * com mídia (posição 1-2) resolve mesmo assim.
 */
export async function midiaDoWebhook(
  supabase: SupabaseClient,
  linhaId: string,
  dados: {
    telefone: string; chatId: string; messageId: string; mime: string | null; fileName: string | null; inline: string | null;
    /** Sessão do número que recebeu (null = padrão). */
    sessao?: string | null;
  },
): Promise<"ok" | "pendente"> {
  const linha: LinhaMidia = {
    id: linhaId, contact_phone: dados.telefone, message_id: dados.messageId,
    mime_type: dados.mime, file_name: dados.fileName, media_tentativas: 0,
  };
  if (dados.inline) {
    try {
      const bytes = base64ParaBytes(dados.inline);
      if (bytes.byteLength && bytes.byteLength <= TETO_MIDIA) {
        await guardarEMarcar(supabase, linha, bytes, null);
        return "ok";
      }
    } catch (e) {
      console.warn("midia: inline do webhook ilegível", classificarErroMidia(e).msg);
    }
  }
  try {
    // 2 s antes: dá tempo do OpenWA terminar de guardar o arquivo (evita ir ao histórico à toa)
    await dormir(2_000);
    const { bytes, mime } = await baixarMidiaPorId(dados.chatId, dados.messageId, { timeoutMs: 60_000, sessao: dados.sessao ?? null });
    await guardarEMarcar(supabase, linha, bytes, mime);
    return "ok";
  } catch (e) {
    const c = classificarErroMidia(e);
    // o tick do backfill tenta de novo (sessão fora/limite não gastam tentativa)
    await marcarFalha(supabase, linha, c.tipo, c.msg);
    return "pendente";
  }
}

/**
 * Mídias pendentes (backfill e retry), uma a uma pela rota media-id. `reservar()` devolve false quando
 * acabou o orçamento de leituras/tempo; `restanteMs()` (opcional) limita o timeout de cada download
 * ao que sobra do prazo de quem chamou. Sessão fora do ar ou 429: para o lote (as próximas falhariam
 * igual) sem gastar tentativa de ninguém.
 */
export async function processarMidiasPendentes(
  supabase: SupabaseClient,
  linhas: LinhaMidia[],
  reservar: () => Promise<boolean>,
  restanteMs?: () => number,
): Promise<{ ok: number; falhas: number; parou: boolean }> {
  let ok = 0;
  let falhas = 0;
  // sessão fora do ar: pula as próximas DAQUELE número (falhariam igual); os outros números seguem
  const sessoesFora = new Set<string>();
  for (const l of linhas) {
    const chat = chatIdDaMensagem(l.message_id);
    if (!chat) {
      await marcarFalha(supabase, l, "definitivo", "id sem chat");
      falhas++;
      continue;
    }
    const sessao = await sessaoLeitura(supabase, l.numero_id ?? null);
    if (sessoesFora.has(sessao ?? "")) continue;
    if (!(await reservar())) return { ok, falhas, parou: true };
    const sobra = restanteMs ? restanteMs() - 10_000 : 120_000;
    if (sobra < 20_000) return { ok, falhas, parou: true };
    try {
      const { bytes, mime } = await baixarMidiaPorId(chat, l.message_id, {
        timeoutMs: Math.min(120_000, sobra),
        esperas: restanteMs && sobra < 60_000 ? [1_000] : undefined,
        sessao,
      });
      await guardarEMarcar(supabase, l, bytes, mime);
      ok++;
    } catch (e) {
      const c = classificarErroMidia(e);
      if (c.tipo === "limite") return { ok, falhas, parou: true };
      if (c.tipo === "sessao") {
        // baixarMidiaPorId já esperou a sessão (até 30 s): o resto deste número falharia igual
        await marcarFalha(supabase, l, c.tipo, c.msg);
        sessoesFora.add(sessao ?? "");
        continue;
      }
      await marcarFalha(supabase, l, c.tipo, c.msg);
      falhas++;
    }
  }
  return { ok, falhas, parou: sessoesFora.size > 0 };
}

/** Colunas da fila de mídia; sem numero_id (migration 20261028100000 pendente), as antigas. */
export const COLUNAS_MIDIA_PENDENTE_ANTIGAS = "id, contact_phone, message_id, mime_type, file_name, media_tentativas";
export const COLUNAS_MIDIA_PENDENTE = `${COLUNAS_MIDIA_PENDENTE_ANTIGAS}, numero_id`;
