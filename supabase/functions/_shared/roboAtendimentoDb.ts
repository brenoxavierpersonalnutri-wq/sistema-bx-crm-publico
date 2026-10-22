// Robô de atendimento por IA: a parte que fala com o banco e com o WhatsApp (só Deno). A lógica está em
// roboAtendimento.ts (pura, testada no vitest). Usado por:
//   - openwa-webhook: roboAoReceber (mensagem da lead -> fila), reivindicarEcoDoRobo (eco do que o robô mandou),
//     roboAoEnviarFromMe (mensagem do celular -> pausa a IA);
//   - whatsapp-send / whatsapp-send-media: pausarPorHumano (humano respondeu pelo CRM);
//   - ai-robo-tick: rodarTick (worker da fila).
// Toda falha aqui é registrada e engolida: o robô nunca derruba o webhook nem o envio do atendente.
import { completarChatCRM } from "./iaCRM.ts";
import type { UsoTokens } from "./anthropic.ts";
import { carregarEtapasValidas, etapasValidas } from "./etapas.ts";
import { sessaoEnvio } from "./waNumero.ts";
import { enviarDigitando, enviarWhatsApp } from "./waEnvio.ts";
import { pausarPorHumano } from "./roboPausa.ts";
import { ESPERAS_FROM_ME_MS, fromMeEhHumano } from "./envioSistema.ts";
import { avaliarGatilhoAoReceber, enfileirarComRitmo } from "./iaGatilhoDb.ts";
import { aplicarTagsAoIniciar } from "./iaTagsInicio.ts";
import type { AgenteGatilho } from "./iaGatilho.ts";

export { pausarPorHumano };
import {
  type AgenteRobo,
  type ContatoRobo,
  type ContextoItem,
  decidirAoReceber,
  type DepsRobo,
  ehGrupo,
  type EventoRobo,
  type ItemFila,
  type LinhaMensagem,
  processarItemFila,
  type ResultadoItem,
} from "./roboAtendimento.ts";

// cliente do supabase-js; tipado solto para não puxar os tipos gerados no Deno
// deno-lint-ignore no-explicit-any
type Db = any;

const log = (msg: string, e?: unknown) => console.error(`robo-ia: ${msg}`, e instanceof Error ? e.message : e ?? "");
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const HISTORICO_PADRAO = 20;
/** Proxy sem a rota "typing" (ou OpenWA sem o endpoint): para de tentar por 10 min e só espera calado. */
const PAUSA_DIGITANDO_MS = 10 * 60_000;
let digitandoIndisponivelAte = 0;
/** item adiado mais que isto (teto/pausa do número) não sai: resposta de 1 h atrás é pior que nenhuma */
const MAX_TENTATIVAS = 12;

const doNumero = <T>(q: T & { eq: (c: string, v: unknown) => T; is: (c: string, v: null) => T }, numeroId: string | null): T =>
  numeroId ? q.eq("numero_id", numeroId) : q.is("numero_id", null);

async function evento(db: Db, base: { phone: string; numeroId: string | null; agente?: AgenteRobo | null }, e: EventoRobo & { tokens?: UsoTokens | null }) {
  const { error } = await db.from("crm_ai_eventos").insert({
    contact_phone: base.phone,
    numero_id: base.numeroId,
    agent_slug: base.agente?.slug ?? null,
    agent_id: base.agente?.id ?? null,
    tipo: e.tipo,
    detalhe: String(e.detalhe ?? "").slice(0, 1000),
    mensagem: e.mensagem ? String(e.mensagem).slice(0, 4000) : null,
    modelo: e.modelo ?? null,
    tokens_entrada: e.tokens?.entrada || null,
    tokens_saida: e.tokens?.saida || null,
  });
  if (error) log("evento não gravou", error.message);
}

// ------------------------------------------------------------------ webhook: mensagem da lead

