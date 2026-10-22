// Tempo de resposta (delay) por agente: limites, sorteios, "digitando…", teto das esperas e a prévia da tela.
import { describe, expect, it } from "vitest";
import {
  calcularResponderApos,
  camposDoRitmo,
  DIGITANDO_MAX_S,
  formatarSegundos,
  naFaixa,
  normalizarRitmo,
  planoEsperas,
  previaTempo,
  RITMO_PADRAO,
  sortearAtraso,
  sortearEntre,
  tempoDigitandoS,
  TETO_ESPERA_ENVIO_S,
} from "../../supabase/functions/_shared/ritmoResposta.ts";
import { payloadAgente } from "@/lib/crm/treinarIA";

const sempre = (x: number) => () => x;

describe("normalizarRitmo: padrões e limites seguros", () => {
  it("agente sem os campos (banco antigo) = padrão 30 / 90 / 20-60 / digitando 8 cps / 3-8", () => {
    expect(normalizarRitmo({})).toEqual(RITMO_PADRAO);
    expect(normalizarRitmo(null)).toEqual({
      debounce: 30, debounceMax: 90, atrasoMin: 20, atrasoMax: 60, digitando: true, cps: 8, intervaloMin: 3, intervaloMax: 8,
    });
  });
  it("nunca negativo e sempre com teto", () => {
    const r = normalizarRitmo({
      debounce_segundos: -10, debounce_max_segundos: 99999, atraso_min_segundos: -5, atraso_max_segundos: 5000,
      digitando_cps: 0.1, intervalo_min_segundos: -1, intervalo_max_segundos: 999,
    });
    expect(r).toMatchObject({ debounce: 5, debounceMax: 600, atrasoMin: 0, atrasoMax: 300, cps: 2, intervaloMin: 0, intervaloMax: 60 });
    expect(normalizarRitmo({ digitando_cps: 500 }).cps).toBe(30);
    expect(normalizarRitmo({ debounce_segundos: 1000 }).debounce).toBe(300);
  });
  it("máximo das mensagens picadas nunca fica abaixo da espera", () => {
    expect(normalizarRitmo({ debounce_segundos: 120, debounce_max_segundos: 60 })).toMatchObject({ debounce: 120, debounceMax: 120 });
    expect(normalizarRitmo({ debounce_segundos: 300, debounce_max_segundos: 10 }).debounceMax).toBe(300);
  });
  it("mínimo maior que o máximo: troca (não quebra)", () => {
    expect(normalizarRitmo({ atraso_min_segundos: 60, atraso_max_segundos: 20 })).toMatchObject({ atrasoMin: 20, atrasoMax: 60 });
    expect(normalizarRitmo({ intervalo_min_segundos: 8, intervalo_max_segundos: 3 })).toMatchObject({ intervaloMin: 3, intervaloMax: 8 });
  });
  it("vazio, texto e NaN viram padrão; 0 é valor válido no atraso", () => {
    expect(naFaixa("", 0, 10, 7)).toBe(7);
    expect(naFaixa("abc", 0, 10, 7)).toBe(7);
    expect(naFaixa(Number.NaN, 0, 10, 7)).toBe(7);
    expect(normalizarRitmo({ atraso_min_segundos: 0, atraso_max_segundos: 0 })).toMatchObject({ atrasoMin: 0, atrasoMax: 0 });
  });
  it("digitando desligado é respeitado; nulo = ligado", () => {
    expect(normalizarRitmo({ digitando_ligado: false }).digitando).toBe(false);
    expect(normalizarRitmo({ digitando_ligado: null }).digitando).toBe(true);
  });
});

describe("sorteios", () => {
  it("sortearEntre fica sempre dentro de [min, max] (1000 sorteios) e alcança as pontas", () => {
    for (let i = 0; i < 1000; i++) {
      const s = sortearEntre(20, 60);
      expect(s).toBeGreaterThanOrEqual(20);
      expect(s).toBeLessThanOrEqual(60);
      expect(Number.isInteger(s)).toBe(true);
    }
    expect(sortearEntre(20, 60, sempre(0))).toBe(20);
    expect(sortearEntre(20, 60, sempre(0.99999999))).toBe(60);
    expect(sortearEntre(60, 20, sempre(0))).toBe(20);
    expect(sortearEntre(-5, -1, sempre(0.5))).toBe(0);
  });
  it("atraso sorteado usa a faixa do agente", () => {
    const r = normalizarRitmo({ atraso_min_segundos: 10, atraso_max_segundos: 15 });
    expect(sortearAtraso(r, sempre(0))).toBe(10);
    expect(sortearAtraso(r, sempre(0.999))).toBe(15);
  });
});

