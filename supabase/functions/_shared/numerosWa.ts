// Lógica pura de "qual sessão do OpenWA atende este envio/leitura" (Central de Automação, /crm/central).
// Sem Deno, sem rede: roda no Deno (edge functions) e no Node (vitest, src/test/crmCentral.test.ts).
//
// CONTRATO COM A PONTE DA VPS (infra/wa-proxy):
//  - Hoje a ponte atende UMA sessão (OPENWA_SESSION_NAME, padrão "closer") e recusa campo desconhecido
//    no corpo (soCampos). Por isso a sessão padrão NUNCA vai no corpo: a chamada fica idêntica à de antes.
//  - Outra sessão só vai à ponte quando o secret WA_PROXY_MULTISESSAO=1 estiver ligado na função, e aí
//    segue como `sessao: "<nome>"` no corpo assinado. A ponte precisa (a) aceitar o campo, (b) ter na
//    allowlist dela essa sessão e (c) ter uma chave operator do OpenWA com permissão nessa sessão.
//  - Sem isso, a função recusa ANTES de chamar a rede, com motivo claro ("sem ponte para a sessão X").

export const SESSAO_PADRAO = "closer";

const NOME_SESSAO = /^[a-z0-9][a-z0-9-]{0,40}$/;

export type DecisaoSessao =
  | { modo: "padrao" }
  | { modo: "explicita"; sessao: string }
  | { modo: "indisponivel"; sessao: string; motivo: string };

export interface OpcoesSessao {
  /** Nome da sessão que a ponte atende sem campo extra (secret WA_SESSAO_PADRAO; padrão "closer"). */
  padrao?: string | null;
  /** WA_PROXY_MULTISESSAO=1: a ponte aceita `sessao` no corpo. */
  multisessao?: boolean;
}

export function decidirSessao(sessao: string | null | undefined, opcoes: OpcoesSessao = {}): DecisaoSessao {
  const padrao = (opcoes.padrao || SESSAO_PADRAO).trim().toLowerCase();
  const s = typeof sessao === "string" ? sessao.trim().toLowerCase() : "";
  if (!s || s === padrao) return { modo: "padrao" };
  if (!NOME_SESSAO.test(s)) return { modo: "indisponivel", sessao: s, motivo: "nome de sessão inválido" };
  if (!opcoes.multisessao) {
    return {
      modo: "indisponivel",
      sessao: s,
      motivo: `sem ponte para a sessão "${s}": a ponte da VPS só atende "${padrao}" (ver README, Central de Automação)`,
    };
  }
  return { modo: "explicita", sessao: s };
}

/** Corpo a assinar para a ponte, ou null quando a sessão não tem ponte (não chamar a rede). */
export function corpoComSessao<T extends Record<string, unknown>>(
  corpo: T,
  sessao: string | null | undefined,
  opcoes: OpcoesSessao = {},
): { corpo: T | (T & { sessao: string }); decisao: DecisaoSessao } | { corpo: null; decisao: DecisaoSessao } {
  const decisao = decidirSessao(sessao, opcoes);
  if (decisao.modo === "padrao") return { corpo, decisao };
  if (decisao.modo === "explicita") return { corpo: { ...corpo, sessao: decisao.sessao }, decisao };
  return { corpo: null, decisao };
}

/** Número cadastrado em crm_numeros, como o envio precisa enxergar. */
export interface NumeroEnvio {
  tipo: "openwa" | "oficial";
  sessao_openwa: string | null;
  ativo: boolean;
}

/**
 * Sessão a usar para um item da fila. numero_id NULL (ou número não encontrado) = padrão.
 * Número oficial ou desativado não envia pelo OpenWA: devolve o motivo e quem chama não envia.
 */
export function sessaoParaEnvio(numero: NumeroEnvio | null | undefined): { sessao: string | null } | { recusa: string } {
  if (!numero) return { sessao: null };
  if (!numero.ativo) return { recusa: "número desativado na Central" };
  if (numero.tipo === "oficial") return { recusa: "número oficial não envia pelo OpenWA (usa template do Full Funnel)" };
  return { sessao: numero.sessao_openwa };
}