/** Mensagem da lead chegou (não grupo). Robô do número desligado = uma leitura e volta. */
export async function roboAoReceber(db: Db, p: { numeroId: string | null; telefone: string }): Promise<string> {
  try {
    if (!p.numeroId || ehGrupo(p.telefone)) return "sem número ou grupo";
    const { data: numero, error: eNum } = await db.from("crm_numeros").select("id, robo_ia_ligado, robo_ia_max_hora, ativo, tipo")
      .eq("id", p.numeroId).maybeSingle();
    if (eNum) return `sem coluna robo_ia_ligado (migration pendente): ${eNum.message}`;
    if (!numero?.robo_ia_ligado) return "robô desligado";
    const { data: contato } = await db.from("whatsapp_contacts").select("*").eq("phone", p.telefone).eq("numero_id", p.numeroId).maybeSingle();
    const { data: agentes } = await db.from("crm_ai_agents").select("*").eq("numero_id", p.numeroId);
    let primeira = "";
    let humanoJaRespondeu = false;
    if (contato && !contato.ai_agent_slug && !contato.ai_atribuido_em) {
      const { data: pri } = await db.from("whatsapp_messages").select("body, caption").eq("contact_phone", p.telefone)
        .eq("numero_id", p.numeroId).eq("direction", "inbound").order("created_at", { ascending: true }).limit(1);
      primeira = String(pri?.[0]?.body || pri?.[0]?.caption || "");
      const { count } = await db.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("contact_phone", p.telefone)
        .eq("numero_id", p.numeroId).eq("direction", "outbound").in("sender_type", ["human", "user"]);
      humanoJaRespondeu = (count ?? 0) > 0;
    }
    const d = decidirAoReceber({ numero, contato: contato as ContatoRobo | null, agentes: (agentes ?? []) as AgenteRobo[], primeiraMensagemLead: primeira, humanoJaRespondeu });
    if (!d.enfileirar) {
      // conversa que a IA não atende: agente no modo "Ativar sozinha pelo gatilho" pode assumir (iaGatilho.ts)
      const g = await avaliarGatilhoAoReceber(db, {
        numero, contato, agentes: (agentes ?? []) as AgenteGatilho[], telefone: p.telefone,
        completar: (m, o) => completarChatCRM(m, { tarefa: o.tarefa }),
      });
      return g === "sem agente no modo gatilho" ? d.motivo : `gatilho: ${g}`;
    }
    if (d.atribuirAgora) {
      const agora = new Date().toISOString();
      const { error } = await db.from("whatsapp_contacts").update({
        ai_agent_slug: d.agente.slug, ai_pausado: false, ai_pausado_motivo: null, ai_atribuido_em: agora,
        ai_precisa_humano: false, ai_respostas: 0, ai_falhas: 0, updated_at: agora,
      }).eq("phone", p.telefone).eq("numero_id", p.numeroId);
      if (error) { log("não atribuí o agente", error.message); return "erro ao atribuir"; }
      await evento(db, { phone: p.telefone, numeroId: p.numeroId, agente: d.agente }, { tipo: "atribuido", detalhe: d.motivo });
    }
    // tempo de resposta do agente (aba Configuração): debounce, máximo da rajada e o atraso sorteado antes de responder
    const erroFila = await enfileirarComRitmo(db, p.numeroId, p.telefone, d.agente as AgenteGatilho);
    // modo "todas"/Ligado: a IA acabou de assumir = tags ao começar (não lança; falha só vai para o log)
    if (d.atribuirAgora) await aplicarTagsAoIniciar(db, { numeroId: p.numeroId, phone: p.telefone, agente: d.agente, origem: "todas" });
    if (erroFila) { log("não enfileirei", erroFila); return "erro ao enfileirar"; }
    return "enfileirado";
  } catch (e) {
    log("roboAoReceber", e);
    return "erro";
  }
}

// ------------------------------------------------------------------ webhook: mensagem nossa

/**
 * O robô grava a linha (sender_type "bot", message_id nulo) ANTES de mandar. Se o eco do OpenWA chegar antes de o
 * robô gravar o message_id, o webhook casa pelo texto e só completa o message_id. true = era o robô.
 */
