// Dados da Central de Automação (/crm/central). Cada leitura falha sozinha: tabela que ainda não existe
// no banco (migration não rodada) vira lista vazia ou o seed embutido, nunca derruba a tela.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buscarComLimite } from "@/lib/fetchComLimite";
import { db } from "@/lib/crmAutomacoes";
import {
  NUMEROS_PADRAO,
  contarPorNumero,
  enviosPorNumero,
  inicioDoDiaBRT,
  interpretarStatusNumero,
  montarAlertas,
  resumirDia,
  type Alerta,
  type LinhaLog,
  type NumeroCRM,
  type ResumoDia,
  type StatusNumero,
} from "@/lib/crm/central";

export interface RegistroNumerado {
  id: string;
  nome: string;
  ativo?: boolean;
  status?: string;
  numero_id?: string | null;
  gatilho_tipo?: string;
  gatilho_valor?: string | null;
  total?: number;
  pausa_motivo?: string | null;
  created_at?: string;
}

export interface ItemAgendado {
  id: number;
  origem: string;
  contact_phone: string;
  agendado_para: string;
  numero_id?: string | null;
  automacao_id: string | null;
  campanha_id: string | null;
  fluxo_id?: string | null;
}

export interface DadosCentral {
  numeros: NumeroCRM[];
  numerosProvisorios: boolean;
  status: Map<string, StatusNumero>;
  automacoes: RegistroNumerado[];
  fluxos: RegistroNumerado[];
  fluxosDisponiveis: boolean;
  campanhas: RegistroNumerado[];
  roteiros: { id: string; nome: string; stage: string; ativo: boolean }[];
  agendados: ItemAgendado[];
  resumo: ResumoDia;
  envios: Map<string, number>;
  ligados: Map<string, number>;
  alertas: Alerta[];
  envioConfig: { ligado: boolean; pausado: boolean; pausado_motivo: string | null; max_hora: number; max_dia: number } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ler<T>(consulta: PromiseLike<{ data: any; error: any }>, padrao: T): Promise<{ dados: T; ok: boolean }> {
  try {
    const { data, error } = await consulta;
    if (error) return { dados: padrao, ok: false };
    return { dados: (data ?? padrao) as T, ok: true };
  } catch {
    return { dados: padrao, ok: false };
  }
}

export async function statusDaSessao(numero: NumeroCRM, token: string): Promise<StatusNumero> {
  if (numero.tipo === "oficial") return interpretarStatusNumero(numero, null);
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/whatsapp-qr?action=status&sessao=${encodeURIComponent(numero.sessao_openwa ?? "")}`;
    const res = await buscarComLimite(url, { headers: { Authorization: `Bearer ${token}` } });
    return interpretarStatusNumero(numero, await res.json().catch(() => ({})));
  } catch {
    return { estado: "desconhecido", rotulo: "sem leitura", telefone: null, aviso: "Não consegui ler o status agora" };
  }
}

export function useCentralAutomacao() {
  const [dados, setDados] = useState<DadosCentral | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const hoje = inicioDoDiaBRT();
    const [nums, auts, flx, camps, rots, cfg, logs, resps, fila] = await Promise.all([
      ler<NumeroCRM[]>(db.from("crm_numeros").select("*").order("ordem"), []),
      ler<RegistroNumerado[]>(db.from("crm_automacoes").select("*").order("created_at"), []),
      ler<RegistroNumerado[]>(db.from("crm_fluxos").select("*").order("created_at"), []),
      ler<RegistroNumerado[]>(db.from("crm_campanhas").select("*").order("created_at", { ascending: false }), []),
      ler<DadosCentral["roteiros"]>(db.from("crm_roteiros").select("id, nome, stage, ativo").order("ordem"), []),
      ler<DadosCentral["envioConfig"]>(db.from("crm_envio_config").select("*").eq("numero", "principal").maybeSingle(), null),
      ler<LinhaLog[]>(db.from("crm_automacao_log").select("*").gte("created_at", hoje).limit(5000), []),
      ler<{ contact_phone: string; created_at: string }[]>(
        supabase.from("whatsapp_messages").select("contact_phone, created_at").eq("direction", "inbound").gte("created_at", hoje).limit(5000),
        [],
      ),
      ler<ItemAgendado[]>(
        db.from("crm_automacao_fila").select("*").eq("status", "pendente").order("agendado_para").limit(20),
        [],
      ),
    ]);

    const numerosProvisorios = !nums.ok || nums.dados.length === 0;
    const numeros = numerosProvisorios ? NUMEROS_PADRAO : nums.dados;

    const { data: { session } } = await supabase.auth.getSession();
    const status = new Map<string, StatusNumero>();
    if (session) {
      const lidos = await Promise.all(numeros.filter((n) => n.ativo).map(async (n) => [n.id, await statusDaSessao(n, session.access_token)] as const));
      for (const [id, st] of lidos) status.set(id, st);
    }

    const ligados = new Map<string, number>();
    const somar = (m: Map<string, number>) => m.forEach((v, k) => ligados.set(k, (ligados.get(k) ?? 0) + v));
    somar(contarPorNumero(auts.dados, numeros, (a) => a.ativo === true));
    somar(contarPorNumero(flx.dados, numeros, (f) => f.ativo === true));

    const envios = enviosPorNumero(logs.dados, numeros);
    const pausadas = camps.dados.filter((c) => c.status === "pausada");
    const pausasHoje = (cfg.dados?.pausado ? 1 : 0) + pausadas.length;
    const resumo = resumirDia(logs.dados, resps.dados.filter((r) => !r.contact_phone.endsWith("@g.us")), pausasHoje);

    setDados({
      numeros,
      numerosProvisorios,
      status,
      automacoes: auts.dados,
      fluxos: flx.dados,
      fluxosDisponiveis: flx.ok,
      campanhas: camps.dados,
      roteiros: rots.dados,
      agendados: fila.dados,
      resumo,
      envios,
      ligados,
      envioConfig: cfg.dados,
      alertas: montarAlertas({
        numeros,
        status,
        ligados,
        envioConfig: cfg.dados,
        campanhasPausadas: pausadas.map((c) => ({ nome: c.nome, pausa_motivo: c.pausa_motivo ?? null, numero_id: c.numero_id })),
        envios,
      }),
    });
    setCarregando(false);
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { dados, carregando, recarregar };
}
