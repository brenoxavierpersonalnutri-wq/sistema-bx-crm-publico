// Semana de aulas (método LPSG: 6 lives por semana numa playlist do YouTube, não listadas). Puro: sem Deno, sem
// banco; usado pela edge live-aula e pela tela. Horário de Brasília fixo, como nas reprises.
//
// Fluxo: a tela chama semana-criar (playlist nova ou existente + linha em live_semanas) e depois semana-aula uma por
// uma, NA ORDEM (cada aula: live programada + vídeo + Iniciar sozinho + item na playlist). Uma por chamada porque a
// miniatura de cada aula pode ter 2 MB e o corpo da função tem teto de 3 MB; e idempotente por (semana, ordem):
// repetir a chamada da mesma aula devolve a que já existe (o "Tentar de novo as que faltaram" usa isso).
import { CUSTO_YT, DIA_MS, deLocalBrt, formatarBrt, motivoDataInvalida, paraLocalBrt, sufixoData } from "./reprises.ts";

export const AULAS_PADRAO = 6;
export const MAX_AULAS = 7;
/** Unidades da YouTube Data API: playlists.insert 50, playlists.delete 50 (tabela oficial, 21/10/2026). */
export const CUSTO_PLAYLIST = 50;

export type AulaSemana = { titulo: string; video_id: string; agendada_em: string; miniatura?: boolean };

const ID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** N dias seguidos no mesmo horário a partir de "AAAA-MM-DDTHH:mm" (Brasília). */
export function datasSeguidas(inicioLocal: string, n = AULAS_PADRAO): string[] {
  const ini = deLocalBrt(inicioLocal);
  if (!ini) return [];
  return Array.from({ length: n }, (_, i) => paraLocalBrt(new Date(ini.getTime() + i * DIA_MS)));
}

/** Nome sugerido: "Semana 27/10" ou troca a data (dd/mm) que já estiver no nome pela da primeira aula. */
export function nomeDaSemana(nomeAtual: string, primeira: Date | null, padrao = "Semana"): string {
  if (!primeira) return nomeAtual;
  const ddmm = sufixoData(primeira).slice(0, 5);
  const base = nomeAtual.trim();
  if (/\d{2}\/\d{2}/.test(base)) return base.replace(/\d{2}\/\d{2}/, ddmm);
  return base ? `${base} ${ddmm}` : `${padrao} ${ddmm}`;
}

/** Mesma semana N dias depois (padrão 7): títulos e vídeos iguais, datas deslocadas. */
export function deslocarAulas<T extends { agendada_em: string }>(aulas: T[], dias = 7): T[] {
  return aulas.map((a) => ({ ...a, agendada_em: new Date(new Date(a.agendada_em).getTime() + dias * DIA_MS).toISOString() }));
}

export function validarSemana(o: { nome: string; aulas: AulaSemana[] }, agora: Date): string | null {
  if (!o.nome.trim()) return "dê um nome para a semana (vira o nome da playlist)";
  if (!o.aulas.length) return "adicione pelo menos uma aula";
  if (o.aulas.length > MAX_AULAS) return `no máximo ${MAX_AULAS} aulas por semana`;
  const vistas = new Set<number>();
  for (const [i, a] of o.aulas.entries()) {
    const n = `Aula ${i + 1}`;
    if (!a.titulo.trim()) return `${n}: falta o título`;
    if (!ID_OK.test(a.video_id)) return `${n}: escolha o vídeo da aula`;
    const d = new Date(a.agendada_em);
    const m = motivoDataInvalida(d, agora);
    if (m) return `${n}: ${m}`;
    const k = Math.floor(d.getTime() / 60_000);
    if (vistas.has(k)) return `${n}: mesma data e hora de outra aula (${formatarBrt(d)})`;
    vistas.add(k);
  }
  return null;
}

/** Cota estimada: playlist nova (50) + por aula stream/broadcast/bind (3) + item na playlist (50) + miniatura (50). */
export function custoSemana(o: { aulas: number; criarPlaylist: boolean; miniaturas: number }): number {
  const porAula = CUSTO_YT.stream + CUSTO_YT.broadcast + CUSTO_YT.bind + CUSTO_YT.playlist;
  return (o.criarPlaylist ? CUSTO_PLAYLIST : 0) + o.aulas * porAula + o.miniaturas * CUSTO_YT.miniatura;
}

export const linkPlaylist = (id: string) => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;

/**
 * Cria as aulas uma por vez, NA ORDEM (a ordem da playlist é a ordem das chamadas). Erro de cota para o resto
 * ("não tentei"); outro erro numa aula não impede as seguintes. `aoAvancar` alimenta o progresso da tela.
 */
export async function programarEmOrdem<T extends { ordem: number }>(
  itens: T[],
  criar: (item: T) => Promise<void>,
  aoAvancar?: (feitas: number) => void,
): Promise<{ feitas: number; faltaram: { ordem: number; motivo: string }[] }> {
  const faltaram: { ordem: number; motivo: string }[] = [];
  let feitas = 0;
  let parar = false;
  for (const item of [...itens].sort((a, b) => a.ordem - b.ordem)) {
    if (parar) {
      faltaram.push({ ordem: item.ordem, motivo: "não tentei (a cota do YouTube acabou)" });
      continue;
    }
    aoAvancar?.(feitas);
    try {
      await criar(item);
      feitas++;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/cota/i.test(m)) parar = true;
      faltaram.push({ ordem: item.ordem, motivo: m });
    }
  }
  return { feitas, faltaram };
}
