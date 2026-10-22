// Estúdio React: tela de edição depois da gravação. Modelo e operações puras (testadas em src/test/edicaoReact.test.ts).
//
// A edição é a própria linha do tempo (trechos em segundos da gravação dele) com as escolhas dele em cada trecho; o
// serviço da VPS (infra/react/montagem.py) recebe exatamente isto em `trechos` + `edicao` e renderiza respeitando:
//   layout (dividido | ele | original | original_pip; sem layout = automático), volume 0..1 e mudo (som do original),
//   congelar (o original parado no quadro `orig` naquele trecho), removido (true = sai; false = fica, a IA não tira),
//   pausa (trecho congelado criado aqui, num ponto qualquer do original tocando).
// Escolha dele sempre vence a da IA: o que ele mandou ficar, a IA não tira; corte da IA restaurado não volta.
import type { Trecho } from "./linhaTempo";

export type LayoutTrecho = "dividido" | "ele" | "original" | "original_pip";
/** O que a prévia desenha: os 4 de cima + "cheia" (automático: você em tela cheia e o original no quadrinho). */
export type LayoutPrevia = LayoutTrecho | "cheia";
export type Retomar = "onde_parou" | "pular";

export interface TrechoEd extends Trecho {
  layout?: LayoutTrecho;
  volume?: number;
  mudo?: boolean;
  removido?: boolean;
  congelar?: boolean;
  pausa?: boolean;
}

export interface AjustesEdicao {
  volume_geral: number;
  ia_gancho: boolean;
  ia_titulo: boolean;
  cortes_ia_restaurados: string[];
}

export interface EdicaoSalva {
  trechos: TrechoEd[];
  edicao: AjustesEdicao;
  /** epoch em segundos */
  salvo_em?: number;
}

export interface CorteIA { id: string; ini: number; fim: number; texto: string; restaurado?: boolean }

export interface BaseEdicao {
  trechos: TrechoEd[];
  falas: [number, number][];
  dur_reacao: number;
  dur_original: number;
  sem_fala: [number, number][];
  ia: { aplicada: boolean; titulo: string; cortes: CorteIA[]; removidos: [number, number][]; tirados: [number, number][]; gancho: { ini: number; fim: number } | null };
}

export const AJUSTES_PADRAO: AjustesEdicao = { volume_geral: 1, ia_gancho: true, ia_titulo: true, cortes_ia_restaurados: [] };

