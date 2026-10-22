// Estúdio: mesma pessoa em duas abas fica uma só; banners gravam no banco sem esperar o servidor de
// transmissão e nunca falham em silêncio; erro do Cloudflare Stream não parece erro do palco.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const chamadas: { op: string; filtros: unknown[]; valores?: unknown }[] = [];
let resposta: { data: unknown; error: { message: string } | null } = { data: [{ id: "b1" }], error: null };
let cenaPendente: Promise<unknown> = Promise.resolve({});

vi.mock("@/lib/lives/api", () => {
  const consulta = (op: string, valores?: unknown) => {
    const reg = { op, filtros: [] as unknown[], valores };
    chamadas.push(reg);
    const q: any = {
      eq: (...a: unknown[]) => (reg.filtros.push(["eq", ...a]), q),
      neq: (...a: unknown[]) => (reg.filtros.push(["neq", ...a]), q),
      select: () => q,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, erro),
    };
    return q;
  };
  return {
    db: { from: () => ({ update: (v: unknown) => consulta("update", v), delete: () => consulta("delete") }) },
    liveControl: () => cenaPendente,
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { donoDaSessao, sessoesDuplicadas, textoUltimoErro } from "@/lib/lives/sessoes";
import { alternarOverlay, apagarOverlay } from "@/lib/lives/overlays";
import { PainelTextos } from "@/components/lives/estudio/PainelTextos";
import type { LiveOverlay } from "@/lib/lives/api";

const banner = (id: string, visivel: boolean, texto = id): LiveOverlay =>
  ({ id, room_id: "sala", tipo: "banner", visivel, ordem: 0, conteudo: { texto } }) as unknown as LiveOverlay;

beforeEach(() => {
  chamadas.length = 0;
  resposta = { data: [{ id: "b1" }], error: null };
  cenaPendente = Promise.resolve({});
  vi.mocked(toast.error).mockClear();
});

describe("sessões duplicadas da mesma pessoa", () => {
  it("dono = tipo + 8 do id; render/egress não têm dono", () => {
    expect(donoDaSessao("prod_2bf4323d_jYI7")).toBe("prod_2bf4323d");
    expect(donoDaSessao("conv_1a2b3c4d_x_Y-z")).toBe("conv_1a2b3c4d");
    expect(donoDaSessao("ver_abcdef")).toBeNull();
    expect(donoDaSessao("EG_123")).toBeNull();
  });

  it("caso do Breno: aba esquecida (jYI7, 17:54) + aba nova local (O06x, 22:28) -> a nova tira a antiga", () => {
    const sessoes = [
      { identity: "prod_2bf4323d_O06x", joinedAt: new Date("2026-10-20T22:28:06Z"), local: true },
      { identity: "prod_2bf4323d_jYI7", joinedAt: new Date("2026-10-20T17:54:12Z") },
      { identity: "conv_99999999_aaaa", joinedAt: new Date("2026-10-20T22:00:00Z") },
    ];
    expect(sessoesDuplicadas(sessoes)).toEqual(["prod_2bf4323d_jYI7"]);
  });

  it("na aba ANTIGA a regra não derruba a nova (a nova é quem decide): duas abas não se removem uma à outra", () => {
    const vistoDaAntiga = [
      { identity: "prod_2bf4323d_jYI7", joinedAt: new Date("2026-10-20T17:54:12Z"), local: true },
      { identity: "prod_2bf4323d_O06x", joinedAt: new Date("2026-10-20T22:28:06Z") },
    ];
    expect(sessoesDuplicadas(vistoDaAntiga)).toEqual([]);
  });

  it("convidado com o mesmo link em dois aparelhos: fica a entrada mais recente", () => {
    const sessoes = [
      { identity: "prod_2bf4323d_O06x", joinedAt: 5, local: true },
      { identity: "conv_1a2b3c4d_old1", joinedAt: 1 },
      { identity: "conv_1a2b3c4d_new2", joinedAt: 3 },
    ];
    expect(sessoesDuplicadas(sessoes)).toEqual(["conv_1a2b3c4d_old1"]);
  });

  it("empate no horário decide pela identity, igual em qualquer aba", () => {
    const a = { identity: "prod_2bf4323d_aaaa", joinedAt: 7 };
    const b = { identity: "prod_2bf4323d_bbbb", joinedAt: 7 };
    expect(sessoesDuplicadas([{ ...a, local: true }, b])).toEqual([]);
    expect(sessoesDuplicadas([a, { ...b, local: true }])).toEqual(["prod_2bf4323d_aaaa"]);
  });

  it("pessoas diferentes não se tocam", () => {
    expect(sessoesDuplicadas([{ identity: "prod_11111111_a", local: true }, { identity: "prod_22222222_b" }])).toEqual([]);
  });
});

describe("erro do Cloudflare Stream no estúdio", () => {
  it("vira aviso claro, sem dizer que o palco/transmissão falhou", () => {
    const t = textoUltimoErro('LiveKit respondeu 500: "CF_ACCOUNT_ID/CF_STREAM_TOKEN/CF_STREAM_CUSTOMER_CODE ausentes"');
    expect(t).toMatch(/^Webinário próprio indisponível: configure o Cloudflare Stream/);
    expect(t).toMatch(/Palco, banners/);
  });
  it("outros erros passam como vieram", () => {
    expect(textoUltimoErro("LiveKit respondeu 502: x")).toBe("LiveKit respondeu 502: x");
    expect(textoUltimoErro(null)).toBeNull();
  });
});

describe("banners", () => {
  it("mostrar: oculta os outros do tipo (menos ele), grava e devolve SEM esperar o live-control", async () => {
    cenaPendente = new Promise(() => undefined); // servidor de transmissão travado
    const ok = await alternarOverlay("sala", banner("b1", false), true);
    expect(ok).toBe(true);
    expect(chamadas[0]).toMatchObject({ op: "update", valores: { visivel: false } });
    expect(chamadas[0].filtros).toContainEqual(["neq", "id", "b1"]);
    expect(chamadas[1]).toMatchObject({ op: "update", valores: expect.objectContaining({ visivel: true }) });
  });

  it("banco não alterou nenhuma linha (RLS/apagado): avisa em vez de fingir que deu certo", async () => {
    resposta = { data: [], error: null };
    expect(await alternarOverlay("sala", banner("b1", true), false)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/não alterou/));
    expect(await apagarOverlay("sala", banner("b1", false))).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/não apagou/));
  });

  it("erro do banco aparece com o motivo", async () => {
    resposta = { data: null, error: { message: "permission denied for table live_overlays" } };
    expect(await apagarOverlay("sala", banner("b1", false))).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Não consegui apagar: permission denied for table live_overlays");
  });

  it("painel: lixeira apaga e relê a lista mesmo com o live-control travado; clique alterna e relê", async () => {
    cenaPendente = new Promise(() => undefined);
    const recarregar = vi.fn();
    render(<PainelTextos roomId="sala" tipo="banner" overlays={[banner("b1", true, "TESTE"), banner("b2", false, "a")]} recarregar={recarregar} />);
    expect(screen.getByText("No palco — clique para ocultar")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Apagar" })[0]);
    await waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1));
    expect(chamadas.some((c) => c.op === "delete")).toBe(true);
    fireEvent.click(screen.getByText("a"));
    await waitFor(() => expect(recarregar).toHaveBeenCalledTimes(2));
  });

  it("painel: relê a lista mesmo quando o banco recusa", async () => {
    resposta = { data: null, error: { message: "recusado" } };
    const recarregar = vi.fn();
    render(<PainelTextos roomId="sala" tipo="banner" overlays={[banner("b1", false, "a")]} recarregar={recarregar} />);
    fireEvent.click(screen.getByText("a"));
    await waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalled();
  });
});
