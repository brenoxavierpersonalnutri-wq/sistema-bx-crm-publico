// Prévia contínua e blocos da tela de edição, com a edição REAL do Breno (projeto ef80aab7, 22/10/2026: Reels do
// @tozettoo, gravação de 19 s) copiada do edicao_base.json da VPS.
import { describe, expect, it } from "vitest";
import {
  AJUSTES_PADRAO, aparar, dividirEm, juntarComProximo, marcarRemovido, simplificar, type BaseEdicao, type TrechoEd,
} from "@/lib/conteudo/react/edicao";
import {
  blocosComFala, blocosDaLinha, duracaoSaida, gravacaoParaSaida, planoPrevia, quadroEm, saidaParaGravacao, subtrairFaixas,
} from "@/lib/conteudo/react/plano";

const BRENO: BaseEdicao = {
  dur_reacao: 19.072, dur_original: 77.022,
  trechos: [
    { tipo: "comentario", ini: 0.0, fim: 0.004, orig: 0.0 },
    { tipo: "tocando", ini: 0.004, fim: 7.841, orig: 0.0 },
    { tipo: "comentario", ini: 7.841, fim: 13.28, orig: 7.729 },
    { tipo: "tocando", ini: 13.28, fim: 16.841, orig: 7.732 },
    { tipo: "comentario", ini: 16.841, fim: 19.072, orig: 11.271 },
  ],
  falas: [[0.0, 1.682], [3.422, 3.683], [7.742, 8.075], [8.674, 10.451], [10.871, 12.899], [16.038, 16.302], [17.402, 18.513]],
  sem_fala: [[0.0, 0.004]],
  ia: {
    aplicada: true, titulo: "SERÁ QUE VAI TER ÓDIO PRA AJUDAR?",
    cortes: [{ id: "c8-9", ini: 7.841, fim: 9.17, texto: "É, cara," }, { id: "c19-19", ini: 12.16, fim: 12.39, texto: "né?" }],
    removidos: [], tirados: [], gancho: { ini: 17.23, fim: 19.063 },
  },
};
const OP = { cortar_silencio: true, layout: "dividido" as const, ia: true, modelo: "nativo" };

describe("blocos (edição real do Breno)", () => {
  it("o toque de 4 ms some: 5 blocos viram 4, cobrindo a gravação inteira", () => {
    const s = simplificar(BRENO.trechos);
    expect(s).toHaveLength(4);
    expect(s[0]).toMatchObject({ tipo: "tocando", ini: 0, fim: 7.841, orig: 0 });
    expect(s[s.length - 1].fim).toBe(19.072);
    for (let i = 1; i < s.length; i += 1) expect(s[i].ini).toBe(s[i - 1].fim);
  });

  it("vizinhos que continuam com a mesma escolha viram um só; escolha diferente não junta", () => {
    const partido: TrechoEd[] = [
      { tipo: "tocando", ini: 0, fim: 1, orig: 5 }, { tipo: "tocando", ini: 1, fim: 2.5, orig: 6 }, { tipo: "tocando", ini: 2.5, fim: 6, orig: 7.5 },
    ];
    expect(simplificar(partido)).toEqual([{ tipo: "tocando", ini: 0, fim: 6, orig: 5 }]);
    const com = [...partido.slice(0, 2), { ...partido[2], layout: "ele" as const }];
    expect(simplificar(com)).toHaveLength(2);
    // original que pula (voltou o vídeo) não junta: o vídeo mudaria
    expect(simplificar([{ tipo: "tocando", ini: 0, fim: 4, orig: 0 }, { tipo: "tocando", ini: 4, fim: 8, orig: 1 }])).toHaveLength(2);
  });

  it("dividir na agulha, juntar de volta, e recusa juntar tocando com comentário", () => {
    const s = simplificar(BRENO.trechos);
    const d = dividirEm(s, 4);
    if ("erro" in d) throw new Error(d.erro);
    expect(d.trechos).toHaveLength(5);
    expect(d.trechos[1]).toMatchObject({ ini: 4, orig: 4 });
    const j = juntarComProximo(d.trechos, 0);
    if ("erro" in j) throw new Error(j.erro);
    expect(j.trechos).toEqual(s);
    expect("erro" in juntarComProximo(s, 0)).toBe(true);
    expect("erro" in dividirEm(s, 7.8)).toBe(true);
  });

  it("aparar: encolher tira a ponta (removido) e esticar devolve", () => {
    const s = simplificar(BRENO.trechos);
    const a = aparar(s, 0, "ini", 1.5);
    expect(a[0]).toMatchObject({ ini: 0, fim: 1.5, removido: true });
    expect(a[1]).toMatchObject({ ini: 1.5, orig: 1.5 });
    expect(a[1].removido).toBeUndefined();
    const b = simplificar(aparar(a, 1, "ini", 0.5));
    expect(b[0]).toMatchObject({ ini: 0, fim: 0.5, removido: true });
    expect(b[1]).toMatchObject({ ini: 0.5, fim: 7.841, orig: 0.5 });
    expect(simplificar(aparar(b, 1, "ini", 0))).toEqual(s);
    expect(marcarRemovido(s, 2, 3, true).filter((t) => t.removido)).toHaveLength(1);
  });
});

