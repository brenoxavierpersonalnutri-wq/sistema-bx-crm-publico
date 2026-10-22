// Roteiros e passos para os seletores de mensagem (regras e campanhas).
import { useEffect, useState } from "react";
import { db } from "@/lib/crmAutomacoes";

export interface RoteiroOpcao { id: string; nome: string; stage: string }
export interface PassoOpcao { id: string; roteiro_id: string; ordem: number; rotulo: string | null; tipo: string }

// Nome por slug, vivo: atualizado pelo useEtapas quando crm_etapas carrega/muda (componente que mostra precisa chamar useEtapas()).
export { NOMES_ETAPAS } from "@/hooks/useEtapas";

export function useCatalogo() {
  const [roteiros, setRoteiros] = useState<RoteiroOpcao[]>([]);
  const [passos, setPassos] = useState<PassoOpcao[]>([]);
  useEffect(() => {
    (async () => {
      const { data: r } = await db.from("crm_roteiros").select("id, nome, stage").order("stage").order("ordem");
      const { data: p } = await db.from("crm_roteiro_passos").select("id, roteiro_id, ordem, rotulo, tipo").order("ordem");
      setRoteiros(r ?? []);
      setPassos(p ?? []);
    })();
  }, []);
  const nomesRoteiros = Object.fromEntries(roteiros.map((r) => [r.id, r.nome]));
  return { roteiros, passos, nomesRoteiros };
}
