// 20/10/2026, caso Sabrina: o throttler do OpenWA (1000/h por IP e por rota, bloqueio de 1 h) travou o GET de
// status e o pedido de código desistia antes de pedir. Testa o cache/orçamento de status/qr no proxy e a
// leitura de status tolerante a 429 da whatsapp-qr {acao:"codigo"}.
import { describe, expect, it, vi } from "vitest";
import {
  CACHE_ESTADO_MS, LeituraDeEstado, ORCAMENTO_ESTADO_HORA, ORCAMENTO_ESTADO_MINUTO, ROTAS_DE_ESTADO, ROTAS_DE_ENVIO,
  esperaDo429, LIMITE_MINUTO, LIMITE_DIA,
} from "../../infra/wa-proxy/lib.mjs";
import {
  ESPERA_RELER_STATUS_MS, lerStatusParaCodigo, mensagemErroCodigo, mensagemErroStatusCodigo, segundosDeEspera, textoEspera,
} from "../../supabase/functions/_shared/codigoPareamentoWa";

const B = "http://openwa-api:2785/api";

describe("proxy: leitura de estado (status/qr)", () => {
  it("só status e qr passam pelo cache; envio continua com os limites de antes", () => {
    expect([...ROTAS_DE_ESTADO].sort()).toEqual(["qr", "status"]);
    for (const r of ROTAS_DE_ENVIO) expect(ROTAS_DE_ESTADO.has(r)).toBe(false);
    expect(LIMITE_MINUTO).toBe(20);
    expect(LIMITE_DIA).toBe(300);
  });

  it("orçamento fica abaixo do throttler do OpenWA (1000/h, 100/min)", () => {
    expect(ORCAMENTO_ESTADO_HORA).toBeLessThan(1000);
    expect(ORCAMENTO_ESTADO_MINUTO).toBeLessThan(100);
  });

  it("várias telas no mesmo número dentro do TTL = 1 ida ao OpenWA", () => {
    const e = new LeituraDeEstado();
    expect(e.consultar("status", B, "comercial-sabrina", 0).usar).toBe("openwa");
    e.guardar("status", B, "comercial-sabrina", { status: "qr_ready", phone: null }, 0);
    const d = e.consultar("status", B, "comercial-sabrina", CACHE_ESTADO_MS.status - 1);
    expect(d).toEqual({ usar: "cache", corpo: { status: "qr_ready", phone: null } });
    expect(e.consultar("status", B, "comercial-sabrina", CACHE_ESTADO_MS.status).usar).toBe("openwa");
  });

  it("cache é por sessão e por rota", () => {
    const e = new LeituraDeEstado();
    e.guardar("status", B, "a", { status: "ready", phone: "553100000000" }, 0);
    expect(e.consultar("status", B, "b", 1).usar).toBe("openwa");
    expect(e.consultar("qr", B, "a", 1).usar).toBe("openwa");
  });

  it("32 leituras/min por 1 h (o cenário do incidente) nunca passam de 700 idas ao OpenWA", () => {
    const e = new LeituraDeEstado();
    let idas = 0;
    for (let t = 0; t < 3_600_000; t += 1875) { // 32/min, alternando 4 sessões
      const s = `s${(t / 1875) % 4}`;
      const d = e.consultar("status", B, s, t);
      if (d.usar === "openwa") { idas++; e.guardar("status", B, s, { status: "qr_ready", phone: null }, t); }
    }
    expect(idas).toBeLessThanOrEqual(ORCAMENTO_ESTADO_HORA);
  });

  it("sem orçamento: devolve o último valor (velho) ou 429 com retryAfter", () => {
    const e = new LeituraDeEstado({ porMinuto: 2, porHora: 100 });
    expect(e.consultar("status", B, "x", 0).usar).toBe("openwa");
    e.guardar("status", B, "x", { status: "qr_ready", phone: null }, 0);
    expect(e.consultar("status", B, "y", 10).usar).toBe("openwa");
    const velho = e.consultar("status", B, "x", 10_000);
    expect(velho).toMatchObject({ usar: "velho", corpo: { status: "qr_ready" }, idadeS: 10 });
    const recusa = e.consultar("status", B, "z", 10_000);
    expect(recusa.usar).toBe("recusa");
    expect(recusa.retryAfter).toBe(50);
  });

  it("429 do OpenWA: para de bater até o Retry-After", () => {
    const e = new LeituraDeEstado();
    expect(e.bloquear("status", B, 2400, 0)).toBe(2400);
    const d = e.consultar("status", B, "x", 1000);
    expect(d.usar).toBe("recusa");
    expect(d.retryAfter).toBe(2399);
    expect(e.consultar("qr", B, "x", 1000).usar).toBe("openwa"); // qr é outra rota no OpenWA
    expect(e.consultar("status", B, "x", 2_400_001).usar).toBe("openwa");
  });

  it("esperaDo429 lê o maior Retry-After-* do throttler do Nest", () => {
    const h = new Headers({ "retry-after-long": "2379", "retry-after-short": "1" });
    expect(esperaDo429((n: string) => h.get(n))).toBe(2379);
    expect(esperaDo429(() => null)).toBe(60);
  });
});

