// Lógica pura da API mobile, sem nenhuma dependência de Deno ou de rede.
// Fica separada para poder ser testada pelo vitest do projeto
// (`src/test/mobileApi.test.ts`) — o resto do index.ts precisa de runtime Deno.

/**
 * Compara versões no formato "1.2.10". Devolve true quando `atual` é anterior
 * a `minima`. Comparação numérica por segmento: "1.2.10" é MAIOR que "1.2.9",
 * o que a comparação de string erraria.
 */
export function versaoMenorQue(atual: string, minima: string): boolean {
  const a = atual.split(".").map((n) => parseInt(n, 10) || 0);
  const m = minima.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, m.length); i++) {
    const x = a[i] ?? 0;
    const y = m[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Extrai a rota do pathname. O Supabase serve a função em
 * `/functions/v1/mobile-v1/...`, mas em dev local ela responde em
 * `/mobile-v1/...` — as duas formas precisam cair na mesma rota.
 */
export function normalizarCaminho(pathname: string): string {
  return pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/mobile-v1\/?/, "")
    .replace(/\/+$/, "");
}

/** Achata a linha de prescrição no formato que o app nativo renderiza. */
export function formatarExercicio(p: Record<string, any>) {
  const ex = p.exercicios ?? {};
  return {
    id: p.id,
    ordem: p.ordem,
    nome: ex.nome ?? "Exercício",
    equipamento: ex.equipamento ?? null,
    grupo_muscular: ex.grupo_muscular ?? null,
    instrucoes: ex.instrucoes ?? null,
    // Já montado: o app nativo não precisa saber parsear link do YouTube
    video: ex.youtube_id
      ? {
          youtube_id: ex.youtube_id,
          embed_url: `https://www.youtube-nocookie.com/embed/${ex.youtube_id}?rel=0&modestbranding=1&playsinline=1`,
          thumbnail_url: ex.thumbnail_url ?? `https://i.ytimg.com/vi/${ex.youtube_id}/hqdefault.jpg`,
        }
      : null,
    series: p.series,
    repeticoes: p.repeticoes,
    carga_sugerida: p.carga_sugerida ?? null,
    cadencia: p.cadencia ?? null,
    descanso_seg: p.descanso_seg ?? null,
    metodo_avancado: p.metodo_avancado ?? null,
    observacao: p.observacao ?? null,
    // Mesma letra = bi-set / tri-set; o app agrupa por este campo
    agrupamento: p.agrupamento ?? null,
  };
}

/**
 * Agrupa a lista de exercícios em blocos: exercícios seguidos com a mesma
 * letra viram um bi-set/tri-set. O app renderiza cada bloco como um cartão.
 */
export function agruparEmBlocos<T extends { agrupamento?: string | null; id: string }>(
  exercicios: T[],
): { chave: string; agrupamento: string | null; itens: T[] }[] {
  const blocos: { chave: string; agrupamento: string | null; itens: T[] }[] = [];
  for (const ex of exercicios) {
    const ultimo = blocos[blocos.length - 1];
    if (ex.agrupamento && ultimo?.agrupamento === ex.agrupamento) {
      ultimo.itens.push(ex);
    } else {
      blocos.push({ chave: ex.id, agrupamento: ex.agrupamento ?? null, itens: [ex] });
    }
  }
  return blocos;
}

/** Valida nota de 0 a 10. Lança RangeError, que o router traduz em HTTP 400. */
export function validarNota(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > 10) {
    throw new RangeError("As notas vão de 0 a 10.");
  }
  return Math.round(n);
}

/** Aceita "62,4" e "62.4". Devolve null quando vazio. */
export function validarPeso(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (Number.isNaN(n) || n <= 0 || n > 400) {
    throw new RangeError("Peso fora do intervalo esperado.");
  }
  return n;
}
