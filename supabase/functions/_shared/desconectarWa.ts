// Desconectar um número de WhatsApp pela tela /crm/conexoes (21/10/2026).
// Lógica pura (sem Deno, sem rede): usada pela whatsapp-qr ({acao:"desconectar"}) e testada no vitest.
//
// O que acontece de verdade: o proxy da VPS chama POST /sessions/{id}/logout no OpenWA (desvincula o aparelho e
// apaga a credencial guardada; a sessão continua existindo no OpenWA) e, em seguida, POST /sessions/{id}/start,
// para a sessão voltar a mostrar QR. Nada do CRM é apagado: mensagens, contatos e a linha de crm_numeros ficam.
import { segundosDeEspera, textoEspera } from "./codigoPareamentoWa.ts";

/** Quem pode desconectar: usuário aprovado E (admin ou com a liberação Comercial). */
export function podeDesconectar(aprovado: unknown, comercial: unknown): boolean {
  return aprovado === true && comercial === true;
}

export interface NumeroDesconectar {
  apelido?: string | null;
  tipo: string;
  sessao_openwa: string | null;
  ativo?: boolean | null;
}

const NOME_SESSAO = /^[a-z0-9_-]{1,64}$/;

/**
 * Valida o pedido contra crm_numeros: a sessão tem que ser de um número OpenWA cadastrado. Número oficial
 * (Full Funnel) não tem sessão e não desconecta por aqui.
 */
export function numeroParaDesconectar(
  sessao: unknown,
  numeros: NumeroDesconectar[],
): { sessao: string; numero: NumeroDesconectar } | { error: string; status: number } {
  const s = typeof sessao === "string" ? sessao.trim().toLowerCase() : "";
  if (!s || !NOME_SESSAO.test(s)) return { error: "Sessão inválida", status: 400 };
  const numero = numeros.find((n) => (n.sessao_openwa ?? "").trim().toLowerCase() === s);
  if (!numero) return { error: "Este número não está cadastrado nas Conexões do CRM", status: 404 };
  if (numero.tipo !== "openwa") return { error: "O número oficial não usa QR Code e não desconecta por aqui", status: 400 };
  return { sessao: s, numero };
}

/** O que a função devolve ao front depois de um 200 do proxy. */
export function resultadoDesconectar(corpoProxy: unknown): { desconectado: true; state: string; aviso: string | null } {
  const d = (corpoProxy && typeof corpoProxy === "object" ? corpoProxy : {}) as Record<string, unknown>;
  const reiniciada = d.reiniciada === true;
  const bruto = typeof d.status === "string" ? d.status.toLowerCase() : "";
  // depois do logout o número nunca está "ready": se o start não respondeu um estado conhecido, fica "disconnected"
  const state = reiniciada && (bruto === "initializing" || bruto === "qr_ready") ? bruto : reiniciada ? "initializing" : "disconnected";
  const aviso = typeof d.aviso === "string" ? d.aviso : null;
  return { desconectado: true, state, aviso };
}

/** Erro do proxy em texto para a pessoa. */
export function mensagemErroDesconectar(status: number, detalhe: unknown): string {
  const d = (detalhe && typeof detalhe === "object" ? detalhe : {}) as Record<string, unknown>;
  const doProxy = typeof d.error === "string" ? d.error : "";
  if (status === 404 && doProxy === "não existe") {
    return "A ponte da VPS ainda não tem a opção de desconectar (falta aplicar a atualização do proxy).";
  }
  if (status === 429) {
    const espera = segundosDeEspera(d.retryAfter);
    return `Muitas tentativas de desconectar agora. Tente de novo${espera ? ` em ${textoEspera(espera)}` : " daqui a pouco"}.`;
  }
  if (status === 401) return "A ponte da VPS recusou a chamada (assinatura). Avise o suporte técnico.";
  if (status === 503) return "A ponte da VPS não tem a chave desta sessão.";
  if (status === 504) return "O WhatsApp demorou para responder. Confira o status do número e tente de novo em 1 minuto.";
  // 400/409/502 do proxy já vêm com texto legível (ver infra/wa-proxy/lib.mjs, respostaDesconectar)
  if (doProxy && doProxy !== "openwa" && doProxy !== "não autorizado") return doProxy;
  if (status >= 500) return "A ponte da VPS não respondeu agora. Tente de novo em 1 minuto.";
  return `Não consegui desconectar (resposta ${status}).`;
}

/** Status HTTP que a função devolve ao front para cada erro do proxy. */
export function statusErroDesconectar(status: number): number {
  return [400, 404, 409, 429].includes(status) ? status : 502;
}
