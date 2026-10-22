// Ao vivo, relê os destinos a cada 15 s: o webhook do LiveKit marca no banco o destino que caiu (ex.: chave do
// Instagram vencida) enquanto os outros seguem. Avisa uma vez por queda, com o nome e o motivo.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { LiveDestino } from "@/lib/lives/api";
import { quedasNovas } from "@/lib/lives/destinos";

export function useSaidasAoVivo(status: string | undefined, destinos: LiveDestino[], recarregar: () => Promise<void> | void) {
  const noAr = useRef<Set<string>>(new Set());
  const aoVivo = status === "ao_vivo";

  useEffect(() => {
    if (aoVivo) {
      for (const q of quedasNovas(noAr.current, destinos)) {
        toast.error(`${q.nome} caiu (os outros destinos seguem no ar): ${q.erro}`, { duration: 20000 });
      }
    }
    noAr.current = new Set(destinos.filter((d) => d.no_ar).map((d) => d.id));
  }, [aoVivo, destinos]);

  useEffect(() => {
    if (!aoVivo) return;
    const t = setInterval(() => void recarregar(), 15_000);
    return () => clearInterval(t);
  }, [aoVivo, recarregar]);
}
