// Importa histórico de conversas/mensagens do OpenWA (VPS) para o CRM, pelo proxy assinado.
// OpenWA é o único provedor desde 17/10/2026 (UazAPI aposentada).
//
// POST { phone }            -> histórico desse telefone OU grupo (phone = "…@g.us"), até `limit` mensagens
//                              (teto 500; acima de 100 usa o histórico fundo do WhatsApp Web).
// POST { modo: "recentes", numero_id?, chats? (80, teto 100), por_chat? (20, teto 30) }
//                           -> LISTA PRIMEIRO (18/10/2026): rota chats-recentes do proxy, uma chamada, as conversas
//                              mais recentes com as últimas mensagens de cada (texto e horário reais), sem mídia.
//                              Proxy sem a rota: cai no modo de lista abaixo e responde modo: "lento".
// POST { midia_de: message_id } -> baixa a mídia de UMA mensagem (rota media-id), devolve media_path.
// POST { phone, limit?, sem_midia? } -> conversa sob demanda (ao abrir / carregar mais): até 2000, deduplicado.
// POST { chats?, limit?, grupos?, fotos? }
//                           -> lista as conversas mais recentes da sessão, individuais E grupos
//                              (grupos: false tira os grupos), as `chats` mais recentes (padrão 20,
//                              teto 40) e importa o histórico de cada uma.
// Foto (fotos: false desliga): cada conversa importada busca a foto do contato/grupo se ela não
// existe ou tem mais de 7 dias, e guarda no Storage (_shared/avatarWa.ts).
// Ritmo: uma conversa a cada 2,2 s (histórico + foto = 2 leituras; o proxy limita a 60/min) e no
// máximo ~100 s por chamada; se faltar tempo ou o proxy responder 429, devolve o parcial com `restantes`.
// Não sobrescreve nada: contato existente fica com o nome que tem (grupo: o nome acompanha o
// assunto atual do grupo), mensagem existente é pulada. Contato novo nasce com source
// 'whatsapp-importacao' (não dispara automação de etapa: conversa antiga não é lead novo).
// Mídia (17/10/2026): as mais recentes de cada chat entram na fila (media_status 'pendente'); com
// { phone } as 10 mais recentes já são baixadas aqui. Nome de participante de grupo: _shared/waNomes.ts.
// Todas as conversas, com progresso: whatsapp-backfill.
// Número (17/10/2026): { numero_id } escolhe o número (crm_numeros); sem ele, o padrão (closer). Lista,
// histórico, mídia e foto vão pela sessão do OpenWA dele, e contato/mensagens nascem com numero_id dele.
// Na lista, só conversas com atividade dentro da janela (integracao_config 'backfill_dias', padrão 90),
// da mais recente pra mais antiga: nada antigo sobe pro topo; contato novo nasce com a data do chat.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
// Permissões do CRM (22/11/2026): número/área conferidos no banco com o JWT de quem pede.
import { conferirAcessoCrm } from "../_shared/acessoCrm.ts";
import { ErroProxy } from "../_shared/waProxy.ts";
import { chamarProxyNaSessao, numeroPadrao, numeroPorId, sessaoLeitura } from "../_shared/waNumero.ts";
import { chatNaJanela, corteDaJanela, diasDaJanela, tsChatParaMs } from "../_shared/waBackfill.ts";
import { ehGrupo } from "../_shared/openwa.ts";
import { atualizarAvatar } from "../_shared/avatarWa.ts";
import { importarChat, inserirMensagens } from "../_shared/waImportar.ts";
import { ehRotaInexistente } from "../_shared/waMidiaRegras.ts";
import { contatoNovoDaConversa, conversasDosRecentes } from "../_shared/waRecentes.ts";
import { erroDoProxyParaCrm } from "../_shared/waErro.ts";
import { COLUNAS_MIDIA_PENDENTE, COLUNAS_MIDIA_PENDENTE_ANTIGAS, processarMidiasPendentes, type LinhaMidia } from "../_shared/waMidia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Alvo = { phone: string; name: string | null; chatId: string | null; grupo: boolean; ts: number };

