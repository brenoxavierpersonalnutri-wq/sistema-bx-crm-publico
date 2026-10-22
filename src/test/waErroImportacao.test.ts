// 20/10/2026: depois de reconectar o número pessoal (closer), o chats-recentes estourava o teto fixo de 25 s do
// proxy (WhatsApp sincronizando), voltava 502 "falha no proxy" e o CRM mostrava "Edge Function returned a non-2xx
// status code". Aqui: o erro do proxy vira texto legível na edge function, o front lê o corpo da resposta e, ao
// conectar, tenta de novo uma vez quando o erro é transitório.
import { describe, it, expect, vi } from "vitest";
import { erroDoProxyParaCrm } from "../../supabase/functions/_shared/waErro.ts";
import { respostaDeFalha, temposDoProxy, timeoutDoPedido } from "../../infra/wa-proxy/lib.mjs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { ErroImportacao, erroDaImportacao, trazerConversasAoConectar } from "@/lib/crm/fonteConversas";

class ErroProxyFalso extends Error {
  constructor(public status: number, public detalhe: unknown) { super(`proxy respondeu ${status}`); }
}

describe("proxy: tempos e falhas", () => {
  it("chats-recentes tem teto próprio de 50 s na lista; o resto segue 25 s", () => {
    const t = temposDoProxy({});
    expect(t).toEqual({ padrao: 25_000, listaRecentes: 50_000, totalRecentes: 72_000 });
    expect(timeoutDoPedido({ chatsRecentes: { limit: 80, porChat: 20 } }, t)).toBe(50_000);
    expect(timeoutDoPedido({}, t)).toBe(25_000);
    expect(timeoutDoPedido({ pareamento: true }, t)).toBe(80_000);
    expect(timeoutDoPedido({ comMidia: true }, t)).toBe(55_000);
  });
  it("lista + histórico cabem nos 80 s que a edge function espera", () => {
    const t = temposDoProxy({});
    expect(t.listaRecentes).toBeLessThan(t.totalRecentes);
    expect(t.totalRecentes).toBeLessThan(80_000);
  });
  it("valor de ambiente inválido = padrão", () => {
    expect(temposDoProxy({ OPENWA_TIMEOUT_LISTA_RECENTES_MS: "abc", OPENWA_TIMEOUT_PADRAO_MS: "999999" }).listaRecentes).toBe(50_000);
    expect(temposDoProxy({ OPENWA_TIMEOUT_PADRAO_MS: "999999" }).padrao).toBe(25_000);
  });
  it("timeout do OpenWA = 504 com o motivo, não 502 'falha no proxy'", () => {
    const e = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const r = respostaDeFalha(e);
    expect(r.status).toBe(504);
    expect(r.corpo.motivo).toBe("timeout");
    expect(r.corpo.error).toMatch(/sincronizando/);
  });
  it("OpenWA fora do ar = 502 legível; 413/503 seguem como antes; erro cru não vaza", () => {
    expect(respostaDeFalha(new TypeError("fetch failed")).corpo.motivo).toBe("openwa-fora");
    expect(respostaDeFalha({ status: 413 })).toEqual({ status: 413, corpo: { error: "corpo grande demais" } });
    expect(respostaDeFalha({ status: 503 })).toEqual({ status: 503, corpo: { error: "sessão sem chave no proxy" } });
    expect(respostaDeFalha(new Error("http://headturbo-openwa-api:2785 segredo"))).toEqual({ status: 502, corpo: { error: "falha no proxy" } });
  });
});

describe("edge function: erro do proxy -> texto para o CRM", () => {
  it("504 do proxy repassa o motivo dele", () => {
    const r = erroDoProxyParaCrm(new ErroProxyFalso(504, { error: "O WhatsApp demorou para responder (x).", motivo: "timeout" }));
    expect(r).toEqual({ status: 504, error: "O WhatsApp demorou para responder (x).", motivo: "timeout" });
  });
  it("timeout da própria edge function = 504 sincronizando", () => {
    const r = erroDoProxyParaCrm(new DOMException("t", "TimeoutError"));
    expect(r.status).toBe(504);
    expect(r.motivo).toBe("timeout");
  });
  it("429 = limite; 502 genérico ganha contexto; mensagem do OpenWA aparece", () => {
    expect(erroDoProxyParaCrm(new ErroProxyFalso(429, {})).motivo).toBe("limite");
    expect(erroDoProxyParaCrm(new ErroProxyFalso(502, { error: "falha no proxy" })).error)
      .toBe("Não consegui listar as conversas no WhatsApp: falha no proxy");
    expect(erroDoProxyParaCrm(new ErroProxyFalso(409, { error: "openwa", status: 409, message: "Session not ready" })).error)
      .toBe("Não consegui listar as conversas no WhatsApp: OpenWA: Session not ready");
  });
  it("401 do proxy = segredo diferente (não é culpa do número)", () => {
    expect(erroDoProxyParaCrm(new ErroProxyFalso(401, { error: "não autorizado" })).error).toMatch(/assinatura/);
  });
});

describe("front: corpo da resposta no lugar de 'non-2xx'", () => {
  const httpErro = (status: number, corpo: unknown) =>
    Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify(corpo), { status }) });

  it("lê error e motivo do corpo", async () => {
    const e = await erroDaImportacao(httpErro(504, { error: "O WhatsApp demorou para responder.", motivo: "timeout" }));
    expect(e).toBeInstanceOf(ErroImportacao);
    expect(e.message).toBe("O WhatsApp demorou para responder.");
    expect(e.status).toBe(504);
    expect(e.transitorio).toBe(true);
    expect(e.message).not.toMatch(/non-2xx/);
  });
  it("corpo sem error: diz o status, nunca 'non-2xx'", async () => {
    const e = await erroDaImportacao(httpErro(500, {}));
    expect(e.message).toMatch(/500/);
    expect(e.transitorio).toBe(false);
  });
  it("404 número não encontrado não é transitório", async () => {
    const e = await erroDaImportacao(httpErro(404, { error: "número não encontrado" }));
    expect(e.message).toBe("número não encontrado");
    expect(e.transitorio).toBe(false);
  });
});

describe("ao conectar: tenta de novo uma vez se for transitório", () => {
  const ok = { chats: 40, imported: 300, fotos: 0 };
  it("timeout -> avisa, espera, segunda tentativa traz", async () => {
    const trazer = vi.fn()
      .mockRejectedValueOnce(new ErroImportacao("sincronizando", 504, "timeout"))
      .mockResolvedValueOnce(ok);
    const dormir = vi.fn().mockResolvedValue(undefined);
    const aoEsperar = vi.fn();
    await expect(trazerConversasAoConectar("n1", { trazer, dormir, aoEsperar, esperaMs: 60_000 })).resolves.toEqual(ok);
    expect(trazer).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledWith(60_000);
    expect(aoEsperar).toHaveBeenCalledTimes(1);
  });
  it("erro definitivo não repete", async () => {
    const trazer = vi.fn().mockRejectedValue(new ErroImportacao("número não encontrado", 404, null));
    const dormir = vi.fn();
    await expect(trazerConversasAoConectar("n1", { trazer, dormir })).rejects.toThrow("número não encontrado");
    expect(trazer).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });
  it("só UMA nova tentativa: o segundo erro sobe com o texto real", async () => {
    const trazer = vi.fn().mockRejectedValue(new ErroImportacao("sincronizando", 504, "timeout"));
    await expect(trazerConversasAoConectar("n1", { trazer, dormir: async () => {} })).rejects.toThrow("sincronizando");
    expect(trazer).toHaveBeenCalledTimes(2);
  });
});
