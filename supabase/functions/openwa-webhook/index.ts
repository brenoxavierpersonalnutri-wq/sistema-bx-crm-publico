// Recebe os webhooks do OpenWA (VPS) e alimenta o CRM de WhatsApp.
// Único caminho de entrada de mensagens desde 17/10/2026 (o whatsapp-webhook da UazAPI responde 410);
// grava nas mesmas tabelas e no mesmo formato de linha que ele usava.
//
// Autenticação: header X-OpenWA-Signature = "sha256=" + HMAC-SHA256(corpo cru,
// OPENWA_WEBHOOK_SECRET — secret da função ou, sem ele, o gerado no banco). Sem assinatura válida -> 401.
// Eventos: message.received, message.sent, message.ack. Canal/status: ignorados.
// Grupo (desde 17/10/2026): grava como contato com phone = JID do grupo (…@g.us) e is_group,
// e cada mensagem leva o nome/telefone de quem mandou (author_name/author_phone). Só leitura:
// nenhum caminho de envio aceita grupo.
// Foto: a mensagem agenda (em segundo plano) a atualização da foto do contato/grupo quando ele
// não tem foto ou a foto tem mais de 7 dias (_shared/avatarWa.ts).
// Mídia (desde 17/10/2026): a linha é gravada PRIMEIRO com media_status 'pendente' e a resposta sai
// na hora (o OpenWA desiste em 10 s e reentrega); o arquivo é baixado em segundo plano — base64 do
// corpo (até 1 MiB) ou rota media do proxy com 3 tentativas — e vai pro bucket privado whatsapp-media
// (media_path; o front assina na leitura). Falhou: fica pendente e o tick do whatsapp-backfill tenta
// de novo até 3 vezes, depois 'falhou' com o erro (_shared/waMidia.ts).
// Nome em grupo: pushName do evento; sem ele, cache whatsapp_wa_nomes; sem cache, busca em segundo
// plano pelo proxy (contacts-info) e preenche a linha (_shared/waNomes.ts).
// Contato: celular BR com/sem o 9 cai no contato que já existe (variantesTelefoneBR), sem duplicar.
// Robô de IA (18/10/2026, nasce desligado): mensagem da lead numa conversa da IA (ou conversa nova que casa com um
// agente ligado) entra na fila com debounce (crm_ai_fila) SÓ se o número tiver crm_numeros.robo_ia_ligado; quem
// responde é o ai-robo-tick. Mensagem nossa vinda do celular (não do robô nem de automação) pausa a IA da conversa.
// Eco do que o robô mandou casa com a linha que ele pré-gravou (não vira "humano"). Grupo: nunca.
// Número (17/10/2026): as 4 sessões do OpenWA mandam pra cá. Cada mensagem é gravada no número que a
// recebeu/mandou (numero_id em whatsapp_contacts e whatsapp_messages; contato único por número+telefone):
// sessionId assinado do envelope -> crm_numeros.openwa_session_id; na primeira vez, ?sessao=<nome> na URL
// do webhook (headturbo-openwa-webhook-crm --sessao) ou o telefone do próprio número no evento vinculam o
// sessionId. Sessão desconhecida com o padrão já vinculado: 500 (o OpenWA reentrega), nunca a caixa errada.
// Mídia, foto e nomes vão pela sessão desse número (_shared/waNumero.ts).
// Fluxo de Grupo (19/10/2026): group.join / group.leave (só chegam se o webhook da sessão assinar esses
// eventos: headturbo-openwa-webhook-crm --com-eventos-grupo) viram entradas/saídas do grupo de campanha
// (grupos_registrar_evento_membros) e, com boas-vindas ligada, a fila da mensagem de boas-vindas.
// Grupo fora de campanha: ignorado. Nada de contato/mensagem é gravado por esses eventos.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assinaturaOpenwaValida, interpretarEventoOpenwa, sessionIdDoEnvelope } from "../_shared/openwa.ts";
import { identificarNumeroDoEvento } from "../_shared/numerosWa.ts";
import { carregarNumeros, esquecerNumeros, sessaoPadrao } from "../_shared/waNumero.ts";
import { segredoWa } from "../_shared/segredosWa.ts";
import { atualizarAvatar } from "../_shared/avatarWa.ts";
import { midiaDoWebhook } from "../_shared/waMidia.ts";
import { nomesDoCache, resolverNomes } from "../_shared/waNomes.ts";
import { variantesTelefoneBR } from "../_shared/waBackfill.ts";
import { reivindicarEcoDoRobo, roboAoEnviarFromMe, roboAoReceber } from "../_shared/roboAtendimentoDb.ts";
import { interpretarEventoGrupo } from "../_shared/grupos.ts";

