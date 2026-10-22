// Backfill COMPLETO do WhatsApp (OpenWA) para o CRM: percorre TODOS os chats da sessão (contatos e
// grupos), N mensagens por chat, no ritmo do proxy, retomável, sem duplicar, com progresso no banco.
//
// Quem chama:
//  - o front (usuário aprovado, Bearer): { acao: "iniciar", por_chat?, midias_por_chat?, grupos? }
//    | { acao: "cancelar" } | { acao: "status" };
//  - o pg_cron (whatsapp_backfill_tick, 1/min, header x-backfill-segredo): { modo: "tick" }.
//
// Um tick dura até ~100 s e faz, nesta ordem:
//  1) mídias pendentes RECENTES (do webhook, último dia), até 10;
//  2) o job ativo: "listando" pagina a lista de chats (rota chats-page, 500 por vez) e resolve o
//     telefone dos @lid (contacts-info); "importando" consome a fila (whatsapp_backfill_chats), do
//     chat mais recente pro mais antigo, com _shared/waImportar.ts;
//  3) mídias pendentes em geral (backfill e retries), até 40;
//  4) nomes de participantes de grupo que ficaram sem nome.
// Reivindicação: só um tick por vez trabalha o job (ultimo_tick com 150 s de folga).
// Ritmo: no máximo 40 leituras/min no proxy (ele corta em 60 contando webhook e fotos); 429 = para
// e o próximo tick continua. Contatos novos nascem com source 'whatsapp-backfill' (não disparam
// automação de etapa — trigger da migration 20261025100000).
// Janela (17/10/2026): só chats com atividade nos últimos N dias (integracao_config 'backfill_dias',
// padrão 90, "0" = sem limite), lida a cada tick — mudar o valor no banco vale pro job em curso: os
// pendentes fora da janela viram 'pulado' no tick seguinte. Contato que JÁ existe não é tocado (nem
// updated_at, nem etapa); contato novo nasce com updated_at = última mensagem real do chat, não "agora"
// (senão a conversa antiga sobe pro topo da lista e do kanban).
// Por número (17/10/2026): cada job é de UM número (crm_numeros, whatsapp_backfill_jobs.numero_id; um job
// ativo por número). Lista, histórico, mídia e nomes vão pela sessão do OpenWA desse número, e contatos e
// mensagens nascem com numero_id dele. Sem numero_id no pedido, o número padrão (closer). Com vários jobs
// ativos, cada tick pega o que está há mais tempo sem andar (revezamento).
// Histórico completo (18/10/2026): { acao: "iniciar", numero_id, completo: true } — sem janela de dias, até 2000
// mensagens por conversa (teto do proxy), conversas da mais recente pra mais antiga, SEM baixar mídia (só metadado;
// a bolha baixa ao clicar). { acao: "pausar" | "retomar" | "cancelar" } por número; pausar vale no próximo lote de
// 10 conversas. Mensagens entram primeiro (importada = não conta como não lida); contato só nasce se a conversa
// tem mensagem, com a data da última mensagem real e source 'whatsapp-historico' (fora de automação de contato
// novo); contato existente nunca muda (nem updated_at, nem etapa, nem nome).
// Até onde vai: o que o WhatsApp Web do aparelho tem. Com deep, até 2000 mensagens por chat
// (medido em 17/10/2026: 2000 mensagens de um grupo voltaram até 30/07/2026 em 11 s).
// Permissões do CRM (22/11/2026): número/área conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ErroProxy } from "../_shared/waProxy.ts";
import { chamarProxyNaSessao, numeroPadrao, numeroPorId, sessaoLeitura } from "../_shared/waNumero.ts";
import { iguaisTempoConstante } from "../_shared/openwa.ts";
import {
  OrcamentoLeituras, POR_CHAT_HISTORICO_COMPLETO, chatNaJanela, contatoNovoDoBackfill, corteDaJanela, decidirInicio, diasDaJanela,
  filtroForaDaJanela, nomesDaResposta, textoProgresso,
} from "../_shared/waBackfill.ts";
import { importarChat } from "../_shared/waImportar.ts";
import { COLUNAS_MIDIA_PENDENTE, COLUNAS_MIDIA_PENDENTE_ANTIGAS, MAX_TENTATIVAS_MIDIA, processarMidiasPendentes, type LinhaMidia } from "../_shared/waMidia.ts";
import { nomesDoCache, resolverNomes } from "../_shared/waNomes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ORCAMENTO_MS = 100_000;
const LEITURAS_POR_MINUTO = 40;
const FOLGA_TICK_MS = 150_000;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = {
  id: string; numero_id?: string | null; status: string; por_chat: number; midias_por_chat: number; grupos: boolean; offset_lista: number;
  total_chats: number; chats_feitos: number; chats_erro: number; msgs_importadas: number; midias: number;
  /** Histórico completo (18/10/2026): sem janela de dias, até 2000 mensagens por conversa, sem baixar mídia. */
  completo?: boolean | null;
};
type ItemFila = { id: number; chat_id: string; kind: string; phone: string | null; nome: string | null; tentativas: number; ts: number | null };

