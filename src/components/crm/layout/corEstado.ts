import type { StatusNumero } from "@/lib/crm/central";

/** Bolinha de status do número (mesmas cores do cartão da Central). */
export const COR_ESTADO_NUMERO: Record<StatusNumero["estado"], string> = {
  conectado: "bg-emerald-500",
  qr: "bg-amber-500",
  desconectado: "bg-red-500",
  sem_ponte: "bg-zinc-400",
  oficial: "bg-sky-500",
  desconhecido: "bg-zinc-400",
};