/** Roda depois da resposta (EdgeRuntime.waitUntil); fora do runtime da Supabase, só dispara. */
function emSegundoPlano(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const seguro = p.catch((e) => console.error("openwa-webhook: segundo plano", e instanceof Error ? e.message : e));
  if (rt?.waitUntil) rt.waitUntil(seguro);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ORDEM_STATUS: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/** Chave do contato NESTE número: o telefone do evento, ou a variante com/sem 9 que já existe nele. */
async function chaveDoContato(supabase: SupabaseClient, telefone: string, numeroId: string | null): Promise<string> {
  const variantes = variantesTelefoneBR(telefone);
  if (variantes.length < 2) return telefone;
  let q = supabase.from("whatsapp_contacts").select("phone").in("phone", variantes);
  if (numeroId) q = q.eq("numero_id", numeroId);
  const { data } = await q;
  const fones = (data ?? []).map((r: { phone: string }) => r.phone);
  return fones.includes(telefone) ? telefone : (fones[0] ?? telefone);
}

type Numero = { id: string; sessao: string | null };

/**
 * De qual número veio o evento. null = banco sem crm_numeros/numero_id (migration pendente): grava como
 * antes, sem número. Lança quando a sessão é desconhecida (500 -> o OpenWA reentrega).
 */
async function numeroDoEvento(
  supabase: SupabaseClient,
  envelope: unknown,
  req: Request,
  telefoneProprio: string | null,
): Promise<Numero | null> {
  const sessionId = sessionIdDoEnvelope(envelope);
  const sessaoUrl = new URL(req.url).searchParams.get("sessao");
  let numeros;
  try {
    numeros = await carregarNumeros(supabase);
  } catch (e) {
    console.error("openwa-webhook: sem crm_numeros", e instanceof Error ? e.message : e);
    return null;
  }
  let id = identificarNumeroDoEvento(numeros, { sessionId, sessaoUrl, telefoneProprio }, sessaoPadrao());
  if ("erro" in id) {
    // outra instância pode ter acabado de vincular: relê sem cache antes de recusar
    numeros = await carregarNumeros(supabase, true);
    id = identificarNumeroDoEvento(numeros, { sessionId, sessaoUrl, telefoneProprio }, sessaoPadrao());
  }
  if ("erro" in id) throw new Error(id.erro);
  if (id.vincular && sessionId) {
    const { error } = await supabase.from("crm_numeros").update({ openwa_session_id: sessionId }).eq("id", id.numero.id);
    if (error) console.error("openwa-webhook: não vinculei a sessão", error.message);
    else console.log(`openwa-webhook: sessão do OpenWA vinculada ao número ${id.numero.chave} (por ${id.por})`);
    esquecerNumeros();
  }
  const s = id.numero.sessao_openwa;
  return { id: id.numero.id, sessao: s && s !== sessaoPadrao() ? s : null };
}

/** Grava sem numero_id quando a coluna ainda não existe (migration 20261028100000 pendente). */
const semColuna = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703" || e.code === "42P10");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const corpoCru = await req.text();
  const ok = await assinaturaOpenwaValida(
    corpoCru,
    req.headers.get("x-openwa-signature"),
    await segredoWa("OPENWA_WEBHOOK_SECRET"),
  );
  if (!ok) return json({ error: "Unauthorized" }, 401);

  try {
    let envelope: unknown;
    try {
      envelope = JSON.parse(corpoCru);
    } catch {
      return json({ ok: true, ignored: "json inválido" });
    }
    const evGrupo = interpretarEventoGrupo(envelope);
    if (evGrupo) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data, error } = await sb.rpc("grupos_registrar_evento_membros", {
        p_chat_id: evGrupo.chatId, p_tipo: evGrupo.tipo, p_participantes: evGrupo.participantes, p_chave: evGrupo.chave,
      });
      // função ainda não existe (migration pendente): não faz o OpenWA reentregar à toa
      if (error) {
        console.error("openwa-webhook: evento de grupo", error.message);
        return json({ ok: true, ignored: "evento de grupo sem destino" });
      }
      return json({ ok: true, grupos: data ?? 0 });
    }

    const ev = interpretarEventoOpenwa(envelope);
    if (ev.tipo === "ignorar") return json({ ok: true, ignored: ev.motivo });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (ev.tipo === "ack") {
      const { data: linha } = await supabase.from("whatsapp_messages")
        .select("id, status").eq("message_id", ev.messageId).maybeSingle();
      if (!linha) return json({ ok: true, ignored: "ack de mensagem desconhecida" });
      const atual = ORDEM_STATUS[String(linha.status ?? "")] ?? -1;
      const novo = ORDEM_STATUS[ev.status] ?? -1;
      // ack chega fora de ordem: nunca volta de "read" pra "delivered"; "failed" sempre vale
      if (ev.status === "failed" || novo > atual) {
        await supabase.from("whatsapp_messages").update({ status: ev.status }).eq("id", linha.id);
      }
      return json({ ok: true });
    }

    // Reentrega (o OpenWA é at-least-once) ou eco de mensagem que o CRM mesmo mandou:
    // a linha já existe, não refaz nada.
    if (ev.messageId) {
      const { data: existe } = await supabase.from("whatsapp_messages")
        .select("id").eq("message_id", ev.messageId).maybeSingle();
      if (existe) return json({ ok: true, ignored: "duplicada" });
    }

    const numero = await numeroDoEvento(supabase, envelope, req, ev.telefoneProprio);
    const numeroId = numero?.id ?? null;
    const sessao = numero?.sessao ?? null;
    const agoraIso = new Date().toISOString();
    const telefone = ev.grupo ? ev.telefone : await chaveDoContato(supabase, ev.telefone, numeroId);
    const doNumero = numeroId ? { numero_id: numeroId } : {};
    const conflito = numeroId ? "numero_id,phone" : "phone";
    const upsertContato = async (linha: Record<string, unknown>, opts: { ignoreDuplicates?: boolean }) => {
      let { error } = await supabase.from("whatsapp_contacts").upsert({ ...doNumero, ...linha }, { onConflict: conflito, ...opts });
      if (error && numeroId && semColuna(error)) {
        ({ error } = await supabase.from("whatsapp_contacts").upsert(linha, { onConflict: "phone", ...opts }));
      }
      if (error) throw new Error(`contato: ${error.message}`);
    };
    if (ev.grupo) {
      // grupo novo nasce com o nome provisório "Grupo"; o nome real vem da importação (lista de chats)
      await upsertContato({ phone: telefone, name: "Grupo", is_group: true, source: "whatsapp-grupo", updated_at: agoraIso }, { ignoreDuplicates: true });
      let q = supabase.from("whatsapp_contacts").update({ updated_at: agoraIso }).eq("phone", telefone);
      if (numeroId) q = q.eq("numero_id", numeroId);
      await q;
    } else {
      await upsertContato(
        ev.fromMe
          ? { phone: telefone, updated_at: agoraIso }
          : { phone: telefone, name: ev.nome || telefone, updated_at: agoraIso },
        {},
      );
    }
    emSegundoPlano(atualizarAvatar(supabase, telefone, { sessao }));

    // autor de grupo: pushName do evento; sem ele, o cache (rápido); sem cache, segundo plano
    let autorNome = ev.autorNome;
    let autorTelefone = ev.autorTelefone;
    let buscarNome = false;
    if (ev.grupo && ev.autorId && (!autorNome || !autorTelefone)) {
      const { achados } = await nomesDoCache(supabase, [ev.autorId]);
      const c = achados.get(ev.autorId);
      autorNome = autorNome ?? c?.nome ?? null;
      autorTelefone = autorTelefone ?? c?.telefone ?? null;
      buscarNome = !c;
    }

    // eco do que o robô de IA acabou de mandar (linha pré-gravada sem message_id): só completa o id
    if (ev.fromMe && !ev.grupo && await reivindicarEcoDoRobo(supabase, {
      numeroId, telefone, messageId: ev.messageId, corpo: ev.corpo ?? ev.caption ?? null, mediaType: ev.mediaType ?? null,
    })) {
      return json({ ok: true, ignored: "eco do robô de IA" });
    }

    const temMidia = Boolean(ev.mediaType && ev.messageId && (ev.midiaInline || ev.midiaPendente));
    const linha: Record<string, unknown> = {
      ...doNumero,
      contact_phone: telefone,
      direction: ev.fromMe ? "outbound" : "inbound",
      sender_type: ev.fromMe ? "human" : "lead",
      body: ev.corpo,
      media_url: null,
      media_type: ev.mediaType,
      mime_type: ev.mimetype,
      file_name: ev.fileName,
      caption: ev.caption,
      message_id: ev.messageId,
      ...(temMidia ? { media_status: "pendente" } : {}),
    };
    if (ev.grupo) {
      linha.author_name = autorNome;
      linha.author_phone = autorTelefone;
      linha.author_id = ev.autorId;
    }
    if (ev.criadoEm) linha.created_at = ev.criadoEm;

    // insert simples: a existência já foi checada acima, e o índice único de message_id
    // é parcial (WHERE message_id IS NOT NULL), que o ON CONFLICT do upsert pode não casar.
    // Corrida entre duas entregas iguais cai no 23505 e conta como duplicada.
    let { data: gravada, error } = await supabase.from("whatsapp_messages").insert(linha).select("id").maybeSingle();
    if (error && semColuna(error) && "numero_id" in linha) {
      delete linha.numero_id;
      ({ data: gravada, error } = await supabase.from("whatsapp_messages").insert(linha).select("id").maybeSingle());
    }
    if (error && (error.code === "PGRST204" || error.code === "42703") && "media_status" in linha) {
      // migration 20261025100000 ainda não rodou: grava sem a coluna nova (a mensagem não se perde)
      delete linha.media_status;
      ({ data: gravada, error } = await supabase.from("whatsapp_messages").insert(linha).select("id").maybeSingle());
    }
    if (error && error.code === "23505") return json({ ok: true, ignored: "duplicada" });
    if (error) throw new Error(error.message);

    if (temMidia && gravada?.id) {
      emSegundoPlano(midiaDoWebhook(supabase, gravada.id, {
        telefone, chatId: ev.chatId, messageId: ev.messageId!, mime: ev.mimetype, fileName: ev.fileName, inline: ev.midiaInline, sessao,
      }));
    }
    if (ev.grupo && ev.autorId) {
      if (buscarNome) emSegundoPlano(resolverNomes(supabase, [ev.autorId], undefined, sessao));
      else if (ev.autorNome) {
        // pushName novo vai pro cache (e preenche mensagens antigas desse autor que estavam sem nome)
        emSegundoPlano(Promise.resolve(supabase.rpc("whatsapp_aplicar_nomes", {
          p_nomes: [{ wid: ev.autorId, nome: ev.autorNome, telefone: ev.autorTelefone }],
        })));
      }
    }

    // robô de IA: nunca em grupo; tudo em segundo plano (o webhook responde na hora)
    if (!ev.grupo && numeroId) {
      if (ev.fromMe) emSegundoPlano(roboAoEnviarFromMe(supabase, { numeroId, telefone, messageId: ev.messageId }));
      else emSegundoPlano(roboAoReceber(supabase, { numeroId, telefone }));
    }

    return json({ ok: true });
  } catch (err) {
    // 500 faz o OpenWA tentar de novo (retryCount do webhook)
    console.error("openwa-webhook error:", err instanceof Error ? err.message : err);
    return json({ error: "erro interno" }, 500);
  }
});