describe("prévia contínua (plano igual ao da montagem)", () => {
  it("faixas e silêncio: o mesmo cálculo do planejar()", () => {
    expect(subtrairFaixas([[0, 10]], [[2, 3], [5, 6]])).toEqual([[0, 2], [3, 5], [6, 10]]);
    // comentário 7,841-13,28: falas juntas (respiro < 0,7 s) e folgas 0,12/0,22
    expect(blocosComFala(7.841, 13.28, BRENO.falas, { silencio_longo: 0.7, folga_antes: 0.12, folga_depois: 0.22 }))
      .toEqual([[7.841, 13.119]]);
  });

  it("edição do Breno: gancho abre, cortes da IA saem, e a saída bate com a montagem (18,43 s)", () => {
    const s = simplificar(BRENO.trechos);
    const p = planoPrevia(s, BRENO, AJUSTES_PADRAO, BRENO.falas, OP);
    expect(p[0]).toMatchObject({ gancho: true, ini: 17.23, fim: 19.063, s0: 0 });
    // o "É, cara," (7,841-9,17) e o "né?" (12,16-12,39) não tocam
    const tocaEm = (t: number) => p.some((x) => !x.gancho && x.ini <= t && t < x.fim);
    expect(tocaEm(8.5)).toBe(false);
    expect(tocaEm(12.2)).toBe(false);
    expect(tocaEm(10)).toBe(true);
    // a montagem real deu 18,43 s (estado.json); a prévia não tem as micro-sobras de quadro do ffmpeg
    expect(Math.abs(duracaoSaida(p) - 18.43)).toBeLessThan(0.35);
  });

  it("mapa saída <-> gravação, blocos proporcionais e layout trocando no ponto certo", () => {
    const s = simplificar(BRENO.trechos).map((t, i) => (i === 1 ? { ...t, layout: "ele" as const } : i === 2 ? { ...t, layout: "original" as const } : t));
    const p = planoPrevia(s, BRENO, AJUSTES_PADRAO, BRENO.falas, OP);
    const g = p[0].fim - p[0].ini;
    expect(saidaParaGravacao(p, g + 2)).toMatchObject({ t: 2 });
    expect(gravacaoParaSaida(p, 2)).toBeCloseTo(g + 2, 5);
    expect(gravacaoParaSaida(p, 8.5)).toBeCloseTo(gravacaoParaSaida(p, 9.17), 5);  // corte da IA: pula
    const b = blocosDaLinha(s, p);
    expect(b[0].s0).toBeCloseTo(g, 5);
    expect(b[0].s1 - b[0].s0).toBeCloseTo(7.841, 3);
    for (let i = 1; i < b.length; i += 1) expect(b[i].s0).toBeCloseTo(b[i - 1].s1, 5);
    expect(quadroEm(p, s, g + 1)?.layout).toBe("dividido");
    expect(quadroEm(p, s, b[1].s0 + 0.5)?.layout).toBe("ele");
    expect(quadroEm(p, s, b[1].s0 + 0.5)?.congelado).toBe(true);
    expect(quadroEm(p, s, b[2].s0 + 0.5)).toMatchObject({ layout: "original", congelado: false });
    expect(quadroEm(p, s, b[2].s0 + 1)?.orig).toBeCloseTo(7.732 + 1, 2);
  });

  it("removido, mudo e gancho desligado entram no plano", () => {
    const s = simplificar(BRENO.trechos);
    s[2] = { ...s[2], removido: true, mudo: true };
    const p = planoPrevia(s, BRENO, { ...AJUSTES_PADRAO, ia_gancho: false }, BRENO.falas, OP);
    expect(p.some((x) => x.gancho)).toBe(false);
    expect(p.some((x) => x.k === 2)).toBe(false);
    expect(blocosDaLinha(s, p)[2].s1 - blocosDaLinha(s, p)[2].s0).toBe(0);
    const m = planoPrevia(simplificar(BRENO.trechos).map((t) => ({ ...t, mudo: true })), BRENO, AJUSTES_PADRAO, BRENO.falas, OP);
    expect(m.every((x) => x.volume === 0)).toBe(true);
  });
});