describe("whatsapp-qr: status antes do código não barra por 429", () => {
  const erro = (status: number, detalhe: unknown) => Object.assign(new Error("x"), { status, detalhe });
  const semEspera = vi.fn(async () => {});

  it("status ok segue normal", async () => {
    expect(await lerStatusParaCodigo(async () => ({ status: "qr_ready" }), semEspera)).toEqual({ state: "qr_ready", limitado: false });
  });

  it("429 curto: relê uma vez após 1,5 s", async () => {
    const esperar = vi.fn(async () => {});
    const ler = vi.fn()
      .mockRejectedValueOnce(erro(429, { error: "muitas consultas", retryAfter: 1 }))
      .mockResolvedValueOnce({ status: "qr_ready" });
    expect(await lerStatusParaCodigo(ler, esperar)).toEqual({ state: "qr_ready", limitado: false });
    expect(esperar).toHaveBeenCalledWith(ESPERA_RELER_STATUS_MS);
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("429 longo (bloqueio de 1 h do OpenWA): não espera, segue para o código", async () => {
    const esperar = vi.fn(async () => {});
    const ler = vi.fn().mockRejectedValue(erro(429, { error: "openwa", status: 429, retryAfter: 2379 }));
    expect(await lerStatusParaCodigo(ler, esperar)).toEqual({ state: "desconhecido", limitado: true });
    expect(esperar).not.toHaveBeenCalled();
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("429 duas vezes: segue limitado", async () => {
    const ler = vi.fn().mockRejectedValue(erro(429, {}));
    expect(await lerStatusParaCodigo(ler, semEspera)).toEqual({ state: "desconhecido", limitado: true });
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("proxy fora (502) ainda barra, com mensagem real", async () => {
    const r = await lerStatusParaCodigo(async () => { throw erro(502, null); }, semEspera);
    expect(r).toEqual({ erro: { status: 502, detalhe: null } });
    expect(mensagemErroStatusCodigo(502, null)).toMatch(/não respondeu a tempo/);
    expect(mensagemErroStatusCodigo(401, null)).toMatch(/assinatura/);
  });

  it("mensagens de 429 dizem quanto esperar", () => {
    expect(mensagemErroCodigo(429, { error: "limite de códigos por minuto", retryAfter: 40 })).toBe("Muitos códigos pedidos em pouco tempo. Tente de novo em 40 s.");
    expect(mensagemErroCodigo(429, { error: "openwa", status: 429, retryAfter: 2379 })).toMatch(/segurando pedidos.*40 min/);
    expect(segundosDeEspera("12")).toBe(12);
    expect(segundosDeEspera(-1)).toBeNull();
    expect(textoEspera(89)).toBe("89 s");
    expect(textoEspera(120)).toBe("2 min");
  });
});
