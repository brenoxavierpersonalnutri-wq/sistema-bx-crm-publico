// Pré-carga em lote das fotos de perfil (lógica pura, testável): recebe a fila (quem precisa de foto),
// respeita o ritmo do proxy e para no primeiro "limite" (429). Quem busca de fato é injetado
// (atualizarAvatar), assim o teste não precisa de rede.
export type AlvoAvatar = { phone: string; numero_id: string | null };
export type ResultadoLote = { feitos: number; atualizados: number; semFoto: number; emDia: number; falhas: number; parou: "fila" | "limite" | "prazo" };

export async function processarLoteAvatares(
  alvos: AlvoAvatar[],
  deps: {
    /** devolve false quando acabou o orçamento (leituras/min ou tempo) */
    reservar: () => Promise<boolean>;
    atualizar: (a: AlvoAvatar) => Promise<"atualizado" | "sem-foto" | "em-dia" | "falhou" | "limite">;
  },
): Promise<ResultadoLote> {
  const r: ResultadoLote = { feitos: 0, atualizados: 0, semFoto: 0, emDia: 0, falhas: 0, parou: "fila" };
  for (const a of alvos) {
    if (!(await deps.reservar())) { r.parou = "prazo"; break; }
    const res = await deps.atualizar(a);
    r.feitos++;
    if (res === "atualizado") r.atualizados++;
    else if (res === "sem-foto") r.semFoto++;
    else if (res === "em-dia") r.emDia++;
    else if (res === "falhou") r.falhas++;
    else { r.parou = "limite"; break; }
  }
  return r;
}