export async function reivindicarEcoDoRobo(
  db: Db,
  p: { numeroId: string | null; telefone: string; messageId: string | null; corpo: string | null; mediaType: string | null },
): Promise<boolean> {
  if (!p.messageId) return false;
  try {
    const desde = new Date(Date.now() - 3 * 60_000).toISOString();
    const { data } = await doNumero(
      db.from("whatsapp_messages").select("id, body, media_type").eq("contact_phone", p.telefone).eq("direction", "outbound")
        .eq("sender_type", "bot").is("message_id", null).gte("created_at", desde),
      p.numeroId,
    ).order("created_at", { ascending: true }).limit(10);
    const corpo = String(p.corpo ?? "").trim();
    const alvo = ((data ?? []) as { id: string; body: string | null; media_type: string | null }[]).find((l) =>
      p.mediaType ? l.media_type === p.mediaType : String(l.body ?? "").trim() === corpo && corpo !== ""
    );
    if (!alvo) return false;
    const { error } = await db.from("whatsapp_messages").update({ message_id: p.messageId, status: "sent" }).eq("id", alvo.id).is("message_id", null);
    return !error;
  } catch (e) {
    log("reivindicarEcoDoRobo", e);
    return false;
  }
}

/**
 * Mensagem nossa que o webhook gravou (não era o eco do robô). Espera uns segundos para o envio da automação/robô
 * gravar o message_id e então decide: humano pelo celular -> pausa a IA.
 */
export async function roboAoEnviarFromMe(db: Db, p: { numeroId: string | null; telefone: string; messageId: string | null }, esperaMs = 6000) {
  if (ehGrupo(p.telefone)) return;
  try {
    // envio do sistema (robô, automação, fluxo, disparo, follow-up, lembrete) nunca é humano: confere o registro
    // do message_id duas vezes (envioSistema.ts) antes de pausar
    if (!await fromMeEhHumano(db, p.messageId, { esperas: [esperaMs, ESPERAS_FROM_ME_MS[1]], dormir })) return;
    await pausarPorHumano(db, p.numeroId, p.telefone, "mensagem manual pelo celular do número");
  } catch (e) {
    log("roboAoEnviarFromMe", e);
  }
}

// ------------------------------------------------------------------ worker

async function carregarContexto(db: Db, item: ItemFila): Promise<ContextoItem> {
  const { data: numero } = await db.from("crm_numeros").select("id, robo_ia_ligado, robo_ia_max_hora, ativo, tipo").eq("id", item.numero_id).maybeSingle();
  const { data: contato } = await doNumero(db.from("whatsapp_contacts").select("*").eq("phone", item.contact_phone), item.numero_id).maybeSingle();
  const { data: agente } = await db.from("crm_ai_agents").select("*").eq("slug", contato?.ai_agent_slug ?? item.agent_slug).maybeSingle();
  const lim = Math.min(40, Math.max(4, Number(agente?.historico_mensagens) || HISTORICO_PADRAO));
  const { data: msgs } = await doNumero(
    db.from("whatsapp_messages").select("direction, sender_type, body, caption, media_type, created_at").eq("contact_phone", item.contact_phone),
    item.numero_id,
  ).order("created_at", { ascending: false }).limit(lim);
  const historico = ((msgs ?? []) as LinhaMensagem[]).reverse();
  let conhecimento: ContextoItem["conhecimento"] = [];
  let exemplos: ContextoItem["exemplos"] = [];
  if (agente?.id) {
    const [k, x] = await Promise.all([
      db.from("crm_ai_conhecimento").select("tipo, titulo, pergunta, resposta, conteudo, ativo").eq("agent_id", agente.id).eq("ativo", true).order("ordem"),
      db.from("crm_ai_exemplos").select("mensagem_lead, resposta, tipo, ativo").eq("agent_id", agente.id).eq("ativo", true).order("created_at", { ascending: false }).limit(20),
    ]);
    conhecimento = k.data ?? [];
    exemplos = x.data ?? [];
  }
  const umaHora = new Date(Date.now() - 3600_000).toISOString();
  const { count: uso } = await db.from("whatsapp_messages").select("id", { count: "exact", head: true })
    .eq("numero_id", item.numero_id).eq("sender_type", "bot").eq("direction", "outbound").gte("created_at", umaHora)
    .not("message_id", "is", null);
  const doze = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { count: fora } = await doNumero(
    db.from("crm_ai_eventos").select("id", { count: "exact", head: true }).eq("contact_phone", item.contact_phone).eq("tipo", "fora_horario")
      .not("mensagem", "is", null).gte("created_at", doze),
    item.numero_id,
  );
  const { data: cfg } = await db.from("crm_envio_config").select("pausado, pausado_motivo").eq("numero", "principal").maybeSingle();
  await carregarEtapasValidas(db);
  return {
    numero, contato, agente, historico, conhecimento, exemplos, etapas: etapasValidas(),
    usoNumeroHora: uso ?? 0, foraHorarioRecente: (fora ?? 0) > 0,
    envioPausado: cfg?.pausado ? String(cfg.pausado_motivo || "restrição no número") : null,
  };
}

