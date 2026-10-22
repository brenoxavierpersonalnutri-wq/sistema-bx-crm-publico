// Peças comuns das funções públicas do webinário.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { conferirTokenInscricao } from "./liveCrypto.ts";
import { configIntegracao } from "./livesHttp.ts";

let segredoCache: string | null = null;
export async function segredoInscricao(db: SupabaseClient): Promise<string> {
  if (!segredoCache) segredoCache = await configIntegracao(db, "webinar_token_segredo");
  if (!segredoCache) throw new Error("webinar_token_segredo ausente (rodar a migration 20261020110000)");
  return segredoCache;
}

/** Normaliza WhatsApp: só dígitos; 10-11 dígitos ganham o 55 do Brasil. null se inválido. */
export function normalizarWhatsapp(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  const n = d.length === 10 || d.length === 11 ? `55${d}` : d;
  return /^\d{12,15}$/.test(n) ? n : null;
}

export async function inscricaoDoToken(db: SupabaseClient, token: unknown) {
  if (typeof token !== "string") return null;
  const id = await conferirTokenInscricao(token, await segredoInscricao(db));
  if (!id) return null;
  const { data } = await db.from("webinar_registrations").select("*").eq("id", id).maybeSingle();
  return data;
}

export const CAMPOS_OFERTA =
  "id, titulo, descricao, preco_texto, cta_texto, checkout_link_id, url, modo, aparece_em_seg, dura_seg, liberada_em, encerrada_em, liberada_session_id, ativo, ordem";
