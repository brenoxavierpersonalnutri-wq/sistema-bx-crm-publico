// IA do CRM no Claude (Anthropic): conversor chat -> Messages API, leitura da resposta (thinking + text,
// refusal), tradução de erro (401/429/529/crédito), modelo antigo -> Sonnet, pareamento da chave e o
// erro mostrado na tela. fetch é falso: nada sai daqui.
import { describe, expect, it, vi } from "vitest";
import {
  chamarAnthropic,
  converterParaAnthropic,
  erroDaAnthropic,
  ErroIA,
  extrairTexto,
  lerChaveGuardada,
  MODELO_CONVERSA,
  MODELO_RESUMO,
  MODELOS_CLAUDE,
  PERFIS,
  resolverModelo,
  semChave,
  URL_ANTHROPIC,
  validarCorpoAnthropic,
  VERSAO_ANTHROPIC,
} from "../../supabase/functions/_shared/anthropic";
import { mensagemErroIA } from "@/lib/crm/iaClaude";

const CHAVE = "sk-ant-api03-" + "A".repeat(40) + "_bc-d";
const OPC = { modelo: "claude-sonnet-5-5", maxTokens: 1000, esforco: "medium" as const };

describe("converterParaAnthropic", () => {
  it("tira os system da lista e junta no campo system, na ordem", () => {
    const p = converterParaAnthropic(
      [
        { role: "system", content: "regra 1" },
        { role: "user", content: "oi" },
        { role: "system", content: "regra 2" },
      ],
      OPC,
    );
    expect(p.system).toBe("regra 1\n\nregra 2");
    expect(p.messages).toEqual([{ role: "user", content: "oi" }]);
    expect(p).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 1000, output_config: { effort: "medium" } });
  });

  it("não manda temperature, top_p nem thinking (a geração 5.5 recusa)", () => {
    const p = converterParaAnthropic([{ role: "user", content: "oi" }], OPC) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("temperature");
    expect(p).not.toHaveProperty("top_p");
    expect(p).not.toHaveProperty("thinking");
  });

  it("junta papéis repetidos em sequência e descarta mensagens vazias", () => {
    const p = converterParaAnthropic(
      [
        { role: "user", content: "oi" },
        { role: "user", content: "  " },
        { role: "user", content: "tudo bem?" },
        { role: "assistant", content: "tudo" },
        { role: "assistant", content: "e você?" },
        { role: "user", content: "bem" },
      ],
      OPC,
    );
    expect(p.messages).toEqual([
      { role: "user", content: "oi\n\ntudo bem?" },
      { role: "assistant", content: "tudo\n\ne você?" },
      { role: "user", content: "bem" },
    ]);
  });

  it("conversa que começa com mensagem nossa ganha um marcador de user antes", () => {
    const p = converterParaAnthropic(
      [{ role: "assistant", content: "Oi, Maria!" }, { role: "user", content: "oi" }],
      OPC,
    );
    expect(p.messages[0]).toEqual({ role: "user", content: "(início da conversa)" });
    expect(p.messages).toHaveLength(3);
  });

  it("sem system não manda o campo; terminar em assistant (prefill) ou vazio é erro", () => {
    expect(converterParaAnthropic([{ role: "user", content: "oi" }], OPC)).not.toHaveProperty("system");
    expect(() => converterParaAnthropic([{ role: "user", content: "oi" }, { role: "assistant", content: "x" }], OPC)).toThrow(/última mensagem/);
    expect(() => converterParaAnthropic([{ role: "system", content: "só regra" }], OPC)).toThrow(/vazia/);
  });
});

