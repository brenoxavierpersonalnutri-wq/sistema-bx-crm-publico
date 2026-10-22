// Link /g/ lotado (21/10/2026): "Preparando seu grupo…", consulta a cada 3 s com o token, redireciona quando o grupo
// novo tem convite e, depois de 60 s, "Tente de novo em instantes" com botão de recarregar. Lotado nunca usa url_lotado.
// Relógio falso e RPC falsa: nada aqui fala com o Supabase.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { abrirComEspera, interpretarRespostaLink, resolverLinkGrupo, type ResultadoLink } from "@/lib/grupoLink";
import { AbrindoGrupo, TEXTO_PREPARANDO, TEXTO_TENTE_DE_NOVO } from "@/components/grupos/AbrindoGrupo";

const TOKEN = "3f1c2b8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f";
const URL_GRUPO = "https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBB";

describe("resposta da RPC", () => {
  it("lotado (RPC nova) = espera com token; url_lotado nunca é usada", () => {
    expect(interpretarRespostaLink({ erro: "lotado", aguardando: true, criando: true, espera: TOKEN, url: null })).toEqual({ tipo: "aguardando", espera: TOKEN });
    // RPC antiga devolvia a URL de lotado: mesmo assim espera
    expect(interpretarRespostaLink({ erro: "lotado", url: "https://reserva.exemplo", criando: false })).toEqual({ tipo: "aguardando", espera: null });
  });
  it("pausado usa a URL de pausa; grupo redireciona; o resto é erro", () => {
    expect(interpretarRespostaLink({ erro: "pausado", url: "https://pausa.exemplo" })).toEqual({ tipo: "pausado", url: "https://pausa.exemplo" });
    expect(interpretarRespostaLink({ url: URL_GRUPO })).toEqual({ tipo: "grupo", url: URL_GRUPO });
    expect(interpretarRespostaLink({ erro: "nao_encontrada" })).toEqual({ tipo: "nao_encontrada" });
    expect(interpretarRespostaLink({ url: "https://golpe.exemplo" }).tipo).toBe("erro");
  });
});

