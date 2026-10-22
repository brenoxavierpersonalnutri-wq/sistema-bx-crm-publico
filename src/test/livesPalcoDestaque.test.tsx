// Palco com 2+ (o print do Breno, 21/10): "Breno Xavier (você)" + "Vídeo da aula" no palco. Quem aparece em cada
// layout, como o destaque é escolhido e gravado (stage_ordem), e os controles da fila e da linha de destaque.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  calcularCena, destaqueDoPalco, ehAulaCena, inverterDoisPrimeiros, ordemAoSubir, ordemParaDestacar, quemAparece,
  type ParticipanteCena,
} from "@/lib/lives/layout";
import { FilaBastidores, type PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import { ControlesPalco } from "@/components/lives/estudio/ControlesPalco";

const p = (identity: string, ordem?: number, extra: Partial<ParticipanteCena> = {}): ParticipanteCena => ({
  identity,
  attributes: { stage: "1", ...(ordem === undefined ? {} : { stage_ordem: String(ordem) }) },
  ...extra,
});
const AULA = "aula-video-6f9f7b3b22a0";
const BRENO = "prod_1234abcd_xyz";

/** aplica as trocas de stage_ordem como o live-control faria (atributo do participante) */
function aplicar(ps: ParticipanteCena[], trocas: { identity: string; ordem: number }[]): ParticipanteCena[] {
  return ps.map((x) => {
    const t = trocas.filter((y) => y.identity === x.identity).pop();
    return t ? { ...x, attributes: { ...x.attributes, stage: "1", stage_ordem: String(t.ordem) } } : x;
  });
}

describe("o cenário do print: produtor + vídeo da aula, os dois com stage_ordem 0", () => {
  // o token do produtor e o webhook do vídeo da aula gravam stage_ordem "0": a identity desempata
  const ps = [p(BRENO, 0), p(AULA, 0)];

  it("o destaque padrão é o vídeo da aula", () => {
    expect(ehAulaCena(AULA)).toBe(true);
    expect(destaqueDoPalco(ps)?.identity).toBe(AULA);
  });

  it("1 pessoa: só o vídeo da aula, em tela cheia", () => {
    expect(quemAparece("solo", ps)).toEqual([`${AULA}:camera`]);
    expect(calcularCena("solo", ps)[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("2 lado a lado e grade: os dois, o destaque primeiro", () => {
    expect(quemAparece("lado-a-lado", ps)).toEqual([`${AULA}:camera`, `${BRENO}:camera`]);
    expect(quemAparece("grade", ps)).toEqual([`${AULA}:camera`, `${BRENO}:camera`]);
  });

  it("tela + pessoa sem tela compartilhada: vídeo da aula grande e o Breno pequeno no canto", () => {
    const cena = calcularCena("tela-pip", ps);
    expect(cena.map((b) => `${b.identity}:${b.fonte}`)).toEqual([`${AULA}:camera`, `${BRENO}:camera`]);
    expect(cena[0]).toMatchObject({ w: 1, h: 1, z: 1 });
    expect(cena[1].w).toBeLessThan(0.3);
    expect(cena[1].z).toBeGreaterThan(cena[0].z);
  });

  it("só tela sem tela compartilhada: o vídeo da aula ocupa o quadro", () => {
    expect(calcularCena("tela-cheia", ps)).toEqual([{ key: `${AULA}:camera`, identity: AULA, fonte: "camera", x: 0, y: 0, w: 1, h: 1, z: 1 }]);
  });

  it("com tela compartilhada, ela ganha do vídeo da aula como imagem grande; o vídeo da aula não vira miniatura", () => {
    const comTela = [p(BRENO, 0, { temTela: true }), p(AULA, 0)];
    expect(quemAparece("tela-pip", comTela)).toEqual([`${BRENO}:tela`, `${BRENO}:camera`]);
    expect(quemAparece("tela-cheia", comTela)).toEqual([`${BRENO}:tela`]);
  });

  it("Destacar o Breno: 1 pessoa passa a mostrar só ele; o lado a lado inverte", () => {
    const depois = aplicar(ps, [{ identity: BRENO, ordem: ordemParaDestacar(ps, BRENO) }]);
    expect(quemAparece("solo", depois)).toEqual([`${BRENO}:camera`]);
    expect(quemAparece("lado-a-lado", depois)).toEqual([`${BRENO}:camera`, `${AULA}:camera`]);
  });

  it("Inverter troca os dois primeiros, mesmo empatados em 0, e inverter de novo desfaz", () => {
    const uma = aplicar(ps, inverterDoisPrimeiros(ps));
    expect(quemAparece("lado-a-lado", uma)).toEqual([`${BRENO}:camera`, `${AULA}:camera`]);
    const duas = aplicar(uma, inverterDoisPrimeiros(uma));
    expect(quemAparece("lado-a-lado", duas)).toEqual([`${AULA}:camera`, `${BRENO}:camera`]);
  });

  it("só o 2º: tirar o 1º do palco deixa só o outro", () => {
    const semAula = ps.map((x) => (x.identity === AULA ? { ...x, attributes: { stage: "0" } } : x));
    expect(quemAparece("grade", semAula)).toEqual([`${BRENO}:camera`]);
    expect(quemAparece("tela-pip", semAula)).toEqual([`${BRENO}:camera`]); // sem tela e sem vídeo: cai para grade
  });
});

describe("quem sobe ao palco", () => {
  it("sem vídeo da aula, quem sobe vira o destaque (o último que entrou)", () => {
    const ps = [p(BRENO, 0), p("conv_a", 1, { attributes: { stage: "0" } })];
    const { ordem, trocas } = ordemAoSubir(ps, "conv_a");
    expect(trocas).toEqual([]);
    const depois = aplicar(ps, [{ identity: "conv_a", ordem }]);
    expect(destaqueDoPalco(depois)?.identity).toBe("conv_a");
    expect(quemAparece("solo", depois)).toEqual(["conv_a:camera"]);
  });

  it("com o vídeo da aula no palco, ele continua em destaque e quem sobe entra em 2º", () => {
    const ps = [p(AULA, 0), p(BRENO, 1), p("conv_a", undefined, { attributes: { stage: "0" } })];
    const { ordem, trocas } = ordemAoSubir(ps, "conv_a");
    const depois = aplicar(ps, [...trocas, { identity: "conv_a", ordem }]);
    expect(quemAparece("lado-a-lado", depois)).toEqual([`${AULA}:camera`, "conv_a:camera"]);
    expect(quemAparece("grade", depois).map((x) => x.split(":")[0])).toEqual([AULA, "conv_a", BRENO]);
  });

  it("o vídeo da aula que sobe vai para a frente", () => {
    const ps = [p(BRENO, 0), p("conv_a", 1), p(AULA, undefined, { attributes: { stage: "0" } })];
    const { ordem } = ordemAoSubir(ps, AULA);
    expect(destaqueDoPalco(aplicar(ps, [{ identity: AULA, ordem }]))?.identity).toBe(AULA);
  });

  it("palco vazio: ordem 0", () => {
    expect(ordemAoSubir([], BRENO)).toEqual({ ordem: 0, trocas: [] });
  });
});

describe("controles na fila e na linha de destaque", () => {
  const PESSOAS: PessoaFila[] = [
    { identity: AULA, nome: "Vídeo da aula", noPalco: true, posicao: 1, destaque: true },
    { identity: BRENO, nome: "Breno Xavier", noPalco: true, posicao: 2, voce: true, papel: "produtor" },
    { identity: "conv_a", nome: "Carla", noPalco: false },
  ];

  it("cada miniatura do palco tem Tirar do palco; Destacar só em quem não é o destaque; bastidores tem Colocar no palco", () => {
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={() => undefined} onDestacar={() => undefined} />);
    const aula = within(screen.getByTestId(`fila-${AULA}`));
    expect(aula.getByText("Destaque")).toBeInTheDocument();
    expect(aula.getByRole("button", { name: /Tirar do palco/ })).toBeInTheDocument();
    expect(aula.queryByRole("button", { name: /Destacar/ })).toBeNull();
    const breno = within(screen.getByTestId(`fila-${BRENO}`));
    expect(breno.getByText("2º")).toBeInTheDocument();
    expect(breno.getByRole("button", { name: /Destacar/ })).toBeInTheDocument();
    const conv = within(screen.getByTestId("fila-conv_a"));
    expect(conv.getByRole("button", { name: /Colocar no palco/ })).toBeInTheDocument();
    expect(conv.queryByRole("button", { name: /Destacar/ })).toBeNull();
  });

  it("Destacar e o clique na miniatura chamam onDestacar(identity)", () => {
    const onDestacar = vi.fn();
    render(<FilaBastidores pessoas={PESSOAS} onAlternar={() => undefined} onDestacar={onDestacar} />);
    const li = screen.getByTestId(`fila-${BRENO}`);
    fireEvent.click(within(li).getByRole("button", { name: /Destacar/ }));
    expect(onDestacar).toHaveBeenLastCalledWith(BRENO);
    onDestacar.mockClear();
    const camada = within(li).getByRole("button", { name: /Destacar/ }).parentElement!;
    fireEvent.click(camada);
    expect(onDestacar).toHaveBeenCalledWith(BRENO);
  });

  it("seletor Destaque: lista quem está no palco e troca; Inverter só no 2 lado a lado", () => {
    const onDestacar = vi.fn();
    const onInverter = vi.fn();
    const { rerender } = render(<ControlesPalco layout="solo" pessoas={PESSOAS} onDestacar={onDestacar} onInverter={onInverter} />);
    const sel = screen.getByLabelText("Destaque do palco") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Vídeo da aula", "Breno Xavier (você)"]);
    expect(sel.value).toBe(AULA);
    expect(screen.getByTestId("resumo-palco")).toHaveTextContent("No ar: Vídeo da aula");
    fireEvent.change(sel, { target: { value: BRENO } });
    expect(onDestacar).toHaveBeenCalledWith(BRENO);
    expect(screen.queryByRole("button", { name: /Inverter/ })).toBeNull();
    rerender(<ControlesPalco layout="lado-a-lado" pessoas={PESSOAS} onDestacar={onDestacar} onInverter={onInverter} />);
    expect(screen.getByTestId("resumo-palco")).toHaveTextContent("No ar: Vídeo da aula e Breno Xavier");
    fireEvent.click(screen.getByRole("button", { name: /Inverter/ }));
    expect(onInverter).toHaveBeenCalled();
  });

  it("com menos de 2 no palco a linha de destaque some", () => {
    render(<ControlesPalco layout="solo" pessoas={[PESSOAS[0], PESSOAS[2]]} onDestacar={() => undefined} />);
    expect(screen.queryByTestId("controles-palco")).toBeNull();
  });
});
