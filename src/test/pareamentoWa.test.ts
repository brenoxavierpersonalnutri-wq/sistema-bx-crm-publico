// Pareamento CRM <-> VPS: janela, uso único e origem (IP da VPS), incluindo tentativas de forjar.
import { describe, it, expect } from "vitest";
import {
  decidirPareamento, origemPermitida, normalizarIp, ipInterno, ipCloudflare, IP_VPS,
} from "../../supabase/functions/_shared/pareamentoWa";

const cab = (h: Record<string, string>) => (n: string) => h[n] ?? null;
const AGORA = Date.parse("2026-10-17T20:00:00Z");
const ABERTA = { abertoAte: "2026-10-17T20:20:00Z", pareadoEm: null };

describe("origemPermitida", () => {
  it("aceita cf-connecting-ip da VPS, mesmo com XFF trazendo salto AWS/interno", () => {
    expect(origemPermitida(cab({ "cf-connecting-ip": IP_VPS })).ok).toBe(true);
    // caso real de 17/10/2026: a Supabase acrescenta um salto AWS no fim do XFF
    expect(origemPermitida(cab({ "cf-connecting-ip": IP_VPS, "x-forwarded-for": `${IP_VPS}, 99.83.99.150` })).ok).toBe(true);
    expect(origemPermitida(cab({ "cf-connecting-ip": IP_VPS, "x-real-ip": "99.83.99.150", "x-forwarded-for": `${IP_VPS}, 10.0.3.4, 99.83.99.150` })).ok).toBe(true);
    expect(origemPermitida(cab({ "cf-connecting-ip": `::ffff:${IP_VPS}` })).ok).toBe(true);
    // lixo em cabeçalho que não decide não derruba
    expect(origemPermitida(cab({ "cf-connecting-ip": IP_VPS, "x-forwarded-for": "unknown" })).ok).toBe(true);
  });

  it("recusa XFF/x-real-ip forjados com o IP da VPS quando cf-connecting-ip é outro", () => {
    expect(origemPermitida(cab({ "cf-connecting-ip": "200.1.2.3", "x-forwarded-for": IP_VPS })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "200.1.2.3", "x-real-ip": IP_VPS, "x-forwarded-for": `${IP_VPS}, ${IP_VPS}` })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "2804:14c::1", "x-forwarded-for": IP_VPS })).ok).toBe(false);
  });

  it("recusa sem cf-connecting-ip (mesmo com XFF/x-real-ip da VPS), ilegível, múltiplo ou vizinho", () => {
    expect(origemPermitida(cab({}))).toMatchObject({ ok: false, motivo: "sem cf-connecting-ip" });
    expect(origemPermitida(cab({ "x-forwarded-for": IP_VPS, "x-real-ip": IP_VPS })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "   " })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "unknown" })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": `${IP_VPS}, 200.1.2.3` })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "203.0.113.100" })).ok).toBe(false);
    expect(origemPermitida(cab({ "cf-connecting-ip": "31.97.34.54" })).ok).toBe(false);
  });

  it("vistos traz todos os IPs (diagnóstico), cf-connecting-ip primeiro", () => {
    const r = origemPermitida(cab({ "cf-connecting-ip": IP_VPS, "x-forwarded-for": `${IP_VPS}, 99.83.99.150` }));
    expect(r.vistos).toEqual([`cf-connecting-ip=${IP_VPS}`, `x-forwarded-for=${IP_VPS}`, "x-forwarded-for=99.83.99.150"]);
  });

  it("utilitários de IP", () => {
    expect(normalizarIp(" [2001:db8::1]:443 ")).toBe("2001:db8::1");
    expect(normalizarIp("1.2.3.4:80")).toBe("1.2.3.4");
    expect(normalizarIp("nao-e-ip")).toBeNull();
    expect(ipInterno("192.168.1.1")).toBe(true);
    expect(ipInterno("100.64.0.1")).toBe(true);
    expect(ipInterno(IP_VPS)).toBe(false);
    expect(ipCloudflare("172.70.1.2")).toBe(true);
    expect(ipCloudflare("2606:4700::1")).toBe(true);
    expect(ipCloudflare(IP_VPS)).toBe(false);
  });
});

describe("decidirPareamento", () => {
  const ok = { ok: true };
  it("dentro da janela, nunca pareado, origem certa -> 200", () => {
    expect(decidirPareamento(ABERTA, ok, AGORA).status).toBe(200);
  });
  it("uso único: depois de pareado é 410 sempre (mesmo com janela aberta e origem certa)", () => {
    expect(decidirPareamento({ ...ABERTA, pareadoEm: "2026-10-17T20:01:00Z" }, ok, AGORA).status).toBe(410);
    expect(decidirPareamento({ abertoAte: null, pareadoEm: "2026-10-17T20:01:00Z" }, { ok: false }, AGORA).status).toBe(410);
  });
  it("janela: fechada, ausente ou ilegível -> 403", () => {
    expect(decidirPareamento(ABERTA, ok, Date.parse("2026-10-17T20:20:01Z")).status).toBe(403);
    expect(decidirPareamento({ abertoAte: null, pareadoEm: null }, ok, AGORA).status).toBe(403);
    expect(decidirPareamento({ abertoAte: "amanhã", pareadoEm: null }, ok, AGORA).status).toBe(403);
  });
  it("origem errada -> 403", () => {
    expect(decidirPareamento(ABERTA, { ok: false }, AGORA)).toEqual({ status: 403, motivo: "origem recusada" });
  });
});