describe("extrairTexto", () => {
  it("lê só os blocos text, pulando thinking", () => {
    expect(
      extrairTexto({
        content: [{ type: "thinking", text: "pensando" }, { type: "text", text: "Olá" }, { type: "text", text: ", Maria" }],
        stop_reason: "end_turn",
      }),
    ).toBe("Olá, Maria");
  });

  it("refusal vira erro com a categoria", () => {
    expect(() => extrairTexto({ content: [], stop_reason: "refusal", stop_details: { category: "bio" } })).toThrow(/recusou.*\(bio\)/);
  });

  it("sem texto: avisa se foi o limite de tokens", () => {
    expect(() => extrairTexto({ content: [{ type: "thinking" }], stop_reason: "max_tokens" })).toThrow(/limite de tokens/);
    expect(() => extrairTexto({ content: [] })).toThrow(/vazia/);
  });
});

describe("erroDaAnthropic", () => {
  const corpo = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });

  it("401: chave inválida, com o caminho do conserto", () => {
    const e = erroDaAnthropic(401, corpo("authentication_error", "invalid x-api-key"));
    expect(e).toBeInstanceOf(ErroIA);
    expect(e.status).toBe(401);
    expect(e.detalhe).toMatch(/chave da Anthropic inválida/);
  });

  it("429: limite de uso", () => {
    expect(erroDaAnthropic(429, corpo("rate_limit_error", "Number of requests has exceeded")).detalhe).toMatch(/limite de uso/);
  });

  it("529 e overloaded_error: sobrecarregada", () => {
    expect(erroDaAnthropic(529, corpo("overloaded_error", "Overloaded")).detalhe).toMatch(/sobrecarregada/);
    expect(erroDaAnthropic(503, corpo("overloaded_error", "Overloaded")).detalhe).toMatch(/sobrecarregada/);
  });

  it("crédito acabou (400 credit balance): manda recarregar", () => {
    const e = erroDaAnthropic(400, corpo("invalid_request_error", "Your credit balance is too low to access the Anthropic API."));
    expect(e.detalhe).toMatch(/crédito da conta Anthropic acabou/);
  });

  it("400 comum traz o motivo; 500 é instabilidade; corpo não-JSON não quebra", () => {
    expect(erroDaAnthropic(400, corpo("invalid_request_error", "max_tokens: too big")).detalhe).toMatch(/recusou o pedido: max_tokens/);
    expect(erroDaAnthropic(500, "<html>").detalhe).toMatch(/instável \(erro 500\)/);
  });

  it("nunca devolve a chave, mesmo se ela vier no corpo do erro", () => {
    const e = erroDaAnthropic(400, corpo("invalid_request_error", `bad key ${CHAVE}`));
    expect(e.detalhe).not.toContain(CHAVE);
    expect(e.detalhe).toContain("sk-ant-***");
    expect(semChave(`a ${CHAVE} b`)).toBe("a sk-ant-*** b");
  });
});

