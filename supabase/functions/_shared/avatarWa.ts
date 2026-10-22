// Foto de perfil de contato/grupo do WhatsApp (só Deno): busca os bytes pelo proxy (rota avatar),
// guarda no bucket PRIVADO whatsapp-avatars e grava em whatsapp_contacts.avatar_url um link
// assinado de 1 ano. Por que Storage: a URL do CDN do WhatsApp expira em horas.
//
// Ritmo: no máximo uma busca por contato a cada 7 dias. A "reserva" é um UPDATE condicional
// (avatar_atualizado_em nulo ou velho -> agora), então duas mensagens seguidas do mesmo contato
// não disparam duas buscas. Falha que não seja "sem foto" reagenda pra ~1 dia.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ErroProxy } from "./waProxy.ts";
import { chamarProxyNaSessao } from "./waNumero.ts";
import { AVATAR_VALIDADE_MS, caminhoAvatar, chatIdDoContato } from "./openwa.ts";

const BUCKET = "whatsapp-avatars";
const UM_ANO = 60 * 60 * 24 * 365;
const TETO = 2 * 1024 * 1024;

export type ResultadoAvatar = "atualizado" | "sem-foto" | "em-dia" | "falhou" | "limite";

export async function atualizarAvatar(
  supabase: SupabaseClient,
  phone: string,
  // sessao: a do número da conversa (grupo só a sessão que participa dele enxerga a foto); null = padrão
  opcoes: { forcar?: boolean; sessao?: string | null } = {},
): Promise<ResultadoAvatar> {
  const chatId = chatIdDoContato(phone);
  if (!chatId) return "falhou";
  const agora = new Date();
  const limite = new Date(agora.getTime() - AVATAR_VALIDADE_MS).toISOString();

  // reserva atômica (se a coluna ainda não existe, a migration não rodou: não faz nada)
  let q = supabase.from("whatsapp_contacts").update({ avatar_atualizado_em: agora.toISOString() }).eq("phone", phone);
  if (!opcoes.forcar) q = q.or(`avatar_atualizado_em.is.null,avatar_atualizado_em.lt."${limite}"`);
  const { data: reservado, error: errRes } = await q.select("phone");
  if (errRes) {
    console.error("avatar: reserva falhou", errRes.message);
    return "falhou";
  }
  if (!reservado?.length) return "em-dia";

  const reagendar = async () => {
    // tenta de novo em ~1 dia (marca como se tivesse 6 dias)
    const em = new Date(agora.getTime() - AVATAR_VALIDADE_MS + 24 * 3600 * 1000).toISOString();
    await supabase.from("whatsapp_contacts").update({ avatar_atualizado_em: em }).eq("phone", phone);
  };

  try {
    const res: Response = await chamarProxyNaSessao("avatar", { chatId }, opcoes.sessao ?? null, { binario: true, timeoutMs: 25_000 });
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > TETO || !/^image\/(jpeg|png|webp)$/.test(mime)) {
      await reagendar();
      return "falhou";
    }
    const caminho = await caminhoAvatar(phone, mime);
    const up = await supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: true, cacheControl: "604800" });
    if (up.error) throw new Error(up.error.message);
    const { data: assinado } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, UM_ANO);
    if (!assinado?.signedUrl) throw new Error("sem link assinado");
    await supabase.from("whatsapp_contacts").update({ avatar_url: assinado.signedUrl }).eq("phone", phone);
    return "atualizado";
  } catch (e) {
    if (e instanceof ErroProxy && e.status === 404) {
      // sem foto ou escondida pela privacidade: limpa e só olha de novo daqui a 7 dias
      await supabase.from("whatsapp_contacts").update({ avatar_url: null }).eq("phone", phone);
      return "sem-foto";
    }
    await reagendar();
    if (e instanceof ErroProxy && e.status === 429) return "limite";
    console.error("avatar: falhou em ***" + phone.slice(-4), e instanceof ErroProxy ? e.status : e instanceof Error ? e.message : e);
    return "falhou";
  }
}
