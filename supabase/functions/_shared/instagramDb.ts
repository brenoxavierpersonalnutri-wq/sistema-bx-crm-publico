// Acesso a banco e à Graph API do Instagram que as três funções (oauth, webhook, send) dividem.
// O token só é decifrado aqui dentro e nunca sai em resposta nem em log.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decifrarToken, GRAPH_IG, VERSAO_GRAPH } from "./instagram.ts";
import { lerAppIgGuardado } from "./pareamentoIg.ts";

export const corsIg = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const jsonIg = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsIg, "Content-Type": "application/json" } });

// Credenciais: Deno.env tem prioridade; na falta, integracao_config ('instagram_app' gravado pelo
// pareamento da VPS, 'instagram_token_segredo' gerado no banco). Cada função chama prepararEnvIg(db)
// no começo da requisição; envIg() fica síncrono. Cache por instância, 60 s. Nunca loga valor.
let doBanco: { appId: string; appSecret: string; segredoToken: string; ate: number } | null = null;

export async function prepararEnvIg(db: SupabaseClient): Promise<void> {
  const precisa = !Deno.env.get("IG_APP_ID") || !Deno.env.get("IG_APP_SECRET") || (Deno.env.get("IG_TOKEN_SEGREDO") ?? "").length < 32;
  if (!precisa || (doBanco && doBanco.ate > Date.now())) return;
  try {
    const { data, error } = await db.from("integracao_config").select("chave, valor")
      .in("chave", ["instagram_app", "instagram_token_segredo"]);
    if (error) throw new Error(error.message);
    const linhas = new Map(((data ?? []) as { chave: string; valor: string }[]).map((l) => [l.chave, l.valor]));
    const app = lerAppIgGuardado(linhas.get("instagram_app"));
    doBanco = {
      appId: app?.app_id ?? "",
      appSecret: app?.app_secret ?? "",
      segredoToken: linhas.get("instagram_token_segredo") ?? "",
      ate: Date.now() + 60_000,
    };
  } catch (e) {
    console.error("prepararEnvIg: não li integracao_config", e instanceof Error ? e.message : "erro");
  }
}

export function envIg() {
  const envSeg = Deno.env.get("IG_TOKEN_SEGREDO") ?? "";
  return {
    appId: Deno.env.get("IG_APP_ID") || doBanco?.appId || "",
    appSecret: Deno.env.get("IG_APP_SECRET") || doBanco?.appSecret || "",
    segredoToken: envSeg.length >= 32 ? envSeg : (doBanco?.segredoToken ?? envSeg),
    urlCrm: (Deno.env.get("CRM_URL") ?? "https://equipe.brenoxavier.com.br").replace(/\/+$/, ""),
    redirectUri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/instagram-oauth`,
  };
}

export async function configIg(db: SupabaseClient, chave: string): Promise<string | null> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return (data?.valor as string | undefined) ?? null;
}

export interface ContaIg {
  id: string;
  ig_user_id: string;
  username: string;
  token_cifrado: string | null;
  token_expira_em: string | null;
  status: string;
}

export async function contaPorIgId(db: SupabaseClient, igUserId: string): Promise<ContaIg | null> {
  const { data } = await db.from("ig_contas")
    .select("id, ig_user_id, username, token_cifrado, token_expira_em, status")
    .eq("ig_user_id", igUserId).maybeSingle();
  return (data as ContaIg | null) ?? null;
}

export async function tokenDaConta(conta: ContaIg): Promise<string> {
  if (!conta.token_cifrado) throw new Error("conta sem token: conecte o Instagram de novo");
  return decifrarToken(conta.token_cifrado, envIg().segredoToken);
}

/** Erro da Graph sem vazar o token: só código, subcódigo e mensagem. */
export class ErroGraph extends Error {
  constructor(public status: number, public codigo: number | null, public subcodigo: number | null, mensagem: string) {
    super(mensagem);
  }
}

export async function graph(
  caminho: string,
  token: string,
  opcoes: { metodo?: "GET" | "POST" | "DELETE"; corpo?: unknown; query?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH_IG}/${VERSAO_GRAPH}/${caminho.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opcoes.query ?? {})) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(opcoes.corpo ? { "Content-Type": "application/json" } : {}) },
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || j.error) {
      const e = (j.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
      throw new ErroGraph(r.status, e.code ?? null, e.error_subcode ?? null, String(e.message ?? `HTTP ${r.status}`).slice(0, 300));
    }
    return j;
  } finally {
    clearTimeout(t);
  }
}

/** Tradução dos erros mais comuns do envio pro atendente. */
export function mensagemErroEnvio(e: unknown): string {
  if (e instanceof ErroGraph) {
    if (e.codigo === 10 && e.subcodigo === 2018278) return "Fora da janela de 24 h: o Instagram recusou. Espere a pessoa escrever de novo.";
    if (e.codigo === 190) return "Token do Instagram expirou ou foi revogado. Conecte de novo na Central.";
    if (e.codigo === 200 || e.codigo === 10) return `A Meta recusou por permissão (${e.message}). Confira o acesso da permissão de mensagens no app.`;
    if (e.codigo === 4 || e.codigo === 613 || e.codigo === 32) return "Limite de envio do Instagram atingido. Tente em alguns minutos.";
    if (e.codigo === 551 || e.subcodigo === 1545041) return "Essa pessoa não está disponível no Direct (bloqueou ou restringiu a conta).";
    return `Instagram: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Falha ao enviar.";
}
