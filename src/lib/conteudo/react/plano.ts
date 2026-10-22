// Estúdio React: o plano da PRÉVIA CONTÍNUA da tela de edição (testado em src/test/planoReact.test.ts).
//
// É o mesmo planejamento que o montagem.py faz (`planejar` + `aplicar_edicao`), em versão de navegador: a partir dos
// trechos com as escolhas dele, do que a IA fez na última montagem (base) e das falas medidas na VPS, sai a lista de
// PEDAÇOS na ordem em que o vídeo final vai tocar:
//   - gancho da IA (se ligado) abrindo o vídeo;
//   - trecho removido por ele, comentário que a IA tirou (e ele não mandou ficar) e comentário sem fala não entram;
//   - cortes da IA (repetição, "é...") não restaurados saem do meio;
//   - comentário tem o silêncio do começo/fim e o silêncio longo do meio cortados (folgas do modelo de edição);
//   - original tocando e congelado/pausa escolhido por ele entram inteiros.
// A prévia toca esses pedaços em sequência sem parar; a linha do tempo desenha no tempo de SAÍDA (o do vídeo final).
// O que NÃO entra na prévia: legenda, zoom de ênfase e o encurtamento do original para caber na duração máxima.
import { congelado, origEm, volumeEfetivo, type AjustesEdicao, type BaseEdicao, type LayoutPrevia, type TrechoEd } from "./edicao";

export interface CorteSilencio { silencio_longo: number; folga_antes: number; folga_depois: number }

const CORTE_PADRAO: CorteSilencio = { silencio_longo: 0.7, folga_antes: 0.12, folga_depois: 0.22 };
/** Folgas do corte de silêncio por modelo (infra/react/modelos/<id>.json, campo "corte"). */
export const CORTE_POR_MODELO: Record<string, CorteSilencio> = {
  eduestevesfitness: { silencio_longo: 0.4, folga_antes: 0.08, folga_depois: 0.12 },
};
export const corteDoModelo = (m?: string) => (m && CORTE_POR_MODELO[m]) || CORTE_PADRAO;

const MIN_FALA = 0.12;
const COMENTARIO_LONGO = 5;
const QUADRO = 1 / 30;
const EPS = 1e-3;

export interface Pedaco {
  /** índice do trecho de onde o pedaço vem */
  k: number;
  /** segundos da gravação dele */
  ini: number;
  fim: number;
  /** começo no vídeo final */
  s0: number;
  gancho?: boolean;
  layout: LayoutPrevia;
  congelado: boolean;
  /** som do original 0..1 */
  volume: number;
}

export interface OpcoesPlano {
  cortar_silencio: boolean;
  layout: "dividido" | "cheia_longos";
  ia: boolean;
  modelo?: string;
}

/** Tirar intervalos [a, b] de uma lista de intervalos (ordenados). */
export function subtrairFaixas(faixas: [number, number][], tirar: [number, number][]): [number, number][] {
  let out = faixas.map((f) => [...f] as [number, number]);
  for (const [a, b] of tirar) {
    const nova: [number, number][] = [];
    for (const [s, e] of out) {
      if (b <= s || a >= e) { nova.push([s, e]); continue; }
      if (a > s) nova.push([s, a]);
      if (b < e) nova.push([b, e]);
    }
    out = nova;
  }
  return out.filter(([s, e]) => e - s > EPS);
}

/** Onde ele fala dentro de [a, b] e o que sobra depois do corte de silêncio (o mesmo cálculo do planejar()). */
export function blocosComFala(a: number, b: number, falas: [number, number][], c: CorteSilencio): [number, number][] {
  const dentro = falas
    .map(([s, e]) => [Math.max(a, s), Math.min(b, e)] as [number, number])
    .filter(([s, e]) => e - s >= MIN_FALA)
    .sort((x, y) => x[0] - y[0]);
  if (!dentro.length) return [];
  const juntas: [number, number][] = [[...dentro[0]]];
  for (const [s, e] of dentro.slice(1)) {
    if (s - juntas[juntas.length - 1][1] < c.silencio_longo) juntas[juntas.length - 1][1] = Math.max(juntas[juntas.length - 1][1], e);
    else juntas.push([s, e]);
  }
  const blocos: [number, number][] = [];
  for (const [s, e] of juntas) {
    let s2 = Math.max(a, s - c.folga_antes);
    const e2 = Math.min(b, e + c.folga_depois);
    if (blocos.length && s2 < blocos[blocos.length - 1][1]) s2 = blocos[blocos.length - 1][1];
    if (e2 - s2 > EPS) blocos.push([s2, e2]);
  }
  return blocos;
}

const meio = (t: { ini: number; fim: number }) => (t.ini + t.fim) / 2;
const contem = (faixas: [number, number][] | undefined, m: number) => !!faixas?.some(([a, b]) => a - EPS <= m && m < b + EPS);

/** O trecho sai do vídeo final inteiro? (removido por ele, ou a IA tirou e ele não mandou ficar) */
export function trechoFora(t: TrechoEd, base: BaseEdicao | null | undefined, op: Pick<OpcoesPlano, "ia">): boolean {
  if (t.removido === true) return true;
  if (t.removido === false || t.tipo !== "comentario" || !op.ia || !base?.ia?.aplicada) return false;
  return contem(base.ia.removidos, meio(t)) || contem(base.ia.tirados, meio(t));
}

