// Estúdio React, tela de edição: operações puras (pausa nova, aplicar em intervalo, prévia, IA) e a tela renderizada.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  aplicar, cortesDoTrecho, desfazerPausa, duracaoPrevista, edicaoInicial, estadoPrevia, falaDepois, layoutEfetivo, origEm, paraPedido,
  pausarAqui, proximoVisivel, situacaoIA, trechoEm, volumeEfetivo, type BaseEdicao, type TrechoEd,
} from "@/lib/conteudo/react/edicao";
import { estilosLayout } from "@/components/conteudo/react/PreviaEdicao";
import { pareceLink, textoCredito } from "@/lib/conteudo/react/api";

// o Slider do Radix mede o tamanho; o jsdom não tem ResizeObserver
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const TR: TrechoEd[] = [
  { tipo: "tocando", ini: 0, fim: 6, orig: 0 },
  { tipo: "comentario", ini: 6, fim: 10, orig: 6 },
  { tipo: "tocando", ini: 10, fim: 15, orig: 6 },
];

describe("edição: operações", () => {
  it("pausa nova continua de onde parou (ou pula o que tocou)", () => {
    const r = pausarAqui(TR, 12, 2);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.indice).toBe(3);
    expect(r.trechos.slice(2)).toEqual([
      { tipo: "tocando", ini: 10, fim: 12, orig: 6 },
      { tipo: "tocando", ini: 12, fim: 14, orig: 8, congelar: true, pausa: true },
      { tipo: "tocando", ini: 14, fim: 15, orig: 8 },
    ]);
    const p = pausarAqui(TR, 12, 2, "pular");
    if ("erro" in p) throw new Error(p.erro);
    expect(p.trechos[4].orig).toBe(10);
    // a pausa guarda o layout e o som do trecho de onde saiu
    const comEscolha = aplicar(TR, [2], { layout: "ele", volume: 0.3 });
    const q = pausarAqui(comEscolha, 11, 1);
    if ("erro" in q) throw new Error(q.erro);
    expect(q.trechos[3]).toMatchObject({ layout: "ele", congelar: true });
    expect(q.trechos[4]).toMatchObject({ layout: "ele", volume: 0.3 });
  });

  it("pausa recusa comentário, pouco tempo e desfaz voltando ao trecho original", () => {
    expect(pausarAqui(TR, 7, 2)).toHaveProperty("erro");
    expect(pausarAqui(TR, 14.9, 2)).toHaveProperty("erro");
    const r = pausarAqui(TR, 12, 2);
    if ("erro" in r) throw new Error(r.erro);
    expect(desfazerPausa(r.trechos, r.indice)).toEqual(TR);
    const fim = pausarAqui(TR, 13, 5);    // pausa até o fim do trecho: sem resto
    if ("erro" in fim) throw new Error(fim.erro);
    expect(fim.trechos).toHaveLength(4);
    expect(fim.trechos[3]).toMatchObject({ ini: 13, fim: 15, congelar: true });
  });

  it("aplica em intervalo, apaga escolha com undefined e congelar só em tocando", () => {
    const a = aplicar(TR, [0, 1, 2], { layout: "original_pip", congelar: true });
    expect(a.map((t) => t.layout)).toEqual(["original_pip", "original_pip", "original_pip"]);
    expect(a[1].congelar).toBeUndefined();
    expect(a[0].congelar).toBe(true);
    expect(aplicar(a, [0], { layout: undefined })[0]).not.toHaveProperty("layout");
  });

  it("prévia: ponto do original, volume, layout e pula removido", () => {
    expect(origEm(TR[0], 2.5)).toBe(2.5);
    expect(origEm(TR[1], 8)).toBe(6);
    const t = aplicar(aplicar(TR, [0], { volume: 0.3 }), [2], { mudo: true, removido: true });
    expect(volumeEfetivo(t[0], 0.5)).toBeCloseTo(0.15);
    expect(volumeEfetivo(t[1])).toBe(0);
    expect(estadoPrevia(t, 3, 1)).toMatchObject({ i: 0, congelado: false, orig: 3, volume: 0.3, layout: "dividido" });
    expect(estadoPrevia(t, 7, 1)).toMatchObject({ i: 1, congelado: true, orig: 6 });
    expect(proximoVisivel(t, 11)).toBeNull();
    expect(proximoVisivel(aplicar(TR, [1], { removido: true }), 7)).toBe(10);
    expect(layoutEfetivo(TR[1], "cheia_longos")).toBe("dividido");      // 4 s: curto
    expect(layoutEfetivo({ ...TR[1], fim: 12 }, "cheia_longos")).toBe("cheia");
    expect(trechoEm(TR, 15)).toBe(2);
    expect(duracaoPrevista(t)).toBe(10);
  });

  it("enquanto eu falo: dura a fala (respiro curto junta)", () => {
    const falas: [number, number][] = [[1, 2.5], [2.8, 4], [8, 9]];
    expect(falaDepois(falas, 1.5)).toBeCloseTo(2.65);
    expect(falaDepois(falas, 5)).toBeNull();
    expect(falaDepois(falas, 7.2)).toBeCloseTo(1.95);
    expect(falaDepois(null, 1)).toBeNull();
  });

  it("o que a IA fez aparece por trecho (mesmo depois de partir)", () => {
    const base = { trechos: TR, falas: [], dur_reacao: 15, dur_original: 30, sem_fala: [],
      ia: { aplicada: true, titulo: "T", cortes: [{ id: "c1-2", ini: 7, fim: 7.5, texto: "é então" }], removidos: [[6, 10]], tirados: [], gancho: null } } as BaseEdicao;
    expect(situacaoIA(base, TR[1])).toBe("ia_removeu");
    expect(situacaoIA(base, TR[0])).toBeNull();
    expect(cortesDoTrecho(base, TR[1]).map((c) => c.id)).toEqual(["c1-2"]);
  });

  it("pedido enxuto e edição salva mais nova vence", () => {
    const p = paraPedido([{ ...TR[0], volume: 1, layout: "ele" }, { ...TR[1], removido: false }, { ...TR[2], volume: 0.333, mudo: true }]);
    expect(p[0]).toEqual({ tipo: "tocando", ini: 0, fim: 6, orig: 0, layout: "ele" });
    expect(p[1].removido).toBe(false);
    expect(p[2]).toMatchObject({ volume: 0.33, mudo: true });
    const velha = { trechos: [TR[0]], edicao: { volume_geral: 0.2, ia_gancho: true, ia_titulo: true, cortes_ia_restaurados: [] }, salvo_em: 10 };
    const nova = { trechos: TR, edicao: { volume_geral: 0.7, ia_gancho: false, ia_titulo: true, cortes_ia_restaurados: [] }, salvo_em: 20 };
    expect(edicaoInicial([velha, nova], null, []).edicao.volume_geral).toBe(0.7);
    expect(edicaoInicial([null, undefined], null, TR).trechos).toHaveLength(3);
  });

  it("layouts da prévia batem com o montagem.py e nunca deixam faixa (cover)", () => {
    expect(estilosLayout("dividido").orig).toMatchObject({ height: "50%", objectFit: "cover" });
    expect(estilosLayout("ele").orig).toMatchObject({ opacity: 0 });
    expect(estilosLayout("original").orig).toMatchObject({ width: "100%", height: "100%", objectFit: "cover" });
    expect(estilosLayout("original").ele).toMatchObject({ opacity: 0 });
    expect(estilosLayout("original_pip").ele).toMatchObject({ width: "34.4%", height: "25.6%", objectFit: "cover" });
    expect(estilosLayout("original_pip", true).ele).toMatchObject({ top: "17.2%" });
    expect(estilosLayout("cheia").orig).toMatchObject({ objectFit: "cover" });
  });
});

