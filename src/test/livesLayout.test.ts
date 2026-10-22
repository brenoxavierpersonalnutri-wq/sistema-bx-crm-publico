// Quem está no palco e onde cada vídeo fica — a mesma função alimenta a prévia e o render do Egress.
import { describe, expect, it } from "vitest";
import { calcularCena, lerEstadoCena, noPalco, nosBastidores, type Bloco, type ParticipanteCena } from "@/lib/lives/layout";

const p = (identity: string, stage?: string, extra: Partial<ParticipanteCena> = {}): ParticipanteCena => ({
  identity,
  attributes: stage === undefined ? {} : { stage, ...(extra.attributes ?? {}) },
  ...extra,
  ...(extra.attributes ? { attributes: { ...(stage === undefined ? {} : { stage }), ...extra.attributes } } : {}),
});

const dentro = (b: Bloco) => b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9;
const sobrepoe = (a: Bloco, b: Bloco) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

describe("palco × bastidores", () => {
  it("só stage=1 entra no palco; render/oculto nunca aparece", () => {
    const ps = [p("prod", "1"), p("conv", "0"), p("semattr"), p("egress", "1", { oculto: true })];
    expect(noPalco(ps).map((x) => x.identity)).toEqual(["prod"]);
    expect(nosBastidores(ps).map((x) => x.identity)).toEqual(["conv", "semattr"]);
  });

  it("ordena pelo stage_ordem, depois pela identity", () => {
    const ps = [p("c", "1", { attributes: { stage_ordem: "2" } }), p("a", "1"), p("b", "1", { attributes: { stage_ordem: "0" } })];
    expect(noPalco(ps).map((x) => x.identity)).toEqual(["b", "c", "a"]);
  });

  it("bastidores não geram bloco na cena", () => {
    const cena = calcularCena("grade", [p("prod", "1"), p("conv", "0")]);
    expect(cena.map((b) => b.identity)).toEqual(["prod"]);
  });

  it("palco vazio = cena vazia", () => {
    expect(calcularCena("solo", [p("conv", "0")])).toEqual([]);
  });
});

