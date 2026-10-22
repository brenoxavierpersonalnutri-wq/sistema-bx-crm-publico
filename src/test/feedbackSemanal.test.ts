import { describe, it, expect } from "vitest";
import {
  montarResumoWhatsApp,
  cardioReferencia,
  whatsappLink,
  FEEDBACK_PRODUTOS,
  WHATSAPP_CONSULTORIA,
  FeedbackSemanalResponse,
  limparNumeroLocal,
  telefoneE164,
  paisPorIso,
  alternarValor,
  listaValores,
  rotulosMultiplos,
  MAIOR_GARGALO,
  produtoDoPrograma,
} from "@/types/feedbackSemanal";

describe("cardioReferencia", () => {
  it("mapeia as notas da escala do Breno", () => {
    expect(cardioReferencia(10)).toBe("FC acima de 180 bpm");
    expect(cardioReferencia(7)).toBe("FC por volta de 150 bpm");
    expect(cardioReferencia(3)).toBe("FC por volta de 110 bpm");
    expect(cardioReferencia(2)).toBe("FC abaixo de 110 bpm");
  });

  it("trata notas abaixo da tabela e valores ausentes", () => {
    expect(cardioReferencia(2)).toBe("FC abaixo de 110 bpm");
    expect(cardioReferencia(undefined)).toBeNull();
    expect(cardioReferencia(null)).toBeNull();
  });
});

describe("montarResumoWhatsApp", () => {
  const completo: Partial<FeedbackSemanalResponse> = {
    nome: "  Ana Paula  ",
    treino_execucao: 8,
    treino_reps_reserva: "1-3",
    treino_frequencia_semanal: "4x",
    cardio_minutos_semanais: "60-120",
    cardio_intensidade: 7,
    dieta_adesao: 5,
    dieta_refeicoes_fora: "2",
    dieta_beliscando: "quase_todo_dia",
    maior_gargalo: "dieta,sono",
    percebe_mudanca: "sim_pouco",
    mudanca_descricao: "Calça folgou na cintura",
    programa_indicaria: 9,
    consultoria_feedback: "Gostando muito do suporte",
    consultoria_sente_falta: "Senti falta de mais vídeo de execução",
  };

  it("monta o resumo com nome limpo e produto", () => {
    const txt = montarResumoWhatsApp(completo, FEEDBACK_PRODUTOS.elite);
    expect(txt).toContain("*Feedback Elite*");
    expect(txt).toContain("Aluna: Ana Paula");
  });

  it("traduz os valores fechados para os rótulos legíveis", () => {
    const txt = montarResumoWhatsApp(completo, FEEDBACK_PRODUTOS.mgmd);
    expect(txt).toContain("Frequência: 4x na semana");
    expect(txt).toContain("Refeições livres na semana: 2 refeições livres, estou atenta");
    expect(txt).toContain("Beliscando: Quase todo dia");
    expect(txt).toContain("Séries válidas (repetições que ainda dava): 1 a 3 repetições");
    expect(txt).toContain("Minutos de cardio na semana: De 60 a 120 min");
    expect(txt).toContain("Maior gargalo: Dieta, Sono e recuperação");
    expect(txt).toContain("Percebe mudança no corpo: Sim, pouca coisa");
  });

  it("separa o feedback do programa do que a aluna sente falta", () => {
    const txt = montarResumoWhatsApp(completo, FEEDBACK_PRODUTOS.mgmd);
    expect(txt).toContain("Indicaria o programa: 9/10");
    expect(txt).toContain("Sobre o programa: Gostando muito do suporte");
    expect(txt).toContain(
      "O que sente falta, o que pode melhorar: Senti falta de mais vídeo de execução"
    );

  });

  it("inclui a referência de FC junto da intensidade do cardio", () => {
    const txt = montarResumoWhatsApp(completo, FEEDBACK_PRODUTOS.mgmd);
    expect(txt).toContain("Intensidade do cardio: 7/10 (FC por volta de 150 bpm)");
  });

  it("mantém as três seções quando tudo foi respondido", () => {
    const txt = montarResumoWhatsApp(completo, FEEDBACK_PRODUTOS.mgmd);
    expect(txt).toContain("*TREINO*");
    expect(txt).toContain("*DIETA*");
    expect(txt).toContain("*GERAL*");
  });

  it("não gera linha nem seção pra pergunta pulada", () => {
    const txt = montarResumoWhatsApp(
      { nome: "Bia", treino_execucao: 6 },
      FEEDBACK_PRODUTOS.mgmd
    );
    expect(txt).toContain("Técnica, amplitude e cadência: 6/10");
    expect(txt).not.toContain("*DIETA*");
    expect(txt).not.toContain("*GERAL*");
    expect(txt).not.toContain("undefined");
  });

  it("preserva nota 0 (0 é resposta, não ausência)", () => {
    const txt = montarResumoWhatsApp(
      { nome: "Cris", dieta_adesao: 0 },
      FEEDBACK_PRODUTOS.mgmd
    );
    expect(txt).toContain("Adesão (segunda a segunda): 0/10");
  });

  it("cai pra Semanal quando a periodicidade não foi marcada", () => {
    const txt = montarResumoWhatsApp({ nome: "Dani" }, FEEDBACK_PRODUTOS.mgmd);
    expect(txt).toContain("*Feedback MGMD*");
  });
});

