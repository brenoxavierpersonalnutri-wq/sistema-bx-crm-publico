// Os recortes dos cartões do topo da tela de alunas. Ficam aqui, num lugar só,
// pra contagem do cartão e a lista que ele abre nunca discordarem.
import { addDays, isBefore } from "date-fns";
import type { Aluna } from "./alunaTypes";

export type FiltroAluna = "individuais" | "plataforma" | "dia" | "pendentes";

export const ROTULO_FILTRO: Record<FiltroAluna, string> = {
  individuais: "Alunas individuais",
  plataforma: "Plataforma",
  dia: "Pagamentos em dia",
  pendentes: "Pagamentos pendentes",
};

const ehPlataforma = (a: Aluna) => a.programa === "plataforma_magra";

export function filtrarAlunas(alunas: Aluna[], filtro: FiltroAluna): Aluna[] {
  switch (filtro) {
    case "plataforma":
      return alunas.filter(ehPlataforma);
    case "dia":
      return alunas.filter((a) => !ehPlataforma(a) && a.pago);
    case "pendentes":
      return alunas.filter((a) => !ehPlataforma(a) && !a.pago);
    case "individuais":
    default:
      return alunas.filter((a) => !ehPlataforma(a));
  }
}

export function ehFiltroValido(v: string | null): v is FiltroAluna {
  return v === "individuais" || v === "plataforma" || v === "dia" || v === "pendentes";
}

/**
 * Quem vence nos próximos 7 dias ou já venceu, fora quem saiu ou já disse que
 * não renova. Mesma regra que o aviso de vencimento usa, pra o número do botão
 * e a lista não discordarem.
 */
export function alunasVencendo(alunas: Aluna[]): Aluna[] {
  const daquiA7 = addDays(new Date(), 7);
  return alunas.filter(
    (a) =>
      a.status !== "inativa" &&
      !a.renovacaoRecusada &&
      isBefore(new Date(a.dataVencimento), daquiA7),
  );
}