/** Os pedaços do vídeo final, na ordem, com o começo de cada um no tempo de saída. */
export function planoPrevia(trechos: TrechoEd[], base: BaseEdicao | null | undefined, ajustes: AjustesEdicao,
  falas: [number, number][] | null | undefined, op: OpcoesPlano): Pedaco[] {
  const corte = corteDoModelo(op.modelo);
  const restaurados = new Set(ajustes.cortes_ia_restaurados);
  const cortesIA: [number, number][] = op.ia && base?.ia?.aplicada
    ? (base.ia.cortes ?? []).filter((c) => !restaurados.has(c.id) && !c.restaurado).map((c) => [c.ini, c.fim] as [number, number])
    : [];
  const pedacos: Omit<Pedaco, "s0">[] = [];
  trechos.forEach((t, k) => {
    if (trechoFora(t, base, op)) return;
    let blocos: [number, number][];
    const ehComentario = t.tipo === "comentario";
    if (ehComentario && op.cortar_silencio && falas) {
      blocos = blocosComFala(t.ini, t.fim, falas, corte);
      if (!blocos.length) return;     // pausou e não falou nada: sai, como na montagem
    } else {
      blocos = [[t.ini, t.fim]];
    }
    if (ehComentario) blocos = subtrairFaixas(blocos, cortesIA);
    const total = blocos.reduce((s, [a, b]) => s + b - a, 0);
    const lay: LayoutPrevia = t.layout
      ?? (ehComentario && op.layout === "cheia_longos" && total >= COMENTARIO_LONGO ? "cheia" : "dividido");
    const cong = congelado(t);
    const vol = volumeEfetivo(t, ajustes.volume_geral);
    for (const [a, b] of blocos) {
      if (b - a < 2 * QUADRO) continue;
      pedacos.push({ k, ini: a, fim: b, layout: lay, congelado: cong, volume: vol });
    }
  });
  // gancho da IA: 2 a 4 s do melhor comentário abrindo o vídeo (some se o trecho dele saiu)
  const g = base?.ia?.gancho;
  if (op.ia && base?.ia?.aplicada && ajustes.ia_gancho && g && g.fim - g.ini > 0.3) {
    const p = pedacos.find((x) => !x.gancho && x.ini - EPS <= meio(g) && meio(g) < x.fim + EPS);
    if (p) pedacos.unshift({ ...p, ini: g.ini, fim: g.fim, gancho: true });
  }
  let s = 0;
  return pedacos.map((p) => { const out = { ...p, s0: s }; s += p.fim - p.ini; return out; });
}

export const duracaoSaida = (plano: Pedaco[]) => (plano.length ? plano[plano.length - 1].s0 + plano[plano.length - 1].fim - plano[plano.length - 1].ini : 0);

/** Pedaço que está tocando no tempo de saída s (o último fica com o fim). */
export function pedacoEmSaida(plano: Pedaco[], s: number): number {
  if (!plano.length) return -1;
  for (let i = 0; i < plano.length; i += 1) {
    const p = plano[i];
    if (s < p.s0 + (p.fim - p.ini) - EPS) return i;
  }
  return plano.length - 1;
}

/** Tempo de saída -> pedaço e segundo da gravação. */
export function saidaParaGravacao(plano: Pedaco[], s: number): { i: number; t: number } | null {
  const i = pedacoEmSaida(plano, Math.max(0, s));
  if (i < 0) return null;
  const p = plano[i];
  return { i, t: Math.min(p.fim, p.ini + Math.max(0, s - p.s0)) };
}

/** Segundo da gravação -> tempo de saída (ponto removido = começo do próximo pedaço que fica). Ignora o gancho. */
export function gravacaoParaSaida(plano: Pedaco[], t: number): number {
  for (const p of plano) {
    if (p.gancho) continue;
    if (t < p.ini) return p.s0;
    if (t < p.fim) return p.s0 + (t - p.ini);
  }
  return duracaoSaida(plano);
}

/** O bloco de cada trecho na linha do tempo (tempo de saída). Trecho que sai inteiro tem largura 0. */
export interface BlocoLinha { k: number; s0: number; s1: number }
export function blocosDaLinha(trechos: TrechoEd[], plano: Pedaco[]): BlocoLinha[] {
  let cursor = plano.find((p) => !p.gancho)?.s0 ?? 0;
  return trechos.map((_, k) => {
    const ps = plano.filter((p) => p.k === k && !p.gancho);
    if (!ps.length) return { k, s0: cursor, s1: cursor };
    const s0 = ps[0].s0;
    const last = ps[ps.length - 1];
    cursor = last.s0 + last.fim - last.ini;
    return { k, s0, s1: cursor };
  });
}

/** Estado da prévia num ponto da saída: onde estão os dois vídeos e como desenhar. */
export interface QuadroPrevia { i: number; k: number; t: number; orig: number; layout: LayoutPrevia; congelado: boolean; volume: number; gancho: boolean }
export function quadroEm(plano: Pedaco[], trechos: TrechoEd[], s: number): QuadroPrevia | null {
  const r = saidaParaGravacao(plano, s);
  if (!r) return null;
  const p = plano[r.i];
  const tr = trechos[p.k];
  if (!tr) return null;
  return { i: r.i, k: p.k, t: r.t, orig: origEm(tr, r.t), layout: p.layout, congelado: p.congelado, volume: p.volume, gancho: !!p.gancho };
}