describe("whatsappLink", () => {
  it("monta o link do wa.me com o texto codificado", () => {
    const link = whatsappLink(WHATSAPP_CONSULTORIA, "Oi, tudo bem?");
    expect(link).toBe(`https://wa.me/${WHATSAPP_CONSULTORIA}?text=Oi%2C%20tudo%20bem%3F`);
  });

  it("codifica quebra de linha e asterisco do resumo", () => {
    const link = whatsappLink("5531999999999", montarResumoWhatsApp({ nome: "Ana" }, FEEDBACK_PRODUTOS.mgmd));
    expect(link).toContain("%0A");
    expect(link).not.toContain(" ");
  });
});

describe("telefone com seletor de país", () => {
  const BR = paisPorIso("BR");
  const PT = paisPorIso("PT");
  const US = paisPorIso("US");

  it("tira espaço, traço e parênteses do que a aluna digitar", () => {
    expect(limparNumeroLocal("31 99000-0107", BR)).toBe("31990000107");
    expect(limparNumeroLocal("(31) 99000 0107", BR)).toBe("31990000107");
  });

  it("descarta o DDI colado na frente", () => {
    expect(limparNumeroLocal("5531990000107", BR)).toBe("31990000107");
    expect(limparNumeroLocal("+55 31 99000-0107", BR)).toBe("31990000107");
    expect(limparNumeroLocal("351912345678", PT)).toBe("912345678");
  });

  it("não mutila quem é do DDD 55 de verdade", () => {
    expect(limparNumeroLocal("5531994659", BR)).toBe("5531994659");
  });

  it("monta E.164 com o país escolhido", () => {
    expect(telefoneE164("31990000107", BR)).toBe("+5531990000107");
    expect(telefoneE164("912345678", PT)).toBe("+351912345678");
    expect(telefoneE164("4155551234", US)).toBe("+14155551234");
  });

  it("país desconhecido cai no Brasil", () => {
    expect(paisPorIso("ZZ").iso).toBe("BR");
  });
});

describe("gargalo com múltipla escolha", () => {
  it("marca e desmarca sem perder o que já estava", () => {
    expect(alternarValor("", "treino")).toBe("treino");
    expect(alternarValor("treino", "dieta")).toBe("treino,dieta");
    expect(alternarValor("treino,dieta", "treino")).toBe("dieta");
  });

  it("'nenhum, tá fluindo' marca sozinho", () => {
    expect(alternarValor("treino,dieta", "nenhum")).toBe("nenhum");
    expect(alternarValor("nenhum", "treino")).toBe("treino");
    expect(alternarValor("nenhum", "nenhum")).toBe("");
  });

  it("lê a lista e os rótulos", () => {
    expect(listaValores("treino,dieta")).toEqual(["treino", "dieta"]);
    expect(listaValores(undefined)).toEqual([]);
    expect(rotulosMultiplos(MAIOR_GARGALO, "treino,cardio")).toBe("Treino, Cardio");
    expect(rotulosMultiplos(MAIOR_GARGALO, "")).toBeNull();
  });
});

describe("produto pelo plano da aluna", () => {
  it("reconhece MGMD escrito de jeitos diferentes", () => {
    expect(produtoDoPrograma("MGMD")?.slug).toBe("mgmd");
    expect(produtoDoPrograma("mgmd 12 meses")?.slug).toBe("mgmd");
    expect(produtoDoPrograma("-Gordura +Definição")?.slug).toBe("mgmd");
  });

  it("reconhece Elite, inclusive 'Consultoria de Elite'", () => {
    expect(produtoDoPrograma("Elite")?.slug).toBe("elite");
    expect(produtoDoPrograma("Consultoria de Elite")?.slug).toBe("elite");
    expect(produtoDoPrograma("CONSULTORIA DE ELITE - ANUAL")?.slug).toBe("elite");
  });

  it("reconhece a Plataforma", () => {
    expect(produtoDoPrograma("Plataforma")?.slug).toBe("plataforma");
    expect(produtoDoPrograma("PLATAFORMA MAGRA E DEFINIDA")?.slug).toBe("plataforma");
    expect(produtoDoPrograma("Magra e Definida")?.slug).toBe("plataforma");
  });

  it("devolve null quando não dá pra saber", () => {
    expect(produtoDoPrograma("")).toBeNull();
    expect(produtoDoPrograma(null)).toBeNull();
    expect(produtoDoPrograma("acompanhamento avulso")).toBeNull();
  });

  it("os três produtos existem com os slugs das rotas", () => {
    expect(FEEDBACK_PRODUTOS.mgmd.slug).toBe("mgmd");
    expect(FEEDBACK_PRODUTOS.elite.slug).toBe("elite");
    expect(FEEDBACK_PRODUTOS.plataforma.slug).toBe("plataforma");
  });
});
