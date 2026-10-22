// Dados do Dashboard do CRM (/crm). Só agregação leve: contagens com head:true (o banco devolve o
// número, não as linhas) e uma janela limitada de mensagens para as não respondidas.
// Cada leitura falha sozinha: tabela que não existe vira null e o cartão mostra "—".
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEtapas } from "@/hooks/useEtapas";
import { db } from "@/lib/crmAutomacoes";
import { NUMEROS_PADRAO, type NumeroCRM, type StatusNumero } from "@/lib/crm/central";
import { statusDaSessao } from "@/hooks/useCentralAutomacao";
import { inicioDoPeriodo, naoRespondidas, type MsgLeve, type NaoRespondida, type PeriodoDashboard } from "@/lib/crm/dashboard";

export interface DadosDashboard {
  conversasNovas: number | null;
  recebidas: number | null;
  enviadas: number | null;
  baseLeadsNovos: number | null;
  /** contatos criados no período, por etapa atual */
  novosPorEtapa: Record<string, number>;
  /** todos os contatos (não grupo), por etapa atual */
  distribuicao: Record<string, number>;
  /** contatos com etapa fora das 5 colunas */
  distribuicaoOutras: number;
  semResposta: (NaoRespondida & { nome: string | null })[];
  /** a janela de mensagens bateu no teto: pode haver mais não respondidas */
  semRespostaParcial: boolean;
  disparosOk: number | null;
  disparosFalha: number | null;
  campanhasPausadas: number | null;
  envioPausado: boolean;
  automacoesLigadas: number | null;
  fluxosLigados: number | null;
  numeros: NumeroCRM[];
  status: Map<string, StatusNumero>;
}

const JANELA_SEM_RESPOSTA_DIAS = 7;
const TETO_MSGS = 5000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = PromiseLike<{ count: number | null; error: any }>;
async function contar(q: Consulta): Promise<number | null> {
  try {
    const { count, error } = await q;
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

const contatos = () => db.from("whatsapp_contacts").select("id", { count: "exact", head: true }).eq("is_group", false);
const mensagens = () =>
  supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).not("contact_phone", "like", "%@g.us");

export function useDashboardCRM(periodo: PeriodoDashboard, horasSemResposta: number) {
  const { colunas } = useEtapas(); // etapas ativas de crm_etapas
  const chaveEtapas = colunas.map((c) => c.id).join(",");
  const [dados, setDados] = useState<DadosDashboard | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const desde = inicioDoPeriodo(periodo);
    const etapas = chaveEtapas.split(",").filter(Boolean);
    const janela = new Date(Date.now() - JANELA_SEM_RESPOSTA_DIAS * 86_400_000).toISOString();

    const [
      conversasNovas, recebidas, enviadas, baseLeadsNovos, totalContatos,
      novos, dist, msgs, ok, falha, pausadas, cfg, auts, flx, nums,
    ] = await Promise.all([
      contar(contatos().gte("created_at", desde)),
      contar(mensagens().eq("direction", "inbound").gte("created_at", desde)),
      contar(mensagens().eq("direction", "outbound").gte("created_at", desde)),
      contar(db.from("base_leads").select("id", { count: "exact", head: true }).gte("criado_origem", desde)),
      contar(contatos()),
      Promise.all(etapas.map((s) => contar(contatos().eq("stage", s).gte("created_at", desde)))),
      Promise.all(etapas.map((s) => contar(contatos().eq("stage", s)))),
      (async () => {
        try {
          const { data, error } = await supabase
            .from("whatsapp_messages")
            .select("contact_phone, direction, created_at")
            .gte("created_at", janela)
            .order("created_at", { ascending: false })
            .limit(TETO_MSGS);
          return error ? null : ((data ?? []) as MsgLeve[]);
        } catch {
          return null;
        }
      })(),
      contar(db.from("crm_automacao_log").select("id", { count: "exact", head: true }).in("canal", ["whatsapp", "oficial"]).eq("status", "ok").gte("created_at", desde)),
      contar(db.from("crm_automacao_log").select("id", { count: "exact", head: true }).in("canal", ["whatsapp", "oficial"]).eq("status", "erro").gte("created_at", desde)),
      contar(db.from("crm_campanhas").select("id", { count: "exact", head: true }).eq("status", "pausada")),
      (async () => {
        try {
          const { data } = await db.from("crm_envio_config").select("pausado").eq("numero", "principal").maybeSingle();
          return data as { pausado?: boolean } | null;
        } catch {
          return null;
        }
      })(),
      contar(db.from("crm_automacoes").select("id", { count: "exact", head: true }).eq("ativo", true)),
      contar(db.from("crm_fluxos").select("id", { count: "exact", head: true }).eq("ativo", true)),
      (async () => {
        try {
          const { data, error } = await db.from("crm_numeros").select("*").order("ordem");
          return error || !data?.length ? NUMEROS_PADRAO : (data as NumeroCRM[]);
        } catch {
          return NUMEROS_PADRAO;
        }
      })(),
    ]);

    const novosPorEtapa: Record<string, number> = {};
    const distribuicao: Record<string, number> = {};
    etapas.forEach((s, i) => {
      novosPorEtapa[s] = novos[i] ?? 0;
      distribuicao[s] = dist[i] ?? 0;
    });
    const somaDist = Object.values(distribuicao).reduce((a, b) => a + b, 0);

    const lista = msgs ? naoRespondidas(msgs, horasSemResposta) : [];
    const nomes = new Map<string, string | null>();
    if (lista.length) {
      const { data } = await db.from("whatsapp_contacts").select("phone, name").in("phone", lista.slice(0, 8).map((l) => l.phone));
      for (const c of (data ?? []) as { phone: string; name: string | null }[]) nomes.set(c.phone, c.name);
    }

    const status = new Map<string, StatusNumero>();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const lidos = await Promise.all(nums.filter((n) => n.ativo).map(async (n) => [n.id, await statusDaSessao(n, session.access_token)] as const));
      for (const [id, st] of lidos) status.set(id, st);
    }

    setDados({
      conversasNovas,
      recebidas,
      enviadas,
      baseLeadsNovos,
      novosPorEtapa,
      distribuicao,
      distribuicaoOutras: Math.max(0, (totalContatos ?? somaDist) - somaDist),
      semResposta: lista.map((l) => ({ ...l, nome: nomes.get(l.phone) ?? null })),
      semRespostaParcial: (msgs?.length ?? 0) >= TETO_MSGS,
      disparosOk: ok,
      disparosFalha: falha,
      campanhasPausadas: pausadas,
      envioPausado: cfg?.pausado === true,
      automacoesLigadas: auts,
      fluxosLigados: flx,
      numeros: nums,
      status,
    });
    setCarregando(false);
  }, [periodo, horasSemResposta, chaveEtapas]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { dados, carregando, recarregar };
}
