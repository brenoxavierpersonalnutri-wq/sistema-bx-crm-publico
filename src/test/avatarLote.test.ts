import { describe, expect, it } from "vitest";
import { processarLoteAvatares } from "../../supabase/functions/_shared/avatarLote";

const alvos = ["5531111111111", "5531222222222", "120363@g.us", "5531333333333"].map((phone) => ({ phone, numero_id: null }));

describe("pré-carga de fotos em lote", () => {
  it("conta cada resultado e esgota a fila", async () => {
    const res = ["atualizado", "sem-foto", "em-dia", "falhou"] as const;
    let i = 0;
    const r = await processarLoteAvatares(alvos, { reservar: async () => true, atualizar: async () => res[i++] });
    expect(r).toEqual({ feitos: 4, atualizados: 1, semFoto: 1, emDia: 1, falhas: 1, parou: "fila" });
  });
  it("para no 429 do proxy sem tentar o resto", async () => {
    const vistos: string[] = [];
    const r = await processarLoteAvatares(alvos, {
      reservar: async () => true,
      atualizar: async (a) => { vistos.push(a.phone); return vistos.length === 2 ? "limite" : "atualizado"; },
    });
    expect(vistos).toHaveLength(2);
    expect(r).toMatchObject({ feitos: 2, atualizados: 1, parou: "limite" });
  });
  it("para quando o orçamento de leituras/tempo acaba", async () => {
    let n = 0;
    const r = await processarLoteAvatares(alvos, { reservar: async () => ++n <= 3, atualizar: async () => "atualizado" });
    expect(r).toMatchObject({ feitos: 3, parou: "prazo" });
  });
});