export const ROTULO_LAYOUT: Record<LayoutTrecho, string> = {
  dividido: "Tela dividida",
  ele: "Só você",
  original: "Só o original",
  original_pip: "Original + você no canto",
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.001;
export const PAUSA_MIN = 0.3;

export const congelado = (t: TrechoEd) => t.tipo === "comentario" || !!t.congelar;
export const duracao = (t: Trecho) => Math.max(0, t.fim - t.ini);

/** Índice do trecho que contém o instante t da gravação (o último trecho fica com o instante final). */
export function trechoEm(trechos: Trecho[], t: number): number {
  const i = trechos.findIndex((x) => x.ini - EPS <= t && t < x.fim - EPS);
  if (i >= 0) return i;
  return trechos.length && t >= trechos[trechos.length - 1].fim - EPS ? trechos.length - 1 : -1;
}

/** Ponto do original no instante t (congelado = o quadro `orig`; tocando = anda junto). */
export function origEm(tr: TrechoEd, t: number): number {
  return congelado(tr) ? tr.orig : tr.orig + Math.max(0, Math.min(t, tr.fim) - tr.ini);
}

/** Som do original no trecho, 0..1 (mudo = 0; congelado não tem som do original). */
export function volumeEfetivo(tr: TrechoEd, geral = 1): number {
  if (congelado(tr) || tr.mudo) return 0;
  return Math.max(0, Math.min(1, (tr.volume ?? 1) * geral));
}

/** Layout que a prévia desenha. Automático = o do serviço: comentário de 5 s ou mais vai em tela cheia no "cheia_longos". */
export function layoutEfetivo(tr: TrechoEd, layoutGeral: "dividido" | "cheia_longos" = "dividido"): LayoutPrevia {
  if (tr.layout) return tr.layout;
  if (layoutGeral === "cheia_longos" && congelado(tr) && tr.tipo === "comentario" && duracao(tr) >= 5) return "cheia";
  return "dividido";
}

/** Base da edição a partir da linha do tempo da gravação (sem escolhas). */
export function baseDaLinha(linha: Trecho[]): TrechoEd[] {
  return linha.filter((t) => t.fim - t.ini > EPS).map((t) => ({ tipo: t.tipo, ini: r3(t.ini), fim: r3(t.fim), orig: r3(t.orig) }));
}

/** Escolhas em vários trechos de uma vez (undefined apaga a escolha = volta ao automático). */
export function aplicar(trechos: TrechoEd[], indices: number[], patch: Partial<TrechoEd>): TrechoEd[] {
  const sel = new Set(indices);
  return trechos.map((t, i) => {
    if (!sel.has(i)) return t;
    const n: TrechoEd = { ...t, ...patch };
    (Object.keys(patch) as (keyof TrechoEd)[]).forEach((k) => { if (patch[k] === undefined) delete n[k]; });
    if (n.congelar && n.tipo !== "tocando") delete n.congelar;
    return n;
  });
}

/**
 * Pausa nova: no instante t (gravação) de um trecho com o original tocando, o original congela por `dur` s e depois
 * continua de onde parou (padrão) ou pula o que tocou nesse tempo. Devolve os trechos novos ou um erro legível.
 */
export function pausarAqui(trechos: TrechoEd[], t: number, dur: number, retomar: Retomar = "onde_parou"): { trechos: TrechoEd[]; indice: number } | { erro: string } {
  const i = trechoEm(trechos, t);
  const tr = trechos[i];
  if (!tr || tr.tipo !== "tocando" || tr.congelar || tr.removido) {
    return { erro: "Toque num ponto em que o vídeo original está tocando." };
  }
  const a = r3(Math.max(tr.ini, t));
  const d = Math.min(dur, tr.fim - a);
  if (d < PAUSA_MIN) return { erro: "Pouco tempo até o fim deste trecho para pausar." };
  const b = r3(a + d);
  const parado = r3(origEm(tr, a));
  const { layout, volume, mudo } = tr;
  const escolhas: Partial<TrechoEd> = {};
  if (layout) escolhas.layout = layout;
  if (volume !== undefined) escolhas.volume = volume;
  if (mudo) escolhas.mudo = true;
  const novos: TrechoEd[] = [];
  if (a - tr.ini > 0.05) novos.push({ ...tr, fim: a });
  const indice = i + novos.length;
  novos.push({ tipo: "tocando", ini: a, fim: b, orig: parado, congelar: true, pausa: true, ...(layout ? { layout } : {}) });
  if (tr.fim - b > 0.05) novos.push({ tipo: "tocando", ini: b, fim: tr.fim, orig: retomar === "pular" ? r3(origEm(tr, b)) : parado, ...escolhas });
  return { trechos: [...trechos.slice(0, i), ...novos, ...trechos.slice(i + 1)], indice };
}

/** Desfaz uma pausa criada aqui: junta com o trecho tocando de antes (ele volta a andar sem parar). */
export function desfazerPausa(trechos: TrechoEd[], i: number): TrechoEd[] {
  const p = trechos[i];
  if (!p?.pausa) return trechos;
  const ant = trechos[i - 1];
  const prox = trechos[i + 1];
  const continua = (x?: TrechoEd) => x && x.tipo === "tocando" && !x.congelar;
  let ini = i;
  let fim = i;
  let base: TrechoEd;
  if (continua(ant) && Math.abs(ant!.fim - p.ini) < 0.01 && Math.abs(origEm(ant!, ant!.fim) - p.orig) < 0.05) {
    ini = i - 1;
    base = { ...ant! };
  } else {
    base = { ...p };
    delete base.congelar;
    delete base.pausa;
  }
  let fimT = p.fim;
  if (continua(prox) && Math.abs(prox!.ini - p.fim) < 0.01) { fim = i + 1; fimT = prox!.fim; }
  return [...trechos.slice(0, ini), { ...base, fim: fimT }, ...trechos.slice(fim + 1)];
}

/** "Enquanto eu falo": quanto dura a fala que está acontecendo em t (ou que começa até 1 s depois). null = sem fala perto. */
export function falaDepois(falas: [number, number][] | null | undefined, t: number, max = 15): number | null {
  if (!falas?.length) return null;
  const f = falas.find(([a, b]) => b > t + 0.1 && a <= t + 1.0);
  if (!f) return null;
  // falas separadas por respiro curto (< 0,6 s) contam como a mesma fala
  let fim = f[1];
  for (const [a, b] of falas) if (a > f[0] && a - fim < 0.6) fim = Math.max(fim, b);
  return r3(Math.max(PAUSA_MIN, Math.min(max, fim - t + 0.15)));
}

/** Duração aproximada do vídeo com estas escolhas (antes do corte de silêncio e da IA). */
export function duracaoPrevista(trechos: TrechoEd[]): number {
  return trechos.filter((t) => !t.removido).reduce((s, t) => s + duracao(t), 0);
}

/** Primeiro instante visível a partir de t (pula trechos removidos). null = acabou. */
export function proximoVisivel(trechos: TrechoEd[], t: number): number | null {
  let i = trechoEm(trechos, t);
  if (i < 0) return null;
  if (!trechos[i].removido) return t;
  while (i < trechos.length && trechos[i].removido) i += 1;
  return i < trechos.length ? trechos[i].ini : null;
}

export interface EstadoPrevia { i: number; removido: boolean; congelado: boolean; orig: number; volume: number; layout: LayoutPrevia }

/** O que a prévia mostra no instante t da gravação. */
export function estadoPrevia(trechos: TrechoEd[], t: number, geral: number, layoutGeral: "dividido" | "cheia_longos" = "dividido"): EstadoPrevia | null {
  const i = trechoEm(trechos, t);
  if (i < 0) return null;
  const tr = trechos[i];
  return { i, removido: !!tr.removido, congelado: congelado(tr), orig: origEm(tr, t), volume: volumeEfetivo(tr, geral), layout: layoutEfetivo(tr, layoutGeral) };
}

const dentro = (faixas: [number, number][] | undefined, t: TrechoEd) => {
  const m = (t.ini + t.fim) / 2;
  return !!faixas?.some(([a, b]) => a - EPS <= m && m < b + EPS);
};

/** O que a IA (ou o corte de silêncio) fez com o trecho na última montagem. */
export function situacaoIA(base: BaseEdicao | null | undefined, t: TrechoEd): "ia_removeu" | "ia_duracao" | "sem_fala" | null {
  if (!base || t.tipo !== "comentario") return null;
  if (dentro(base.ia?.removidos, t)) return "ia_removeu";
  if (dentro(base.ia?.tirados, t)) return "ia_duracao";
  if (dentro(base.sem_fala, t)) return "sem_fala";
  return null;
}

/** Cortes da IA (repetição, erro, muleta) dentro do trecho. */
export function cortesDoTrecho(base: BaseEdicao | null | undefined, t: TrechoEd): CorteIA[] {
  return (base?.ia?.cortes ?? []).filter((c) => { const m = (c.ini + c.fim) / 2; return t.ini <= m && m < t.fim; });
}

/** Só o que o serviço entende, sem campos vazios (o pedido fica pequeno e igual ao que é salvo). */
export function paraPedido(trechos: TrechoEd[]): TrechoEd[] {
  return trechos.map((t) => {
    const n: TrechoEd = { tipo: t.tipo, ini: r3(t.ini), fim: r3(t.fim), orig: r3(t.orig) };
    if (t.layout) n.layout = t.layout;
    if (t.volume !== undefined && t.volume < 0.999) n.volume = Math.round(Math.max(0, Math.min(1, t.volume)) * 100) / 100;
    if (t.mudo) n.mudo = true;
    if (t.removido !== undefined) n.removido = t.removido;
    if (t.congelar && t.tipo === "tocando") n.congelar = true;
    if (t.pausa) n.pausa = true;
    return n;
  });
}

/** Tem alguma escolha dele (para avisar "alterações não salvas" e para mostrar o selo no bloco)? */
export const temEscolha = (t: TrechoEd) =>
  !!t.layout || t.volume !== undefined || !!t.mudo || t.removido !== undefined || !!t.congelar || !!t.pausa;

/** Qual edição abrir: a salva mais nova (banco ou VPS); senão a base da última montagem; senão a linha da gravação. */
export function edicaoInicial(salvas: (EdicaoSalva | null | undefined)[], base: BaseEdicao | null | undefined, linha: Trecho[]): EdicaoSalva {
  const validas = salvas.filter((s): s is EdicaoSalva => !!s && Array.isArray(s.trechos) && s.trechos.length > 0);
  validas.sort((a, b) => (b.salvo_em ?? 0) - (a.salvo_em ?? 0));
  if (validas[0]) return { trechos: validas[0].trechos, edicao: { ...AJUSTES_PADRAO, ...(validas[0].edicao || {}) }, salvo_em: validas[0].salvo_em };
  if (base?.trechos?.length) return { trechos: baseDaLinha(base.trechos).map((t, i) => ({ ...base.trechos[i], ...t })), edicao: { ...AJUSTES_PADRAO } };
  return { trechos: baseDaLinha(linha), edicao: { ...AJUSTES_PADRAO } };
}

export function rotuloTrecho(t: TrechoEd): string {
  if (t.pausa) return "Pausa";
  if (t.tipo === "comentario") return "Comentário";
  return t.congelar ? "Congelado" : "Tocando";
}

// ------------------------------------------------------------------ blocos: juntar, dividir, aparar

/** Bloco mais curto que isto, sem escolha dele, é ruído da gravação (um toque no play): some no vizinho. */
export const MICRO = 0.5;
/** Mínimo desejado por bloco (só vale entre trechos que podem se juntar sem mudar o vídeo). */
export const BLOCO_MIN = 3;

const vol1 = (v?: number) => (v === undefined ? 1 : Math.round(v * 100) / 100);

/** Mesmas escolhas (layout, som, mudo, remover, congelar, pausa)? */
export function mesmaEscolha(a: TrechoEd, b: TrechoEd): boolean {
  return a.layout === b.layout && vol1(a.volume) === vol1(b.volume) && !!a.mudo === !!b.mudo && a.removido === b.removido
    && !!a.congelar === !!b.congelar && !!a.pausa === !!b.pausa;
}

/** b continua a de onde parou (mesmo tipo, colados, e o original no mesmo ponto)? Aí juntar não muda o vídeo. */
export function continua(a: TrechoEd, b: TrechoEd): boolean {
  if (a.tipo !== b.tipo || congelado(a) !== congelado(b) || Math.abs(a.fim - b.ini) > 0.01) return false;
  const onde = congelado(a) ? a.orig : origEm(a, a.fim);
  return Math.abs(onde - b.orig) < 0.05;
}

/** Junta vizinhos que continuam um ao outro e têm a mesma escolha (só entre os índices [de, ate], se dados). */
export function juntarCompativeis(trechos: TrechoEd[], de = 0, ate = Infinity): TrechoEd[] {
  const out: TrechoEd[] = [];
  trechos.forEach((t, i) => {
    const u = out[out.length - 1];
    if (u && i > de && i <= ate && continua(u, t) && mesmaEscolha(u, t)) out[out.length - 1] = { ...u, fim: t.fim };
    else out.push({ ...t });
  });
  return out;
}

/** Bloco de menos de MICRO s (sem escolha dele) entra no vizinho: o seguinte, ou o anterior se for o último. */
export function absorverMicros(trechos: TrechoEd[], micro = MICRO): TrechoEd[] {
  let out = trechos.map((t) => ({ ...t }));
  let mudou = true;
  while (mudou && out.length > 1) {
    mudou = false;
    for (let i = 0; i < out.length; i += 1) {
      const t = out[i];
      if (duracao(t) >= micro || temEscolha(t)) continue;
      const d = duracao(t);
      const prox = out[i + 1];
      const ant = out[i - 1];
      if (prox && (!ant || continua(t, prox) || !continua(ant, t))) {
        const n = { ...prox, ini: t.ini };
        if (!congelado(prox)) n.orig = r3(Math.max(0, prox.orig - d));
        out = [...out.slice(0, i), n, ...out.slice(i + 2)];
      } else if (ant) {
        out = [...out.slice(0, i - 1), { ...ant, fim: t.fim }, ...out.slice(i + 1)];
      } else continue;
      mudou = true;
      break;
    }
  }
  return out;
}

/** Menos blocos sem mudar o vídeo: some o ruído de toque e junta o que continua com a mesma escolha. */
export function simplificar(trechos: TrechoEd[]): TrechoEd[] {
  return juntarCompativeis(absorverMicros(juntarCompativeis(trechos)));
}

/** Divide o trecho que contém t em dois (as duas metades com as mesmas escolhas). */
export function dividirEm(trechos: TrechoEd[], t: number, folga = 0.2): { trechos: TrechoEd[]; indice: number } | { erro: string } {
  const i = trechoEm(trechos, t);
  const tr = trechos[i];
  if (!tr) return { erro: "Posicione a agulha sobre um bloco." };
  if (t - tr.ini < folga || tr.fim - t < folga) return { erro: "Muito perto da ponta do bloco para dividir." };
  const a = r3(t);
  const esq: TrechoEd = { ...tr, fim: a };
  const dir: TrechoEd = { ...tr, ini: a, orig: r3(origEm(tr, a)) };
  return { trechos: [...trechos.slice(0, i), esq, dir, ...trechos.slice(i + 1)], indice: i + 1 };
}

/** Junta o bloco i com o seguinte. Só quando um continua o outro (senão o vídeo mudaria); fica a escolha do primeiro. */
export function juntarComProximo(trechos: TrechoEd[], i: number): { trechos: TrechoEd[]; indice: number } | { erro: string } {
  const a = trechos[i];
  const b = trechos[i + 1];
  if (!a || !b) return { erro: "Não há bloco depois deste." };
  if (!continua(a, b)) {
    return { erro: a.tipo !== b.tipo || congelado(a) !== congelado(b)
      ? "Não dá para juntar: num o original toca e no outro ele está parado."
      : "Não dá para juntar: o original pula de um ponto para outro entre os dois." };
  }
  return { trechos: [...trechos.slice(0, i), { ...a, fim: b.fim }, ...trechos.slice(i + 2)], indice: i };
}

/** Marca [a, b] da gravação como removido (true), mantido (false) ou automático (undefined), partindo nas pontas. */
export function marcarRemovido(trechos: TrechoEd[], a: number, b: number, valor: boolean | undefined): TrechoEd[] {
  if (b - a < EPS) return trechos;
  const out: TrechoEd[] = [];
  for (const t of trechos) {
    if (t.fim <= a + EPS || t.ini >= b - EPS) { out.push(t); continue; }
    const partes: [number, number, boolean][] = [];
    if (a > t.ini + EPS) partes.push([t.ini, a, false]);
    partes.push([Math.max(t.ini, a), Math.min(t.fim, b), true]);
    if (b < t.fim - EPS) partes.push([b, t.fim, false]);
    for (const [s, e, dentro] of partes) {
      const n: TrechoEd = { ...t, ini: r3(s), fim: r3(e), orig: r3(origEm(t, s)) };
      if (dentro) { if (valor === undefined) delete n.removido; else n.removido = valor; }
      out.push(n);
    }
  }
  return out;
}

/**
 * Alça de aparar: leva a ponta `lado` do bloco i para o instante t (gravação). Encolher = o pedaço de fora sai
 * (removido); esticar = devolve o que estava removido colado a ele (até onde houver removido).
 */
export function aparar(trechos: TrechoEd[], i: number, lado: "ini" | "fim", t: number, min = 0.3): TrechoEd[] {
  const tr = trechos[i];
  if (!tr) return trechos;
  if (lado === "ini") {
    if (t > tr.ini) return marcarRemovido(trechos, tr.ini, Math.min(t, tr.fim - min), true);
    let lim = tr.ini;
    for (let j = i - 1; j >= 0 && trechos[j].removido === true && Math.abs(trechos[j].fim - lim) < 0.01; j -= 1) lim = trechos[j].ini;
    return marcarRemovido(trechos, Math.max(t, lim), tr.ini, tr.removido);
  }
  if (t < tr.fim) return marcarRemovido(trechos, Math.max(t, tr.ini + min), tr.fim, true);
  let lim = tr.fim;
  for (let j = i + 1; j < trechos.length && trechos[j].removido === true && Math.abs(trechos[j].ini - lim) < 0.01; j += 1) lim = trechos[j].fim;
  return marcarRemovido(trechos, tr.fim, Math.min(t, lim), tr.removido);
}