// ------------------------------------------------- de qual número veio o webhook (17/10/2026)

/** Número como o openwa-webhook enxerga (crm_numeros). */
export interface NumeroWebhook {
  id: string;
  chave: string;
  tipo: "openwa" | "oficial";
  sessao_openwa: string | null;
  telefone: string | null;
  openwa_session_id: string | null;
}

export type IdentificacaoNumero =
  | {
      numero: NumeroWebhook;
      /** Gravar `sessionId` em crm_numeros.openwa_session_id deste número (primeira vez ou sessão recriada). */
      vincular: boolean;
      por: "session_id" | "url" | "telefone" | "padrao";
    }
  | { erro: string };

const UUID_SESSAO = /^[A-Za-z0-9-]{8,64}$/;

/** Celular BR com e sem o 9 (55 + DDD + 8/9 dígitos) e o próprio número. */
function variantesBR(d: string): string[] {
  const m9 = /^55(\d{2})9(\d{8})$/.exec(d);
  if (m9) return [d, `55${m9[1]}${m9[2]}`];
  const m8 = /^55(\d{2})([6-9]\d{7})$/.exec(d);
  if (m8) return [d, `55${m8[1]}9${m8[2]}`];
  return [d];
}

/**
 * Qual número (crm_numeros) recebeu/mandou a mensagem do webhook. Ordem de confiança:
 *  1) `sessionId` do envelope (assinado pelo HMAC) já vinculado a um número;
 *  2) `?sessao=<nome>` na URL do webhook (headturbo-openwa-webhook-crm --sessao) — vincula o sessionId;
 *  3) o telefone do próprio número no evento (data.to na recebida, data.from na enviada) casando com
 *     crm_numeros.telefone (o whatsapp-qr grava quando o número conecta) — vincula o sessionId;
 *  4) sem sessionId nenhum (OpenWA antigo, teste manual): o número padrão;
 *  5) sessionId desconhecido e sem pista: o padrão SÓ enquanto o padrão não tem sessionId vinculado
 *     (instalação de antes, só o closer mandava webhook). Padrão já vinculado a outro id = erro: a
 *     mensagem NÃO entra na caixa errada (o openwa-webhook responde 500 e o OpenWA reentrega).
 */
export function identificarNumeroDoEvento(
  numeros: NumeroWebhook[],
  ev: { sessionId: string | null; sessaoUrl: string | null; telefoneProprio: string | null },
  padrao: string = SESSAO_PADRAO,
): IdentificacaoNumero {
  const openwa = numeros.filter((n) => n.tipo === "openwa" && n.sessao_openwa);
  const sid = ev.sessionId && UUID_SESSAO.test(ev.sessionId) ? ev.sessionId : null;
  const vincular = (n: NumeroWebhook) => Boolean(sid) && n.openwa_session_id !== sid;

  if (sid) {
    const ja = openwa.find((n) => n.openwa_session_id === sid);
    if (ja) return { numero: ja, vincular: false, por: "session_id" };
  }
  const nomeUrl = (ev.sessaoUrl ?? "").trim().toLowerCase();
  if (nomeUrl) {
    const n = openwa.find((x) => x.sessao_openwa === nomeUrl);
    if (n) return { numero: n, vincular: vincular(n), por: "url" };
  }
  const tel = (ev.telefoneProprio ?? "").replace(/\D/g, "");
  if (/^\d{10,15}$/.test(tel)) {
    const vs = variantesBR(tel);
    const n = openwa.find((x) => x.telefone && vs.includes(x.telefone));
    if (n) return { numero: n, vincular: vincular(n), por: "telefone" };
  }
  const p = openwa.find((n) => n.sessao_openwa === padrao.trim().toLowerCase());
  if (!p) return { erro: `número padrão "${padrao}" não está em crm_numeros` };
  if (!sid) return { numero: p, vincular: false, por: "padrao" };
  if (!p.openwa_session_id) return { numero: p, vincular: false, por: "padrao" };
  return { erro: "sessão do OpenWA desconhecida: cadastre o webhook com --sessao (URL ?sessao=) ou conecte o número na tela Conexões" };
}