/** Resposta da rota chats do proxy -> conversas com telefone (as @lid sem telefone resolvido ficam de fora). */
function alvosDaLista(lista: unknown): Alvo[] {
  if (!Array.isArray(lista)) return [];
  const out: Alvo[] = [];
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const phone = typeof c.phone === "string" && /^\d{10,15}$/.test(c.phone) ? c.phone : null;
    const chatId = typeof c.chatId === "string" && /^(\d{10,15}@c\.us|\d{5,25}@lid)$/.test(c.chatId) ? c.chatId : null;
    if (!phone) continue;
    out.push({
      phone, chatId, grupo: false, name: typeof c.name === "string" ? c.name : null,
      ts: Number.isFinite(c.timestamp) ? c.timestamp : 0,
    });
  }
  return out;
}

/** Resposta da rota groups do proxy -> grupos (phone = chatId = JID do grupo). */
function alvosDosGrupos(lista: unknown): Alvo[] {
  if (!Array.isArray(lista)) return [];
  const out: Alvo[] = [];
  for (const c of lista) {
    if (!c || typeof c !== "object" || !ehGrupo(c.chatId)) continue;
    out.push({
      phone: c.chatId, chatId: c.chatId, grupo: true,
      name: typeof c.name === "string" && c.name.trim() ? c.name : null,
      ts: Number.isFinite(c.timestamp) ? c.timestamp : 0,
    });
  }
  return out;
}

const PAUSA_ENTRE_CHATS_MS = 2200;
const ORCAMENTO_MS = 100_000;

const semOrcamento = async () => true; // o ritmo aqui é a pausa entre chats

