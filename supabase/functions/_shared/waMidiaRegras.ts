// Regras puras do download de mídia do WhatsApp (sem Deno, sem rede): roda igual no vitest e na edge.
//
// Como um erro do proxy vira decisão:
//  - transitório (5xx do proxy/OpenWA, timeout, rede): tenta de novo com espera crescente;
//  - sessão fora do ar (409 "sessao-desconectada" / "Session is not connected"): espera a sessão
//    voltar a `ready` e tenta uma vez; se não voltar, a linha fica pendente SEM gastar tentativa;
//  - definitivo (fora das 100 mais recentes sem arquivo guardado, sem mídia, grande demais, pedido
//    inválido): vira 'falhou' na hora, porque repetir não muda nada;
//  - limite (429): para o lote, sem gastar tentativa;
//  - o resto (404 sem detalhe, erro desconhecido): gasta uma tentativa (até 3, depois 'falhou').

export type TipoErroMidia = "transitorio" | "sessao" | "definitivo" | "limite" | "tentar-depois";

/** Erro de chamada ao proxy, no formato do ErroProxy de waProxy.ts (sem importar Deno). */
export type ErroComStatus = { status: number; detalhe: unknown };

const temStatus = (e: unknown): e is ErroComStatus =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number" && "detalhe" in e;

/** O detalhe do erro como objeto: a rota binária devolve o JSON como texto. */
export function detalheComoObjeto(detalhe: unknown): Record<string, unknown> {
  if (detalhe && typeof detalhe === "object" && !Array.isArray(detalhe)) return detalhe as Record<string, unknown>;
  if (typeof detalhe === "string" && detalhe.trim().startsWith("{")) {
    try {
      const o = JSON.parse(detalhe);
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

const SESSAO_FORA = /session is not connected|not connected|sessao-desconectada|not ready|not active/i;

export function classificarErroMidia(e: unknown): { tipo: TipoErroMidia; msg: string } {
  if (temStatus(e)) {
    const d = detalheComoObjeto(e.detalhe);
    const codigo = typeof d.error === "string" ? d.error : "";
    const msgOpenwa = typeof d.message === "string" ? d.message.slice(0, 120) : "";
    const texto = `${codigo} ${msgOpenwa}`;
    if (e.status === 429) return { tipo: "limite", msg: "proxy 429: limite de leituras" };
    if (e.status === 409 || SESSAO_FORA.test(texto)) {
      return { tipo: "sessao", msg: `sessão do WhatsApp desconectada${msgOpenwa ? `: ${msgOpenwa}` : ""}` };
    }
    if (e.status === 404 && codigo === "fora-da-janela") {
      return {
        tipo: "definitivo",
        msg: "sem arquivo guardado no OpenWA e fora das 100 mensagens mais recentes do chat (o OpenWA v0.24.0 não baixa de novo)",
      };
    }
    if (e.status === 404 && (codigo === "sem-midia" || codigo === "midia-indisponivel")) {
      return { tipo: "definitivo", msg: codigo === "sem-midia" ? "a mensagem não tem mídia no WhatsApp" : "o WhatsApp não entregou a mídia (expirada ou apagada)" };
    }
    if (e.status === 413) return { tipo: "definitivo", msg: "mídia grande demais (teto 25 MB)" };
    if (e.status === 400) return { tipo: "definitivo", msg: `proxy 400${codigo ? `: ${codigo}` : ""}` };
    if (e.status >= 500) return { tipo: "transitorio", msg: `proxy ${e.status}${msgOpenwa ? `: ${msgOpenwa}` : ""}` };
    return { tipo: "tentar-depois", msg: `proxy ${e.status}${codigo ? `: ${codigo}` : ""}` };
  }
  const nome = (e as { name?: unknown })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (nome === "TimeoutError" || nome === "AbortError" || e instanceof TypeError || /timed? ?out|network|fetch failed|connection/i.test(msg)) {
    return { tipo: "transitorio", msg: `rede: ${msg.slice(0, 140)}` };
  }
  return { tipo: "tentar-depois", msg: msg.slice(0, 160) };
}

/** O proxy antigo (sem a rota media-id) responde 404 {"error":"não existe"} antes de conferir a assinatura. */
export function ehRotaInexistente(e: unknown): boolean {
  return temStatus(e) && e.status === 404 && detalheComoObjeto(e.detalhe).error === "não existe";
}

export type DepsDownload<T> = {
  /** Uma ida à rota media-id do proxy. */
  baixar: () => Promise<T>;
  /** Proxy antigo (sem media-id): a rota media de antes (só o arquivo guardado). */
  baixarLegado: () => Promise<T>;
  /** Status da sessão ("ready" = conectada); erro conta como fora do ar. */
  statusSessao: () => Promise<string | null>;
  dormir: (ms: number) => Promise<unknown>;
};

/** Esperas entre tentativas para erro transitório (502, timeout...). */
export const ESPERAS_TRANSITORIO = [1_000, 3_000, 8_000];
/** Espera pela sessão: de 5 em 5 s, até 30 s. */
export const PASSO_SESSAO_MS = 5_000;
export const TETO_SESSAO_MS = 30_000;

/**
 * Baixa com retry: transitório -> espera 1 s, 3 s, 8 s; sessão fora -> espera voltar a `ready` (até 30 s)
 * e tenta uma vez. O erro final sobe como veio (quem chama classifica com classificarErroMidia).
 */
export async function baixarComRetry<T>(deps: DepsDownload<T>, esperas = ESPERAS_TRANSITORIO): Promise<T> {
  let transitorios = 0;
  let esperouSessao = false;
  for (;;) {
    try {
      return await deps.baixar();
    } catch (e) {
      if (ehRotaInexistente(e)) return await deps.baixarLegado();
      const { tipo } = classificarErroMidia(e);
      if (tipo === "transitorio" && transitorios < esperas.length) {
        await deps.dormir(esperas[transitorios++]);
        continue;
      }
      if (tipo === "sessao" && !esperouSessao) {
        esperouSessao = true;
        if (await esperarSessaoPronta(deps)) continue;
      }
      throw e;
    }
  }
}

/** true quando a sessão voltou a `ready` dentro do teto. */
export async function esperarSessaoPronta(
  deps: Pick<DepsDownload<unknown>, "statusSessao" | "dormir">,
  passo = PASSO_SESSAO_MS,
  teto = TETO_SESSAO_MS,
): Promise<boolean> {
  for (let gasto = 0; gasto <= teto; gasto += passo) {
    let st: string | null = null;
    try {
      st = await deps.statusSessao();
    } catch {
      st = null;
    }
    if (st === "ready") return true;
    if (gasto + passo > teto) break;
    await deps.dormir(passo);
  }
  return false;
}

/** O que gravar na linha depois de uma falha (null = não mexer na linha: sessão/limite não gastam tentativa). */
export function atualizacaoDeFalha(
  tentativasAntes: number,
  tipo: TipoErroMidia,
  msg: string,
  maxTentativas: number,
): { media_tentativas: number; media_status: "pendente" | "falhou"; media_erro: string } {
  const erro = msg.slice(0, 300);
  if (tipo === "sessao" || tipo === "limite") {
    return { media_tentativas: tentativasAntes, media_status: "pendente", media_erro: erro };
  }
  if (tipo === "definitivo") {
    return { media_tentativas: Math.max(tentativasAntes + 1, maxTentativas), media_status: "falhou", media_erro: erro };
  }
  const t = tentativasAntes + 1;
  return { media_tentativas: t, media_status: t >= maxTentativas ? "falhou" : "pendente", media_erro: erro };
}
