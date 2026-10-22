// Resumo por IA de uma resposta do feedback semanal.
//
// Recebe { response_id }, monta o texto completo das respostas, pede um resumo
// curto ao Claude Haiku 5.5 (Anthropic, crédito da conta do Breno, via _shared/iaCRM.ts) e grava
// em feedback_semanal_responses.resumo_ia. Se já existe resumo e force não veio,
// devolve o que está gravado sem gastar chamada.
// Só usuário logado e aprovado chama (o verify_jwt aceita a anon key; a chamada gasta crédito).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completarChatCRM, ErroIA } from "../_shared/iaCRM.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ===== Rótulos: espelho de src/types/feedbackSemanal.ts =====
const L = {
  treino_reps_reserva: {
    "1-3": "1 a 3 repetições (série válida de verdade)",
    "4-6": "4 a 6 repetições",
    "7-10": "7 a 10 repetições (longe da falha)",
    "10+": "mais de 10 repetições (bem longe da falha)",
  },
  treino_frequencia_semanal: {
    "1x": "1x na semana", "2x": "2x na semana", "3x": "3x na semana",
    "4x": "4x na semana", "5x": "5x na semana", "6x+": "6x ou mais",
    nao_treinei: "não treinou essa semana",
  },
  cardio_minutos_semanais: {
    "0": "não fez cardio", "<60": "abaixo de 60 min", "60-120": "60 a 120 min",
    "120-180": "120 a 180 min", "180-240": "180 a 240 min", "240+": "mais de 240 min",
  },
  dieta_refeicoes_fora: {
    "0": "nenhuma refeição livre", "1": "1 refeição livre", "2": "2 refeições livres",
    "3": "3 refeições livres", "4+": "4 ou mais refeições livres",
  },
  dieta_beliscando: {
    nao: "não está beliscando", raramente: "belisca raramente",
    algumas_vezes: "belisca algumas vezes na semana",
    quase_todo_dia: "belisca quase todo dia", todo_dia: "belisca todo dia",
  },
  maior_gargalo: {
    treino: "treino", dieta: "dieta", cardio: "cardio", sono: "sono e recuperação",
    rotina: "rotina e falta de tempo", fim_de_semana: "fim de semana",
    intestino_preso: "intestino preso", urina_escura: "urina escura, provavelmente retida",
    constancia: "cabeça e constância",
    nenhum: "nenhum, está fluindo",
  },
  percebe_mudanca: {
    sim_muito: "sim, bastante", sim_pouco: "sim, pouca coisa",
    nao_ainda: "ainda não, mas é começo", nao: "não está percebendo nada",
  },
} as const;

type Row = Record<string, unknown>;

function rot(campo: keyof typeof L, valor: unknown): string | null {
  if (typeof valor !== "string" || !valor) return null;
  const mapa = L[campo] as Record<string, string>;
  // maior_gargalo é múltiplo: valores separados por vírgula.
  if (valor.includes(",")) {
    return valor.split(",").map((v) => mapa[v.trim()] ?? v.trim()).join(" e ");
  }
  return mapa[valor] ?? valor;
}

function linha(titulo: string, valor: string | null | undefined): string | null {
  return valor ? `${titulo}: ${valor}` : null;
}

function montarTexto(r: Row): string {
  const nota = (v: unknown) => (typeof v === "number" ? `${v}/10` : null);
  return [
    linha("Treino — técnica, amplitude e cadência", nota(r.treino_execucao)),
    linha("Séries válidas (repetições que ainda dava)", rot("treino_reps_reserva", r.treino_reps_reserva)),
    linha("Frequência de treino de força", rot("treino_frequencia_semanal", r.treino_frequencia_semanal)),
    linha("Minutos de cardio na semana", rot("cardio_minutos_semanais", r.cardio_minutos_semanais)),
    linha("Intensidade do cardio", nota(r.cardio_intensidade)),
    linha("Adesão da dieta (segunda a segunda)", nota(r.dieta_adesao)),
    linha("Refeições livres na semana", rot("dieta_refeicoes_fora", r.dieta_refeicoes_fora)),
    linha("Beliscando", rot("dieta_beliscando", r.dieta_beliscando)),
    linha("Maior gargalo", rot("maior_gargalo", r.maior_gargalo)),
    linha("Percebe mudança no corpo", rot("percebe_mudanca", r.percebe_mudanca)),
    linha("O que está percebendo", typeof r.mudanca_descricao === "string" ? r.mudanca_descricao : null),
    linha("O que acha do programa", typeof r.consultoria_feedback === "string" ? r.consultoria_feedback : null),
    linha("O que sente falta / pode melhorar", typeof r.consultoria_sente_falta === "string" ? r.consultoria_sente_falta : null),
  ].filter(Boolean).join("\n");
}

const SYSTEM = `Você resume feedbacks semanais de alunas de uma consultoria fitness para o Breno Xavier, que vai ler dezenas deles em sequência.

Escreva em português do Brasil, direto, sem floreio, sem motivação, sem emoji, sem markdown, sem bullet.

Formato exato, 4 linhas, cada uma começando com o rótulo:
Treino: <uma frase>
Dieta: <uma frase>
Corpo e saúde: <uma frase>
Atenção: <o ponto que o Breno tem que olhar primeiro, ou "nada crítico">

Regras:
- Só o que está nas respostas. Não invente número, não suponha o que não foi respondido.
- Se algo não foi respondido, não cite.
- Série válida boa é parar a 1-3 repetições da falha; 7 ou mais sobrando é treino longe da falha.
- Nenhuma refeição livre não é elogio automático: pode ser controle ou restrição que vai estourar.
- Não dê conselho pra aluna. Você está escrevendo para o treinador.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const comoUsuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await comoUsuario.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: aprovado } = await comoUsuario.rpc("is_approved", { _user_id: user.id });
    if (aprovado === false) return json({ error: "Usuário não aprovado" }, 403);

    const { response_id, force } = await req.json().catch(() => ({}));
    if (!response_id) return json({ error: "response_id é obrigatório" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: row, error } = await supabase
      .from("feedback_semanal_responses")
      .select("*")
      .eq("id", response_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: "Resposta não encontrada" }, 404);

    if (row.resumo_ia && !force) {
      return json({ resumo: row.resumo_ia, cached: true });
    }

    const texto = montarTexto(row as Row);
    if (!texto.trim()) return json({ error: "Resposta sem conteúdo pra resumir" }, 422);

    let resumo: string;
    try {
      resumo = (await completarChatCRM(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Aluna: ${row.nome ?? "sem nome"}\n\n${texto}` },
        ],
        { tarefa: "resumo" },
      )).trim();
    } catch (e) {
      if (e instanceof ErroIA) return json({ error: `IA (Claude): ${e.detalhe}`, status_ia: e.status }, 502);
      throw e;
    }
    if (!resumo) return json({ error: "IA devolveu resposta vazia" }, 502);

    const { error: upErr } = await supabase
      .from("feedback_semanal_responses")
      .update({ resumo_ia: resumo, resumo_ia_at: new Date().toISOString() })
      .eq("id", response_id);
    if (upErr) return json({ resumo, salvo: false, aviso: upErr.message });

    return json({ resumo, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    return json({ error: msg }, 500);
  }
});
