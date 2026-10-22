// Fila de download automático de áudio (20/10/2026): no máximo 2 por vez, para não gastar o orçamento do
// proxy (700/h) nem o throttler do OpenWA (1000/h por rota). Já baixado (por mensagem) não baixa de novo:
// o link fica em memória e, depois, o banco devolve media_path -> link assinado.
export const MAX_SIMULTANEOS = 2;
/** Ao abrir a conversa, só os áudios destas últimas mensagens baixam sozinhos; o resto, depois de rolar. */
export const JANELA_AUTO = 30;

type Tarefa = { id: string; rodar: () => Promise<string | null>; ok: (v: string | null) => void; erro: (e: unknown) => void };

const espera: Tarefa[] = [];
const emAndamento = new Map<string, Promise<string | null>>();
const prontos = new Map<string, string>();
let ativos = 0;

function andar() {
  while (ativos < MAX_SIMULTANEOS && espera.length) {
    const t = espera.shift()!;
    ativos++;
    t.rodar()
      .then((v) => { if (v) prontos.set(t.id, v); t.ok(v); }, t.erro)
      .finally(() => { emAndamento.delete(t.id); ativos--; andar(); });
  }
}

/** Entra na fila (dedup por id). Devolve o link; null = indisponível; rejeita em erro. */
export function baixarNaFila(id: string, rodar: () => Promise<string | null>): Promise<string | null> {
  const pronto = prontos.get(id);
  if (pronto) return Promise.resolve(pronto);
  const atual = emAndamento.get(id);
  if (atual) return atual;
  const p = new Promise<string | null>((ok, erro) => espera.push({ id, rodar, ok, erro }));
  emAndamento.set(id, p);
  andar();
  return p;
}

export function linkJaBaixado(id: string): string | null {
  return prontos.get(id) ?? null;
}

/** Só para teste. */
export function zerarFilaAudio() {
  espera.length = 0; emAndamento.clear(); prontos.clear(); ativos = 0;
}
