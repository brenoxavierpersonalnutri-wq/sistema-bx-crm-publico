// Pré-visualização das reprises na aba Programação (pura). As regras de data, limite e cota moram em
// supabase/functions/_shared/reprises.ts, o mesmo arquivo que a edge live-aula usa: a tela e o servidor contam igual.
import {
  deLocalBrt, fimDoDiaBrt, gerarDatas, MAX_REPRISES, motivoDataInvalida, normalizarDatas, type Frequencia,
} from "../../../supabase/functions/_shared/reprises.ts";

export type ModoReprise = "datas" | "recorrencia";
export type FimRecorrencia = "ate" | "vezes" | "sempre";
type Modo = ModoReprise;
type Fim = FimRecorrencia;

/** Datas que serão criadas (ou o motivo de não dar). Puro: a tela usa para a pré-visualização. */
export function previaReprises(o: {
  modo: Modo; datas: string[]; freq: Frequencia; inicio: string; fim: Fim; ate: string; vezes: string; agora: Date;
}): { datas: Date[]; erro: string | null; continua: boolean } {
  if (o.modo === "datas") {
    const preenchidas = o.datas.filter(Boolean);
    if (!preenchidas.length) return { datas: [], erro: null, continua: false };
    const lidas = preenchidas.map(deLocalBrt);
    if (lidas.some((d) => !d)) return { datas: [], erro: "há uma data incompleta", continua: false };
    const datas = normalizarDatas(lidas as Date[]);
    if (datas.length > MAX_REPRISES) return { datas, erro: `no máximo ${MAX_REPRISES} reprises por vez`, continua: false };
    const inval = datas.map((d) => motivoDataInvalida(d, o.agora)).find(Boolean);
    return { datas, erro: inval ?? null, continua: false };
  }
  const inicio = deLocalBrt(o.inicio);
  if (!inicio) return { datas: [], erro: null, continua: false };
  const g = gerarDatas({
    frequenciaDias: o.freq,
    inicio,
    ate: o.fim === "ate" ? fimDoDiaBrt(o.ate) ?? new Date(NaN) : null,
    quantidade: o.fim === "vezes" ? Number(o.vezes) : null,
    continua: o.fim === "sempre",
  });
  if (g.ok === false) return { datas: [], erro: g.motivo, continua: false };
  return { datas: g.datas, erro: motivoDataInvalida(g.datas[0], o.agora), continua: g.continua };
}
