// Chamada da aba "Número de telefone" (/crm/conexoes) à whatsapp-qr: POST {acao:"codigo", sessao, telefone}.
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";

export type RespostaCodigo = { ok: boolean; status: number; corpo: Record<string, unknown> };
export type PedirCodigo = (sessao: string, telefone: string) => Promise<RespostaCodigo>;

/** Prazo do front: o OpenWA pode levar até ~70 s (tenta de novo enquanto a página do QR recarrega). */
export const PRAZO_MS = 95_000;
/** Teto quando a função não manda a validade (igual a VALIDADE_CODIGO_SEGUNDOS da whatsapp-qr). */
export const VALIDADE_PADRAO_S = 60;

export const pedirCodigoPadrao: PedirCodigo = async (sessao, telefone) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, status: 401, corpo: { error: "Sessão expirada: entre de novo" } };
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const res = await buscarComLimite(`https://${projectId}.supabase.co/functions/v1/whatsapp-qr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "codigo", sessao, telefone }),
  }, PRAZO_MS);
  const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, corpo };
};
