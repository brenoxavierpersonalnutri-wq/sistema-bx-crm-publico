// Funil por origem: "IA WhatsApp" × outras. Só contagens (head:true): o banco devolve o número, não as linhas.
// Leads e qualificados vêm do formulário (lead_form_responses); agendados e compareceu, das consultas
// criadas no período (consultations, coorte por created_at). Cada leitura falha sozinha e vira "—".
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { filtroOrigemIA, outrasOrigens, type EtapasOrigem } from "@/lib/crm/origemIA";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function contar(q: PromiseLike<{ count: number | null; error: any }>): Promise<number | null> {
  try {
    const { count, error } = await q;
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

export interface FunilOrigem {
  ia: EtapasOrigem;
  outras: EtapasOrigem;
}

export function useFunilOrigemIA(desde: string) {
  const [dados, setDados] = useState<FunilOrigem | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const respostas = () => db.from("lead_form_responses").select("id", { count: "exact", head: true }).gte("created_at", desde);
    const consultas = () => db.from("consultations").select("id", { count: "exact", head: true }).gte("created_at", desde);
    const fr = filtroOrigemIA(false);
    const fc = filtroOrigemIA(true);
    const [tl, tq, ta, tc, il, iq, ia, ic] = await Promise.all([
      contar(respostas()),
      contar(respostas().neq("nivel", "DQ")),
      contar(consultas()),
      contar(consultas().eq("attended", true)),
      contar(respostas().or(fr)),
      contar(respostas().or(fr).neq("nivel", "DQ")),
      contar(consultas().or(fc)),
      contar(consultas().or(fc).eq("attended", true)),
    ]);
    const total: EtapasOrigem = { leads: tl, qualificados: tq, agendados: ta, compareceu: tc };
    const doIA: EtapasOrigem = { leads: il, qualificados: iq, agendados: ia, compareceu: ic };
    setDados({ ia: doIA, outras: outrasOrigens(total, doIA) });
    setCarregando(false);
  }, [desde]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { dados, carregando, recarregar };
}
