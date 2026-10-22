// Automações e campanhas do CRM (WhatsApp não oficial + template oficial via Full Funnel).
//
// Duas portas:
//  - pg_cron (1/min, crm_automacoes_tick) com header x-automacao-segredo = integracao_config.crm_automacoes_segredo
//      -> avalia gatilhos das regras LIGADAS, enfileira, executa a fila respeitando os limites;
//  - a tela do CRM (JWT de usuário aprovado): simular, contar público, confirmar/pausar/retomar/cancelar
//    campanha, relatório, amostra do template oficial.
//
// Fluxos (crm_fluxos, migration 20261023120000): inscreve quem bateu no gatilho e anda os passos de cada
// execução; mensagem e template de fluxo entram na mesma fila (e nos mesmos limites) das automações.
//
// Envio não oficial: no máximo UM item por chamada, com intervalo aleatório reservado em
// crm_envio_config.proximo_envio_em (trava atômica), janela 8h-20h, máx./hora e máx./dia contados
// no crm_automacao_log, pausa automática com 3 falhas seguidas ou sinal de restrição.
// Mensagem da IA (follow-up, 18/10/2026): o passo entra na MESMA fila não oficial (limites, janela, intervalo,
// pausa por falha); o texto é escrito pelo agente de follow-up só na hora do envio (executarPassoFollowup em
// _shared/agenteResponder.ts). IA falhou = nada sai e o log do fluxo diz o motivo.
// Número do envio (17/10/2026): o da automação/campanha/fluxo (crm_automacao_fila.numero_id, Central); sem
// número escolhido, o MESMO número da conversa do contato (última mensagem; sem mensagem, o contato).
// Permissões do CRM (22/11/2026): área/número/ação conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aplicarVariaveis } from "../_shared/agentesIA.ts";
import { executarPassoFollowup, type ResultadoPasso } from "../_shared/agenteResponder.ts";
import type { AgenteFollowup, LinhaHistorico } from "../_shared/agenteFollowup.ts";
import { completarChatCRM } from "../_shared/iaCRM.ts";
import { planoTransferencia } from "../_shared/roboAtendimento.ts";
import { transferirParaIAPorFluxo } from "../_shared/iaGatilhoDb.ts";
import { aplicarTagsAoIniciar, mesclarTagsAoIniciar } from "../_shared/iaTagsInicio.ts";
import { fluxoDeFollowup, pausadaPorHumano } from "../_shared/pausaHumana.ts";
import { retomarPorFollowup } from "../_shared/roboPausa.ts";
import { carregarEtapasValidas } from "../_shared/etapas.ts";
import { enviarWhatsApp, ErroEnvio } from "../_shared/waEnvio.ts";
import { sessaoEnvio } from "../_shared/waNumero.ts";
import {
  type Acao,
  type Automacao,
  type ConfigEnvio,
  type ContatoBasico,
  type FiltroPublico,
  type PassoBasico,
  CONFIG_PADRAO,
  acaoUsaWhatsApp,
  agendarLotes,
  aindaSemResposta,
  avaliarEventos,
  avaliarSemResposta,
  filtrarPublico,
  filtroVazio,
  inicioDoDiaSP,
  inicioDosEventos,
  intervaloAleatorio,
  normalizarTag,
  passosDoEnvio,
  passosLivres,
  payloadTemplateOficial,
  precisaWhatsApp,
  problemasDosPassos,
  registrarResultado,
  ultimaMensagemPorContato,
  validarAutomacao,
  verificarLimites,
} from "../_shared/automacoes.ts";
import {
  type EventoFluxo,
  type ExecucaoFluxo,
  type Fluxo,
  type GatilhoFluxo,
  gatilhosDoFluxo,
  decidir,
  inicioEventosFluxo,
  inscricoesDoFluxo,
  normalizarEvento,
  resolverVariaveis,
  validarFluxo,
  bateFiltroBanco,
  eventoDoBanco,
  eventoWebhook,
  inicioDoGatilho,
} from "../_shared/fluxos.ts";
import {
  alvosSemResposta,
  chaveGatilhoBase,
  corpoWebhook,
  inicioDiaBRT,
  inscricoesPorSegmento,
  passoEnvia,
  proximaJanela,
  vagasHoje,
} from "../_shared/fluxoConstrutor.ts";
import { aplicarFiltro, type FiltroSegmento } from "../_shared/segmentoFiltro.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_CAMPANHA = 5000;

// ------------------------------------------------------------------ utilidades

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function configIntegracao(chave: string): Promise<string | null> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

async function carregarConfig(): Promise<ConfigEnvio> {
  const { data } = await db.from("crm_envio_config").select("*").eq("numero", "principal").maybeSingle();
  return { ...CONFIG_PADRAO, ...(data ?? {}) } as ConfigEnvio;
}

/** Grupo do WhatsApp gravado no CRM (phone = JID …@g.us, desde 17/10/2026). */
const ehContatoGrupo = (phone: unknown) => typeof phone === "string" && phone.endsWith("@g.us");

async function contatosPorTelefone(phones: string[]): Promise<Map<string, ContatoBasico>> {
  const m = new Map<string, ContatoBasico>();
  const unicos = [...new Set(phones)];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data } = await db
      .from("whatsapp_contacts")
      .select("phone, name, stage, source, tags")
      .in("phone", unicos.slice(i, i + 200));
    // grupo (phone = …@g.us) nunca entra em automação/campanha
    for (const c of data ?? []) if (!ehContatoGrupo(c.phone)) m.set(c.phone, c as ContatoBasico);
  }
  return m;
}

async function todosContatos(): Promise<ContatoBasico[]> {
  const saida: ContatoBasico[] = [];
  for (let de = 0; de < 50_000; de += 1000) {
    const { data, error } = await db
      .from("whatsapp_contacts")
      .select("phone, name, stage, source, tags")
      .order("created_at", { ascending: true })
      .range(de, de + 999);
    if (error) throw error;
    saida.push(...((data ?? []) as ContatoBasico[]).filter((c) => !ehContatoGrupo(c.phone)));
    if (!data || data.length < 1000) break;
  }
  return saida;
}

async function mensagensDesde(desde: Date, direcao?: "inbound" | "outbound") {
  const saida: { contact_phone: string; direction: string; created_at: string }[] = [];
  for (let de = 0; de < 40_000; de += 1000) {
    let q = db
      .from("whatsapp_messages")
      .select("contact_phone, direction, created_at")
      .gte("created_at", desde.toISOString())
      .order("created_at", { ascending: true })
      .range(de, de + 999);
    if (direcao) q = q.eq("direction", direcao);
    const { data, error } = await q;
    if (error) throw error;
    saida.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return saida;
}

async function jaNaFila(automacaoId: string | undefined, phones: string[]): Promise<Set<string>> {
  const s = new Set<string>();
  if (!automacaoId || !phones.length) return s;
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await db
      .from("crm_automacao_fila")
      .select("contact_phone")
      .eq("automacao_id", automacaoId)
      .in("contact_phone", phones.slice(i, i + 200));
    for (const r of data ?? []) s.add(r.contact_phone);
  }
  return s;
}

// --------------------------------------------------------------- gatilhos

async function atingidos(aut: Automacao, agora: Date, simulacao: boolean): Promise<{ phones: string[]; contatos: Map<string, ContatoBasico> }> {
  if (aut.gatilho_tipo === "etapa" || aut.gatilho_tipo === "tag") {
    const desde = inicioDosEventos(aut, agora, simulacao);
    const { data: eventos } = await db
      .from("crm_contato_eventos")
      .select("contact_phone, tipo, valor, created_at")
      .eq("tipo", aut.gatilho_tipo)
      .gte("created_at", desde.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);
    const lista = (eventos ?? []).filter((e) =>
      aut.gatilho_tipo === "tag" ? normalizarTag(e.valor) === normalizarTag(aut.gatilho_valor) : e.valor === aut.gatilho_valor
    );
    const phones = [...new Set(lista.map((e) => e.contact_phone))];
    const contatos = await contatosPorTelefone(phones);
    const fila = await jaNaFila(aut.id, phones);
    return { phones: avaliarEventos(aut, lista, contatos, fila, agora, simulacao), contatos };
  }
  if (aut.gatilho_tipo === "sem_resposta") {
    const horas = Number(aut.sem_resposta_horas) + Number(aut.janela_max_horas || 48);
    const msgs = await mensagensDesde(new Date(agora.getTime() - horas * 3600_000));
    const candidatos = [...ultimaMensagemPorContato(msgs).entries()]
      .filter(([, m]) => m.direction === "outbound")
      .map(([p]) => p);
    const contatos = await contatosPorTelefone(candidatos);
    const fila = await jaNaFila(aut.id, candidatos);
    return { phones: avaliarSemResposta(aut, msgs, contatos, fila, agora), contatos };
  }
  return { phones: [], contatos: new Map() };
}

