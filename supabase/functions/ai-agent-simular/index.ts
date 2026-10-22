// Modo de teste dos agentes de IA (tela "Treinar IA", /crm/ia): simula a conversa com o agente sem enviar
// nada no WhatsApp e sem gravar mensagem. Usa o MESMO prompt, protocolo de ações, portão (horário, limite,
// palavras de transferência) e leitura de marcações do robô, então o que aparece aqui é o que a lead receberia.
// Aceita os campos do agente, a base de conhecimento e os exemplos no corpo (testa edição não salva).
// modo "followup" (18/10/2026): mostra a mensagem que o agente de follow-up mandaria para uma conversa real
// escolhida (lida com o JWT do usuário, RLS) ou para um histórico de teste. NADA é enviado nem gravado.
// Permissões do CRM (22/11/2026): área/número/ação conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  contarRespostasDaIA,
  decidirAntesDoModelo,
  type ExemploTreino,
  type ItemConhecimento,
  linkAgendamento,
} from "../_shared/agentesIA.ts";
import { gerarFollowup, gerarRespostaAtendimento } from "../_shared/agenteResponder.ts";
import { type AgenteRobo, classificarTransferencia, despedidaDoTransferirDaIA, pedeHumano, planoTransferencia } from "../_shared/roboAtendimento.ts";
import { type LinhaHistorico, tamanhoHistorico } from "../_shared/agenteFollowup.ts";
import { completarChatCRM, ErroIA } from "../_shared/iaCRM.ts";
import { resolverModelo } from "../_shared/anthropic.ts";
import { carregarEtapasValidas, etapasValidas } from "../_shared/etapas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const texto = (v: unknown, max = 4000): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const lista = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => x.slice(0, 200)) : [];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: aprovado } = await supabase.rpc("is_approved", { _user_id: user.id });
    if (aprovado === false) return json({ error: "Usuário não aprovado" }, 403);
    // simular lê conversa real (follow-up) e gasta IA: área Agente IA, pelo menos "ver"
    const acesso = await conferirAcessoCrm(supabase, { area: "agente_ia", nivel: 1 });
    if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);

    const body = await req.json().catch(() => ({}));
    const a = body?.agente ?? {};
    const prompt = typeof a.prompt === "string" ? a.prompt.slice(0, 60000) : "";
    if (!prompt.trim()) return json({ error: "prompt do agente vazio" }, 400);

    if (body?.modo === "followup") return await simularFollowup(supabase, body, a, prompt);

    const historico = Array.isArray(body?.historico) ? body.historico.slice(-40) : [];
    const chat = historico
      .map((m: { de?: string; texto?: string }) => ({
        role: m?.de === "agente" ? ("assistant" as const) : ("user" as const),
        content: String(m?.texto ?? "").slice(0, 4000),
      }))
      .filter((m: { content: string }) => m.content.trim());
    if (!chat.length || chat[chat.length - 1].role !== "user") {
      return json({ error: "a última mensagem precisa ser da lead" }, 400);
    }

    const contato = {
      phone: "5500000000000",
      name: typeof body?.contato?.nome === "string" ? body.contato.nome : "Maria Teste",
      stage: typeof body?.contato?.etapa === "string" ? body.contato.etapa : "leads",
      notes: typeof body?.contato?.notas === "string" ? body.contato.notas : null,
    };
    const agente: AgenteRobo = {
      id: "simulador",
      slug: texto(a.slug, 40) || "agente",
      nome: texto(a.nome, 120) || "Agente",
      prompt,
      base_conhecimento: texto(a.base_conhecimento, 30000),
      etapas: [],
      origens: [],
      gatilhos: [],
      modelo: resolverModelo(texto(a.modelo, 80)),
      temperatura: Number.isFinite(Number(a.temperatura)) ? Number(a.temperatura) : 0.2,
      ativo: true,
      horario_inicio: texto(a.horario_inicio, 8),
      horario_fim: texto(a.horario_fim, 8),
      dias_semana: Array.isArray(a.dias_semana) ? a.dias_semana.filter((d: unknown) => Number.isInteger(d)) : null,
      limite_interacoes: Number.isFinite(Number(a.limite_interacoes)) ? Number(a.limite_interacoes) : 15,
      historico_mensagens: 20,
      atraso_segundos: 0,
      link_agendamento: texto(a.link_agendamento, 500),
      mensagem_fora_horario: texto(a.mensagem_fora_horario, 2000),
      politicas: texto(a.politicas, 4000),
      frase_transferencia: texto(a.frase_transferencia, 300),
      palavras_transferencia: lista(a.palavras_transferencia),
      prompt_transferencia: texto(a.prompt_transferencia, 8000),
      transferir_sem_mensagem: a.transferir_sem_mensagem === true,
      transferir_para: texto(a.transferir_para, 80),
      transferir_tag: texto(a.transferir_tag, 80),
      transferir_etapa: texto(a.transferir_etapa, 40),
      transferir_fluxo_id: texto(a.transferir_fluxo_id, 60),
    };
    /** O que a transferência faria (nada é aplicado no simulador). */
    // comDespedida = false quando a IA já escreveu a frase de passagem junto do [TRANSFERIR] (o robô não repete).
    const simularTransferencia = (motivo: string, comDespedida = true) => {
      const plano = planoTransferencia(agente, { tags: [] }, motivo, new Date(), comDespedida);
      return {
        motivo,
        despedida: plano.despedida,
        para: agente.transferir_para || "fila geral",
        tag: agente.transferir_tag || null,
        etapa: agente.transferir_etapa || null,
        fluxo_id: agente.transferir_fluxo_id || null,
      };
    };

    const conhecimento: ItemConhecimento[] = (Array.isArray(body?.conhecimento) ? body.conhecimento : []).slice(0, 200);
    const exemplos: ExemploTreino[] = (Array.isArray(body?.exemplos) ? body.exemplos : []).slice(0, 50);
    // por turno (bolhas seguidas do agente = 1 resposta), como o robô conta em ai_respostas
    const respostasDaIA = contarRespostasDaIA(chat);

    // Portão: o mesmo do robô (o número não entra no teste).
    const decisao = decidirAntesDoModelo(agente, {
      grupo: false,
      textoLead: chat[chat.length - 1].content,
      respostasDaIA,
      ignorarHorario: body?.respeitarHorario !== true,
    });
    if (decisao.acao !== "responder") {
      const transf = decisao.acao === "transferir" ? simularTransferencia(decisao.motivo) : null;
      const mensagens =
        decisao.acao === "fora_horario" && decisao.mensagem
          ? [{ tipo: "text" as const, conteudo: decisao.mensagem }]
          : transf?.despedida
          ? [{ tipo: "text" as const, conteudo: transf.despedida }]
          : [];
      return json({
        ok: true,
        decisao,
        bruto: null,
        transferencia: transf,
        resposta: { mensagens, transferir: decisao.acao === "transferir", silencio: mensagens.length === 0, etapa: null, retidas: [] },
      });
    }

    // mesma ordem do robô: lead pede humano (atalho) e depois a classificação com o prompt de transferência
    const textoLead = chat[chat.length - 1].content;
    const completar = (m: Parameters<typeof completarChatCRM>[0], o: { tarefa: "conversa"; modelo?: string | null }) => completarChatCRM(m, o);
    let classificacao: { transferir: boolean; motivo: string } | null = null;
    if (pedeHumano(textoLead)) classificacao = { transferir: true, motivo: "a lead pediu para falar com uma pessoa" };
    else {
      classificacao = await classificarTransferencia(agente, chat, completar);
      if (!classificacao) return json({ error: "a decisão de transferência veio fora do formato (JSON): no robô isso conta como falha de IA" }, 502);
    }
    if (classificacao.transferir) {
      const transf = simularTransferencia(classificacao.motivo ? `IA decidiu transferir: ${classificacao.motivo}` : "IA decidiu transferir");
      return json({
        ok: true,
        decisao: { acao: "transferir", motivo: transf.motivo },
        classificacao,
        transferencia: transf,
        bruto: null,
        resposta: { mensagens: transf.despedida ? [{ tipo: "text", conteudo: transf.despedida }] : [], transferir: true, silencio: !transf.despedida, etapa: null, retidas: [] },
      });
    }

    await carregarEtapasValidas(supabase); // etapas reais (crm_etapas); sem a tabela, as 5 de sempre
    const etapas = etapasValidas();
    // Claude (Anthropic): o modelo do agente, ou Sonnet 5.5; valor antigo google/* vira Sonnet.
    // A temperatura do agente não vai para a API (a geração 5.5 recusa temperature fora do padrão).
    // No teste o código do contato é fixo ("teste00"), para o link aparecer completo.
    const link = linkAgendamento(agente.link_agendamento, agente.slug, "teste00");
    // Mesmo gerador que o robô de atendimento vai usar (_shared/agenteResponder.ts).
    const { bruto, resposta } = await gerarRespostaAtendimento({
      agente, contato, chat, etapas, treino: { conhecimento, exemplos }, extras: { link_agendamento: link },
      completar: (m, o) => completarChatCRM(m, o),
    });
    // Igual ao robô (processarItemFila): [TRANSFERIR] com texto = a frase da IA é a passagem, a despedida NÃO sai;
    // [TRANSFERIR] sozinho (ou mensagem retida) = sai a despedida configurada, para a lead não ficar sem resposta.
    const semTexto = resposta.mensagens.length === 0;
    const transferencia = resposta.transferir
      ? simularTransferencia(resposta.retidas.length ? `variável sem valor: ${resposta.retidas.join(", ")}` : "a IA pediu [TRANSFERIR]", semTexto)
      : null;
    const despedida = despedidaDoTransferirDaIA(agente, resposta);
    const saida = despedida ? { ...resposta, mensagens: [{ tipo: "text" as const, conteudo: despedida }], silencio: false } : resposta;
    return json({ ok: true, decisao, classificacao, transferencia, bruto, resposta: saida });
  } catch (err) {
    if (err instanceof ErroIA) return json({ error: `IA (Claude): ${err.detalhe}`, status_ia: err.status }, 502);
    console.error("ai-agent-simular:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown" }, 500);
  }
});