function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function config(db: SupabaseClient, chave: string): Promise<string> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", chave).maybeSingle();
  return typeof data?.valor === "string" ? data.valor : "";
}

/** Dispara um tick sem esperar (o cron também chama a cada minuto). */
async function chutarTick(db: SupabaseClient) {
  const url = await config(db, "whatsapp_backfill_fn_url");
  const segredo = await config(db, "whatsapp_backfill_segredo");
  if (!/^https:\/\//.test(url) || !segredo) return;
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-backfill-segredo": segredo },
    body: JSON.stringify({ modo: "tick" }),
  }).then((r) => r.body?.cancel()).catch(() => {});
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

// ------------------------------------------------------------------ tick

class Prazo {
  private fim = Date.now() + ORCAMENTO_MS;
  private orc = new OrcamentoLeituras(LEITURAS_POR_MINUTO);
  restante() { return this.fim - Date.now(); }
  /** Espera a vaga de leitura se couber no prazo; false = acabou o tempo deste tick. */
  reservar = async (): Promise<boolean> => {
    for (;;) {
      if (this.restante() < 8_000) return false;
      const espera = this.orc.reservar();
      if (espera === 0) return true;
      if (espera > this.restante() - 8_000) return false;
      await dormir(espera);
    }
  };
}

async function midiasPendentes(db: SupabaseClient, prazo: Prazo, recentes: boolean, max: number) {
  // numero_id: cada mídia é baixada pela sessão do número dela (sem a coluna, as antigas = padrão)
  const ler = (colunas: string) => {
    let q = db.from("whatsapp_messages").select(colunas)
      .eq("media_status", "pendente").lt("media_tentativas", MAX_TENTATIVAS_MIDIA)
      .order("created_at", { ascending: false }).limit(max);
    if (recentes) q = q.gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    return q;
  };
  let { data, error } = await ler(COLUNAS_MIDIA_PENDENTE);
  if (error) ({ data, error } = await ler(COLUNAS_MIDIA_PENDENTE_ANTIGAS));
  if (error || !data?.length) return { ok: 0, falhas: 0 };
  const r = await processarMidiasPendentes(db, data as unknown as LinhaMidia[], prazo.reservar, () => prazo.restante());
  return { ok: r.ok, falhas: r.falhas };
}

