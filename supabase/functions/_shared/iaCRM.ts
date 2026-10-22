// Ponto único de IA do CRM (Deno): toda chamada de IA das functions do CRM passa por aqui e vai para o
// Claude da Anthropic (crédito da conta do Breno). Substitui o antigo iaGateway.ts (gateway do Lovable/Gemini).
//
// A chave vem, nesta ordem:
//   1. Deno.env ANTHROPIC_API_KEY (secret da função, se um dia for posto no painel);
//   2. integracao_config.anthropic_api_key, gravada UMA vez pela VPS via anthropic-pareamento
//      (o Breno nunca cola a chave em chat nem no painel).
// A tabela integracao_config só é legível pelo service_role, por isso a leitura usa a service role key.
// A chave nunca é logada nem devolvida: os erros saem de anthropic.ts já sem ela.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chamarAnthropic,
  ErroIA,
  lerChaveGuardada,
  type MensagemChat,
  PERFIS,
  resolverModelo,
  type Tarefa,
  type UsoTokens,
} from "./anthropic.ts";

export { ErroIA, type MensagemChat } from "./anthropic.ts";

let cache: { chave: string; ate: number } | null = null;
const CACHE_MS = 5 * 60_000;

export async function chaveAnthropic(): Promise<string> {
  const doEnv = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (doEnv) return doEnv;
  if (cache && cache.ate > Date.now()) return cache.chave;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.from("integracao_config").select("valor").eq("chave", "anthropic_api_key").maybeSingle();
  if (error) throw new ErroIA(500, "não consegui ler a configuração da Anthropic no banco");
  const chave = lerChaveGuardada(data?.valor);
  if (!chave) throw new ErroIA(503, "chave da Anthropic não configurada: rode o pareamento na VPS (anthropic-parear)");
  cache = { chave, ate: Date.now() + CACHE_MS };
  return chave;
}

/**
 * Completa um chat (system + mensagens) com o Claude e devolve o texto.
 * tarefa "conversa" (simulador e robô do WhatsApp): Sonnet 5.5 por padrão, ou o modelo do agente;
 * tarefa "resumo" (feedback semanal e afins): Haiku 5.5.
 * Modelo antigo (google/*, openai/*) cai no padrão da tarefa.
 */
export async function completarChatCRM(
  mensagens: MensagemChat[],
  opcoes: { tarefa: Tarefa; modelo?: string | null; aoUsar?: (u: UsoTokens) => void },
): Promise<string> {
  const perfil = PERFIS[opcoes.tarefa];
  const chave = await chaveAnthropic();
  try {
    return await chamarAnthropic({
      chave,
      mensagens,
      modelo: resolverModelo(opcoes.modelo, perfil.modelo),
      maxTokens: perfil.maxTokens,
      esforco: perfil.esforco,
      timeoutMs: perfil.timeoutMs,
      aoUsar: opcoes.aoUsar,
    });
  } catch (e) {
    // chave revogada: esquece o cache para o próximo pareamento valer sem esperar 5 min
    if (e instanceof ErroIA && e.status === 401) cache = null;
    throw e;
  }
}