async function avaliarAutomacoes(agora: Date): Promise<number> {
  const { data: auts } = await db.from("crm_automacoes").select("*").eq("ativo", true);
  let n = 0;
  for (const a of (auts ?? []) as Automacao[]) {
    if (validarAutomacao(a).length) continue;
    try {
      const { phones } = await atingidos(a, agora, false);
      if (!phones.length) continue;
      const usa = precisaWhatsApp(a.acoes);
      const linhas = phones.map((p) => ({
        origem: "automacao",
        automacao_id: a.id,
        contact_phone: p,
        gatilho_tipo: a.gatilho_tipo,
        acoes: a.acoes,
        usa_whatsapp: usa,
      }));
      const { error } = await db
        .from("crm_automacao_fila")
        .upsert(linhas, { onConflict: "automacao_id,contact_phone", ignoreDuplicates: true });
      if (error) console.error("enfileirar", a.id, error.message);
      else n += linhas.length;
    } catch (e) {
      console.error("avaliar", a.id, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

// --------------------------------------------------------------- execução

async function passosDaAcao(acao: Acao): Promise<PassoBasico[]> {
  const campos = "id, ordem, tipo, conteudo, media_url, file_name, atraso_segundos, aguarda_resposta";
  if (acao.tipo === "passo") {
    const { data } = await db.from("crm_roteiro_passos").select(campos).eq("id", acao.passo_id).maybeSingle();
    return data ? [data as PassoBasico] : [];
  }
  if (acao.tipo === "roteiro") {
    const { data } = await db.from("crm_roteiro_passos").select(campos).eq("roteiro_id", acao.roteiro_id);
    return passosDoEnvio((data ?? []) as PassoBasico[]);
  }
  if (acao.tipo === "livre") return passosLivres(acao);
  return [];
}

async function registrar(item: ItemFila, canal: "whatsapp" | "oficial" | "crm", tipo: string, ok: boolean, detalhe = "", messageId: string | null = null) {
  await db.from("crm_automacao_log").insert({
    fila_id: item.id,
    automacao_id: item.automacao_id,
    campanha_id: item.campanha_id,
    fluxo_id: item.fluxo_id ?? null,
    contact_phone: item.contact_phone,
    canal,
    tipo,
    status: ok ? "ok" : "erro",
    detalhe: detalhe.slice(0, 1000),
    message_id: messageId,
  });
}

interface ItemFila {
  id: number;
  origem: string;
  automacao_id: string | null;
  campanha_id: string | null;
  fluxo_id?: string | null;
  fluxo_execucao_id?: number | null;
  contact_phone: string;
  gatilho_tipo: string | null;
  acoes: Acao[];
  usa_whatsapp: boolean;
  tentativas: number;
}

type Resultado =
  | { estado: "enviado" }
  | { estado: "ignorado"; motivo: string }
  | { estado: "erro"; motivo: string; falhaWhatsApp?: { status: number; detalhe: unknown } };

const rotuloMidia = (t: string) => (t === "image" ? "[foto]" : t === "audio" ? "[áudio]" : t === "document" ? "[documento]" : "");

/** Número da conversa do contato: o da última mensagem; sem mensagem, o do contato mais recente; null = padrão. */
async function numeroDaConversa(phone: string): Promise<string | null> {
  const { data: m, error } = await db.from("whatsapp_messages").select("numero_id")
    .eq("contact_phone", phone).order("created_at", { ascending: false }).limit(1);
  if (error) return null; // sem a coluna (migration pendente): padrão
  if (m?.[0]?.numero_id) return m[0].numero_id;
  const { data: c } = await db.from("whatsapp_contacts").select("numero_id")
    .eq("phone", phone).order("updated_at", { ascending: false }).limit(1);
  return c?.[0]?.numero_id ?? null;
}

/** Número do item: o escolhido na Central (herdado pela fila) ou o da conversa. Cache por item. */
const numeroDoItemCache = new Map<number, string | null>();
async function numeroDoItem(item: ItemFila): Promise<string | null> {
  if (numeroDoItemCache.has(item.id)) return numeroDoItemCache.get(item.id)!;
  let escolhido: string | null = null;
  if (item.id) {
    const { data, error } = await db.from("crm_automacao_fila").select("numero_id").eq("id", item.id).maybeSingle();
    if (!error) escolhido = data?.numero_id ?? null;
  }
  const n = escolhido ?? await numeroDaConversa(item.contact_phone);
  numeroDoItemCache.set(item.id, n);
  return n;
}

/** Manda UM passo (texto ou mídia) pelo número do item e grava a mensagem no CRM. null = saiu; senão o motivo. */
async function enviarPasso(item: ItemFila, p: PassoBasico, texto: string): Promise<Resultado | null> {
  try {
    // número do item (Central /crm/central) ou o da conversa: sessão do OpenWA dele; oficial/desativado não envia
    const numeroId = await numeroDoItem(item);
    const alvo = await sessaoEnvio(db, numeroId);
    if ("recusa" in alvo) return { estado: "ignorado", motivo: alvo.recusa };
    const id = await enviarWhatsApp(
      item.contact_phone,
      { tipo: p.tipo, texto, url: p.media_url, fileName: p.file_name },
      { sessao: alvo.sessao },
    );
    await registrar(item, "whatsapp", p.tipo, true, `passo ${p.ordem}`, id);
    await db.from("whatsapp_messages").insert({
      ...(numeroId ? { numero_id: numeroId } : {}),
      contact_phone: item.contact_phone,
      direction: "outbound",
      sender_type: "bot",
      body: p.tipo === "text" ? texto : (texto || rotuloMidia(p.tipo)),
      media_url: p.tipo === "text" ? null : p.media_url,
      media_type: p.tipo === "text" ? null : p.tipo,
      file_name: p.file_name,
      caption: p.tipo === "text" ? null : (texto || null),
      message_id: id,
    });
    return null;
  } catch (e) {
    const status = e instanceof ErroEnvio ? e.status : 0;
    const detalhe = e instanceof ErroEnvio ? e.detalhe : String(e);
    await registrar(item, "whatsapp", p.tipo, false, `passo ${p.ordem}: HTTP ${status} ${JSON.stringify(detalhe).slice(0, 400)}`);
    return { estado: "erro", motivo: `falha no passo ${p.ordem} (HTTP ${status})`, falhaWhatsApp: { status, detalhe } };
  }
}

/** Passo "Mensagem da IA": gera com o agente de follow-up na hora e manda como texto (ou não manda e diz por quê). */
async function passoFollowup(item: ItemFila, contato: ContatoBasico, acao: Extract<Acao, { tipo: "ia_followup" }>, desde: string | null): Promise<ResultadoPasso> {
  return await executarPassoFollowup(acao, { contato: { phone: contato.phone, name: contato.name, stage: contato.stage }, desde }, {
    carregarAgente: async (id) => {
      const { data } = await db.from("crm_ai_agents").select("*").eq("id", id).maybeSingle();
      return (data as AgenteFollowup | null) ?? null;
    },
    carregarHistorico: async (phone, limite) => {
      const { data } = await db.from("whatsapp_messages").select("direction, sender_type, body, caption, media_type, created_at")
        .eq("contact_phone", phone).order("created_at", { ascending: false }).limit(limite);
      return ((data ?? []) as (LinhaHistorico & { caption?: string | null; media_type?: string | null })[]).map((m) => ({
        direction: m.direction, sender_type: m.sender_type ?? null, created_at: m.created_at,
        body: m.body || m.caption || (m.media_type ? rotuloMidia(m.media_type) : null),
      }));
    },
    completar: (mensagens, opcoes) => completarChatCRM(mensagens, opcoes),
    registrar: (ok, detalhe) => registrar(item, "crm", "ia_followup", ok, detalhe),
    enviarTexto: async (texto) => {
      const r = await enviarPasso(item, {
        id: "ia", ordem: acao.tentativa ?? 1, tipo: "text", conteudo: texto, media_url: null, file_name: null, atraso_segundos: 0, aguarda_resposta: false,
      }, texto);
      return r ?? { estado: "enviado" };
    },
  });
}

async function executarItem(item: ItemFila, passosPlanejados?: PassoBasico[]): Promise<Resultado> {
  const contatos = await contatosPorTelefone([item.contact_phone]);
  const contato = contatos.get(item.contact_phone);
  if (!contato) return { estado: "ignorado", motivo: "contato não existe mais" };

  if (item.gatilho_tipo === "sem_resposta") {
    const { data: ult } = await db
      .from("whatsapp_messages")
      .select("contact_phone, direction, created_at")
      .eq("contact_phone", item.contact_phone)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!aindaSemResposta(ult?.[0])) return { estado: "ignorado", motivo: "a lead respondeu antes do envio" };
  }

  let inicioExecucao: string | null = null;
  if (item.fluxo_execucao_id) {
    const { data: ex } = await db.from("crm_fluxo_execucoes").select("status, iniciado_em").eq("id", item.fluxo_execucao_id).maybeSingle();
    if (!ex || !["ativo", "concluido"].includes(ex.status)) return { estado: "ignorado", motivo: `fluxo ${ex?.status ?? "apagado"}` };
    inicioExecucao = ex.iniciado_em ?? null;
  }

  const nomeAut = item.automacao_id ?? item.campanha_id ?? item.fluxo_id ?? null;

  for (const acao of item.acoes) {
    if (acao.tipo === "ia_followup") {
      const r = await passoFollowup(item, contato, acao, inicioExecucao);
      if (r.estado !== "enviado") return r;
      // follow-up saiu: é o único caminho automático que tira a pausa de atendimento humano (pausaHumana.ts)
      await retomarPorFollowup(db, await numeroDoItem(item), item.contact_phone, item.fluxo_id ? `fluxo ${item.fluxo_id}` : "passo Mensagem da IA");
    } else if (acaoUsaWhatsApp(acao)) {
      const passos = passosPlanejados ?? await passosDaAcao(acao);
      const problemas = problemasDosPassos(passos);
      if (problemas.length) return { estado: "ignorado", motivo: problemas.join(" ") };
      for (const [i, p] of passos.entries()) {
        if (i > 0) await dormir(Math.min(Math.max(Number(p.atraso_segundos) || 0, 3), 8) * 1000);
        const texto = aplicarVariaveis(p.conteudo ?? "", contato);
        const falha = await enviarPasso(item, p, texto);
        if (falha) return falha;
      }
    } else if (acao.tipo === "etapa") {
      const { error } = await db
        .from("whatsapp_contacts")
        .update({ stage: acao.etapa, updated_at: new Date().toISOString() })
        .eq("phone", item.contact_phone);
      await registrar(item, "crm", "etapa", !error, error ? error.message : `→ ${acao.etapa}`);
    } else if (acao.tipo === "tag") {
      const tag = normalizarTag(acao.tag);
      const atuais = (contato.tags ?? []).map(normalizarTag);
      if (tag && !atuais.includes(tag)) {
        const { error } = await db
          .from("whatsapp_contacts")
          .update({ tags: [...(contato.tags ?? []), tag], updated_at: new Date().toISOString() })
          .eq("phone", item.contact_phone);
        await registrar(item, "crm", "tag", !error, error ? error.message : `+ ${tag}`);
      }
    } else if (acao.tipo === "template_oficial") {
      const url = await configIntegracao("fullfunnel_webhook_crm_url");
      const payload = payloadTemplateOficial(contato, acao, { automacao: nomeAut });
      if (!url || !/^https:\/\/[^/]+\//.test(url)) {
        await registrar(item, "oficial", "template_oficial", false, "sem URL https em integracao_config.fullfunnel_webhook_crm_url");
        return { estado: "erro", motivo: "Full Funnel sem URL configurada" };
      }
      if (!payload) {
        await registrar(item, "oficial", "template_oficial", false, "telefone não vira E.164");
        return { estado: "ignorado", motivo: "telefone inválido para o template oficial" };
      }
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        const corpo = (await r.text().catch(() => "")).slice(0, 300);
        await registrar(item, "oficial", "template_oficial", r.ok, `${acao.template}: HTTP ${r.status} ${corpo}`);
        if (!r.ok) return { estado: "erro", motivo: `Full Funnel respondeu ${r.status}` };
      } catch (e) {
        await registrar(item, "oficial", "template_oficial", false, String(e));
        return { estado: "erro", motivo: "Full Funnel fora do ar" };
      }
    }
  }
  return { estado: "enviado" };
}

async function reivindicar(id: number, tentativas: number): Promise<boolean> {
  const { data } = await db
    .from("crm_automacao_fila")
    .update({ status: "enviando", tentativas: tentativas + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pendente")
    .select("id");
  return Boolean(data?.length);
}

async function finalizar(item: ItemFila, r: Resultado) {
  const agora = new Date().toISOString();
  if (r.estado === "enviado") {
    await db.from("crm_automacao_fila").update({ status: "enviado", motivo: null, enviado_em: agora, updated_at: agora }).eq("id", item.id);
  } else if (r.estado === "ignorado") {
    await db.from("crm_automacao_fila").update({ status: "ignorado", motivo: r.motivo, updated_at: agora }).eq("id", item.id);
  } else {
    // Falha antes de qualquer mensagem sair pode tentar de novo uma vez, 15 min depois.
    // (Se parte do roteiro saiu, não repete: melhor faltar um passo que duplicar mensagem.)
    const { count } = await db
      .from("crm_automacao_log")
      .select("id", { count: "exact", head: true })
      .eq("fila_id", item.id)
      .eq("status", "ok")
      .eq("canal", "whatsapp");
    const repetir = item.tentativas + 1 < 2 && !count;
    await db.from("crm_automacao_fila").update({
      status: repetir ? "pendente" : "erro",
      motivo: r.motivo,
      agendado_para: repetir ? new Date(Date.now() + 15 * 60_000).toISOString() : undefined,
      updated_at: agora,
    }).eq("id", item.id);
  }
}

/** Itens sem mensagem não oficial (mudar etapa, tag, template oficial): sem ritmo, até 50 por vez. */
async function processarSemWhatsApp(agora: Date): Promise<number> {
  const { data } = await db
    .from("crm_automacao_fila")
    .select("id, origem, automacao_id, campanha_id, fluxo_id, fluxo_execucao_id, contact_phone, gatilho_tipo, acoes, usa_whatsapp, tentativas")
    .eq("status", "pendente")
    .eq("usa_whatsapp", false)
    .lte("agendado_para", agora.toISOString())
    .order("id", { ascending: true })
    .limit(50);
  let n = 0;
  for (const item of (data ?? []) as ItemFila[]) {
    if (!(await reivindicar(item.id, item.tentativas))) continue;
    await finalizar(item, await executarItem(item));
    n++;
  }
  return n;
}

async function usoWhatsApp(agora: Date): Promise<{ hora: number; dia: number }> {
  const base = () =>
    db.from("crm_automacao_log").select("id", { count: "exact", head: true }).eq("canal", "whatsapp").eq("status", "ok");
  const { count: hora } = await base().gte("created_at", new Date(agora.getTime() - 3600_000).toISOString());
  const { count: dia } = await base().gte("created_at", inicioDoDiaSP(agora).toISOString());
  return { hora: hora ?? 0, dia: dia ?? 0 };
}

/** Um item com mensagem não oficial, se os limites deixarem. */
async function processarUmWhatsApp(agora: Date): Promise<string> {
  const cfg = await carregarConfig();
  if (!cfg.ligado) return "envio desligado";
  if (cfg.pausado) return `pausado: ${cfg.pausado_motivo ?? ""}`;

  const { data: ativas } = await db.from("crm_campanhas").select("id").eq("status", "ativa");
  const campanhasAtivas = new Set((ativas ?? []).map((c) => c.id));

  const { data: candidatos } = await db
    .from("crm_automacao_fila")
    .select("id, origem, automacao_id, campanha_id, fluxo_id, fluxo_execucao_id, contact_phone, gatilho_tipo, acoes, usa_whatsapp, tentativas")
    .eq("status", "pendente")
    .eq("usa_whatsapp", true)
    .lte("agendado_para", agora.toISOString())
    .order("agendado_para", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);
  // Automação e fluxo (resposta a um gatilho) passam na frente de campanha.
  const peso = (o: string) => (o === "campanha" ? 1 : 0);
  const elegiveis = ((candidatos ?? []) as ItemFila[])
    .filter((i) => !i.campanha_id || campanhasAtivas.has(i.campanha_id))
    .sort((a, b) => peso(a.origem) - peso(b.origem));
  const item = elegiveis[0];
  if (!item) return "fila vazia";

  const acaoMsg = item.acoes.find(acaoUsaWhatsApp);
  const passos = acaoMsg ? await passosDaAcao(acaoMsg) : [];
  const v = verificarLimites(cfg, await usoWhatsApp(agora), passos.length, agora);
  if (!v.ok) return `${v.motivo}: ${v.detalhe}`;

  // Trava atômica: reserva o próximo horário antes de enviar (duas chamadas não enviam juntas).
  // mensagem da IA: 1 texto, mais o tempo do Claude escrever
  const duracao = acaoMsg?.tipo === "ia_followup" ? 60 : passos.length * 8;
  const proximo = new Date(agora.getTime() + (intervaloAleatorio(cfg.intervalo_min, cfg.intervalo_max) + duracao) * 1000);
  const { data: reservado } = await db
    .from("crm_envio_config")
    .update({ proximo_envio_em: proximo.toISOString() })
    .eq("numero", "principal")
    .or(`proximo_envio_em.is.null,proximo_envio_em.lte.${agora.toISOString()}`)
    .select("numero");
  if (!reservado?.length) return "outra chamada reservou o horário";

  if (!(await reivindicar(item.id, item.tentativas))) return "item já pego";
  const r = await executarItem(item, passos);
  await finalizar(item, r);

  // Só falha de envio do WhatsApp conta para a pausa automática.
  const falha = r.estado === "erro" ? r.falhaWhatsApp : undefined;
  if (r.estado === "enviado" || falha) {
    const conta = registrarResultado(
      cfg.falhas_seguidas,
      falha ? { ok: false, status: falha.status, detalhe: falha.detalhe } : { ok: true },
    );
    await db.from("crm_envio_config").update({
      falhas_seguidas: conta.falhasSeguidas,
      ...(conta.pausar ? { pausado: true, pausado_motivo: `${conta.motivo} em ${agora.toISOString()}` } : {}),
      atualizado_em: new Date().toISOString(),
    }).eq("numero", "principal");
    if (conta.pausar) return `enviou com falha e PAUSOU: ${conta.motivo}`;
  }
  return `item ${item.id}: ${r.estado}`;
}

async function manutencao() {
  // Item preso em "enviando" (função caiu no meio): vira erro, NÃO reenvia (evita duplicar).
  await db
    .from("crm_automacao_fila")
    .update({ status: "erro", motivo: "interrompido no meio do envio" })
    .eq("status", "enviando")
    .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());
  // Campanha ativa sem nada pendente = concluída.
  const { data: ativas } = await db.from("crm_campanhas").select("id").eq("status", "ativa");
  for (const c of ativas ?? []) {
    const { count } = await db
      .from("crm_automacao_fila")
      .select("id", { count: "exact", head: true })
      .eq("campanha_id", c.id)
      .in("status", ["pendente", "enviando"]);
    if (!count) await db.from("crm_campanhas").update({ status: "concluida", updated_at: new Date().toISOString() }).eq("id", c.id);
  }
}

async function tick() {
  const agora = new Date();
  // etapas configuráveis (crm_etapas): qualquer slug existente vale em gatilho/ação; sem a tabela, as 5 de sempre
  await carregarEtapasValidas(db);
  const enfileirados = await avaliarAutomacoes(agora);
  let fluxos: { inscritos: number; avancados: number } | { erro: string } = { inscritos: 0, avancados: 0 };
  try {
    fluxos = { inscritos: await inscreverFluxos(agora), avancados: await avancarFluxos(agora) };
  } catch (e) {
    fluxos = { erro: e instanceof Error ? e.message : String(e) }; // tabela ainda não existe etc.: não derruba o resto
  }
  const semWhatsApp = await processarSemWhatsApp(agora);
  const whatsapp = await processarUmWhatsApp(agora);
  await manutencao();
  return { enfileirados, fluxos, semWhatsApp, whatsapp };
}

// --------------------------------------------------------------- fluxos

/** Inscrições de hoje (Brasília) por fluxo: base do "limite por dia". */
async function inscritosHoje(fluxoId: string, agora: Date): Promise<number> {
  const { count } = await db.from("crm_fluxo_execucoes").select("id", { count: "exact", head: true })
    .eq("fluxo_id", fluxoId).gte("iniciado_em", inicioDiaBRT(agora).toISOString());
  return count ?? 0;
}

async function execucoesDe(fluxoId: string, phones: string[]) {
  const execs: Pick<ExecucaoFluxo, "contact_phone" | "status" | "iniciado_em">[] = [];
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await db.from("crm_fluxo_execucoes").select("contact_phone, status, iniciado_em")
      .eq("fluxo_id", fluxoId).in("contact_phone", phones.slice(i, i + 200));
    execs.push(...((data ?? []) as typeof execs));
  }
  return execs;
}

/**
 * Telefones (só dígitos) de um segmento de alunas (Gestão de Alunas): public.crm_alunas_telefones
 * (migration 20261031100000) já aplica a regra de ativa/ex, o programa (MGMD/ELITE/PLATAFORMA) e a dedup.
 */
async function membrosAlunas(filtro: FiltroSegmento): Promise<string[]> {
  const saida: string[] = [];
  // PostgREST corta em 1000 linhas por resposta: pagina igual à base
  for (let de = 0; de < 20_000; de += 1000) {
    const { data, error } = await db.rpc("crm_alunas_telefones", { p_situacao: filtro.alunas, p_programa: filtro.programa ?? null })
      .order("telefone").range(de, de + 999);
    if (error) throw new Error(`alunas: ${error.message}`);
    for (const r of (data ?? []) as { telefone: string | null }[]) {
      const d = String(r.telefone ?? "").replace(/\D/g, "");
      if (d.length >= 10 && d.length <= 15) saida.push(d);
    }
    if (!data || data.length < 1000) break;
  }
  return [...new Set(saida)];
}

/** Telefones (só dígitos) de um segmento salvo ou de uma lista importada (base_leads.origem). */
async function membrosDaBase(segmentoId: string | null | undefined, listaOrigem: string | null | undefined, tag?: string | null): Promise<string[]> {
  if (tag) {
    const { data, error } = await db.from("whatsapp_contacts").select("phone").contains("tags", [normalizarTag(tag)]).limit(20_000);
    if (error) throw error;
    return (data ?? []).map((c: { phone: string }) => c.phone).filter((p: string) => !ehContatoGrupo(p));
  }
  let filtro: FiltroSegmento;
  if (segmentoId) {
    const { data: seg, error } = await db.from("crm_segmentos").select("filtro, ativo").eq("id", segmentoId).maybeSingle();
    if (error) throw error;
    if (!seg || seg.ativo === false) throw new Error("segmento não existe ou está desativado");
    filtro = (seg.filtro ?? {}) as FiltroSegmento;
    if (filtro.alunas) return await membrosAlunas(filtro);
  } else {
    filtro = { origens: [String(listaOrigem ?? "")] };
  }
  const saida: string[] = [];
  for (let de = 0; de < 20_000; de += 1000) {
    // deno-lint-ignore no-explicit-any
    const base: any = db.from("base_leads_unificada").select("telefone_e164");
    // deno-lint-ignore no-explicit-any
    const q: any = aplicarFiltro(base, filtro, { comTelefone: true });
    const { data, error } = await q.order("chave").range(de, de + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const d = String(r.telefone_e164 ?? "").replace(/\D/g, "");
      if (d.length >= 10 && d.length <= 15) saida.push(d);
    }
    if (!data || data.length < 1000) break;
  }
  return [...new Set(saida)];
}

/**
 * Contato que ainda não existe no CRM nasce com telefone (o motor só anda com contato). Quem já existe
 * em QUALQUER número fica como está; o novo nasce no número padrão (default numero_id do banco).
 */
async function garantirContatos(phones: string[], origem: string) {
  for (let i = 0; i < phones.length; i += 500) {
    const lote = phones.slice(i, i + 500);
    const { data: ja } = await db.from("whatsapp_contacts").select("phone").in("phone", lote);
    const existentes = new Set((ja ?? []).map((r: { phone: string }) => r.phone));
    const novos = lote.filter((p) => !existentes.has(p));
    if (!novos.length) continue;
    let { error } = await db.from("whatsapp_contacts").upsert(
      novos.map((phone) => ({ phone, name: "", source: origem })),
      { onConflict: "numero_id,phone", ignoreDuplicates: true },
    );
    // sem a coluna numero_id (migration 20261028100000 pendente): o alvo antigo
    if (error && ["42P10", "42703", "PGRST204"].includes(String(error.code))) {
      ({ error } = await db.from("whatsapp_contacts").upsert(
        novos.map((phone) => ({ phone, name: "", source: origem })),
        { onConflict: "phone", ignoreDuplicates: true },
      ));
    }
    if (error) console.error("garantirContatos:", error.message);
  }
}

async function inscrever(f: Fluxo, lista: { phone: string; dados: Record<string, unknown> }[], agora: Date): Promise<string[]> {
  const ok: string[] = [];
  for (const ins of lista) {
    // o índice único (fluxo, contato) WHERE ativo barra corrida entre duas chamadas
    const { error: e } = await db.from("crm_fluxo_execucoes").insert({
      fluxo_id: f.id, contact_phone: ins.phone, dados: ins.dados, proximo_em: agora.toISOString(), iniciado_em: agora.toISOString(),
    });
    if (!e) ok.push(ins.phone);
  }
  return ok;
}

async function inscreverPorBase(f: Fluxo, g: Extract<GatilhoFluxo, { tipo: "segmento" | "data" }>, vagas: number, agora: Date): Promise<number> {
  if (g.tipo === "data" && new Date(g.em) > agora) return 0;
  const modo = g.tipo === "segmento" ? g.modo : "todos";
  const membros = g.tipo === "segmento"
    ? await membrosDaBase(g.segmento_id, g.lista_origem)
    : await membrosDaBase(g.segmento_id, null, g.segmento_id ? null : g.tag);
  const chave = chaveGatilhoBase(g);
  const vistos = new Set<string>();
  if (modo === "novos") {
    for (let de = 0; de < 50_000; de += 1000) {
      const { data } = await db.from("crm_fluxo_base_vistos").select("contact_phone").eq("fluxo_id", f.id).eq("chave", chave).range(de, de + 999);
      for (const r of data ?? []) vistos.add(r.contact_phone);
      if (!data || data.length < 1000) break;
    }
  }
  const execs = await execucoesDe(f.id, membros);
  const ja = new Set(execs.map((x) => x.contact_phone));
  const r = inscricoesPorSegmento({ modo, membros, jaInscritos: ja, vistos, vagas });
  let entrou: string[] = [];
  if (r.inscrever.length) {
    await garantirContatos(r.inscrever, g.tipo === "segmento" ? "segmento" : "agenda");
    entrou = await inscrever(f, r.inscrever.map((phone) => ({ phone, dados: { gatilho: g.tipo } })), agora);
  }
  const foto = r.inscrever.length ? entrou : r.fotografar;
  for (let i = 0; i < foto.length; i += 500) {
    await db.from("crm_fluxo_base_vistos").upsert(
      foto.slice(i, i + 500).map((contact_phone) => ({ fluxo_id: f.id, chave, contact_phone })),
      { onConflict: "fluxo_id,chave,contact_phone", ignoreDuplicates: true },
    );
  }
  return entrou.length;
}

async function inscreverFluxos(agora: Date): Promise<number> {
  const { data: fluxos, error } = await db.from("crm_fluxos").select("*").eq("ativo", true).is("excluido_em", null);
  if (error) throw error;
  let n = 0;
  for (const f of (fluxos ?? []) as Fluxo[]) {
    if (validarFluxo(f).length) continue;
    const desde = inicioEventosFluxo(f, agora);
    let vagas = vagasHoje(f.config, await inscritosHoje(f.id, agora));
    for (const g of gatilhosDoFluxo(f)) {
      if (vagas <= 0) break;
      try {
        let lista: { phone: string; dados: Record<string, unknown> }[] = [];
        if (g.tipo === "tag" || g.tipo === "etapa" || g.tipo === "evento") {
          const { data: eventos } = await db
            .from("crm_contato_eventos")
            .select("contact_phone, tipo, valor, dados, created_at")
            .eq("tipo", g.tipo)
            .gte("created_at", desde.toISOString())
            .order("created_at", { ascending: true })
            .limit(5000);
          const alvo = g.tipo === "tag" ? normalizarTag(g.valor) : g.tipo === "evento" ? normalizarEvento(g.valor) : g.valor;
          const evs = ((eventos ?? []) as EventoFluxo[]).filter((e) =>
            (g.tipo === "tag" ? normalizarTag(e.valor) : g.tipo === "evento" ? normalizarEvento(e.valor) : e.valor) === alvo
          );
          if (!evs.length) continue;
          const phones = [...new Set(evs.map((e) => e.contact_phone))];
          const contatos = await contatosPorTelefone(phones);
          const execs = await execucoesDe(f.id, phones);
          lista = inscricoesDoFluxo({ ...f, gatilho_tipo: g.tipo, gatilho_valor: g.valor }, evs, contatos, execs, agora);
        } else if (g.tipo === "sem_resposta") {
          const msgs = await mensagensDesde(new Date(agora.getTime() - (Number(g.horas) + 24) * 3600_000));
          const alvos = alvosSemResposta(msgs, Number(g.horas), desde, agora);
          if (!alvos.length) continue;
          const phones = alvos.map((x) => x.phone);
          const contatos = await contatosPorTelefone(phones);
          const execs = await execucoesDe(f.id, phones);
          for (const a of alvos) {
            if (!contatos.has(a.phone)) continue;
            const ant = execs.filter((x) => x.contact_phone === a.phone);
            if (ant.some((x) => x.status === "ativo")) continue;
            if (!f.permitir_repetir && ant.length) continue;
            if (ant.some((x) => x.iniciado_em >= a.desde)) continue; // mesmo silêncio não inscreve duas vezes
            lista.push({ phone: a.phone, dados: { sem_resposta_desde: a.desde } });
          }
        } else if (g.tipo === "banco" || g.tipo === "webhook") {
          // evento gravado pelo trigger da tabela (banco_<fonte>) ou pela edge function fluxo-entrada
          // (webhook_<fluxo>): só o que nasceu depois de publicar o fluxo E de criar o gatilho
          const nome = g.tipo === "banco" ? eventoDoBanco(g.fonte) : eventoWebhook(f.id);
          const { data: eventos, error: eEv } = await db
            .from("crm_contato_eventos")
            .select("contact_phone, tipo, valor, dados, created_at")
            .eq("tipo", "evento")
            .eq("valor", nome)
            .gte("created_at", inicioDoGatilho(desde, g).toISOString())
            .order("created_at", { ascending: true })
            .limit(5000);
          if (eEv) throw eEv;
          const evs = ((eventos ?? []) as EventoFluxo[]).filter((e) => g.tipo !== "banco" || bateFiltroBanco(g, e.dados));
          if (!evs.length) continue;
          const phones = [...new Set(evs.map((e) => e.contact_phone))];
          const execs = await execucoesDe(f.id, phones);
          const ja = new Set(execs.map((x) => x.contact_phone));
          // contato só nasce para quem vai entrar (o evento do banco não cria contato)
          await garantirContatos(phones.filter((p) => !ja.has(p) || f.permitir_repetir).slice(0, vagas), g.tipo === "banco" ? `banco:${g.fonte}` : "webhook");
          const contatos = await contatosPorTelefone(phones);
          lista = inscricoesDoFluxo({ ...f, gatilho_tipo: "evento", gatilho_valor: nome, ligado_em: inicioDoGatilho(desde, g).toISOString() }, evs, contatos, execs, agora)
            .map((x) => ({ ...x, dados: { ...x.dados, gatilho: g.tipo, ...(g.tipo === "banco" ? { fonte: g.fonte } : {}) } }));
        } else if (g.tipo === "segmento" || g.tipo === "data") {
          const entrou = await inscreverPorBase(f, g, vagas, agora);
          n += entrou;
          vagas -= entrou;
          continue;
        }
        const entrou = await inscrever(f, lista.slice(0, vagas), agora);
        n += entrou.length;
        vagas -= entrou.length;
      } catch (e) {
        console.error("fluxo gatilho", f.id, g.tipo, e instanceof Error ? e.message : e);
        await db.from("crm_automacao_log").insert({
          fluxo_id: f.id, contact_phone: "-", canal: "crm", tipo: `gatilho_${g.tipo}`, status: "erro",
          detalhe: String(e instanceof Error ? e.message : e).slice(0, 500),
        });
      }
    }
  }
  return n;
}

async function ultimaEntrada(phone: string): Promise<number> {
  const { data } = await db.from("whatsapp_messages").select("created_at")
    .eq("contact_phone", phone).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1);
  return data?.[0] ? new Date(data[0].created_at).getTime() : 0;
}

/** Alguma conversa do contato (qualquer número) com a IA pausada por atendimento humano? */
async function algumaPausaHumana(phone: string): Promise<boolean> {
  const { data, error } = await db.from("whatsapp_contacts").select("ai_pausado, ai_pausado_motivo").eq("phone", phone);
  if (error) return false;
  return ((data ?? []) as { ai_pausado: boolean | null; ai_pausado_motivo: string | null }[]).some(pausadaPorHumano);
}

/** Última transferência IA -> humano da conversa (crm_ai_eventos tipo "transferido"); 0 = nunca ou tabela ausente. */
async function ultimaTransferenciaIA(phone: string): Promise<number> {
  const { data, error } = await db.from("crm_ai_eventos").select("created_at")
    .eq("contact_phone", phone).eq("tipo", "transferido").order("created_at", { ascending: false }).limit(1);
  if (error) return 0;
  return data?.[0] ? new Date(data[0].created_at).getTime() : 0;
}

async function encerrarExecucao(ex: ExecucaoFluxo, status: string, motivo: string) {
  const agora = new Date().toISOString();
  await db.from("crm_fluxo_execucoes").update({ status, motivo: motivo.slice(0, 300), aguardando_resposta: false, updated_at: agora })
    .eq("id", ex.id).eq("status", "ativo");
  if (status !== "concluido") {
    await db.from("crm_automacao_fila").update({ status: "cancelado", motivo: `fluxo ${status}: ${motivo}`.slice(0, 300), updated_at: agora })
      .eq("fluxo_execucao_id", ex.id).eq("status", "pendente");
  }
}

/** Anda as execuções vencidas (ou que esperam resposta). Até 100 por chamada, até 10 ações cada. */
async function avancarFluxos(agora: Date): Promise<number> {
  const { data: execs, error } = await db
    .from("crm_fluxo_execucoes")
    .select("*")
    .eq("status", "ativo")
    .or(`proximo_em.lte.${agora.toISOString()},aguardando_resposta.eq.true`)
    .order("proximo_em", { ascending: true })
    .limit(100);
  if (error) throw error;
  const lista = (execs ?? []) as ExecucaoFluxo[];
  if (!lista.length) return 0;
  const { data: fluxos } = await db.from("crm_fluxos").select("*").in("id", [...new Set(lista.map((e) => e.fluxo_id))]);
  const porId = new Map(((fluxos ?? []) as Fluxo[]).map((f) => [f.id, f]));
  let n = 0;

  for (const ex of lista) {
    const f = porId.get(ex.fluxo_id);
    if (!f || !f.ativo || (f as { excluido_em?: string | null }).excluido_em) continue; // fluxo desligado/excluído: execução fica parada até religar
    const contato = (await contatosPorTelefone([ex.contact_phone])).get(ex.contact_phone);
    if (!contato) { await encerrarExecucao(ex, "erro", "contato não existe mais"); continue; }
    const entrada = await ultimaEntrada(ex.contact_phone);
    const transferiu = await ultimaTransferenciaIA(ex.contact_phone);
    const ctx = {
      contato,
      respondeuDesde: (d: string) => entrada > new Date(d).getTime(),
      iaTransferiuDesde: (d: string) => transferiu > new Date(d).getTime(),
    };

    const vencida = new Date(ex.proximo_em) <= agora;
    if (!vencida) {
      // "esperar até responder": só adianta se a lead respondeu depois do último envio
      if (!ex.aguardando_resposta || !ctx.respondeuDesde(ex.ultimo_envio_em ?? ex.iniciado_em)) continue;
    }

    let estado = { ...ex, aguardando_resposta: false };
    let encerrou = false;
    for (let acoes = 0; acoes < 10; acoes++) {
      const d = decidir(f, estado, ctx, agora);
      if (d.fazer === "parar") { await encerrarExecucao(estado, d.status, d.motivo); encerrou = true; break; }
      if (d.fazer === "esperar") {
        await db.from("crm_fluxo_execucoes").update({
          passo_idx: d.proximo_idx, proximo_em: d.ate.toISOString(), aguardando_resposta: d.aguardando_resposta,
          ultimo_envio_em: estado.ultimo_envio_em, updated_at: new Date().toISOString(),
        }).eq("id", ex.id).eq("status", "ativo");
        encerrou = true; // gravou o estado
        break;
      }
      const p = d.passo;
      // horário permitido do fluxo: mensagem fora da janela espera a próxima abertura (sem avançar)
      const abre = passoEnvia(p) ? proximaJanela(agora, f.config) : null;
      if (abre) {
        await db.from("crm_fluxo_execucoes").update({
          passo_idx: d.idx, proximo_em: abre.toISOString(), aguardando_resposta: false,
          ultimo_envio_em: estado.ultimo_envio_em, updated_at: new Date().toISOString(),
        }).eq("id", ex.id).eq("status", "ativo");
        encerrou = true;
        break;
      }
      const item = { id: null as unknown as number, origem: "fluxo", automacao_id: null, campanha_id: null, fluxo_id: f.id, fluxo_execucao_id: ex.id, contact_phone: ex.contact_phone, gatilho_tipo: "fluxo", acoes: [], usa_whatsapp: false, tentativas: 0 } as ItemFila;
      if (p.tipo === "tag") {
        const tag = normalizarTag(p.tag);
        const atuais = contato.tags ?? [];
        const tem = atuais.map(normalizarTag).includes(tag);
        const novas = p.acao === "por" ? (tem ? atuais : [...atuais, tag]) : atuais.filter((t) => normalizarTag(t) !== tag);
        if (novas !== atuais) {
          const { error: e } = await db.from("whatsapp_contacts").update({ tags: novas, updated_at: new Date().toISOString() }).eq("phone", ex.contact_phone);
          await registrar(item, "crm", "tag", !e, e ? e.message : `${p.acao === "por" ? "+" : "-"} ${tag} (fluxo passo ${d.idx + 1})`);
          if (!e) contato.tags = novas;
        }
      } else if (p.tipo === "etapa") {
        const { error: e } = await db.from("whatsapp_contacts").update({ stage: p.etapa, updated_at: new Date().toISOString() }).eq("phone", ex.contact_phone);
        await registrar(item, "crm", "etapa", !e, e ? e.message : `→ ${p.etapa} (fluxo passo ${d.idx + 1})`);
        if (!e) contato.stage = p.etapa;
      } else if (p.tipo === "atribuir") {
        // Com atendente_id (passo salvo depois da migration 20261123140000) a conversa vai para o usuário escolhido, e o
        // nome fica só de rótulo: renomear-se não desvia mais o "Atribuir". Sem id (fluxo antigo), o banco casa o nome.
        const patch: Record<string, unknown> = { atendente: p.atendente.trim().slice(0, 80), updated_at: new Date().toISOString() };
        if (p.atendente_id) patch.atendente_id = p.atendente_id;
        const { error: e } = await db.from("whatsapp_contacts").update(patch).eq("phone", ex.contact_phone);
        await registrar(item, "crm", "atribuir", !e, e ? e.message : `atendente ${p.atendente}${p.atendente_id ? " (por id)" : ""} (fluxo passo ${d.idx + 1})`);
      } else if (p.tipo === "agente_ia" && p.acao === "ligar" && !fluxoDeFollowup(f.passos) && await algumaPausaHumana(ex.contact_phone)) {
        // atendimento humano entrou: fluxo comum não religa a IA (só fluxo de follow-up ou o botão "Devolver para IA")
        await registrar(item, "crm", "agente_ia", false, `não ligou ${p.agente}: IA pausada: atendimento humano; só o follow-up retoma (fluxo passo ${d.idx + 1})`);
      } else if (p.tipo === "agente_ia") {
        const agora2 = new Date().toISOString();
        const retomada = p.acao === "ligar" && await algumaPausaHumana(ex.contact_phone);
        const mud = p.acao === "ligar"
          ? { ai_agent_slug: String(p.agente ?? "").trim(), ai_pausado: false, ai_pausado_motivo: null, ai_atribuido_em: agora2, updated_at: agora2 }
          : { ai_pausado: true, ai_pausado_motivo: "pausado por fluxo", updated_at: agora2 };
        const { error: e } = await db.from("whatsapp_contacts").update(mud).eq("phone", ex.contact_phone);
        await registrar(item, "crm", "agente_ia", !e, e ? e.message : `${p.acao === "ligar" ? `ligou ${p.agente}` : "pausou"} (fluxo passo ${d.idx + 1})`);
        if (!e && retomada) {
          await db.from("crm_ai_eventos").insert({ contact_phone: ex.contact_phone, agent_slug: String(p.agente ?? "").trim() || null, tipo: "retomado_followup", detalhe: `IA retomada pelo follow-up (fluxo ${f.nome}, passo ${d.idx + 1})` });
        }
        if (!e && p.acao === "ligar") {
          // tags ao começar do agente ligado (mesmo alcance do update acima: todas as conversas do telefone); nunca lança
          const slug = String(p.agente ?? "").trim();
          const { data: ag } = await db.from("crm_ai_agents").select("slug, tags_ao_iniciar").eq("slug", slug).maybeSingle();
          const t = await aplicarTagsAoIniciar(db, { numeroId: null, phone: ex.contact_phone, agente: ag ?? null, origem: "fluxo_agente_ia" });
          if (t.adicionadas.length) contato.tags = mesclarTagsAoIniciar(contato.tags, t.adicionadas); // condições "tem tag" seguintes
        }
      } else if (p.tipo === "transferir_ia") {
        // passa a conversa para o agente de IA (portões de iaGatilho.ts); barrado = registra e segue o fluxo
        const r = await transferirParaIAPorFluxo(db, {
          phone: ex.contact_phone, nome: contato.name ?? null, agenteSlug: String(p.agente ?? "").trim(),
          mesmoComHumano: Boolean(p.mesmo_com_humano), followup: fluxoDeFollowup(f.passos), motivo: `fluxo ${f.nome}, passo ${d.idx + 1}`,
        });
        await registrar(item, "crm", "transferir_ia", r.ok, `${r.detalhe} (fluxo passo ${d.idx + 1})`);
        if (r.tagsAdicionadas?.length) contato.tags = mesclarTagsAoIniciar(contato.tags, r.tagsAdicionadas); // condições "tem tag" seguintes
      } else if (p.tipo === "transferir_humano") {
        // mesmo efeito da transferência da IA (planoTransferencia); a despedida entra na fila como mensagem
        const motivo = `fluxo ${f.nome}, passo ${d.idx + 1}`;
        const plano = planoTransferencia(
          { frase_transferencia: p.despedida ?? null, transferir_sem_mensagem: Boolean(p.sem_mensagem) || !String(p.despedida ?? "").trim(),
            transferir_para: p.para ?? null, transferir_tag: p.tag ?? null, transferir_etapa: p.etapa ?? null, transferir_fluxo_id: null },
          { tags: contato.tags ?? [] }, motivo, new Date(),
        );
        let { error: e } = await db.from("whatsapp_contacts").update(plano.contato).eq("phone", ex.contact_phone);
        if (e && /ai_precisa_humano|ai_transferido_em|schema cache/i.test(e.message)) {
          // migration 20261103100000 pendente: aplica o que a tabela já tem
          const { ai_precisa_humano: _a, ai_transferido_em: _b, ...resto } = plano.contato;
          ({ error: e } = await db.from("whatsapp_contacts").update(resto).eq("phone", ex.contact_phone));
        }
        await registrar(item, "crm", "transferir_humano", !e, e ? e.message : `transferido para ${p.para || "fila geral"} (fluxo passo ${d.idx + 1})`);
        if (!e) {
          if (Array.isArray(plano.contato.tags)) contato.tags = plano.contato.tags as string[];
          if (typeof plano.contato.stage === "string") contato.stage = plano.contato.stage;
          await db.from("crm_ai_eventos").insert({ contact_phone: ex.contact_phone, tipo: "transferido", detalhe: `transferido por ${motivo}`, mensagem: plano.despedida });
        }
        if (!e && plano.despedida) {
          const acao: Acao = { tipo: "livre", itens: [{ tipo: "text", conteudo: plano.despedida, media_url: null }] };
          await db.from("crm_automacao_fila").upsert({
            origem: "fluxo", fluxo_id: f.id, fluxo_execucao_id: ex.id, passo_idx: d.idx, contact_phone: ex.contact_phone,
            gatilho_tipo: "fluxo", acoes: [acao], usa_whatsapp: precisaWhatsApp([acao]),
            ...(p.numero_id ? { numero_id: p.numero_id } : {}),
          }, { onConflict: "fluxo_execucao_id,passo_idx", ignoreDuplicates: true });
          estado = { ...estado, ultimo_envio_em: new Date().toISOString() };
        }
      } else if (p.tipo === "webhook") {
        let ok = false;
        let det = "";
        try {
          if (!/^https:\/\//.test(p.url)) throw new Error("URL precisa ser https");
          const r = await fetch(p.url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpoWebhook(f, contato, estado.dados ?? {})), signal: AbortSignal.timeout(10_000), redirect: "manual",
          });
          ok = r.ok;
          det = `HTTP ${r.status}`;
        } catch (e) {
          det = e instanceof Error ? e.message : String(e);
        }
        await registrar(item, "crm", "webhook", ok, `${p.url.slice(0, 80)}: ${det} (fluxo passo ${d.idx + 1})`);
      } else if (p.tipo === "ir_fluxo") {
        const { data: destino } = await db.from("crm_fluxos").select("id, nome").eq("id", p.fluxo_id).is("excluido_em", null).maybeSingle();
        if (!destino) { await encerrarExecucao(estado, "erro", "fluxo de destino não existe"); encerrou = true; break; }
        const { error: e } = await db.from("crm_fluxo_execucoes").insert({
          fluxo_id: destino.id, contact_phone: ex.contact_phone, dados: { ...(estado.dados ?? {}), veio_do_fluxo: f.id },
          proximo_em: new Date().toISOString(), iniciado_em: new Date().toISOString(),
        });
        await registrar(item, "crm", "ir_fluxo", !e, e ? e.message : `→ ${destino.nome}`);
        await encerrarExecucao(estado, "concluido", `foi para o fluxo ${destino.nome}`);
        encerrou = true;
        break;
      } else {
        const acao: Acao = p.tipo === "template_oficial"
          ? { tipo: "template_oficial", template: p.template, variaveis: resolverVariaveis(p.variaveis, estado.dados ?? {}) }
          : p.tipo === "ia_followup"
          ? { tipo: "ia_followup", agente_id: p.agente_id, instrucao: p.instrucao ?? null, tentativa: p.tentativa ?? null }
          : p.passo_id ? { tipo: "passo", passo_id: p.passo_id }
          : p.roteiro_id ? { tipo: "roteiro", roteiro_id: String(p.roteiro_id) }
          : { tipo: "livre", itens: p.midia_url
              ? [{ tipo: (p.midia_tipo ?? "document") as "image" | "audio" | "document", conteudo: String(p.texto ?? ""), media_url: p.midia_url }]
              : [{ tipo: "text", conteudo: String(p.texto ?? ""), media_url: null }] };
        const { error: e } = await db.from("crm_automacao_fila").upsert({
          origem: "fluxo", fluxo_id: f.id, fluxo_execucao_id: ex.id, passo_idx: d.idx, contact_phone: ex.contact_phone,
          gatilho_tipo: "fluxo", acoes: [acao], usa_whatsapp: precisaWhatsApp([acao]),
          // número do passo; sem ele o trigger herda o número do fluxo
          ...(p.numero_id ? { numero_id: p.numero_id } : {}),
        }, { onConflict: "fluxo_execucao_id,passo_idx", ignoreDuplicates: true });
        if (e) { await encerrarExecucao(estado, "erro", `não entrou na fila: ${e.message}`); encerrou = true; break; }
        estado = { ...estado, ultimo_envio_em: new Date().toISOString() };
      }
      estado = { ...estado, passo_idx: d.proximo_idx ?? f.passos.length };
    }
    if (!encerrou) {
      // 10 ações seguidas sem espera: grava e continua no próximo tick
      await db.from("crm_fluxo_execucoes").update({
        passo_idx: estado.passo_idx, proximo_em: agora.toISOString(), aguardando_resposta: false,
        ultimo_envio_em: estado.ultimo_envio_em, updated_at: new Date().toISOString(),
      }).eq("id", ex.id).eq("status", "ativo");
    }
    n++;
  }
  return n;
}

