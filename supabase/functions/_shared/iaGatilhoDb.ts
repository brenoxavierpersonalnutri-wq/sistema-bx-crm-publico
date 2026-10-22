// Ativação da IA por gatilho e pelo passo de fluxo "Transferir para agente IA": a parte que fala com o banco
// (Deno). A regra está em iaGatilho.ts (pura, testada no vitest). Usado por:
//   - roboAtendimentoDb.roboAoReceber (openwa-webhook): mensagem nova da lead numa conversa sem dono;
//   - crm-automacoes: passo de fluxo "transferir_ia".
// Nada aqui envia mensagem: quem responde é o ai-robo-tick, com horário e tempo de resposta do agente.
import { normalizarRitmo, sortearAtraso } from "./ritmoResposta.ts";
import {
  type AgenteGatilho,
  type CompletarGatilho,
  type ContextoGatilho,
  decidirAtivacaoPorGatilho,
  decidirTransferenciaFluxo,
  detalheAtivacao,
  horasHumano,
  LIMITES_ATIVACAO,
  leadEsperando,
  modoAtivacao,
  patchAtivacao,
} from "./iaGatilho.ts";
import type { ContatoRobo, NumeroRobo } from "./roboAtendimento.ts";
import { pausadaPorHumano } from "./pausaHumana.ts";
import { aplicarTagsAoIniciar } from "./iaTagsInicio.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const log = (msg: string, e?: unknown) => console.error(`ia-gatilho: ${msg}`, e instanceof Error ? e.message : e ?? "");

export async function eventoIA(db: Db, e: {
  phone: string; numeroId: string | null; agente?: { slug: string; id?: string | null } | null; tipo: string; detalhe: string; mensagem?: string | null;
}): Promise<void> {
  const { error } = await db.from("crm_ai_eventos").insert({
    contact_phone: e.phone, numero_id: e.numeroId, agent_slug: e.agente?.slug ?? null, agent_id: e.agente?.id ?? null,
    tipo: e.tipo, detalhe: String(e.detalhe ?? "").slice(0, 1000), mensagem: e.mensagem ? String(e.mensagem).slice(0, 4000) : null,
  });
  if (error) log("evento não gravou", error.message);
}

/** Enfileira a resposta com o tempo de resposta do agente (debounce, máximo da rajada, atraso sorteado). */
export async function enfileirarComRitmo(db: Db, numeroId: string, phone: string, agente: AgenteGatilho): Promise<string | null> {
  const ritmo = normalizarRitmo(agente);
  const base = { p_numero_id: numeroId, p_phone: phone, p_agent_slug: agente.slug, p_debounce: ritmo.debounce };
  let { error } = await db.rpc("crm_ai_enfileirar", { ...base, p_teto: ritmo.debounceMax, p_atraso: sortearAtraso(ritmo) });
  if (error && /p_teto|p_atraso|PGRST202|function/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    // banco sem a migration 20261105100000 (função antiga de 4 parâmetros): debounce só
    ({ error } = await db.rpc("crm_ai_enfileirar", base));
  }
  return error ? String(error.message ?? error) : null;
}

/**
 * Última ação humana na conversa dentro da janela: mensagem manual da equipe (CRM ou celular) ou evento da IA de
 * humano assumindo/pausando. null = nenhuma na janela.
 */
export async function ultimaAcaoHumana(db: Db, numeroId: string, phone: string, horas: number): Promise<string | null> {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const [m, e] = await Promise.all([
    db.from("whatsapp_messages").select("created_at").eq("contact_phone", phone).eq("numero_id", numeroId).eq("direction", "outbound")
      .in("sender_type", ["human", "user"]).gte("created_at", desde).order("created_at", { ascending: false }).limit(1),
    db.from("crm_ai_eventos").select("created_at").eq("contact_phone", phone).eq("numero_id", numeroId)
      .in("tipo", ["assumido_humano", "pausado_humano"]).gte("created_at", desde).order("created_at", { ascending: false }).limit(1),
  ]);
  const datas = [m.data?.[0]?.created_at, e.data?.[0]?.created_at].filter(Boolean) as string[];
  return datas.sort().pop() ?? null;
}

