// Tempo de resposta (delay) do agente de IA, 19/10/2026: lógica pura, sem Deno e sem banco. A mesma conta roda na tela
// (aba Configuração do agente, prévia do tempo total), no webhook (quando a fila responde) e no ai-robo-tick (quanto
// espera antes de cada bolha). Testes em src/test/ritmoResposta.test.ts.
//
// Linha do tempo de uma resposta, a partir da ÚLTIMA mensagem da lead:
//   1) espera a lead terminar de escrever (debounce_segundos; cada mensagem nova reinicia a conta),
//      nunca passando de debounce_max_segundos depois da PRIMEIRA mensagem da rajada;
//   2) atraso antes de responder: um sorteio entre atraso_min_segundos e atraso_max_segundos
//      (1 + 2 viram o responder_apos da crm_ai_fila: ninguém fica dormindo dentro da função);
//   3) o Claude escreve a resposta;
//   4) cada bolha: "digitando…" proporcional ao tamanho (digitando_cps caracteres por segundo, se ligado);
//      entre uma bolha e a próxima, um sorteio entre intervalo_min_segundos e intervalo_max_segundos.
// Valores fora da faixa são trazidos para a faixa (nunca negativo, sempre com teto): o banco tem CHECK igual.

export interface CamposRitmo {
  debounce_segundos?: number | null;
  debounce_max_segundos?: number | null;
  atraso_min_segundos?: number | null;
  atraso_max_segundos?: number | null;
  digitando_ligado?: boolean | null;
  digitando_cps?: number | null;
  intervalo_min_segundos?: number | null;
  intervalo_max_segundos?: number | null;
}

export interface RitmoResposta {
  debounce: number;
  debounceMax: number;
  atrasoMin: number;
  atrasoMax: number;
  digitando: boolean;
  cps: number;
  intervaloMin: number;
  intervaloMax: number;
}

/** Faixas aceitas (segundos; cps em caracteres por segundo) e o padrão de cada campo. Iguais aos CHECK da migration. */
export const LIMITES_RITMO = {
  debounce: { min: 5, max: 300, padrao: 30 },
  debounceMax: { min: 10, max: 600, padrao: 90 },
  atraso: { min: 0, max: 300, padraoMin: 20, padraoMax: 60 },
  cps: { min: 2, max: 30, padrao: 8 },
  intervalo: { min: 0, max: 60, padraoMin: 3, padraoMax: 8 },
} as const;

/** "Digitando…" de uma bolha: piso de 1 s, teto de 25 s (o WhatsApp apaga o indicador sozinho perto disso). */
export const DIGITANDO_MIN_S = 1;
export const DIGITANDO_MAX_S = 25;
/** Soma das esperas no envio de UMA resposta (digitando + intervalos): a função do tick tem relógio de parede. */
export const TETO_ESPERA_ENVIO_S = 60;

export const RITMO_PADRAO: RitmoResposta = {
  debounce: LIMITES_RITMO.debounce.padrao,
  debounceMax: LIMITES_RITMO.debounceMax.padrao,
  atrasoMin: LIMITES_RITMO.atraso.padraoMin,
  atrasoMax: LIMITES_RITMO.atraso.padraoMax,
  digitando: true,
  cps: LIMITES_RITMO.cps.padrao,
  intervaloMin: LIMITES_RITMO.intervalo.padraoMin,
  intervaloMax: LIMITES_RITMO.intervalo.padraoMax,
};

