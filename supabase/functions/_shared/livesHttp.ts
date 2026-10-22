// Utilidades HTTP comuns às funções de lives/webinário.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-live-segredo, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

/** Usuário logado com acesso ao módulo lives (admin ou módulo "lives"). null = sem acesso. */
export async function usuarioLives(req: Request): Promise<{ id: string; nome: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const cli = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u } = await cli.auth.getUser();
  if (!u?.user) return null;
  const { data: ok } = await cli.rpc("pode_lives", { _uid: u.user.id });
  if (!ok) return null;
  const nome = (u.user.user_metadata?.full_name as string) || u.user.email?.split("@")[0] || "Produtor";
  return { id: u.user.id, nome };
}

/**
 * Chamada interna da agenda (tick do pg_cron -> live-aula -> live-control; livekit-webhook -> live-control):
 * header x-live-segredo = integracao_config.live_agenda_segredo (gerado na migration 20261104100000).
 */
export async function chamadaDaAgenda(req: Request, db: SupabaseClient): Promise<boolean> {
  const recebido = req.headers.get("x-live-segredo") ?? "";
  if (recebido.length < 32) return false;
  const segredo = await configIntegracao(db, "live_agenda_segredo");
  if (!segredo || segredo.length !== recebido.length) return false;
  let dif = 0;
  for (let i = 0; i < segredo.length; i++) dif |= segredo.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

/** Ações que a agenda pode pedir ao live-control sem usuário logado. */
export const ACOES_DA_AGENDA = ["ir-ao-vivo", "encerrar", "youtube-status", "palco"];

/** POST interno para outra função de lives com o segredo da agenda. */
export async function chamarFuncaoLives(db: SupabaseClient, fn: string, corpo: Record<string, unknown>): Promise<{ ok: boolean; status: number; dados: Record<string, unknown> }> {
  const segredo = await configIntegracao(db, "live_agenda_segredo");
  if (!segredo) return { ok: false, status: 412, dados: { error: "live_agenda_segredo ausente (rode a migration 20261104100000)" } };
  const r = await fetch(`${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-live-segredo": segredo },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  const dados = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok && !dados.error, status: r.status, dados };
}

export async function configIntegracao(db: SupabaseClient, chave: string): Promise<string | null> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

export function siteUrl(): string {
  return (Deno.env.get("LIVE_SITE_URL") ?? "https://equipe.brenoxavier.com.br").replace(/\/+$/, "");
}

export async function corpoJson(req: Request, limite = 16_384): Promise<Record<string, unknown> | null> {
  const txt = await req.text();
  if (txt.length > limite) return null;
  try {
    const v = JSON.parse(txt || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