/** Mensagens novas da lead (últimas 24 h, sem as importadas), mais antiga primeiro, e a mais recente (a que disparou). */
async function mensagensNovasDaLead(db: Db, numeroId: string, phone: string, limite: number) {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const consulta = (comImportada: boolean) =>
    db.from("whatsapp_messages").select(comImportada ? "body, caption, created_at, importada" : "body, caption, created_at")
      .eq("contact_phone", phone).eq("numero_id", numeroId).eq("direction", "inbound").gte("created_at", desde)
      .order("created_at", { ascending: false }).limit(limite + 5);
  let { data, error } = await consulta(true);
  // banco sem a coluna importada (migration 20261101100000 pendente)
  if (error) ({ data, error } = await consulta(false));
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as { body: string | null; caption: string | null; created_at: string; importada?: boolean | null }[];
  const ultima = linhas[0] ?? null;
  const novas = linhas.filter((l) => !l.importada).map((l) => String(l.body || l.caption || "").trim()).filter(Boolean).slice(0, limite).reverse();
  return { novas, ultima };
}

/**
 * Mensagem nova da lead numa conversa que a IA não atende: algum agente no modo "gatilho" assume?
 * Só roda se o número tem agente nesse modo (sem agente, nenhuma consulta a mais). Devolve o motivo (log do webhook).
 */
export async function avaliarGatilhoAoReceber(db: Db, p: {
  numero: NumeroRobo;
  contato: (ContatoRobo & { atendente?: string | null }) | null;
  agentes: AgenteGatilho[];
  telefone: string;
  completar: CompletarGatilho;
}): Promise<string> {
  const numeroId = p.numero.id;
  const doModo = p.agentes.filter((a) => (a.tipo ?? "atendimento") === "atendimento" && a.numero_id === numeroId && modoAtivacao(a) === "gatilho");
  if (!doModo.length || !p.contato) return "sem agente no modo gatilho";
  const limite = Math.max(...doModo.map((a) => Number(a.ativacao_max_mensagens) || LIMITES_ATIVACAO.maxMensagens.padrao));
  const { novas, ultima } = await mensagensNovasDaLead(db, numeroId, p.telefone, Math.min(10, Math.max(1, limite)));
  const horas = Math.max(...doModo.map(horasHumano));
  const desde24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [humano, aval] = await Promise.all([
    ultimaAcaoHumana(db, numeroId, p.telefone, horas),
    db.from("crm_ai_eventos").select("id", { count: "exact", head: true }).eq("contact_phone", p.telefone).eq("numero_id", numeroId)
      .eq("tipo", "gatilho_avaliado").gte("created_at", desde24),
  ]);
  const ctx: ContextoGatilho = {
    numero: p.numero, contato: p.contato, agentes: doModo, mensagensLead: novas,
    mensagemImportada: Boolean(ultima?.importada), mensagemEm: ultima?.created_at ?? null,
    ultimaAcaoHumanaEm: humano, avaliacoesRecentes: aval.count ?? 0, agora: new Date(),
  };
  const d = await decidirAtivacaoPorGatilho(ctx, p.completar);
  if (!("por" in d)) {
    if (d.registrar) {
      await eventoIA(db, {
        phone: p.telefone, numeroId, agente: d.agente ?? null, tipo: d.avaliou ? "gatilho_avaliado" : "ignorado",
        detalhe: d.avaliou ? `gatilho avaliado, IA não ativou: ${d.motivo}` : `IA não ativou: ${d.motivo}`,
      });
    }
    return d.motivo;
  }
  // duas mensagens ao mesmo tempo: só uma ativa;
  // só ativa se a conversa continua sem agente e sem pausa (pausada por humano/fluxo nunca é reassumida pelo gatilho)
  const { data: mudou, error } = await db.from("whatsapp_contacts").update(patchAtivacao(d.agente.slug, new Date(), p.contato))
    .eq("phone", p.telefone).eq("numero_id", numeroId).eq("ai_precisa_humano", false)
    .is("ai_agent_slug", null).or("ai_pausado.is.null,ai_pausado.eq.false").is("ai_pausado_motivo", null).select("phone");
  if (error) { log("não ativei", error.message); return "erro ao ativar"; }
  if (!mudou?.length) return "outra mensagem já ativou a IA";
  if (d.por === "classificador") {
    await eventoIA(db, { phone: p.telefone, numeroId, agente: d.agente, tipo: "gatilho_avaliado", detalhe: `gatilho avaliado: ativou (${d.motivo})` });
  }
  await eventoIA(db, { phone: p.telefone, numeroId, agente: d.agente, tipo: "ativado_gatilho", detalhe: detalheAtivacao(d.motivo) });
  const erroFila = await enfileirarComRitmo(db, numeroId, p.telefone, d.agente);
  // tags ao começar: depois de enfileirar; não lança (falha só vai para o log)
  await aplicarTagsAoIniciar(db, { numeroId, phone: p.telefone, agente: d.agente, origem: "gatilho" });
  if (erroFila) { log("não enfileirei", erroFila); return "ativou, mas não enfileirou"; }
  return `ativado por ${d.por}`;
}

