// sync2
// Edge Function pública: recebe respostas do formulário de qualificação (novaav.brenoxavier.com.br)
// e armazena em lead_form_responses. Calcula score/nivel server-side por segurança.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { erroColunaAusente, hostDaRequisicao, hostEhDoBreno } from "../_shared/hostsBreno.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hosts do Breno (lista única em ../_shared/hostsBreno.ts): decidem o SellFlux e vão gravados na linha
// (host_breno), que o banco usa para barrar lead de site de cliente no Full Funnel e na base de leads.
// ===== Tabela de pontuação (espelho do formulário) =====
const P1_PTS: Record<string, number> = {
  emagrecer: -20,
  perder_gordura_definir: 5,
  definido_slim: 5,
  volume_muscular: 5,
};
const P5_PTS: Record<string, number> = {
  nao_entregam: 5,
  demoro_muito: 0,
  consigo_resultado: -10,
};
const P6_PTS: Record<string, number> = {
  uso_atual: 10,
  ja_usei: 5,
  nunca_usei: 0,
};
const P7_PTS: Record<string, number> = {
  nutricional: 10,
  treino: 10,
  ambos: 20,
  nunca: 0,
};
const P8_PTS: Record<string, number> = {
  abaixo_100: -20,
  "100_250": 5,
  "250_400": 10,
  "400_600": 15,
  "600_1000": 20,
  acima_1000: 25,
};
const P9_PTS: Record<string, number> = {
  imediato: 15,
  futuramente: -5,
  pensar: -10,
};
const RENDA_PTS: Record<string, number> = {
  ate_2k: 0,
  "2k_4k": 5,
  "5k_8k": 10,
  "9k_15k": 15,
  acima_15k: 20,
};

function calcScore(b: Record<string, unknown>): { score: number; nivel: string } {
  let s = 0;
  s += P1_PTS[String(b.p1_objetivo ?? "")] ?? 0;
  s += P5_PTS[String(b.p5_estrategias ?? "")] ?? 0;
  s += P6_PTS[String(b.p6_caneta ?? "")] ?? 0;
  const p7 = String(b.p7_acompanhamento ?? "");
  s += P7_PTS[p7] ?? 0;
  if (p7 !== "nunca") {
    s += P8_PTS[String(b.p8_investimento ?? "")] ?? 0;
  }
  s += P9_PTS[String(b.p9_prioridade ?? "")] ?? 0;
  s += RENDA_PTS[String(b.renda_mensal ?? b.p10_renda ?? "")] ?? 0;
  const peso = Number(b.p4_peso);
  if (!Number.isNaN(peso) && peso > 86) s -= 10;

  let nivel = "DQ";
  if (s >= 65) nivel = "A";
  else if (s >= 50) nivel = "B";
  else if (s >= 41) nivel = "C";
  else if (s >= 35) nivel = "D";

  return { score: s, nivel };
}

// SellFlux só dispara para leads vindos dos hosts EXATOS de HOSTS_BRENO (ordem do dono, 30/09/2026). Outros
// sites (remixes de clientes, e também o fluxo fitness bgimplementacao.brenoxavier.com.br) chamavam esta mesma
// função e acabavam disparando a automação do time. Fora da lista, o lead ainda é gravado em
// lead_form_responses (com host_breno = false), mas NÃO vai para a SellFlux nem para o Full Funnel.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "invalid body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { score, nivel } = calcScore(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const toNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const toInt = (v: unknown) => {
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : null;
    };
    const toStr = (v: unknown) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s.length ? s : null;
    };

    const hostOrigem = hostDaRequisicao(req.headers);
    const doBreno = hostEhDoBreno(hostOrigem);

    const linha = {
      nome: toStr(body.nome),
      telefone: toStr(body.telefone),
      instagram: toStr(body.instagram),
      email: toStr(body.email),
      p1_objetivo: toStr(body.p1_objetivo),
      p2_situacao: toStr(body.p2_situacao),
      p3_profissao: toStr(body.p3_profissao),
      p4_altura: toNum(body.p4_altura),
      p4_peso: toNum(body.p4_peso),
      p4_idade: toInt(body.p4_idade),
      p5_estrategias: toStr(body.p5_estrategias),
      p6_caneta: toStr(body.p6_caneta),
      p7_acompanhamento: toStr(body.p7_acompanhamento),
      p8_investimento: toStr(body.p8_investimento),
      p9_prioridade: toStr(body.p9_prioridade),
      renda_mensal: toStr(body.renda_mensal ?? body.p10_renda),
      // A LP antiga ainda chama esta mesma função sem enviar "origem".
      // Como esta função recebe exclusivamente respostas de captação, o
      // fallback preserva a rastreabilidade das novas leads até ela ser
      // substituída pela LP unificada.
      origem: toStr(body.origem) ?? "avaliacao", // "avaliacao" | "individual" (consultoria de elite)
      score,
      nivel,
      utm_source: toStr(body.utm_source),
      utm_medium: toStr(body.utm_medium),
      utm_campaign: toStr(body.utm_campaign),
      utm_content: toStr(body.utm_content),
      utm_term: toStr(body.utm_term),
    };
    // origem_host/host_breno: o trigger do Full Funnel lê na hora do INSERT (precisa ir no mesmo insert).
    let { data, error } = await supabase
      .from("lead_form_responses")
      .insert({ ...linha, origem_host: hostOrigem?.slice(0, 255) ?? null, host_breno: doBreno })
      .select("id, score, nivel")
      .single();
    if (error && erroColunaAusente(error)) {
      // migration 20261122130000 ainda não rodou: não perde o lead
      console.warn("lead_form_responses sem origem_host/host_breno; gravando sem eles");
      ({ data, error } = await supabase.from("lead_form_responses").insert(linha).select("id, score, nivel").single());
    }

    if (error || !data) throw error ?? new Error("insert sem retorno");

    // Envia só qualificadas (nível != DQ) para o SellFlux, e só se o lead veio
    // de um host de HOSTS_BRENO (lista exata em ../_shared/hostsBreno.ts).
    if (data.nivel !== "DQ" && !doBreno) {
      console.log("sellflux ignorado: origem fora de HOSTS_BRENO", hostOrigem);
    }
    if (data.nivel !== "DQ" && doBreno) {
      // Formato novo: o formulário já envia com o DDI escolhido (ex.: "+5531..." ou "+3519...")
      const rawTel = String(body.telefone ?? "").trim();
      let phone: string | undefined;
      if (rawTel) {
        const digits = rawTel.replace(/\D/g, "");
        phone = "+" + (rawTel.startsWith("+") ? digits : digits.startsWith("55") ? digits : "55" + digits);
      }
      try {
        const r = await fetch(
          Deno.env.get("SELLFLUX_WEBHOOK_LEADS") ?? "https://webhook.sellflux.app/flux/sellflux/SEU_ID_DO_FLUXO",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: toStr(body.nome) ?? "Lead",
              email: toStr(body.email) ?? undefined,
              phone,
            }),
          },
        );
        await r.text();
      } catch (e) {
        console.error("sellflux webhook error", e);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, id: data.id, score: data.score, nivel: data.nivel }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("submit-form-response error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