/** Dependências reais de um item: Claude (com uso de tokens), WhatsApp do número, banco. */
function depsReais(db: Db, item: ItemFila): DepsRobo & { contexto: () => ContextoItem | null } {
  let ctx: ContextoItem | null = null;
  let uso: UsoTokens = { entrada: 0, saida: 0 };
  const base = () => ({ phone: item.contact_phone, numeroId: item.numero_id, agente: ctx?.agente ?? null });
  const filtroContato = (q: Db) => doNumero(q.eq("phone", item.contact_phone), item.numero_id);
  return {
    contexto: () => ctx,
    async carregar(i) {
      ctx = await carregarContexto(db, i);
      return ctx;
    },
    completar: (m, o) => completarChatCRM(m, { ...o, aoUsar: (u) => { uso = { entrada: uso.entrada + u.entrada, saida: uso.saida + u.saida }; } }),
    async enviar(m) {
      const alvo = await sessaoEnvio(db, item.numero_id);
      if ("recusa" in alvo) throw new Error(`número sem envio: ${alvo.recusa}`);
      const midia = m.tipo !== "text";
      const nome = midia ? decodeURIComponent(m.conteudo.split("/").pop() ?? "arquivo").slice(0, 120) : null;
      const { data: pre, error: ePre } = await db.from("whatsapp_messages").insert({
        numero_id: item.numero_id, contact_phone: item.contact_phone, direction: "outbound", sender_type: "bot",
        body: midia ? (m.tipo === "image" ? "[imagem]" : m.tipo === "audio" ? "[áudio]" : "[documento]") : m.conteudo,
        media_url: midia ? m.conteudo : null, media_type: midia ? m.tipo : null, file_name: nome, status: "pending", message_id: null,
      }).select("id").single();
      if (ePre) throw new Error(`não gravei a mensagem antes de enviar: ${ePre.message}`);
      let id: string | null;
      try {
        id = await enviarWhatsApp(item.contact_phone, { tipo: m.tipo, texto: midia ? "" : m.conteudo, url: midia ? m.conteudo : null, fileName: nome, gravando: m.gravando }, { sessao: alvo.sessao });
      } catch (e) {
        await db.from("whatsapp_messages").update({ status: "failed" }).eq("id", pre.id);
        throw e;
      }
      if (id) {
        const { error } = await db.from("whatsapp_messages").update({ message_id: id, status: "sent" }).eq("id", pre.id).is("message_id", null);
        if (error?.code === "23505") {
          // o eco chegou antes e virou linha própria: ela é do robô; a pré-gravada sai
          await db.from("whatsapp_messages").update({ sender_type: "bot" }).eq("message_id", id);
          await db.from("whatsapp_messages").delete().eq("id", pre.id);
        }
      }
    },
    async atualizarContato(patch) {
      const { error } = await filtroContato(db.from("whatsapp_contacts").update(patch));
      if (error) throw new Error(`contato não atualizou: ${error.message}`);
      if (ctx?.contato) ctx.contato = { ...ctx.contato, ...patch } as ContatoRobo;
    },
    async iniciarFluxo(fluxoId, motivo) {
      const { data: f } = await db.from("crm_fluxos").select("id, nome").eq("id", fluxoId).is("excluido_em", null).maybeSingle();
      if (!f) { await evento(db, base(), { tipo: "ignorado", detalhe: "fluxo da transferência não existe mais" }); return; }
      const agora = new Date().toISOString();
      const { error } = await db.from("crm_fluxo_execucoes").insert({
        fluxo_id: f.id, contact_phone: item.contact_phone, dados: { veio_da_ia: true, motivo_transferencia: motivo }, proximo_em: agora, iniciado_em: agora,
      });
      if (error) await evento(db, base(), { tipo: "ignorado", detalhe: `fluxo ${f.nome} não iniciou: ${error.message}` });
    },
    async registrar(e) {
      const tokens = uso.entrada || uso.saida ? uso : null;
      uso = { entrada: 0, saida: 0 };
      await evento(db, base(), { ...e, tokens });
    },
    dormir,
    async digitando(estado) {
      if (Date.now() < digitandoIndisponivelAte) return;
      const alvo = await sessaoEnvio(db, item.numero_id).catch(() => null);
      if (!alvo || "recusa" in alvo) return;
      const ok = await enviarDigitando(item.contact_phone, estado, { sessao: alvo.sessao });
      if (!ok) digitandoIndisponivelAte = Date.now() + PAUSA_DIGITANDO_MS;
    },
    agora: () => new Date(),
  };
}