/**
 * Passo de fluxo "Transferir para agente IA": passa a conversa do contato, no número do agente, para a IA.
 * Cria a conversa nesse número se ainda não existe. Se a lead já está esperando (última mensagem dela, nova),
 * enfileira para a IA responder; senão a IA responde quando a lead escrever.
 */
export async function transferirParaIAPorFluxo(db: Db, p: {
  phone: string;
  nome?: string | null;
  agenteSlug: string;
  mesmoComHumano?: boolean;
  /** fluxo de follow-up: pode tirar a pausa de atendimento humano (pausaHumana.ts) */
  followup?: boolean;
  motivo: string;
}): Promise<{ ok: boolean; detalhe: string; tagsAdicionadas?: string[] }> {
  const { data: agente } = await db.from("crm_ai_agents").select("*").eq("slug", p.agenteSlug).maybeSingle();
  const a = (agente ?? null) as AgenteGatilho | null;
  const numeroId = a?.numero_id ?? null;
  let contato: (ContatoRobo & { atendente?: string | null }) | null = null;
  if (numeroId) {
    const { data } = await db.from("whatsapp_contacts").select("*").eq("phone", p.phone).eq("numero_id", numeroId).maybeSingle();
    contato = data ?? null;
  }
  const humano = numeroId && contato ? await ultimaAcaoHumana(db, numeroId, p.phone, horasHumano(a ?? {})) : null;
  const d = decidirTransferenciaFluxo({ agente: a, phone: p.phone, contato, ultimaAcaoHumanaEm: humano, mesmoComHumano: p.mesmoComHumano, followup: p.followup, agora: new Date() });
  if ("motivo" in d) return { ok: false, detalhe: `não transferiu para a IA: ${d.motivo}` };
  const ag = a as AgenteGatilho;
  const agora = new Date();
  if (!contato) {
    const { error } = await db.from("whatsapp_contacts").upsert(
      { phone: p.phone, numero_id: numeroId, name: p.nome || p.phone, updated_at: agora.toISOString() },
      { onConflict: "numero_id,phone", ignoreDuplicates: true },
    );
    if (error) return { ok: false, detalhe: `não criei a conversa no número do agente: ${error.message}` };
  }
  const { error } = await db.from("whatsapp_contacts").update(patchAtivacao(ag.slug, agora, contato)).eq("phone", p.phone).eq("numero_id", numeroId);
  if (error) return { ok: false, detalhe: `não transferiu para a IA: ${error.message}` };
  if (pausadaPorHumano(contato)) {
    await eventoIA(db, { phone: p.phone, numeroId, agente: ag, tipo: "retomado_followup", detalhe: `IA retomada pelo follow-up (${p.motivo})` });
  }
  await eventoIA(db, { phone: p.phone, numeroId, agente: ag, tipo: "ativado_gatilho", detalhe: detalheAtivacao(p.motivo) });
  const { data: ult } = await db.from("whatsapp_messages").select("direction, created_at, importada").eq("contact_phone", p.phone)
    .eq("numero_id", numeroId).order("created_at", { ascending: false }).limit(1);
  let fila = "a IA responde quando a lead escrever";
  if (leadEsperando(ult?.[0] ?? null, agora)) {
    const { data: num } = await db.from("crm_numeros").select("robo_ia_ligado").eq("id", numeroId).maybeSingle();
    if (num?.robo_ia_ligado) {
      const e = await enfileirarComRitmo(db, numeroId!, p.phone, ag);
      fila = e ? `não enfileirou: ${e}` : "lead esperando: resposta da IA na fila";
    } else fila = "robô do número desligado: a IA não responde até ligar";
  }
  // tags ao começar: não lança; falha não desfaz a transferência
  const tags = await aplicarTagsAoIniciar(db, { numeroId, phone: p.phone, agente: ag, origem: "fluxo_transferir_ia" });
  const notaTags = tags.adicionadas.length ? `; tags: ${tags.adicionadas.join(", ")}` : tags.erro ? "; tags não aplicadas" : "";
  return { ok: true, detalhe: `conversa passada para a IA (${ag.nome}); ${fila}${notaTags}`, tagsAdicionadas: tags.adicionadas };
}
