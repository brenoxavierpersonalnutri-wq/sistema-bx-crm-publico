import { describe, it, expect } from "vitest";
import {
  versaoMenorQue, normalizarCaminho, formatarExercicio, agruparEmBlocos,
  validarNota, validarPeso,
} from "../../supabase/functions/mobile-v1/lib";

describe("versaoMenorQue — porta de atualização obrigatória", () => {
  it("compara por número, não por string", () => {
    // O caso que a comparação de string erra: "1.2.10" < "1.2.9" seria true
    expect(versaoMenorQue("1.2.10", "1.2.9")).toBe(false);
    expect(versaoMenorQue("1.2.9", "1.2.10")).toBe(true);
  });

  it("reconhece versão igual como suficiente", () => {
    expect(versaoMenorQue("2.0.0", "2.0.0")).toBe(false);
  });

  it("trata segmentos ausentes como zero", () => {
    expect(versaoMenorQue("2.0", "2.0.0")).toBe(false);
    expect(versaoMenorQue("2.0", "2.0.1")).toBe(true);
    expect(versaoMenorQue("3", "2.9.9")).toBe(false);
  });

  it("não derruba app com versão malformada", () => {
    expect(versaoMenorQue("", "1.0.0")).toBe(true);
    expect(versaoMenorQue("abc", "1.0.0")).toBe(true);
  });
});

describe("normalizarCaminho — roteamento", () => {
  it("resolve o caminho servido pelo Supabase e o de dev local para a mesma rota", () => {
    expect(normalizarCaminho("/functions/v1/mobile-v1/treino/concluir")).toBe("treino/concluir");
    expect(normalizarCaminho("/mobile-v1/treino/concluir")).toBe("treino/concluir");
  });

  it("ignora barra final", () => {
    expect(normalizarCaminho("/functions/v1/mobile-v1/bootstrap/")).toBe("bootstrap");
    expect(normalizarCaminho("/functions/v1/mobile-v1/bootstrap//")).toBe("bootstrap");
  });

  it("devolve string vazia na raiz", () => {
    expect(normalizarCaminho("/functions/v1/mobile-v1")).toBe("");
    expect(normalizarCaminho("/functions/v1/mobile-v1/")).toBe("");
  });
});

describe("formatarExercicio — formato que o app nativo consome", () => {
  const linha = {
    id: "te-1", ordem: 1, series: 4, repeticoes: "10-12",
    cadencia: "3-0-1-0", descanso_seg: 90, metodo_avancado: "drop-set",
    observacao: "Descer até 90 graus", agrupamento: "A",
    exercicios: {
      nome: "Agachamento livre", equipamento: "Barra", grupo_muscular: "pernas",
      youtube_id: "dQw4w9WgXcQ", thumbnail_url: null, instrucoes: "Pés na largura do quadril",
    },
  };

  it("entrega a prescrição inteira num objeto plano", () => {
    const r = formatarExercicio(linha);
    expect(r.nome).toBe("Agachamento livre");
    expect(r.series).toBe(4);
    expect(r.repeticoes).toBe("10-12");
    expect(r.cadencia).toBe("3-0-1-0");
    expect(r.descanso_seg).toBe(90);
    expect(r.metodo_avancado).toBe("drop-set");
    expect(r.observacao).toBe("Descer até 90 graus");
    expect(r.agrupamento).toBe("A");
  });

  it("monta embed e thumbnail para o app não parsear link", () => {
    const r = formatarExercicio(linha);
    expect(r.video?.embed_url).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(r.video?.embed_url).toContain("playsinline=1");
    // Sem thumbnail no banco, deriva do id em vez de devolver null
    expect(r.video?.thumbnail_url).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("devolve video null quando o exercício não tem vídeo", () => {
    const r = formatarExercicio({ ...linha, exercicios: { ...linha.exercicios, youtube_id: null } });
    expect(r.video).toBeNull();
  });

  it("não quebra quando o join do exercício vem vazio", () => {
    const r = formatarExercicio({ id: "te-2", ordem: 1, series: 3, repeticoes: "12" });
    expect(r.nome).toBe("Exercício");
    expect(r.video).toBeNull();
  });
});

describe("agruparEmBlocos — bi-set e tri-set", () => {
  it("junta exercícios seguidos com a mesma letra", () => {
    const blocos = agruparEmBlocos([
      { id: "1", agrupamento: "A" },
      { id: "2", agrupamento: "A" },
      { id: "3", agrupamento: null },
    ]);
    expect(blocos).toHaveLength(2);
    expect(blocos[0].itens).toHaveLength(2);
    expect(blocos[0].agrupamento).toBe("A");
    expect(blocos[1].itens).toHaveLength(1);
  });

  it("não junta letras iguais que não estão lado a lado", () => {
    const blocos = agruparEmBlocos([
      { id: "1", agrupamento: "A" },
      { id: "2", agrupamento: "B" },
      { id: "3", agrupamento: "A" },
    ]);
    expect(blocos).toHaveLength(3);
  });

  it("mantém exercícios isolados separados mesmo em sequência", () => {
    const blocos = agruparEmBlocos([
      { id: "1", agrupamento: null },
      { id: "2", agrupamento: null },
    ]);
    expect(blocos).toHaveLength(2);
  });
});

describe("validação de entrada do feedback", () => {
  it("aceita notas de 0 a 10", () => {
    expect(validarNota(0)).toBe(0);
    expect(validarNota(10)).toBe(10);
    expect(validarNota("7")).toBe(7);
    expect(validarNota(7.6)).toBe(8);
  });

  it("recusa nota fora da escala", () => {
    expect(() => validarNota(11)).toThrow(RangeError);
    expect(() => validarNota(-1)).toThrow(RangeError);
    expect(() => validarNota("abc")).toThrow(RangeError);
  });

  it("trata ausência como null em vez de erro", () => {
    expect(validarNota(null)).toBeNull();
    expect(validarNota(undefined)).toBeNull();
    expect(validarNota("")).toBeNull();
  });

  it("aceita peso com vírgula, como a aluna digita", () => {
    expect(validarPeso("62,4")).toBe(62.4);
    expect(validarPeso("62.4")).toBe(62.4);
    expect(validarPeso(62)).toBe(62);
  });

  it("recusa peso impossível", () => {
    expect(() => validarPeso(0)).toThrow(RangeError);
    expect(() => validarPeso(-5)).toThrow(RangeError);
    expect(() => validarPeso(500)).toThrow(RangeError);
    expect(() => validarPeso("muito")).toThrow(RangeError);
  });
});