async function finalizar(db: Db, item: ItemFila, r: ResultadoItem) {
  const adiar = r.estado === "adiar" && item.tentativas < MAX_TENTATIVAS;
  const status = r.estado === "feito" ? "feito" : r.estado === "ignorado" ? "ignorado" : adiar ? "pendente" : "erro";
  const patch: Record<string, unknown> = { status, motivo: r.detalhe.slice(0, 500), updated_at: new Date().toISOString() };
  if (adiar) patch.responder_apos = new Date(Date.now() + (r as { segundos: number }).segundos * 1000).toISOString();
  const { error } = await db.from("crm_ai_fila").update(patch).eq("id", item.id);
  // adiar colide com uma pendência mais nova da mesma conversa: a nova cobre
  if (error?.code === "23505") await db.from("crm_ai_fila").update({ status: "ignorado", motivo: `${r.detalhe} (há pendência mais nova)` }).eq("id", item.id);
  else if (error) log("fila não atualizou", error.message);
}

/** Um item: processa e grava o resultado na fila. */
async function rodarItem(db: Db, item: ItemFila): Promise<string> {
  const deps = depsReais(db, item);
  let r: ResultadoItem;
  try {
    r = await processarItemFila(item, deps);
  } catch (e) {
    r = { estado: "erro", detalhe: `erro inesperado: ${e instanceof Error ? e.message : String(e)}` };
    await evento(db, { phone: item.contact_phone, numeroId: item.numero_id, agente: deps.contexto()?.agente ?? null }, { tipo: "falha", detalhe: r.detalhe });
  }
  await finalizar(db, item, r);
  return `${item.id}: ${r.estado} (${r.detalhe})`;
}

/**
 * Um tick: pega os vencidos (conversas diferentes) e processa o lote EM PARALELO (cada resposta pode passar de 1 min
 * com o "digitando…" e os intervalos do agente; em série o lote estouraria o relógio da função). Só começa lote novo
 * nos primeiros `tetoMs`: o último lote ainda precisa caber (Claude + até TETO_ESPERA_ENVIO_S de esperas).
 */
export async function rodarTick(db: Db, tetoMs = 30_000): Promise<{ processados: number; resultados: string[] }> {
  const inicio = Date.now();
  const resultados: string[] = [];
  let processados = 0;
  while (Date.now() - inicio < tetoMs) {
    const { data, error } = await db.rpc("crm_ai_fila_pegar", { p_limite: 5 });
    if (error) { log("pegar", error.message); break; }
    const itens = (data ?? []) as ItemFila[];
    const feitos = await Promise.all(itens.map((item) => rodarItem(db, item)));
    processados += feitos.length;
    resultados.push(...feitos);
    if (itens.length) continue;
    // nada vencido agora: espera o próximo que vence em até 40 s, se couber no teto
    const { data: prox } = await db.from("crm_ai_fila").select("responder_apos").eq("status", "pendente")
      .order("responder_apos", { ascending: true }).limit(1);
    const quando = prox?.[0]?.responder_apos ? new Date(prox[0].responder_apos).getTime() : null;
    if (!quando) break;
    const espera = quando - Date.now() + 500;
    if (espera > 40_000 || Date.now() - inicio + espera > tetoMs) break;
    await dormir(Math.max(500, espera));
  }
  return { processados, resultados };
}