// --------------------------------------------------------------- campanhas

async function publico(filtro: FiltroPublico): Promise<ContatoBasico[]> {
  const contatos = await todosContatos();
  const dias = Number(filtro.sem_resposta_dias) || 0;
  const respondeu = new Set<string>();
  if (dias > 0) {
    for (const m of await mensagensDesde(new Date(Date.now() - dias * 86400_000), "inbound")) respondeu.add(m.contact_phone);
  }
  return filtrarPublico(filtro, contatos, respondeu);
}

async function acaoDaCampanha(c: { roteiro_id: string | null; passo_id: string | null }): Promise<Acao | null> {
  if (c.passo_id) return { tipo: "passo", passo_id: c.passo_id };
  if (c.roteiro_id) return { tipo: "roteiro", roteiro_id: c.roteiro_id };
  return null;
}

async function confirmarCampanha(id: string, totalConfirmado: number, userId: string) {
  const { data: camp } = await db.from("crm_campanhas").select("*").eq("id", id).maybeSingle();
  if (!camp) return json({ error: "Campanha não encontrada" }, 404);
  if (camp.status !== "rascunho") return json({ error: "Só rascunho pode ser confirmado" }, 409);
  const filtro = (camp.filtro ?? {}) as FiltroPublico;
  if (filtroVazio(filtro)) return json({ error: "Escolha pelo menos um filtro de público (não existe 'todos os contatos')." }, 400);
  const acao = await acaoDaCampanha(camp);
  if (!acao) return json({ error: "Escolha a mensagem (roteiro ou passo)." }, 400);
  const problemas = problemasDosPassos(await passosDaAcao(acao));
  if (problemas.length) return json({ error: problemas.join(" ") }, 400);

  const lista = await publico(filtro);
  if (!lista.length) return json({ error: "Nenhum contato no público." }, 400);
  if (lista.length !== Number(totalConfirmado)) {
    return json({ error: `O público mudou: agora são ${lista.length} contatos. Conte de novo e confirme.`, total: lista.length }, 409);
  }
  if (lista.length > MAX_CAMPANHA) return json({ error: `Máximo de ${MAX_CAMPANHA} contatos por campanha.` }, 400);

  const cfg = await carregarConfig();
  const agora = new Date();
  const datas = agendarLotes(lista.length, camp.lote_por_dia, agora, cfg.hora_inicio);
  const linhas = lista.map((c, i) => ({
    origem: "campanha",
    campanha_id: id,
    contact_phone: c.phone,
    acoes: [acao],
    usa_whatsapp: true,
    agendado_para: datas[i].toISOString(),
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db
      .from("crm_automacao_fila")
      .upsert(linhas.slice(i, i + 500), { onConflict: "campanha_id,contact_phone", ignoreDuplicates: true });
    if (error) return json({ error: `Falha ao enfileirar: ${error.message}` }, 500);
  }
  await db.from("crm_campanhas").update({
    status: "ativa",
    total: lista.length,
    confirmado_em: agora.toISOString(),
    confirmado_por: userId,
    updated_at: agora.toISOString(),
  }).eq("id", id);
  return json({ ok: true, total: lista.length, envio_ligado: cfg.ligado && !cfg.pausado });
}

async function acaoCampanha(id: string, acao: string) {
  const { data: camp } = await db.from("crm_campanhas").select("id, status").eq("id", id).maybeSingle();
  if (!camp) return json({ error: "Campanha não encontrada" }, 404);
  const agora = new Date().toISOString();
  const mudar = async (de: string[], para: string) => {
    if (!de.includes(camp.status)) return false;
    await db.from("crm_campanhas").update({ status: para, updated_at: agora }).eq("id", id);
    return true;
  };
  if (acao === "pausar" && (await mudar(["ativa"], "pausada"))) return json({ ok: true });
  if (acao === "retomar" && (await mudar(["pausada"], "ativa"))) return json({ ok: true });
  if (acao === "cancelar" && (await mudar(["ativa", "pausada"], "cancelada"))) {
    await db.from("crm_automacao_fila").update({ status: "cancelado", motivo: "campanha cancelada", updated_at: agora })
      .eq("campanha_id", id).eq("status", "pendente");
    return json({ ok: true });
  }
  return json({ error: `Não dá para ${acao} uma campanha ${camp.status}` }, 409);
}

async function relatorioCampanha(id: string) {
  const linhas: { contact_phone: string; status: string; enviado_em: string | null }[] = [];
  for (let de = 0; de < 10_000; de += 1000) {
    const { data } = await db.from("crm_automacao_fila").select("contact_phone, status, enviado_em")
      .eq("campanha_id", id).range(de, de + 999);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const porStatus: Record<string, number> = {};
  for (const l of linhas) porStatus[l.status] = (porStatus[l.status] ?? 0) + 1;
  const enviados = linhas.filter((l) => l.enviado_em);
  let respostas = 0;
  if (enviados.length) {
    const primeiro = enviados.reduce((m, l) => (l.enviado_em! < m ? l.enviado_em! : m), enviados[0].enviado_em!);
    const quando = new Map(enviados.map((l) => [l.contact_phone, new Date(l.enviado_em!).getTime()]));
    const responderam = new Set<string>();
    const phones = [...quando.keys()];
    for (let i = 0; i < phones.length; i += 200) {
      const { data } = await db.from("whatsapp_messages").select("contact_phone, created_at")
        .eq("direction", "inbound").gte("created_at", primeiro).in("contact_phone", phones.slice(i, i + 200)).limit(5000);
      for (const m of data ?? []) {
        if (new Date(m.created_at).getTime() > (quando.get(m.contact_phone) ?? Infinity)) responderam.add(m.contact_phone);
      }
    }
    respostas = responderam.size;
  }
  return json({ total: linhas.length, porStatus, enviados: enviados.length, respostas });
}

// --------------------------------------------------------------- servidor

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const segredoRecebido = req.headers.get("x-automacao-segredo");

    if (segredoRecebido) {
      const segredo = await configIntegracao("crm_automacoes_segredo");
      if (!segredo || !iguais(segredo, segredoRecebido)) return json({ error: "Unauthorized" }, 401);
      return json({ ok: true, ...(await tick()) });
    }

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await usuario.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: aprovado } = await db.rpc("is_approved", { _user_id: user.id });
    if (!aprovado) return json({ error: "Forbidden" }, 403);
    {
      // simular/contar/relatório leem contatos = Automação "ver"; confirmar/agir/amostra = "editar"
      const leitura = ["simular", "contar_publico", "relatorio_campanha"].includes(String(body?.modo));
      const acesso = await conferirAcessoCrm(usuario, { area: "automacao", nivel: leitura ? 1 : 2 });
      if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);
    }
    await carregarEtapasValidas(db);

    switch (body?.modo) {
      case "simular": {
        const a = body.automacao as Automacao;
        const erros = validarAutomacao(a ?? {});
        if (erros.length) return json({ error: erros.join(" ") }, 400);
        const agora = new Date();
        const { phones, contatos } = await atingidos({ ...a, acoes: a.acoes ?? [], filtro_etapas: a.filtro_etapas ?? [] }, agora, !a.ativo);
        const cfg = await carregarConfig();
        const v = verificarLimites(cfg, await usoWhatsApp(agora), 1, agora);
        return json({
          total: phones.length,
          contatos: phones.slice(0, 200).map((p) => ({ phone: p, name: contatos.get(p)?.name ?? null, stage: contatos.get(p)?.stage ?? null })),
          envio: v.ok ? "liberado agora" : v.detalhe,
          observacao: a.ativo ? "Regra ligada: eventos desde que foi ligada (máx. 24 h)." : "Regra desligada: simula com os eventos das últimas 24 h.",
        });
      }
      case "contar_publico": {
        const filtro = (body.filtro ?? {}) as FiltroPublico;
        if (filtroVazio(filtro)) return json({ error: "Escolha pelo menos um filtro." }, 400);
        const lista = await publico(filtro);
        return json({ total: lista.length, amostra: lista.slice(0, 20).map((c) => ({ phone: c.phone, name: c.name, stage: c.stage })) });
      }
      case "confirmar_campanha":
        return await confirmarCampanha(String(body.campanha_id ?? ""), Number(body.total_confirmado), user.id);
      case "campanha_acao":
        return await acaoCampanha(String(body.campanha_id ?? ""), String(body.acao ?? ""));
      case "relatorio_campanha":
        return await relatorioCampanha(String(body.campanha_id ?? ""));
      case "amostra_template": {
        // Dados FALSOS, para o Full Funnel salvar o formato do Inbound Webhook.
        const url = await configIntegracao("fullfunnel_webhook_crm_url");
        if (!url || !/^https:\/\/[^/]+\//.test(url)) return json({ error: "Grave antes a URL em integracao_config.fullfunnel_webhook_crm_url" }, 400);
        const payload = payloadTemplateOficial(
          { phone: "5531900000000", name: "Amostra Teste", stage: "leads", source: "amostra" },
          { template: String(body.template || "nome_do_template"), variaveis: body.variaveis ?? { nome: "{primeiro_nome}" } },
          { automacao: "amostra", teste: true },
        )!;
        payload.phone = "+5500900000000";
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
        return json({ ok: r.ok, http: r.status, payload });
      }
      default:
        return json({ error: "modo inválido" }, 400);
    }
  } catch (e) {
    console.error("crm-automacoes", e);
    return json({ error: e instanceof Error ? e.message : "erro" }, 500);
  }
});