/** Nomes de participantes que ficaram sem nome (mensagens antigas, webhook sem pushName). */
async function nomesPendentes(db: SupabaseClient, prazo: Prazo) {
  const ler = (colunas: string) => db.from("whatsapp_messages").select(colunas)
    .is("author_name", null).not("author_id", "is", null)
    .order("created_at", { ascending: false }).limit(1000);
  let { data, error } = await ler("author_id, numero_id");
  if (error) ({ data } = await ler("author_id"));
  const linhas = ((data ?? []) as unknown as { author_id: string; numero_id?: string | null }[])
    .filter((r) => /^\d{5,25}@(c\.us|lid)$/.test(r.author_id));
  const wids = [...new Set(linhas.map((r) => r.author_id))];
  if (!wids.length) return 0;
  const { achados } = await nomesDoCache(db, wids);
  const comNome = [...achados].filter(([, v]) => v.nome || v.telefone)
    .map(([wid, v]) => ({ wid, nome: v.nome, telefone: v.telefone }));
  if (comNome.length) await db.rpc("whatsapp_aplicar_nomes", { p_nomes: comNome });
  // quem falta é perguntado à sessão do número em que apareceu (o grupo é daquele aparelho)
  const porNumero = new Map<string, Set<string>>();
  for (const r of linhas) {
    if (achados.has(r.author_id)) continue;
    const k = r.numero_id ?? "";
    porNumero.set(k, (porNumero.get(k) ?? new Set()).add(r.author_id));
  }
  let novos = 0;
  for (const [numeroId, ws] of porNumero) {
    const sessao = await sessaoLeitura(db, numeroId || null);
    novos += (await resolverNomes(db, [...ws], prazo.reservar, sessao)).size;
  }
  return comNome.length + novos;
}

