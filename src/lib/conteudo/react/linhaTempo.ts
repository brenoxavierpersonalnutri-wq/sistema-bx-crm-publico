// Linha do tempo do react: o que o vídeo original fazia em cada instante da gravação dele.
// Alimentada pelos eventos do <video> do original (playing / pause / waiting / ended / seeked), com o relógio da
// gravação (segundos desde o início do MediaRecorder). O serviço headturbo-react (infra/react/montagem.py) recebe
// exatamente esta lista: trechos "tocando" (o original anda a partir de `orig`) e "comentario" (o original fica
// congelado em `orig` enquanto ele fala). Buffering ("waiting") conta como congelado: é o que ele viu na tela.

export type TipoTrecho = "tocando" | "comentario";

export interface Trecho {
  tipo: TipoTrecho;
  ini: number;
  fim: number;
  orig: number;
}

const EPS = 0.001;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class LinhaTempo {
  private feitos: Trecho[] = [];
  private aberto: { tipo: TipoTrecho; ini: number; orig: number } | null = null;
  private fechada = false;

  /** Começo da gravação: o original ainda não está tocando (o play leva alguns ms). */
  iniciar(t: number, orig: number) {
    this.feitos = [];
    this.fechada = false;
    this.aberto = { tipo: "comentario", ini: Math.max(0, t), orig: Math.max(0, orig) };
  }

  private trocar(tipo: TipoTrecho, t: number, orig: number, forcar = false) {
    if (this.fechada || !this.aberto) return;
    if (!forcar && this.aberto.tipo === tipo) return;
    if (t - this.aberto.ini > EPS) {
      this.feitos.push({ tipo: this.aberto.tipo, ini: r3(this.aberto.ini), fim: r3(t), orig: r3(this.aberto.orig) });
    }
    this.aberto = { tipo, ini: Math.max(t, this.aberto.ini), orig: Math.max(0, orig) };
  }

  /** O original começou ou voltou a tocar (evento "playing"). */
  tocando(t: number, orig: number) {
    this.trocar("tocando", t, orig);
  }

  /** O original parou: pausa dele, fim do vídeo ou buffering ("pause", "ended", "waiting"). */
  parado(t: number, orig: number) {
    this.trocar("comentario", t, orig);
  }

  /** Pulou para outro ponto enquanto tocava ("seeked"): fecha o trecho e abre outro a partir do ponto novo. */
  pulou(t: number, orig: number) {
    if (!this.aberto) return;
    this.trocar(this.aberto.tipo, t, orig, true);
  }

  /** Fim da gravação: fecha o trecho aberto e devolve a lista. */
  finalizar(t: number): Trecho[] {
    if (this.aberto && !this.fechada && t - this.aberto.ini > EPS) {
      this.feitos.push({ tipo: this.aberto.tipo, ini: r3(this.aberto.ini), fim: r3(t), orig: r3(this.aberto.orig) });
    }
    this.fechada = true;
    this.aberto = null;
    return this.lista;
  }

  get lista(): Trecho[] {
    return this.feitos.map((x) => ({ ...x }));
  }

  /** Quantas vezes ele pausou para comentar (o congelado do começo, antes do primeiro play, não conta). */
  get pausas(): number {
    const lista = this.aberto ? [...this.feitos, { tipo: this.aberto.tipo } as Trecho] : this.feitos;
    const primeiroTocando = lista.findIndex((x) => x.tipo === "tocando");
    if (primeiroTocando < 0) return 0;
    return lista.slice(primeiroTocando).filter((x) => x.tipo === "comentario").length;
  }

  get tocandoAgora(): boolean {
    return this.aberto?.tipo === "tocando";
  }
}

/** Resumo para a tela: "3 pausas · 1:42 de gravação". */
export function resumoLinha(trechos: Trecho[]): { pausas: number; duracao: number; comentando: number } {
  const duracao = trechos.length ? trechos[trechos.length - 1].fim - trechos[0].ini : 0;
  const i0 = trechos.findIndex((x) => x.tipo === "tocando");
  const depois = i0 < 0 ? [] : trechos.slice(i0);
  return {
    pausas: depois.filter((x) => x.tipo === "comentario").length,
    duracao,
    comentando: depois.filter((x) => x.tipo === "comentario").reduce((s, x) => s + (x.fim - x.ini), 0),
  };
}

export function formatarTempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