/** Número na faixa; vazio, texto ou NaN = padrão. Inteiro (o banco guarda integer). */
export function naFaixa(v: unknown, min: number, max: number, padrao: number): number {
  if (v === null || v === undefined || v === "") return padrao;
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/** Lê os campos do agente (banco antigo sem as colunas = padrão) e devolve o ritmo dentro dos limites. */
export function normalizarRitmo(a: CamposRitmo | null | undefined): RitmoResposta {
  const L = LIMITES_RITMO;
  const c = a ?? {};
  const debounce = naFaixa(c.debounce_segundos, L.debounce.min, L.debounce.max, L.debounce.padrao);
  // o máximo nunca é menor que a espera normal
  const debounceMax = Math.max(debounce, naFaixa(c.debounce_max_segundos, L.debounceMax.min, L.debounceMax.max, L.debounceMax.padrao));
  let atrasoMin = naFaixa(c.atraso_min_segundos, L.atraso.min, L.atraso.max, L.atraso.padraoMin);
  let atrasoMax = naFaixa(c.atraso_max_segundos, L.atraso.min, L.atraso.max, L.atraso.padraoMax);
  if (atrasoMin > atrasoMax) [atrasoMin, atrasoMax] = [atrasoMax, atrasoMin];
  let intervaloMin = naFaixa(c.intervalo_min_segundos, L.intervalo.min, L.intervalo.max, L.intervalo.padraoMin);
  let intervaloMax = naFaixa(c.intervalo_max_segundos, L.intervalo.min, L.intervalo.max, L.intervalo.padraoMax);
  if (intervaloMin > intervaloMax) [intervaloMin, intervaloMax] = [intervaloMax, intervaloMin];
  return {
    debounce,
    debounceMax,
    atrasoMin,
    atrasoMax,
    digitando: c.digitando_ligado === null || c.digitando_ligado === undefined ? true : Boolean(c.digitando_ligado),
    cps: naFaixa(c.digitando_cps, L.cps.min, L.cps.max, L.cps.padrao),
    intervaloMin,
    intervaloMax,
  };
}

/** Campos para gravar no crm_ai_agents (já na faixa e coerentes entre si). */
export function camposDoRitmo(r: RitmoResposta): Required<{ [K in keyof CamposRitmo]: NonNullable<CamposRitmo[K]> }> {
  return {
    debounce_segundos: r.debounce,
    debounce_max_segundos: r.debounceMax,
    atraso_min_segundos: r.atrasoMin,
    atraso_max_segundos: r.atrasoMax,
    digitando_ligado: r.digitando,
    digitando_cps: r.cps,
    intervalo_min_segundos: r.intervaloMin,
    intervalo_max_segundos: r.intervaloMax,
  };
}

/** Sorteio uniforme entre min e max (inclusive), em segundos inteiros. Invertido não quebra. */
export function sortearEntre(min: number, max: number, aleatorio: () => number = Math.random): number {
  const a = Math.max(0, Math.min(min, max));
  const b = Math.max(0, Math.max(min, max));
  const x = Math.min(0.999999, Math.max(0, aleatorio()));
  return a + Math.floor(x * (b - a + 1));
}

/** Atraso sorteado antes de responder (segundos), somado ao responder_apos da fila. */
export const sortearAtraso = (r: RitmoResposta, aleatorio?: () => number): number => sortearEntre(r.atrasoMin, r.atrasoMax, aleatorio);

/**
 * Quando responder uma rajada (espelho do SQL crm_ai_enfileirar): agora + debounce, mas nunca mais que debounceMax
 * depois da primeira mensagem da rajada; depois disso, + o atraso sorteado.
 */
export function calcularResponderApos(primeiraMsg: Date, agora: Date, r: RitmoResposta, atrasoS = 0): Date {
  const atraso = naFaixa(atrasoS, LIMITES_RITMO.atraso.min, LIMITES_RITMO.atraso.max, 0);
  const base = Math.min(primeiraMsg.getTime() + r.debounceMax * 1000, agora.getTime() + r.debounce * 1000);
  return new Date(Math.max(base, agora.getTime()) + atraso * 1000);
}

/** "Digitando…" de uma bolha em segundos (0 quando desligado ou quando não é texto/áudio). */
export function tempoDigitandoS(texto: string, r: RitmoResposta, tipo = "text"): number {
  if (!r.digitando) return 0;
  // áudio: o "gravando áudio…" é do proxy (proporcional à duração do arquivo, que só ele conhece; 21/10/2026)
  if (tipo === "audio") return 0;
  if (tipo !== "text") return 0;
  const s = String(texto ?? "").length / r.cps;
  return Math.round(Math.min(DIGITANDO_MAX_S, Math.max(DIGITANDO_MIN_S, s)) * 10) / 10;
}

export interface EsperaBolha {
  /** pausa antes desta bolha por ser a 2ª, 3ª... (0 na primeira) */
  intervaloMs: number;
  /** "digitando…" antes desta bolha */
  digitandoMs: number;
}

/**
 * Esperas do envio de uma resposta com várias bolhas. A soma nunca passa de TETO_ESPERA_ENVIO_S: o que estoura sai
 * do fim (a última bolha espera menos), para o tick não morrer no relógio de parede com metade da resposta enviada.
 */
export function planoEsperas(
  mensagens: { tipo: string; conteudo: string }[],
  r: RitmoResposta,
  aleatorio: () => number = Math.random,
): EsperaBolha[] {
  let resta = TETO_ESPERA_ENVIO_S * 1000;
  return mensagens.map((m, i) => {
    const intervalo = i === 0 ? 0 : Math.min(resta, sortearEntre(r.intervaloMin, r.intervaloMax, aleatorio) * 1000);
    resta -= intervalo;
    const digitando = Math.min(resta, Math.round(tempoDigitandoS(m.conteudo, r, m.tipo) * 1000));
    resta -= digitando;
    return { intervaloMs: intervalo, digitandoMs: digitando };
  });
}

export interface PreviaTempo {
  /** segundos depois da última mensagem da lead até a 1ª bolha sair (sem contar o tempo do Claude) */
  primeiraMin: number;
  primeiraMax: number;
  /** até a última bolha sair */
  totalMin: number;
  totalMax: number;
  digitandoPorBolha: number;
}

/** Resposta típica da prévia da tela: 2 bolhas de ~100 caracteres. */
export const RESPOSTA_TIPICA = { bolhas: 2, caracteres: 100 } as const;
/** Tempo que o Claude costuma levar (classificação + resposta), só para a prévia. */
export const TEMPO_IA_TIPICO_S = 6;

/** Prévia do tempo total de uma resposta típica (o que a tela mostra). */
export function previaTempo(r: RitmoResposta, tipica: { bolhas: number; caracteres: number } = RESPOSTA_TIPICA): PreviaTempo {
  const dig = tempoDigitandoS("x".repeat(tipica.caracteres), r);
  const bolhas = Math.max(1, tipica.bolhas);
  const envioDigitando = Math.min(TETO_ESPERA_ENVIO_S, dig * bolhas);
  const envioMin = Math.min(TETO_ESPERA_ENVIO_S, envioDigitando + r.intervaloMin * (bolhas - 1));
  const envioMax = Math.min(TETO_ESPERA_ENVIO_S, envioDigitando + r.intervaloMax * (bolhas - 1));
  const antesMin = r.debounce + r.atrasoMin + TEMPO_IA_TIPICO_S;
  const antesMax = r.debounce + r.atrasoMax + TEMPO_IA_TIPICO_S;
  return {
    primeiraMin: Math.round(antesMin + Math.min(TETO_ESPERA_ENVIO_S, dig)),
    primeiraMax: Math.round(antesMax + Math.min(TETO_ESPERA_ENVIO_S, dig)),
    totalMin: Math.round(antesMin + envioMin),
    totalMax: Math.round(antesMax + envioMax),
    digitandoPorBolha: dig,
  };
}

/** "45 s", "1 min 30 s", "2 min". */
export function formatarSegundos(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  const r = t % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