describe("link do Instagram", () => {
  it("reconhece o link colado do app e monta o crédito", () => {
    expect(pareceLink("https://www.instagram.com/reel/DdDCBCwArSO/?igsh=MWx0")).toBe(true);
    expect(pareceLink("instagram.com/p/Cabc123/")).toBe(true);
    expect(pareceLink("https://www.instagram.com/natgeo/")).toBe(false);
    expect(pareceLink("https://exemplo.com/v.mp4")).toBe(false);
    expect(textoCredito("natgeo", "https://www.instagram.com/reel/X/")).toBe("Vídeo original: @natgeo");
    expect(textoCredito(null, null)).toBe("");
  });
});

// ------------------------------------------------------------------ a tela
const api = vi.hoisted(() => ({
  lerEdicao: vi.fn(),
  salvarEdicao: vi.fn(async () => ({ banco: false })),
}));
vi.mock("@/lib/conteudo/react/api", async (orig) => ({ ...(await orig<typeof import("@/lib/conteudo/react/api")>()), ...api }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

describe("EditorReact (tela no jeito do CapCut)", () => {
  it("abre em tela cheia com blocos, aplica layout/mudo/apagar pelas ferramentas e exporta com as escolhas", async () => {
    const { EditorReact } = await import("@/components/conteudo/react/EditorReact");
    api.lerEdicao.mockResolvedValue({
      base: { trechos: TR, falas: [[11, 13]], dur_reacao: 15, dur_original: 30, sem_fala: [], ia: { aplicada: true, titulo: "O erro", cortes: [], removidos: [[6, 10]], tirados: [], gancho: null } },
      salva: null, falas: [[11, 13]], previas: { original: null, reacao: null }, montando: false, link: null,
    });
    const onMontar = vi.fn(async () => undefined);
    const projeto = { id: "p1", titulo: "t", modo: "aqui", linha_tempo: TR } as never;
    render(<EditorReact projeto={projeto} op={{ layout: "dividido", legenda: true, cortar_silencio: true, ia: true, duracao_max: 90, modelo: "nativo" }}
      onFechar={() => undefined} onMontar={onMontar} />);
    await screen.findByTestId("editor-react");
    expect(screen.getAllByRole("button", { name: /Tocando de|Comentário de/ })).toHaveLength(3);
    // bloco 1: layout canto (painel com ✓) e mudo (ação direta)
    fireEvent.click(screen.getByRole("button", { name: /Tocando de 0:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("radio", { name: "Original + você no canto" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Mudo" }));
    // bloco 2 (a IA tirou): Restaurar = manter
    fireEvent.click(screen.getByRole("button", { name: /Comentário de 0:06/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
    // bloco 3: apagar
    fireEvent.click(screen.getByRole("button", { name: /Tocando de 0:10/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    // texto: desliga o título da IA
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Título da IA" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    // painel cancelado (X) desfaz o que mudou nele
    fireEvent.click(screen.getByRole("button", { name: /Tocando de 0:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("radio", { name: "Só você" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    await waitFor(() => expect(onMontar).toHaveBeenCalled());
    const [, trechos, ajustes] = onMontar.mock.calls[0] as unknown as [unknown, TrechoEd[], { ia_titulo: boolean }];
    expect(trechos[0]).toMatchObject({ layout: "original_pip", mudo: true });
    expect(trechos[1]).toMatchObject({ removido: false });
    expect(trechos[2]).toMatchObject({ removido: true });
    expect(ajustes.ia_titulo).toBe(false);
  }, 20_000);

  it("desfazer e refazer; dividir na agulha cria um bloco", async () => {
    const { EditorReact } = await import("@/components/conteudo/react/EditorReact");
    api.lerEdicao.mockResolvedValue({
      base: { trechos: TR, falas: [], dur_reacao: 15, dur_original: 30, sem_fala: [], ia: { aplicada: false, titulo: "", cortes: [], removidos: [], tirados: [], gancho: null } },
      salva: null, falas: [], previas: { original: null, reacao: null }, montando: false, link: null,
    });
    const projeto = { id: "p2", titulo: "t", modo: "aqui", linha_tempo: TR } as never;
    render(<EditorReact projeto={projeto} op={{ layout: "dividido", legenda: true, cortar_silencio: false, ia: false, duracao_max: 90, modelo: "nativo" }}
      onFechar={() => undefined} onMontar={vi.fn(async () => undefined)} />);
    await screen.findByTestId("editor-react");
    // rolar a linha do tempo com o dedo leva a agulha a 12 s (36 px por segundo)
    const rolagem = screen.getByTestId("linha-rolagem");
    rolagem.scrollLeft = 12 * 36;
    fireEvent.scroll(rolagem);
    await waitFor(() => expect(screen.getByTestId("tempo").textContent).toContain("0:12"));
    fireEvent.click(screen.getByRole("button", { name: "Dividir" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Tocando de|Comentário de/ })).toHaveLength(4));
    expect(screen.getByRole("button", { name: /Tocando de 0:12 a 0:15/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(screen.getByRole("button", { name: "Apagar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refazer" }));
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeTruthy();
  }, 20_000);
});
