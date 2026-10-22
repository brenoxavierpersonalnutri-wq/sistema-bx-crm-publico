// Dados do painel "Disparo em grupo": campanhas, números (com status de conexão), grupos e métricas do período.
// Só leitura. Status do número é o mesmo da tela Conexões (statusDaSessao); nada é enviado daqui.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { statusDaSessao } from "@/hooks/useCentralAutomacao";
import type { NumeroCRM, StatusNumero } from "@/lib/crm/central";
import { db, listarNumeros, type CampanhaGrupos, type GrupoLinha, type MensagemAgendada, type NumeroWhatsApp } from "@/lib/grupos";
import { desdeDe, metricasCampanha, type MetricaPeriodo, type MetricasCampanha, type Periodo } from "@/lib/painelGrupos";

// "*" e não lista de colunas: banco sem alguma migração antiga ainda carrega (colunas faltando viram undefined)
export const COLUNAS_GRUPO = "*";

export function usePainelGrupos(periodo: Periodo) {
  const [campanhas, setCampanhas] = useState<CampanhaGrupos[]>([]);
  const [numeros, setNumeros] = useState<NumeroWhatsApp[]>([]);
  const [grupos, setGrupos] = useState<GrupoLinha[]>([]);
  const [periodoMetricas, setPeriodoMetricas] = useState<Map<string, MetricaPeriodo> | null>(null);
  const [status, setStatus] = useState<Record<string, StatusNumero>>({});
  const [comErro, setComErro] = useState<Pick<MensagemAgendada, "campanha_id">[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarBase = useCallback(async () => {
    const ontem = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [c, g, e] = await Promise.all([
      db.from("grupos_campanhas").select("*").order("created_at", { ascending: false }),
      db.from("grupos_campanha_grupos").select(COLUNAS_GRUPO).order("ordem").limit(3000),
      db.from("grupos_mensagens").select("campanha_id").eq("status", "erro").gte("updated_at", ontem).limit(200),
    ]);
    if (c.error) setErro(c.error.message);
    setCampanhas((c.data ?? []) as CampanhaGrupos[]);
    setGrupos((g.data ?? []) as GrupoLinha[]);
    setComErro((e.error ? [] : e.data ?? []) as Pick<MensagemAgendada, "campanha_id">[]);
    setCarregando(false);
  }, []);

  const carregarPeriodo = useCallback(async () => {
    const { data, error } = await db.rpc("grupos_metricas_periodo", { p_desde: desdeDe(periodo) });
    // sem a migração 20261110100000 a RPC não existe: o painel usa os acumulados dos grupos
    if (error || !Array.isArray(data)) { setPeriodoMetricas(null); return; }
    setPeriodoMetricas(new Map((data as MetricaPeriodo[]).map((m) => [m.campanha_id, m])));
  }, [periodo]);

  const recarregar = useCallback(async () => { await Promise.all([carregarBase(), carregarPeriodo()]); }, [carregarBase, carregarPeriodo]);

  useEffect(() => { carregarBase(); listarNumeros().then(setNumeros); }, [carregarBase]);
  useEffect(() => { carregarPeriodo(); }, [carregarPeriodo]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      for (const n of numeros) {
        const st = await statusDaSessao({ id: n.id, tipo: "openwa", sessao_openwa: n.sessao ?? null, ativo: true } as NumeroCRM, token);
        if (!vivo) return;
        setStatus((s) => ({ ...s, [n.id]: st }));
      }
    })();
    return () => { vivo = false; };
  }, [numeros]);

  const metricas = useMemo(() => {
    const m = new Map<string, MetricasCampanha>();
    for (const c of campanhas) m.set(c.id, metricasCampanha(c, grupos, periodoMetricas ? periodoMetricas.get(c.id) ?? { campanha_id: c.id, cliques: 0, cliques_grupo: 0, entradas: 0, saidas: 0 } : null));
    return m;
  }, [campanhas, grupos, periodoMetricas]);

  const conectado = useMemo(() => {
    const o: Record<string, boolean | undefined> = {};
    for (const [id, st] of Object.entries(status)) o[id] = st.estado === "conectado" ? true : st.estado === "desconectado" ? false : undefined;
    return o;
  }, [status]);

  return {
    campanhas, numeros, grupos, metricas, status, conectado, comErro, carregando, erro,
    temPeriodo: periodoMetricas !== null, recarregar, recarregarBase: carregarBase,
  };
}

export type PainelGrupos = ReturnType<typeof usePainelGrupos>;