/** Fase "listando": todas as páginas da lista de chats -> fila. */
async function listar(db: SupabaseClient, job: Job, prazo: Prazo, corteMs: number | null): Promise<"pronto" | "continua"> {
  let offset = job.offset_lista;
  const sessao = await sessaoLeitura(db, job.numero_id ?? null);
  for (;;) {
    if (!(await prazo.reservar())) return "continua";
    const pagina = await chamarProxyNaSessao("chats-page", { limit: 500, offset }, sessao, { timeoutMs: 45_000 });
    const itens: { chatId: string; kind: string; phone: string | null; name: string | null; timestamp: number | null }[] =
      Array.isArray(pagina?.itens) ? pagina.itens : [];
    const brutos = Number(pagina?.brutos) || 0;
    const linhas = itens
      .filter((c) => job.grupos || c.kind !== "group")
      .filter((c) => chatNaJanela(c.timestamp, corteMs))
      .map((c) => ({
        job_id: job.id, chat_id: c.chatId, kind: c.kind, phone: c.kind === "group" ? c.chatId : c.phone,
        nome: c.name, ts: c.timestamp,
      }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await db.from("whatsapp_backfill_chats")
        .upsert(linhas.slice(i, i + 500), { onConflict: "job_id,chat_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    offset += brutos;
    await db.from("whatsapp_backfill_jobs").update({ offset_lista: offset, atualizado_em: new Date().toISOString() }).eq("id", job.id);
    if (brutos < 500) break;
  }

  // @lid sem telefone: resolve de 50 em 50; quem não resolver é pulado (não há como gravar sem número)
  for (;;) {
    const { data: semFone } = await db.from("whatsapp_backfill_chats").select("id, chat_id")
      .eq("job_id", job.id).eq("kind", "individual").is("phone", null).eq("status", "pendente").limit(50);
    if (!semFone?.length) break;
    if (!(await prazo.reservar())) return "continua";
    let resolvidos: Map<string, string | null>;
    try {
      const resp = await chamarProxyNaSessao("contacts-info", { ids: semFone.map((r: { chat_id: string }) => r.chat_id) }, sessao, { timeoutMs: 30_000 });
      resolvidos = new Map(nomesDaResposta(resp).map((n) => [n.wid, n.telefone]));
    } catch (e) {
      if (e instanceof ErroProxy && e.status === 429) return "continua";
      throw e;
    }
    for (const r of semFone as { id: number; chat_id: string }[]) {
      const tel = resolvidos.get(r.chat_id) ?? null;
      await db.from("whatsapp_backfill_chats")
        .update(tel ? { phone: tel } : { status: "pulado", erro: "@lid sem telefone" }).eq("id", r.id);
    }
  }

  const { count } = await db.from("whatsapp_backfill_chats").select("id", { count: "exact", head: true })
    .eq("job_id", job.id).neq("status", "pulado");
  // condicional: pausado/cancelado no meio da listagem não volta a andar
  const { data: virou } = await db.from("whatsapp_backfill_jobs").update({
    status: "importando", total_chats: count ?? 0, atualizado_em: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "listando").select("id");
  return virou?.length ? "pronto" : "continua";
}

/** Fase "importando": consome a fila até acabar o prazo. */
/** Pendentes fora da janela viram 'pulado' e o total é recontado (vale pro job que já estava rodando). */
async function aplicarJanela(db: SupabaseClient, job: Job, corteMs: number | null, dias: number) {
  if (corteMs === null || job.completo) return;
  const { data: pulados, error } = await db.from("whatsapp_backfill_chats")
    .update({ status: "pulado", erro: `fora da janela de ${dias} dias`, feito_em: new Date().toISOString() })
    .eq("job_id", job.id).eq("status", "pendente").or(filtroForaDaJanela(corteMs))
    .select("id");
  if (error || !pulados?.length) return;
  const { count } = await db.from("whatsapp_backfill_chats").select("id", { count: "exact", head: true })
    .eq("job_id", job.id).neq("status", "pulado");
  if (typeof count === "number") {
    job.total_chats = count;
    await db.from("whatsapp_backfill_jobs").update({ total_chats: count, atualizado_em: new Date().toISOString() }).eq("id", job.id);
  }
}

/** Data ISO da mensagem mais recente gravada do contato neste número (null = nenhuma). */
async function ultimaMensagemEm(db: SupabaseClient, phone: string, numeroId: string | null): Promise<string | null> {
  let q = db.from("whatsapp_messages").select("created_at").eq("contact_phone", phone);
  if (numeroId) q = q.eq("numero_id", numeroId);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return typeof data?.created_at === "string" ? data.created_at : null;
}

async function importar(db: SupabaseClient, job: Job, prazo: Prazo): Promise<"concluido" | "continua" | "parado"> {
  const vistosNoTick = new Set<string>();
  const numeroId = job.numero_id ?? null;

  for (;;) {
    if (prazo.restante() < 15_000) return "continua";
    // pausar/cancelar vale no próximo lote (até 10 conversas), sem esperar o tick acabar
    const { data: agoraJob } = await db.from("whatsapp_backfill_jobs").select("status").eq("id", job.id).maybeSingle();
    if (agoraJob?.status !== "importando") return "parado";
    const { data: fila } = await db.from("whatsapp_backfill_chats")
      .select("id, chat_id, kind, phone, nome, tentativas, ts")
      .eq("job_id", job.id).eq("status", "pendente")
      .order("ts", { ascending: false, nullsFirst: false }).limit(10);
    if (!fila?.length) return "concluido";
    for (const item of fila as ItemFila[]) {
      if (prazo.restante() < 15_000) return "continua";
      const phone = item.phone;
      if (!phone) {
        await db.from("whatsapp_backfill_chats").update({ status: "pulado", erro: "sem telefone" }).eq("id", item.id);
        continue;
      }
      if (vistosNoTick.has(phone)) {
        await db.from("whatsapp_backfill_chats").update({ status: "pulado", erro: "mesmo telefone de outro chat" }).eq("id", item.id);
        continue;
      }
      vistosNoTick.add(phone);
      const agora = new Date().toISOString();
      try {
        // mensagens PRIMEIRO (timestamp real do WhatsApp, dedupe pelo id); o histórico completo não baixa mídia
        const r = await importarChat(db, { phone, chatId: item.kind === "group" ? phone : item.chat_id, numeroId }, {
          limite: job.por_chat, midias: job.completo ? 0 : job.midias_por_chat, reservar: prazo.reservar,
        });
        // contato só para conversa com mensagem; o NOVO nasce com a data da última mensagem real (nunca "agora");
        // o que já existe não é tocado (ignoreDuplicates: nem updated_at, nem etapa, nem nome)
        const ultima = await ultimaMensagemEm(db, phone, numeroId);
        if (ultima) {
          await db.from("whatsapp_contacts").upsert(
            contatoNovoDoBackfill(item, phone, ultima, Boolean(job.completo), numeroId),
            { onConflict: numeroId ? "numero_id,phone" : "phone", ignoreDuplicates: true },
          );
        }
        await db.from("whatsapp_backfill_chats").update({ status: "feito", mensagens: r.novas, erro: null, feito_em: agora }).eq("id", item.id);
        job.chats_feitos++;
        job.msgs_importadas += r.novas;
      } catch (e) {
        if ((e instanceof ErroProxy && e.status === 429) || (e instanceof Error && e.message === "sem orçamento de leitura")) {
          return "continua"; // não gasta tentativa: só faltou vaga
        }
        const tent = item.tentativas + 1;
        const msg = e instanceof ErroProxy ? `proxy ${e.status}` : e instanceof Error ? e.message.slice(0, 200) : "erro";
        await db.from("whatsapp_backfill_chats").update({
          tentativas: tent, erro: msg, ...(tent >= 3 ? { status: "erro", feito_em: agora } : {}),
        }).eq("id", item.id);
        if (tent >= 3) { job.chats_feitos++; job.chats_erro++; }
      }
      await db.from("whatsapp_backfill_jobs").update({
        chats_feitos: job.chats_feitos, chats_erro: job.chats_erro, msgs_importadas: job.msgs_importadas,
        atualizado_em: new Date().toISOString(), ultimo_tick: new Date().toISOString(),
      }).eq("id", job.id);
    }
  }
}

const TRAVA = "whatsapp_backfill_tick_em";
const TRAVA_LIVRE = "1970-01-01T00:00:00.000Z";

/** Um tick por vez (o cron chama a cada minuto e o tick dura até ~100 s): trava em integracao_config. */
async function pegarTrava(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("integracao_config")
    .update({ valor: new Date().toISOString() })
    .eq("chave", TRAVA).lt("valor", new Date(Date.now() - FOLGA_TICK_MS).toISOString())
    .select("chave");
  return Boolean(data?.length);
}

async function tick(db: SupabaseClient) {
  if (!(await pegarTrava(db))) return { ocupado: true };
  try {
    return await tickTravado(db);
  } finally {
    await db.from("integracao_config").update({ valor: TRAVA_LIVRE }).eq("chave", TRAVA);
  }
}

async function tickTravado(db: SupabaseClient) {
  const prazo = new Prazo();
  const resumo: Record<string, unknown> = {};

  resumo.midias_recentes = await midiasPendentes(db, prazo, true, 10);

  const limite = new Date(Date.now() - FOLGA_TICK_MS).toISOString();
  // um job por tick (um por número pode estar ativo): o que está há mais tempo sem andar
  const { data: candidatos } = await db.from("whatsapp_backfill_jobs").select("id")
    .in("status", ["listando", "importando"])
    .or(`ultimo_tick.is.null,ultimo_tick.lt."${limite}"`)
    .order("atualizado_em", { ascending: true }).limit(1);
  let job: Job | null = null;
  if (candidatos?.[0]?.id) {
    const { data: reivindicado } = await db.from("whatsapp_backfill_jobs")
      .update({ ultimo_tick: new Date().toISOString() })
      .eq("id", candidatos[0].id)
      .in("status", ["listando", "importando"])
      .or(`ultimo_tick.is.null,ultimo_tick.lt."${limite}"`)
      .select("*");
    job = (reivindicado?.[0] ?? null) as Job | null;
  }
  if (job) {
    try {
      // histórico completo ignora a janela de dias (backfill_dias): todas as conversas, mais recentes primeiro
      const dias = job.completo ? 0 : diasDaJanela(await config(db, "backfill_dias"));
      const corteMs = corteDaJanela(dias);
      resumo.janela_dias = dias;
      if (job.status === "listando" && (await listar(db, job, prazo, corteMs)) === "pronto") job.status = "importando";
      if (job.status === "importando") await aplicarJanela(db, job, corteMs, dias);
      if (job.status === "importando" && (await importar(db, job, prazo)) === "concluido") {
        await db.from("whatsapp_backfill_jobs").update({
          status: "concluido", concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
        }).eq("id", job.id).eq("status", "importando");
        job.status = "concluido";
      }
    } catch (e) {
      const msg = e instanceof ErroProxy ? `proxy ${e.status}` : e instanceof Error ? e.message : String(e);
      console.error("backfill: tick falhou", msg);
      await db.from("whatsapp_backfill_jobs").update({ aviso: msg.slice(0, 300), atualizado_em: new Date().toISOString() }).eq("id", job.id);
    } finally {
      // solta a reivindicação: o próximo cron (até 1 min) continua
      await db.from("whatsapp_backfill_jobs").update({ ultimo_tick: null }).eq("id", job.id).in("status", ["listando", "importando"]);
    }
    resumo.job = { id: job.id, status: job.status, progresso: textoProgresso(job) };
  }

  const m = await midiasPendentes(db, prazo, false, 40);
  if (job && m.ok) {
    const { data: j } = await db.from("whatsapp_backfill_jobs").select("midias").eq("id", job.id).maybeSingle();
    await db.from("whatsapp_backfill_jobs").update({ midias: (j?.midias ?? 0) + m.ok }).eq("id", job.id);
  }
  resumo.midias = m;
  if (prazo.restante() > 15_000) resumo.nomes = await nomesPendentes(db, prazo);
  return resumo;
}

// ------------------------------------------------------------------ HTTP

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = admin();
  const corpo = await req.json().catch(() => ({}));

  const segredoVeio = req.headers.get("x-backfill-segredo");
  if (segredoVeio !== null) {
    const esperado = await config(db, "whatsapp_backfill_segredo");
    if (!esperado || !iguaisTempoConstante(segredoVeio, esperado)) return json({ error: "segredo" }, 401);
    try {
      return json({ ok: true, ...(await tick(db)) });
    } catch (e) {
      console.error("backfill: erro no tick", e instanceof Error ? e.message : e);
      return json({ error: "erro interno" }, 500);
    }
  }

  // usuário do CRM
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: aprovado } = await db.rpc("is_approved", { _user_id: user.id });
  if (!aprovado) return json({ error: "Forbidden" }, 403);

  const acao = String(corpo?.acao ?? "status");
  // número do backfill: o pedido (numero_id) ou o padrão (closer)
  const numeroPedido = typeof corpo?.numero_id === "string" && corpo.numero_id ? await numeroPorId(db, corpo.numero_id) : null;
  if (corpo?.numero_id && !numeroPedido) return json({ error: "número não encontrado" }, 404);
  if (numeroPedido && (numeroPedido.tipo !== "openwa" || !numeroPedido.sessao_openwa)) {
    return json({ error: "backfill só existe para número do OpenWA" }, 400);
  }
  const numero = numeroPedido ?? await numeroPadrao(db).catch(() => null);
  // permissões do CRM: status = ver; iniciar/pausar/retomar/cancelar = editar (Conversas ou Conexão) naquele número
  {
    const nivel = acao === "status" ? 1 : 2;
    const porConversas = await conferirAcessoCrm(anon, { area: "conversas", nivel, numeroId: numero?.id ?? null });
    const acesso = porConversas.ok ? porConversas : await conferirAcessoCrm(anon, { area: "conexao", nivel, numeroId: numero?.id ?? null });
    if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);
  }
  const ultimoDo = async () => {
    let q = db.from("whatsapp_backfill_jobs").select("*");
    if (numero) q = q.eq("numero_id", numero.id);
    let { data, error } = await q.order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (error) {
      // sem a coluna numero_id (migration 20261028100000 pendente): o último de todos, como antes
      ({ data } = await db.from("whatsapp_backfill_jobs").select("*").order("criado_em", { ascending: false }).limit(1).maybeSingle());
    }
    return data;
  };
  const ultimo = await ultimoDo();

  if (acao === "status") return json({ ok: true, job: ultimo ?? null });

  if (acao === "pausar") {
    if (!ultimo || !["listando", "importando"].includes(ultimo.status)) return json({ ok: true, job: ultimo ?? null });
    const { data } = await db.from("whatsapp_backfill_jobs")
      .update({ status: "pausado", atualizado_em: new Date().toISOString() })
      .eq("id", ultimo.id).in("status", ["listando", "importando"]).select("*").maybeSingle();
    return json({ ok: true, job: data ?? ultimo });
  }

  const retomar = async (job: { id: string }) => {
    // volta pela listagem a partir do offset salvo (1 leitura se já tinha acabado): pega o total certo de novo
    const { data, error } = await db.from("whatsapp_backfill_jobs")
      .update({ status: "listando", ultimo_tick: null, aviso: null, atualizado_em: new Date().toISOString() })
      .eq("id", job.id).eq("status", "pausado").select("*").maybeSingle();
    if (error) return json({ error: error.message }, error.code === "23505" ? 409 : 500);
    await chutarTick(db);
    return json({ ok: true, job: data });
  };

  if (acao === "retomar") {
    if (!ultimo || ultimo.status !== "pausado") return json({ ok: true, job: ultimo ?? null });
    return await retomar(ultimo);
  }

  if (acao === "cancelar") {
    if (!ultimo || !["listando", "importando", "pausado"].includes(ultimo.status)) return json({ ok: true, job: ultimo ?? null });
    const { data } = await db.from("whatsapp_backfill_jobs")
      .update({ status: "cancelado", concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq("id", ultimo.id).select("*").maybeSingle();
    return json({ ok: true, job: data });
  }

  if (acao === "iniciar") {
    const completo = corpo?.completo === true;
    const decisao = decidirInicio(ultimo, completo);
    if (decisao === "reusar") {
      await chutarTick(db);
      return json({ ok: true, job: ultimo, aviso: "já existe uma importação em andamento" });
    }
    if (decisao === "retomar") return await retomar(ultimo);
    if (decisao === "cancelar-e-criar") {
      // a importação de 90 dias vira o histórico completo: os chats já feitos são relidos e deduplicados
      await db.from("whatsapp_backfill_jobs")
        .update({ status: "cancelado", concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), aviso: "substituído pelo histórico completo" })
        .eq("id", ultimo.id).in("status", ["listando", "importando", "pausado"]);
    }
    const porChat = completo ? POR_CHAT_HISTORICO_COMPLETO : Math.min(Math.max(Number(corpo?.por_chat) || 500, 1), 2000);
    const midias = completo ? 0 : Math.min(Math.max(Number(corpo?.midias_por_chat ?? 3), 0), 30);
    const { data: novo, error } = await db.from("whatsapp_backfill_jobs").insert({
      ...(numero ? { numero_id: numero.id } : {}),
      ...(completo ? { completo: true } : {}),
      por_chat: porChat, midias_por_chat: midias, grupos: corpo?.grupos !== false, criado_por: user.id,
    }).select("*").single();
    if (error) return json({ error: error.message }, error.code === "23505" ? 409 : 500);
    await chutarTick(db);
    return json({ ok: true, job: novo });
  }

  return json({ error: "acao inválida" }, 400);
});
