// Canais do YouTube conectados (para o seletor "Canal do YouTube") e o padrão.
import { useEffect, useState } from "react";
import { canalPadraoYt, listarContasYt, type ContaYoutube } from "@/lib/lives/youtube";

export function useContasYt(ativo = true) {
  const [contas, setContas] = useState<ContaYoutube[]>([]);
  useEffect(() => {
    if (!ativo) return;
    listarContasYt().then((c) => setContas(c.filter((x) => x.status === "conectado"))).catch(() => setContas([]));
  }, [ativo]);
  return { contas, padrao: canalPadraoYt(contas) };
}