describe("calcularResponderApos (espelho do SQL crm_ai_enfileirar)", () => {
  const primeira = new Date(Date.UTC(2026, 9, 19, 15, 0, 0));
  const r = normalizarRitmo({ debounce_segundos: 30, debounce_max_segundos: 90 });
  it("debounce segundos depois da última mensagem", () => {
    const agora = new Date(primeira.getTime() + 10_000);
    expect(calcularResponderApos(primeira, agora, r).getTime()).toBe(agora.getTime() + 30_000);
  });
  it("lead que não para: no máximo debounceMax depois da primeira", () => {
    const agora = new Date(primeira.getTime() + 80_000);
    expect(calcularResponderApos(primeira, agora, r).getTime()).toBe(primeira.getTime() + 90_000);
  });
  it("teto do agente é respeitado (máximo 200 s)", () => {
    const r2 = normalizarRitmo({ debounce_segundos: 60, debounce_max_segundos: 200 });
    const agora = new Date(primeira.getTime() + 190_000);
    expect(calcularResponderApos(primeira, agora, r2).getTime()).toBe(primeira.getTime() + 200_000);
  });
  it("o atraso sorteado soma depois do debounce, com teto de 300 s e nunca negativo", () => {
    expect(calcularResponderApos(primeira, primeira, r, 40).getTime()).toBe(primeira.getTime() + 70_000);
    expect(calcularResponderApos(primeira, primeira, r, 9999).getTime()).toBe(primeira.getTime() + 330_000);
    expect(calcularResponderApos(primeira, primeira, r, -50).getTime()).toBe(primeira.getTime() + 30_000);
  });
});

describe("digitando proporcional ao tamanho", () => {
  const r = normalizarRitmo({});
  it("100 caracteres a 8 cps = 12,5 s; mais texto = mais tempo", () => {
    expect(tempoDigitandoS("x".repeat(100), r)).toBe(12.5);
    expect(tempoDigitandoS("x".repeat(80), r)).toBeLessThan(tempoDigitandoS("x".repeat(120), r));
  });
  it("piso de 1 s, teto de 25 s", () => {
    expect(tempoDigitandoS("ok", r)).toBe(1);
    expect(tempoDigitandoS("x".repeat(5000), r)).toBe(DIGITANDO_MAX_S);
  });
  it("desligado = 0; imagem/documento = 0; áudio = 0 (o gravando é do proxy, pela duração)", () => {
    expect(tempoDigitandoS("x".repeat(100), normalizarRitmo({ digitando_ligado: false }))).toBe(0);
    expect(tempoDigitandoS("https://x/img.png", r, "image")).toBe(0);
    expect(tempoDigitandoS("https://x/a.ogg", r, "audio")).toBe(0);
  });
  it("velocidade maior = menos tempo", () => {
    expect(tempoDigitandoS("x".repeat(100), normalizarRitmo({ digitando_cps: 20 }))).toBe(5);
  });
});

describe("planoEsperas: intervalo entre bolhas + digitando, com teto", () => {
  const r = normalizarRitmo({});
  it("primeira bolha sem intervalo; as outras com intervalo entre min e max", () => {
    const p = planoEsperas([{ tipo: "text", conteudo: "x".repeat(16) }, { tipo: "text", conteudo: "x".repeat(16) }], r, sempre(0));
    expect(p).toEqual([{ intervaloMs: 0, digitandoMs: 2000 }, { intervaloMs: 3000, digitandoMs: 2000 }]);
    const p2 = planoEsperas([{ tipo: "text", conteudo: "a" }, { tipo: "text", conteudo: "b" }], r, sempre(0.9999));
    expect(p2[1].intervaloMs).toBe(8000);
  });
  it("digitando desligado: só o intervalo entre as bolhas", () => {
    const p = planoEsperas([{ tipo: "text", conteudo: "oi" }, { tipo: "text", conteudo: "tudo bem?" }], normalizarRitmo({ digitando_ligado: false }), sempre(0));
    expect(p).toEqual([{ intervaloMs: 0, digitandoMs: 0 }, { intervaloMs: 3000, digitandoMs: 0 }]);
  });
  it("a soma das esperas nunca passa do teto (resposta enorme em muitas bolhas)", () => {
    const muitas = Array.from({ length: 8 }, () => ({ tipo: "text", conteudo: "x".repeat(400) }));
    const p = planoEsperas(muitas, normalizarRitmo({ intervalo_min_segundos: 60, intervalo_max_segundos: 60 }), sempre(0));
    const soma = p.reduce((s, e) => s + e.intervaloMs + e.digitandoMs, 0);
    expect(soma).toBe(TETO_ESPERA_ENVIO_S * 1000);
    expect(p.every((e) => e.intervaloMs >= 0 && e.digitandoMs >= 0)).toBe(true);
  });
});