describe("resolverLinkGrupo", () => {
  beforeEach(() => rpc.mockReset());
  it("1ª chamada leva telefone e UTM; a consulta de espera leva só o token", async () => {
    rpc.mockResolvedValue({ data: { erro: "lotado", aguardando: true, espera: TOKEN }, error: null });
    await resolverLinkGrupo("grupo-x", "?tel=11999998888&utm_source=meta&nome=Ana");
    expect(rpc).toHaveBeenLastCalledWith("grupos_resolver_link", expect.objectContaining({
      p_slug: "grupo-x", p_tel: "11999998888", p_nome: "Ana", p_utm: { utm_source: "meta" },
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_espera");
    await resolverLinkGrupo("grupo-x", "?tel=11999998888&utm_source=meta", TOKEN);
    expect(rpc).toHaveBeenLastCalledWith("grupos_resolver_link", expect.objectContaining({ p_espera: TOKEN, p_tel: null, p_utm: {} }));
  });
  it("banco sem a migration (não conhece p_espera): consulta de novo sem o token", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Could not find the function public.grupos_resolver_link(p_email, p_espera, ...) in the schema cache" } })
      .mockResolvedValueOnce({ data: { url: URL_GRUPO }, error: null });
    expect(await resolverLinkGrupo("grupo-x", "", TOKEN)).toEqual({ tipo: "grupo", url: URL_GRUPO });
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_espera");
  });
});

describe("abrirComEspera (relógio falso)", () => {
  it("consulta a cada 3 s com o mesmo token e para quando o grupo nasce", async () => {
    let t = 0;
    const esperas: number[] = [];
    const respostas: ResultadoLink[] = [
      { tipo: "aguardando", espera: TOKEN }, { tipo: "aguardando", espera: TOKEN }, { tipo: "aguardando", espera: TOKEN }, { tipo: "grupo", url: URL_GRUPO },
    ];
    const resolver = vi.fn(async (_slug: string, _search: string, _espera?: string | null) => respostas.shift()!);
    const fases: string[] = [];
    const fim = await abrirComEspera({
      slug: "grupo-x", search: "", resolver, onEstado: (e) => fases.push(e.fase),
      agora: () => t, dormir: async (ms) => { esperas.push(ms); t += ms; },
    });
    expect(fim).toEqual({ fase: "fim", resultado: { tipo: "grupo", url: URL_GRUPO } });
    expect(fases).toEqual(["abrindo", "preparando", "fim"]);
    expect(esperas).toEqual([3000, 3000, 3000]);
    expect(resolver.mock.calls.slice(1).map((c) => c[2])).toEqual([TOKEN, TOKEN, TOKEN]);
  });
  it("passou de 60 s: tempo esgotado (20 consultas, nenhuma depois do limite)", async () => {
    let t = 0;
    const resolver = vi.fn(async (): Promise<ResultadoLink> => ({ tipo: "aguardando", espera: TOKEN }));
    const fim = await abrirComEspera({ slug: "grupo-x", search: "", resolver, onEstado: () => {}, agora: () => t, dormir: async (ms) => { t += ms; } });
    expect(fim).toEqual({ fase: "tempo_esgotado" });
    expect(resolver).toHaveBeenCalledTimes(1 + 20);
    expect(t).toBe(60_000);
  });
  it("erro de rede no meio da espera não derruba: continua até o grupo nascer", async () => {
    let t = 0;
    const respostas: ResultadoLink[] = [{ tipo: "aguardando", espera: TOKEN }, { tipo: "erro", mensagem: "rede" }, { tipo: "grupo", url: URL_GRUPO }];
    const fim = await abrirComEspera({ slug: "grupo-x", search: "", resolver: async () => respostas.shift()!, onEstado: () => {}, agora: () => t, dormir: async (ms) => { t += ms; } });
    expect(fim).toMatchObject({ fase: "fim", resultado: { tipo: "grupo" } });
  });
});

describe("página do link (AbrindoGrupo)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mostra \"Preparando seu grupo, só um instante…\" e redireciona sozinha quando o grupo novo tem convite", async () => {
    const respostas: ResultadoLink[] = [{ tipo: "aguardando", espera: TOKEN }, { tipo: "aguardando", espera: TOKEN }, { tipo: "grupo", url: URL_GRUPO }];
    const resolver = vi.fn(async () => respostas.shift()!);
    const redirecionar = vi.fn();
    render(<AbrindoGrupo slug="grupo-x" resolver={resolver} redirecionar={redirecionar} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(TEXTO_PREPARANDO)).toBeTruthy();
    expect(TEXTO_PREPARANDO).toBe("Preparando seu grupo, só um instante…");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(redirecionar).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(redirecionar).toHaveBeenCalledWith(URL_GRUPO);
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("depois de 60 s mostra \"Tente de novo em instantes\" com botão que recarrega", async () => {
    const resolver = vi.fn(async (): Promise<ResultadoLink> => ({ tipo: "aguardando", espera: TOKEN }));
    const recarregar = vi.fn();
    render(<AbrindoGrupo slug="grupo-x" resolver={resolver} redirecionar={vi.fn()} recarregar={recarregar} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(57_000); });
    expect(screen.getByText(TEXTO_PREPARANDO)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.getByText(TEXTO_TENTE_DE_NOVO)).toBeTruthy();
    expect(TEXTO_TENTE_DE_NOVO).toBe("Tente de novo em instantes");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(recarregar).toHaveBeenCalledTimes(1);
    const consultas = resolver.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(resolver.mock.calls.length).toBe(consultas); // parou de consultar
  });

  it("link pausado vai para a URL de pausa; sem URL avisa que as entradas estão fechadas", async () => {
    const redirecionar = vi.fn();
    render(<AbrindoGrupo slug="grupo-x" resolver={async () => ({ tipo: "pausado", url: "https://pausa.exemplo" })} redirecionar={redirecionar} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(redirecionar).toHaveBeenCalledWith("https://pausa.exemplo");
  });

  it("/r/ que já resolveu (inicial) não consulta de novo antes de esperar 3 s", async () => {
    const resolver = vi.fn(async (): Promise<ResultadoLink> => ({ tipo: "grupo", url: URL_GRUPO }));
    const redirecionar = vi.fn();
    render(<AbrindoGrupo slug="grupo-x" inicial={{ tipo: "aguardando", espera: TOKEN }} resolver={resolver} redirecionar={redirecionar} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(resolver).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(resolver).toHaveBeenCalledWith("grupo-x", expect.any(String), TOKEN);
    expect(redirecionar).toHaveBeenCalledWith(URL_GRUPO);
  });
});