// ------------------------------------------------------------------ follow-up (simulação)

// deno-lint-ignore no-explicit-any
type Cliente = any;

/** Mensagem que o agente de follow-up mandaria agora. Conversa real (contato_phone) ou histórico de teste. */
// deno-lint-ignore no-explicit-any
async function simularFollowup(supabase: Cliente, body: any, a: any, prompt: string): Promise<Response> {
  const agente = {
    id: texto(a.id, 60) || "simulador",
    slug: texto(a.slug, 40) || "followup",
    nome: texto(a.nome, 120) || "Follow-up",
    tipo: "followup",
    prompt,
    modelo: resolverModelo(texto(a.modelo, 80)),
    politicas: texto(a.politicas, 4000),
    base_conhecimento: texto(a.base_conhecimento, 30000),
    historico_mensagens: Number.isFinite(Number(a.historico_mensagens)) ? Number(a.historico_mensagens) : 20,
  };
  const limite = tamanhoHistorico(agente);
  const phone = typeof body?.contato_phone === "string" ? body.contato_phone.replace(/[^\d@a-z.]/gi, "").slice(0, 60) : "";
  let contato: { phone: string; name: string | null; stage: string | null; notes: string | null };
  let historico: LinhaHistorico[];
  if (phone) {
    const { data: c } = await supabase.from("whatsapp_contacts").select("phone, name, stage, notes")
      .eq("phone", phone).order("updated_at", { ascending: false }).limit(1);
    if (!c?.[0]) return json({ error: "conversa não encontrada" }, 404);
    contato = { phone, name: c[0].name ?? null, stage: c[0].stage ?? null, notes: c[0].notes ?? null };
    const { data: msgs, error } = await supabase.from("whatsapp_messages").select("direction, sender_type, body, caption, media_type, created_at")
      .eq("contact_phone", phone).order("created_at", { ascending: false }).limit(limite);
    if (error) return json({ error: `não consegui ler a conversa: ${error.message}` }, 500);
    historico = ((msgs ?? []) as { direction: string; sender_type: string | null; body: string | null; caption: string | null; media_type: string | null; created_at: string }[])
      .map((m) => ({ direction: m.direction, sender_type: m.sender_type, created_at: m.created_at, body: m.body || m.caption || (m.media_type ? `[${m.media_type}]` : null) }));
  } else {
    const lista = Array.isArray(body?.historico) ? body.historico.slice(-limite) : [];
    const base = Date.now() - lista.length * 60_000;
    historico = lista.map((m: { de?: string; texto?: string }, i: number) => ({
      direction: m?.de === "agente" ? "outbound" : "inbound",
      body: String(m?.texto ?? "").slice(0, 4000),
      created_at: new Date(base + i * 60_000).toISOString(),
    }));
    contato = {
      phone: "5500000000000",
      name: typeof body?.contato?.nome === "string" ? body.contato.nome : "Maria Teste",
      stage: typeof body?.contato?.etapa === "string" ? body.contato.etapa : null,
      notes: null,
    };
  }
  const tentativa = Number.isInteger(Number(body?.tentativa)) && Number(body.tentativa) > 0 ? Number(body.tentativa) : null;
  const r = await gerarFollowup({
    agente, contato, historico, instrucao: texto(body?.instrucao, 500), tentativa,
    // na simulação "respondeu depois do início do fluxo" não se aplica (não há execução); pedir para parar, sim
    desde: null,
    completar: (m, o) => completarChatCRM(m, o),
  });
  return json({
    ok: true,
    enviado: false,
    historico_usado: historico.length,
    contato: { nome: contato.name, etapa: contato.stage },
    followup: r.ok ? { enviaria: true, texto: r.texto } : { enviaria: false, motivo: r.motivo, falha_ia: r.falhaIA },
  });
}