describe("prévia da tela (resposta típica: 2 bolhas de ~100 caracteres)", () => {
  it("padrão: 1ª bolha entre 68,5 e 108,5 s; resposta inteira entre 84 e 129 s", () => {
    // 30 espera + 20..60 atraso + 6 IA + 12,5 digitando = 68,5..108,5; + 12,5 digitando + 3..8 intervalo
    const p = previaTempo(normalizarRitmo({}));
    expect(p.digitandoPorBolha).toBe(12.5);
    expect(p.primeiraMin).toBe(Math.round(30 + 20 + 6 + 12.5));
    expect(p.primeiraMax).toBe(Math.round(30 + 60 + 6 + 12.5));
    expect(p.totalMin).toBe(Math.round(30 + 20 + 6 + 25 + 3));
    expect(p.totalMax).toBe(Math.round(30 + 60 + 6 + 25 + 8));
  });
  it("tudo zerado e digitando desligado: só espera + IA", () => {
    const p = previaTempo(normalizarRitmo({
      debounce_segundos: 5, atraso_min_segundos: 0, atraso_max_segundos: 0, digitando_ligado: false, intervalo_min_segundos: 0, intervalo_max_segundos: 0,
    }));
    expect(p).toMatchObject({ primeiraMin: 11, primeiraMax: 11, totalMin: 11, totalMax: 11, digitandoPorBolha: 0 });
  });
  it("formata segundos e minutos", () => {
    expect(formatarSegundos(45)).toBe("45 s");
    expect(formatarSegundos(90)).toBe("1 min 30 s");
    expect(formatarSegundos(120)).toBe("2 min");
    expect(formatarSegundos(-3)).toBe("0 s");
  });
});

describe("gravação no agente (payloadAgente)", () => {
  const base = {
    id: "a1", slug: "s", nome: "A", prompt: "p", base_conhecimento: null, etapas: [], origens: [], gatilhos: [], modelo: null,
    temperatura: 0.2, ativo: false, horario_inicio: null, horario_fim: null, dias_semana: [], limite_interacoes: 15,
    historico_mensagens: 20, atraso_segundos: 0, numero_id: null, link_agendamento: null, mensagem_fora_horario: null,
    politicas: null, frase_transferencia: null, palavras_transferencia: [],
  };
  it("com as colunas novas: grava tudo na faixa e coerente", () => {
    const p = payloadAgente({
      ...base, debounce_segundos: 400, debounce_max_segundos: 20, atraso_min_segundos: 90, atraso_max_segundos: 30,
      digitando_ligado: false, digitando_cps: 99, intervalo_min_segundos: -2, intervalo_max_segundos: 5,
    });
    expect(p).toMatchObject({
      debounce_segundos: 300, debounce_max_segundos: 300, atraso_min_segundos: 30, atraso_max_segundos: 90,
      digitando_ligado: false, digitando_cps: 30, intervalo_min_segundos: 0, intervalo_max_segundos: 5,
    });
  });
  it("banco sem a migration: não manda coluna que não existe; debounce na faixa antiga 10..120", () => {
    const p = payloadAgente({ ...base, debounce_segundos: 5 });
    expect(p.debounce_segundos).toBe(10);
    expect("atraso_min_segundos" in p).toBe(false);
    expect("digitando_ligado" in p).toBe(false);
  });
  it("camposDoRitmo do padrão = defaults das colunas da migration", () => {
    expect(camposDoRitmo(RITMO_PADRAO)).toEqual({
      debounce_segundos: 30, debounce_max_segundos: 90, atraso_min_segundos: 20, atraso_max_segundos: 60,
      digitando_ligado: true, digitando_cps: 8, intervalo_min_segundos: 3, intervalo_max_segundos: 8,
    });
  });
});