describe("layouts", () => {
  const quatro = ["a", "b", "c", "d"].map((i) => p(i, "1"));

  it("solo: só o primeiro do palco, em tela cheia", () => {
    const cena = calcularCena("solo", quatro);
    expect(cena).toHaveLength(1);
    expect(cena[0]).toMatchObject({ identity: "a", x: 0, y: 0, w: 1, h: 1 });
  });

  it("lado a lado: 2 colunas do mesmo tamanho, sem sobrepor, dentro do quadro", () => {
    const cena = calcularCena("lado-a-lado", quatro.slice(0, 2));
    expect(cena).toHaveLength(2);
    expect(cena[0].w).toBeCloseTo(cena[1].w);
    expect(cena[0].x).toBeLessThan(cena[1].x);
    expect(cena.every(dentro)).toBe(true);
    expect(sobrepoe(cena[0], cena[1])).toBe(false);
  });

  it("2 lado a lado com mais de 2 no palco: só os 2 primeiros da ordem", () => {
    expect(calcularCena("lado-a-lado", quatro).map((b) => b.identity)).toEqual(["a", "b"]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 9, 12])("grade com %i: todos aparecem, sem sobreposição, dentro do quadro", (n) => {
    const ps = Array.from({ length: n }, (_, i) => p(`p${String(i).padStart(2, "0")}`, "1"));
    const cena = calcularCena("grade", ps);
    expect(cena).toHaveLength(n);
    expect(cena.every(dentro)).toBe(true);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(sobrepoe(cena[i], cena[j])).toBe(false);
  });

  it("tela + PIP: tela em cheio e câmeras do palco por cima, no canto (máx. 3)", () => {
    const ps = [p("a", "1", { temTela: true }), p("b", "1"), p("c", "1"), p("d", "1"), p("e", "1")];
    const cena = calcularCena("tela-pip", ps);
    expect(cena[0]).toMatchObject({ identity: "a", fonte: "tela", x: 0, y: 0, w: 1, h: 1 });
    const pips = cena.slice(1);
    expect(pips).toHaveLength(3);
    expect(pips.every((b) => b.fonte === "camera" && b.z > cena[0].z && b.x > 0.5 && dentro(b))).toBe(true);
    for (let i = 0; i < pips.length; i++) for (let j = i + 1; j < pips.length; j++) expect(sobrepoe(pips[i], pips[j])).toBe(false);
  });

  it("tela + PIP sem ninguém compartilhando cai para grade", () => {
    const ps = [p("a", "1"), p("b", "1")];
    expect(calcularCena("tela-pip", ps)).toEqual(calcularCena("grade", ps));
  });

  it("tela de quem está nos bastidores não vai para a cena", () => {
    const cena = calcularCena("tela-pip", [p("a", "1"), p("b", "0", { temTela: true })]);
    expect(cena.some((b) => b.fonte === "tela")).toBe(false);
  });

  it("tela cheia sem ninguém compartilhando cai para grade", () => {
    const ps = [p("a", "1"), p("b", "1")];
    expect(calcularCena("tela-cheia", ps)).toEqual(calcularCena("grade", ps));
  });
});

// O bug do print do Breno (18/10): com tela compartilhada, "Solo" mostrava a tela e "Só a tela" não funcionava.
describe("layouts com tela compartilhada ativa (pessoa + tela)", () => {
  const ps = [p("ana", "1", { temTela: true, attributes: { stage_ordem: "0" } }), p("carlos", "1", { attributes: { stage_ordem: "1" } })];
  const fontes = (l: Parameters<typeof calcularCena>[0]) => calcularCena(l, ps).map((b) => `${b.identity}:${b.fonte}`);

  it("solo: só a pessoa em destaque, nunca a tela", () => {
    const cena = calcularCena("solo", ps);
    expect(cena).toHaveLength(1);
    expect(cena[0]).toMatchObject({ identity: "ana", fonte: "camera", x: 0, y: 0, w: 1, h: 1 });
  });

  it("lado a lado: as duas pessoas, sem a tela", () => {
    expect(fontes("lado-a-lado")).toEqual(["ana:camera", "carlos:camera"]);
  });

  it("grade: só as câmeras", () => {
    expect(fontes("grade")).toEqual(["ana:camera", "carlos:camera"]);
  });

  it("tela + pessoa: a tela em cheio e as pessoas em miniatura por cima", () => {
    const cena = calcularCena("tela-pip", ps);
    expect(cena[0]).toMatchObject({ identity: "ana", fonte: "tela", w: 1, h: 1 });
    expect(cena.slice(1).map((b) => b.fonte)).toEqual(["camera", "camera"]);
    expect(cena.slice(1).every((b) => b.z > cena[0].z && b.w < 0.3)).toBe(true);
  });

  it("tela cheia: só a tela compartilhada, ocupando o quadro todo", () => {
    expect(calcularCena("tela-cheia", ps)).toEqual([{ key: "ana:tela", identity: "ana", fonte: "tela", x: 0, y: 0, w: 1, h: 1, z: 1 }]);
  });

  it("solo com 1 pessoa compartilhando continua na câmera", () => {
    expect(calcularCena("solo", [p("ana", "1", { temTela: true })])[0].fonte).toBe("camera");
  });
});

describe("estado da cena (metadata da sala)", () => {
  it("aceita o layout tela-cheia vindo da metadata", () => {
    expect(lerEstadoCena(JSON.stringify({ layout: "tela-cheia" })).layout).toBe("tela-cheia");
  });

  it("lê layout e overlays válidos", () => {
    const m = JSON.stringify({ layout: "solo", cor: "#ff0000", overlays: [{ id: "1", tipo: "banner", visivel: true, conteudo: { texto: "Oi" } }, { id: "2", tipo: "xss" }] });
    const e = lerEstadoCena(m);
    expect(e.layout).toBe("solo");
    expect(e.cor).toBe("#ff0000");
    expect(e.overlays.map((o) => o.id)).toEqual(["1"]);
  });

  it("metadata ausente, quebrada ou com layout desconhecido nunca derruba o render", () => {
    expect(lerEstadoCena(undefined).layout).toBe("grade");
    expect(lerEstadoCena("{nao é json").layout).toBe("grade");
    expect(lerEstadoCena(JSON.stringify({ layout: "mosaico", overlays: "x" }))).toEqual({ layout: "grade", overlays: [], cor: undefined });
  });
});