// Histórico de UM telefone/grupo (rota history do proxy; chatId pode ser @lid), no número escolhido.
async function importarOpenwa(
  supabase: SupabaseClient, phone: string, limit: number, chatId: string | null, midias: number, numeroId: string | null,
) {
  const r = await importarChat(supabase, { phone, chatId: ehGrupo(phone) ? phone : chatId, numeroId }, { limite: limit, midias, reservar: semOrcamento });
  return r.novas;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anon.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const corpo = await req.json().catch(() => ({}));

    // Mídia sob demanda (18/10/2026): { midia_de: message_id } baixa o arquivo de UMA mensagem pela rota media-id
    // (sessão do número da mensagem), guarda no bucket privado e devolve o media_path. A importação não baixa
    // mídia antiga em massa: só metadado; o arquivo vem quando alguém abre e pede.
    if (typeof corpo?.midia_de === "string" && corpo.midia_de) {
      const sbm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: aprovado } = await sbm.rpc("is_approved", { _user_id: user.id });
      if (!aprovado) return json({ error: "Forbidden" }, 403);
      // permissões do CRM: só baixa mídia de mensagem que o próprio usuário enxerga (RLS de número/atendente)
      const { data: visivel, error: erroVis } = await anon.from("whatsapp_messages").select("id").eq("message_id", corpo.midia_de).limit(1).maybeSingle();
      if (!erroVis && !visivel) return json({ error: "mensagem não encontrada" }, 404);
      const ler = (colunas: string) => sbm.from("whatsapp_messages")
        .select(`${colunas}, media_type, media_path`).eq("message_id", corpo.midia_de).limit(1).maybeSingle();
      let { data: linha, error: erroLinha } = await ler(COLUNAS_MIDIA_PENDENTE);
      if (erroLinha) ({ data: linha } = await ler(COLUNAS_MIDIA_PENDENTE_ANTIGAS));
      const l = linha as (LinhaMidia & { media_type?: string | null; media_path?: string | null }) | null;
      if (!l) return json({ error: "mensagem não encontrada" }, 404);
      if (l.media_path) return json({ ok: true, media_path: l.media_path, media_status: "ok" });
      if (!l.media_type) return json({ error: "a mensagem não tem mídia" }, 400);
      const prazo = Date.now() + 90_000;
      await processarMidiasPendentes(sbm, [l], async () => Date.now() < prazo, () => prazo - Date.now());
      const { data: depois } = await sbm.from("whatsapp_messages").select("media_path, media_status, media_erro").eq("id", l.id).maybeSingle();
      return json({ ok: Boolean(depois?.media_path), media_path: depois?.media_path ?? null, media_status: depois?.media_status ?? null, erro: depois?.media_erro ?? null });
    }
    // com phone: até 2000 (carregar mais ao rolar pra cima pede limite maior; o banco deduplica pelo id)
    const limit = Math.min(Math.max(Number(corpo?.limit) || 100, 1), corpo?.phone ? 2000 : corpo?.modo === "recentes" ? 30 : 100);
    // modo recentes / sob demanda: só metadado de mídia (baixa ao abrir, pelo media-id)
    const midias = corpo?.sem_midia === true || corpo?.modo === "recentes" ? 0 : corpo?.phone ? 10 : 3;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const inicio = Date.now();

    // número: o pedido ou o padrão; numeroId null = banco sem crm_numeros (grava como antes)
    const pedido = typeof corpo?.numero_id === "string" && corpo.numero_id ? await numeroPorId(sb, corpo.numero_id) : null;
    if (corpo?.numero_id && !pedido) return json({ error: "número não encontrado" }, 404);
    if (pedido && (pedido.tipo !== "openwa" || !pedido.sessao_openwa)) return json({ error: "histórico só existe para número do OpenWA" }, 400);
    const numero = pedido ?? await numeroPadrao(sb).catch(() => null);
    const numeroId = numero?.id ?? null;
    const sessao = await sessaoLeitura(sb, numeroId);
    const doNumero = numeroId ? { numero_id: numeroId } : {};
    const conflito = numeroId ? "numero_id,phone" : "phone";
    const proxy = (rota: string, c: Record<string, unknown>) => chamarProxyNaSessao(rota, c, sessao);

    // permissões do CRM: importar grava conversa/mensagem do número; exige Conversas "editar" naquele número
    const acesso = await conferirAcessoCrm(anon, typeof corpo?.phone === "string" && corpo.phone
      ? { conversa: { numeroId, phone: String(corpo.phone) } }
      : { area: "conversas", numeroId });
    if (!acesso.ok) return json({ error: acesso.erro }, acesso.status);

    // 0) Lista primeiro (modo "recentes", 18/10/2026): uma chamada à rota chats-recentes do proxy traz as N
    //    conversas mais recentes com as últimas mensagens de cada (texto e horário reais). Grava mensagem
    //    (importada: não conta como não lida) e, só para conversa com mensagem, o contato NOVO com a data da
    //    última mensagem; contato existente não muda. Mídia: só metadado (baixa sob demanda pelo media-id).
    //    Proxy sem a rota (404 "não existe"): cai no caminho de lista + histórico conversa a conversa abaixo.
    let lento = false;
    if (corpo?.modo === "recentes" && !corpo?.phone) {
      const maxChats = Math.min(Math.max(Number(corpo?.chats) || 80, 1), 100);
      const porChat = Math.min(Math.max(Number(corpo?.por_chat) || 20, 1), 30);
      let resp: unknown = null;
      try {
        resp = await chamarProxyNaSessao("chats-recentes", { limit: maxChats, porChat }, sessao, { timeoutMs: 80_000 });
      } catch (e) {
        if (ehRotaInexistente(e)) lento = true;
        else {
          // mensagem real (timeout = número sincronizando, limite, recusa do OpenWA), nunca só "non-2xx"
          const falha = erroDoProxyParaCrm(e);
          console.error("whatsapp-import-history recentes:", falha.status, falha.motivo ?? "", e instanceof ErroProxy ? e.status : String(e));
          return json({ error: falha.error, motivo: falha.motivo ?? null }, falha.status);
        }
      }
      if (!lento) {
        const conversas = conversasDosRecentes(resp, numeroId);
        let importadas = 0;
        let novos = 0;
        for (const c of conversas) {
          if (Date.now() - inicio > 120_000) break;
          importadas += await inserirMensagens(sb, c.linhas);
          const { data: criados } = await sb.from("whatsapp_contacts")
            .upsert(contatoNovoDaConversa(c, numeroId), { onConflict: conflito, ignoreDuplicates: true }).select("id");
          novos += criados?.length ?? 0;
        }
        const parcial = Boolean((resp as { parcial?: unknown } | null)?.parcial);
        return json({ ok: true, provider: "openwa", modo: "rapido", chats: conversas.length, imported: importadas, contatos_novos: novos, parcial });
      }
    }

    // 1) Quais conversas
    let alvos: Alvo[];
    const comFotos = corpo?.fotos !== false;
    if (corpo?.phone) {
      if (ehGrupo(corpo.phone)) {
        alvos = [{ phone: corpo.phone, name: null, chatId: corpo.phone, grupo: true, ts: 0 }];
      } else {
        const phone = digits(corpo.phone);
        if (!/^\d{10,15}$/.test(phone)) return json({ error: "phone inválido" }, 400);
        alvos = [{ phone, name: null, chatId: null, grupo: false, ts: 0 }];
      }
    } else {
      const maxChats = Math.min(Math.max(Number(corpo?.chats) || 20, 1), lento ? 30 : 40);
      try {
        // individuais e grupos vêm em listas separadas do proxy; junta pela atividade (como no app)
        const individuais = alvosDaLista(await proxy("chats", { limit: Math.min(maxChats * 2, 60) }));
        let grupos: Alvo[] = [];
        if (corpo?.grupos !== false) {
          await dormir(PAUSA_ENTRE_CHATS_MS);
          grupos = alvosDosGrupos(await proxy("groups", { limit: Math.min(maxChats, 60) }));
        }
        // janela de N dias (backfill_dias): conversa parada há mais tempo não entra
        const { data: cfg } = await sb.from("integracao_config").select("valor").eq("chave", "backfill_dias").maybeSingle();
        const corteMs = corteDaJanela(diasDaJanela(typeof cfg?.valor === "string" ? cfg.valor : ""));
        alvos = [...individuais, ...grupos]
          .filter((a) => chatNaJanela(a.ts, corteMs))
          .sort((a, b) => b.ts - a.ts).slice(0, maxChats);
      } catch (e) {
        const falha = erroDoProxyParaCrm(e);
        return json({ error: falha.error, motivo: falha.motivo ?? null }, falha.status);
      }
    }

    // 2) Histórico de cada uma, no ritmo do proxy
    let importadas = 0;
    let fotos = 0;
    let feitas = 0;
    let aviso: string | null = null;
    for (const alvo of alvos) {
      if (feitas > 0) {
        if (Date.now() - inicio > ORCAMENTO_MS) { aviso = "tempo esgotado, rode de novo para continuar"; break; }
        await dormir(PAUSA_ENTRE_CHATS_MS);
      }
      // contato novo nasce com o nome da conversa; contato existente não é tocado
      // (grupo: o nome acompanha o assunto atual, como no app)
      // contato novo nasce com a data do chat (última mensagem real), nunca "agora"
      const tsMs = tsChatParaMs(alvo.ts);
      const quando = tsMs ? new Date(tsMs).toISOString() : new Date().toISOString();
      if (alvo.grupo) {
        await sb.from("whatsapp_contacts").upsert(
          { ...doNumero, phone: alvo.phone, name: alvo.name || "Grupo", is_group: true, source: "whatsapp-grupo", updated_at: quando },
          { onConflict: conflito, ignoreDuplicates: true },
        );
        if (alvo.name) {
          let q = sb.from("whatsapp_contacts").update({ name: alvo.name, is_group: true }).eq("phone", alvo.phone);
          if (numeroId) q = q.eq("numero_id", numeroId);
          await q;
        }
      } else {
        await sb.from("whatsapp_contacts").upsert(
          { ...doNumero, phone: alvo.phone, name: alvo.name || alvo.phone, source: "whatsapp-importacao", updated_at: quando },
          { onConflict: conflito, ignoreDuplicates: true },
        );
      }
      try {
        let n = await importarOpenwa(sb, alvo.phone, limit, alvo.chatId, midias, numeroId);
        // telefone avulso sem nada em <tel>@c.us: a conversa pode existir só como @lid; procura na lista
        if (n === 0 && !alvo.chatId && alvos.length === 1) {
          await dormir(PAUSA_ENTRE_CHATS_MS);
          const achado = alvosDaLista(await proxy("chats", { limit: 60 })).find((c) => c.phone === alvo.phone && c.chatId);
          if (achado?.chatId && achado.chatId !== `${alvo.phone}@c.us`) {
            await dormir(PAUSA_ENTRE_CHATS_MS);
            n = await importarOpenwa(sb, alvo.phone, limit, achado.chatId, midias, numeroId);
          }
        }
        importadas += n;
        if (comFotos) {
          await dormir(400);
          const r = await atualizarAvatar(sb, alvo.phone, { sessao });
          if (r === "atualizado") fotos++;
          if (r === "limite") { aviso = "limite de leitura do proxy, rode de novo em 1 minuto"; feitas++; break; }
        }
      } catch (e) {
        if (e instanceof ErroProxy && e.status === 429) { aviso = "limite de leitura do proxy, rode de novo em 1 minuto"; break; }
        if (alvos.length === 1) throw e;
        console.error("import-history: falhou em ***" + alvo.phone.slice(-4), e instanceof ErroProxy ? e.status : e);
      }
      feitas++;
    }

    // um contato só: baixa já as mídias que ficaram na fila (as mais recentes), até ~40 s
    let midiasBaixadas = 0;
    if (corpo?.phone && alvos.length === 1 && Date.now() - inicio < 60_000) {
      const ler = (colunas: string, comNumero: boolean) => {
        let q = sb.from("whatsapp_messages").select(colunas)
          .eq("contact_phone", alvos[0].phone).eq("media_status", "pendente");
        if (comNumero && numeroId) q = q.eq("numero_id", numeroId);
        return q.order("created_at", { ascending: false }).limit(10);
      };
      let { data: pend, error: erroPend } = await ler(COLUNAS_MIDIA_PENDENTE, true);
      if (erroPend) ({ data: pend } = await ler(COLUNAS_MIDIA_PENDENTE_ANTIGAS, false));
      const prazo = Date.now() + 40_000;
      if (pend?.length) {
        const r = await processarMidiasPendentes(sb, pend as unknown as LinhaMidia[], async () => Date.now() < prazo, () => prazo - Date.now());
        midiasBaixadas = r.ok;
      }
    }

    return json({
      ok: true,
      provider: "openwa",
      ...(lento ? { modo: "lento" } : {}),
      midias: midiasBaixadas,
      chats: feitas,
      imported: importadas,
      fotos,
      restantes: alvos.length - feitas,
      ...(aviso ? { aviso } : {}),
    });
  } catch (err) {
    console.error("whatsapp-import-history error:", err);
    if (err instanceof ErroProxy || (err as { name?: unknown } | null)?.name === "TimeoutError") {
      const falha = erroDoProxyParaCrm(err, "trazer as conversas");
      return json({ error: falha.error, motivo: falha.motivo ?? null }, falha.status);
    }
    return json({ error: err instanceof Error ? err.message : "Unknown" }, 500);
  }
});