describe("chamarAnthropic", () => {
  const resposta = (status: number, corpo: unknown) =>
    new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

  it("monta a requisição certa e devolve o texto", async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, { content: [{ type: "thinking" }, { type: "text", text: "Oi!" }], stop_reason: "end_turn" }));
    const texto = await chamarAnthropic({
      chave: CHAVE,
      mensagens: [{ role: "system", content: "sys" }, { role: "user", content: "oi" }],
      modelo: "claude-haiku-5-5", maxTokens: 500, esforco: "low", timeoutMs: 1000,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(texto).toBe("Oi!");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_ANTHROPIC);
    expect(init.headers).toMatchObject({ "x-api-key": CHAVE, "anthropic-version": VERSAO_ANTHROPIC, "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      model: "claude-haiku-5-5", max_tokens: 500, system: "sys",
      messages: [{ role: "user", content: "oi" }], output_config: { effort: "low" },
    });
  });

  it("erro HTTP vira ErroIA traduzido", async () => {
    const f = vi.fn().mockResolvedValue(resposta(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
    await expect(
      chamarAnthropic({ chave: CHAVE, mensagens: [{ role: "user", content: "oi" }], modelo: "x", maxTokens: 1, esforco: "low", timeoutMs: 1000, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 529, detalhe: expect.stringMatching(/sobrecarregada/) });
  });

  it("timeout vira 504 com os segundos; sem chave nem chama a rede", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const f = vi.fn().mockRejectedValue(timeout);
    await expect(
      chamarAnthropic({ chave: CHAVE, mensagens: [{ role: "user", content: "oi" }], modelo: "x", maxTokens: 1, esforco: "low", timeoutMs: 45_000, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 504, detalhe: expect.stringMatching(/45 s/) });
    const g = vi.fn();
    await expect(
      chamarAnthropic({ chave: "", mensagens: [{ role: "user", content: "oi" }], modelo: "x", maxTokens: 1, esforco: "low", timeoutMs: 1, fetchImpl: g as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 503 });
    expect(g).not.toHaveBeenCalled();
  });
});

describe("modelos", () => {
  it("padrões: Sonnet na conversa, Haiku no resumo; seletor com Sonnet primeiro", () => {
    expect(MODELO_CONVERSA).toBe("claude-sonnet-5-5");
    expect(MODELO_RESUMO).toBe("claude-haiku-5-5");
    expect(PERFIS.conversa.modelo).toBe("claude-sonnet-5-5");
    expect(PERFIS.resumo.modelo).toBe("claude-haiku-5-5");
    expect(MODELOS_CLAUDE.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]);
  });

  it("valor antigo (google/*, openai/*, vazio) vira o padrão; Claude da lista passa", () => {
    expect(resolverModelo("google/gemini-2.5-flash")).toBe("claude-sonnet-5-5");
    expect(resolverModelo("google/gemini-2.5-pro")).toBe("claude-sonnet-5-5");
    expect(resolverModelo("openai/gpt-5")).toBe("claude-sonnet-5-5");
    expect(resolverModelo(null)).toBe("claude-sonnet-5-5");
    expect(resolverModelo("")).toBe("claude-sonnet-5-5");
    expect(resolverModelo("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(resolverModelo(" claude-haiku-5-5 ")).toBe("claude-haiku-5-5");
    expect(resolverModelo("google/x", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
});

describe("pareamento da chave", () => {
  it("valida o corpo e normaliza para {api_key}", () => {
    expect(validarCorpoAnthropic(JSON.stringify({ api_key: ` ${CHAVE} ` }))).toEqual({ ok: true, valor: JSON.stringify({ api_key: CHAVE }) });
    expect(validarCorpoAnthropic("x")).toMatchObject({ ok: false });
    expect(validarCorpoAnthropic("[]")).toMatchObject({ ok: false });
    expect(validarCorpoAnthropic(JSON.stringify({ api_key: "sk-proj-abc" }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/sk-ant/) });
  });

  it("o corpo canônico é o mesmo que o script da VPS assina (hash bate)", () => {
    // headturbo-anthropic-parear: json.dumps({"api_key": chave}, separators=(",", ":"))
    const v = validarCorpoAnthropic(JSON.stringify({ api_key: CHAVE }));
    expect(v.ok && v.valor).toBe(`{"api_key":"${CHAVE}"}`);
  });

  it("lê a chave guardada (JSON ou texto) e recusa lixo", () => {
    expect(lerChaveGuardada(JSON.stringify({ api_key: CHAVE }))).toBe(CHAVE);
    expect(lerChaveGuardada(CHAVE)).toBe(CHAVE);
    expect(lerChaveGuardada("{quebrado")).toBeNull();
    expect(lerChaveGuardada(null)).toBeNull();
    expect(lerChaveGuardada(JSON.stringify({ api_key: "abc" }))).toBeNull();
  });
});

describe("mensagemErroIA (tela)", () => {
  it("mostra o motivo que a função devolveu no corpo do 502", async () => {
    const ctx = new Response(JSON.stringify({ error: "IA (Claude): o crédito da conta Anthropic acabou" }), { status: 502 });
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: ctx });
    expect(await mensagemErroIA(err, null)).toBe("IA (Claude): o crédito da conta Anthropic acabou");
  });

  it("data.error tem prioridade; função fora do ar tem aviso próprio", async () => {
    expect(await mensagemErroIA(null, { error: "x" })).toBe("x");
    expect(await mensagemErroIA(Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" }))).toMatch(/não respondeu/);
  });
});
