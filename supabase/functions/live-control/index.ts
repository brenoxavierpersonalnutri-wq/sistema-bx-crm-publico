// Comandos do estúdio (sempre com JWT de usuário com módulo lives; verify_jwt = false e
// conferência aqui dentro, no padrão de crm-automacoes).
//
// acao:
//  cena            espelha layout/overlays do banco na metadata da sala (render reage na hora)
//  palco           { identity, no_palco, ordem? } -> atributo stage do participante
//  remover         { identity } tira alguém da sala
//  salvar-destino  { tipo, nome, rtmp_url, chave, id? } cifra a chave (AES-GCM) e grava
//  destino-ativo   { destino_id, ativo } liga/desliga; ao vivo, soma/tira do Egress (UpdateStream).
//                  Erro de um destino fica em live_destinations.yt_erro (nome histórico: vale pra QUALQUER
//                  destino, não só YouTube; o webhook grava ali quando a plataforma derruba a saída).
//  criar-convite   { nome, horas? } devolve o link UMA vez; banco guarda só o sha256
//  criar-cf-input  cria live input no Cloudflare Stream e vira destino "cloudflare" + HLS da sala
//  ir-ao-vivo      Egress RoomComposite com template = /lives/render/:id para todos os destinos ativos
//  encerrar        para o Egress
//  gravar          { ligar } Egress de arquivo (MP4 no disco da VPS)
//  render-url      link de prévia (leitura) do que sai na transmissão
//  salvar-destino-youtube { yt_conta_id, titulo, descricao?, privacidade, id? } destino YouTube conectado
//                  (modo youtube_api): sem chave colada; o broadcast/stream nascem no ir-ao-vivo
//  garantir-youtube { ativar?, yt_conta_id? } destino YouTube automático (canal escolhido ou o PADRÃO; ativo, Não listado, título da live) se a
//                  sala não tem nenhum; idempotente (_shared/destinoYtAuto.ts). ativar=true religa o desligado.
//  youtube-status  confere os broadcasts da sala e, com o stream ativo, transiciona pra live (fallback do auto start)
// A chave RTMP decifrada nunca sai desta função (nem a do YouTube conectado: _shared/youtubeDb.ts).
import {
  cifrarChave,
  decifrarChave,
  finalDaChave,
  sha256Hex,
  tokenAleatorio,
  tokenRender,
  urlRtmpCompleta,
} from "../_shared/liveCrypto.ts";
import {
  atualizarAtributos,
  atualizarMetadataSala,
  atualizarSaidas,
  cfStreamConfigurado,
  criarLiveInputCf,
  criarSala,
  ErroLiveKit,
  iniciarGravacao,
  iniciarTransmissao,
  pararEgress,
  removerParticipante,
} from "../_shared/livekitApi.ts";
import { metadataDaSala } from "../_shared/livesCena.ts";
import { limparMotivo, montarSaidas } from "../_shared/liveSaidas.ts";
import { ErroGoogle, linkYoutube, validarDestinoYt } from "../_shared/youtube.ts";
import { conferirDestinoYt, type DestinoYt, ehYoutubeApi, encerrarDestinoYt, prepararDestinoYt } from "../_shared/youtubeDb.ts";
import { ACOES_DA_AGENDA, admin, chamadaDaAgenda, corpoJson, corsHeaders, json, siteUrl, usuarioLives } from "../_shared/livesHttp.ts";
import { segredoLive } from "../_shared/liveSegredo.ts";
import { garantirDestinoYt, SERVIDOR_YT_RTMPS } from "../_shared/destinoYtAuto.ts";

const db = admin();
const TIPOS = ["youtube", "facebook", "instagram", "cloudflare", "custom"] as const;
// placeholder do destino conectado: o endereço real vem do liveStream no ir-ao-vivo
const SERVIDOR_PADRAO_YT_RTMPS = SERVIDOR_YT_RTMPS;
const SERVIDOR_PADRAO: Record<string, string> = {
  youtube: "rtmp://a.rtmp.youtube.com/live2",
  facebook: "rtmps://live-api-s.facebook.com:443/rtmp",
};

// env LIVE_CHAVES_SEGREDO se existir; senão integracao_config 'live_chaves_segredo' (gerado no banco)
async function segredo(): Promise<string> {
  try {
    return await segredoLive(db);
  } catch (e) {
    throw new ErroLiveKit(500, e instanceof Error ? e.message : "LIVE_CHAVES_SEGREDO ausente");
  }
}

// erro do LiveKit pode ecoar a URL de saída (com a chave): nada que pareça rtmp sai daqui
const semRtmp = (v: unknown) => JSON.stringify(v ?? "").replace(/rtmps?:\/\/[^\s"']+/gi, "rtmp://[oculto]").slice(0, 300);

const templateUrl = (roomId: string) => `${siteUrl()}/lives/render/${roomId}`;

async function urlDoDestino(d: { rtmp_url: string; chave_cifrada: string | null }): Promise<string> {
  if (!d.chave_cifrada) throw new ErroLiveKit(400, "destino sem chave de transmissão");
  return urlRtmpCompleta(d.rtmp_url, await decifrarChave(d.chave_cifrada, await segredo()));
}

/** Destino YouTube conectado: cria broadcast/stream na hora; manual: decifra a chave guardada. */
async function urlParaTransmitir(d: DestinoYt & { rtmp_url: string; chave_cifrada: string | null }): Promise<string> {
  return ehYoutubeApi(d) ? prepararDestinoYt(db, d, await segredo()) : urlDoDestino(d);
}

async function encerrarYoutubeDaSala(roomId: string, soIds?: string[]) {
  let q = db.from("live_destinations").select("*").eq("room_id", roomId).eq("modo", "youtube_api").not("yt_broadcast_id", "is", null);
  if (soIds) q = q.in("id", soIds);
  const { data } = await q;
  if (!data?.length) return;
  const seg = await segredo();
  await Promise.all(data.map((d) => encerrarDestinoYt(db, d, seg).catch(() => null)));
}

async function carregarSala(id: unknown) {
  if (typeof id !== "string") return null;
  const { data } = await db.from("live_rooms").select("*").eq("id", id).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  // agenda (live programada / fim do vídeo da aula): só as ações de transmissão, com o segredo do tick
  const daAgenda = req.headers.has("x-live-segredo") && (await chamadaDaAgenda(req, db));
  const user = daAgenda ? null : await usuarioLives(req);
  if (!daAgenda && !user) return json({ error: "sem acesso ao módulo lives" }, 403);
  const b = await corpoJson(req);
  if (!b) return json({ error: "corpo inválido" }, 400);
  if (daAgenda && !ACOES_DA_AGENDA.includes(String(b.acao))) return json({ error: "ação não permitida para a agenda" }, 403);

  try {
    // destino-ativo chega com destino_id; o resto com room_id
    if (b.acao === "destino-ativo") {
      const { data: d } = await db.from("live_destinations").select("*").eq("id", b.destino_id).maybeSingle();
      if (!d) return json({ error: "destino não encontrado" }, 404);
      const sala = await carregarSala(d.room_id);
      const ativo = b.ativo === true;
      let noAr = false;
      if (sala?.status === "ao_vivo" && sala.egress_id) {
        if (ativo) {
          // somar no meio da live: se a plataforma recusar (ex.: chave do Instagram vencida), os outros seguem
          try {
            await atualizarSaidas(sala.egress_id, [await urlParaTransmitir(d)], []);
          } catch (e) {
            const motivo = limparMotivo(e instanceof ErroLiveKit ? `${e.message}: ${semRtmp(e.detalhe)}` : e);
            await db.from("live_destinations").update({ yt_erro: motivo, no_ar: false }).eq("id", d.id);
            if (ehYoutubeApi(d)) await encerrarYoutubeDaSala(d.room_id, [d.id]).catch(() => null);
            return json({ error: `${d.nome} não entrou: ${motivo}` }, 502);
          }
          noAr = true;
        } else {
          // só tira do Egress o que está no ar: saída que já caiu não existe mais lá e o UpdateStream recusaria
          if (d.no_ar && d.chave_cifrada) {
            await atualizarSaidas(sala.egress_id, [], [await urlDoDestino(d)]).catch((e) =>
              console.error("live-control: remover saída", limparMotivo(e instanceof ErroLiveKit ? semRtmp(e.detalhe) : e)));
          }
          if (ehYoutubeApi(d)) await encerrarYoutubeDaSala(d.room_id, [d.id]);
        }
      }
      await db.from("live_destinations").update({
        ativo, no_ar: noAr, ...(ativo && noAr ? { yt_erro: null } : {}), updated_at: new Date().toISOString(),
      }).eq("id", d.id);
      return json({ ok: true, ativo, no_ar: noAr });
    }

    const sala = await carregarSala(b.room_id);
    if (!sala) return json({ error: "sala não encontrada" }, 404);

    switch (b.acao) {
      case "cena": {
        await atualizarMetadataSala(sala.livekit_room, await metadataDaSala(db, sala.id));
        return json({ ok: true });
      }

      case "palco": {
        if (typeof b.identity !== "string" || !b.identity) return json({ error: "identity" }, 400);
        const attrs: Record<string, string> = { stage: b.no_palco ? "1" : "0" };
        if (typeof b.ordem === "number" && Number.isFinite(b.ordem)) attrs.stage_ordem = String(Math.trunc(b.ordem));
        await atualizarAtributos(sala.livekit_room, b.identity, attrs);
        return json({ ok: true });
      }

      case "remover": {
        if (typeof b.identity !== "string" || !b.identity) return json({ error: "identity" }, 400);
        await removerParticipante(sala.livekit_room, b.identity);
        return json({ ok: true });
      }

      case "salvar-destino": {
        const tipo = String(b.tipo ?? "");
        if (!TIPOS.includes(tipo as (typeof TIPOS)[number])) return json({ error: "tipo inválido" }, 400);
        const nome = String(b.nome ?? "").trim().slice(0, 80) || tipo;
        const rtmp = String(b.rtmp_url ?? "").trim() || SERVIDOR_PADRAO[tipo] || "";
        const chave = String(b.chave ?? "").trim();
        if (!/^rtmps?:\/\/[^\s]+$/i.test(rtmp)) return json({ error: "servidor RTMP inválido (rtmp:// ou rtmps://)" }, 400);
        if (!chave || chave.length > 512 || /\s/.test(chave)) return json({ error: "chave de transmissão inválida" }, 400);
        urlRtmpCompleta(rtmp, chave); // valida a junção
        const linha = {
          room_id: sala.id,
          tipo,
          nome,
          rtmp_url: rtmp,
          chave_cifrada: await cifrarChave(chave, await segredo()),
          chave_final: finalDaChave(chave),
          updated_at: new Date().toISOString(),
        };
        // trocar a chave de um destino no ar deixaria a URL antiga presa no Egress
        const q = typeof b.id === "string"
          ? db.from("live_destinations").update({ ...linha, yt_erro: null }).eq("id", b.id).eq("room_id", sala.id).eq("no_ar", false)
          : db.from("live_destinations").insert(linha);
        const { data, error } = await q.select("id, tipo, nome, rtmp_url, chave_final, ativo, no_ar").maybeSingle();
        if (error) return json({ error: error.message }, 400);
        if (!data) return json({ error: "Este destino está no ar: desligue o interruptor dele antes de trocar a chave." }, 409);
        return json({ ok: true, destino: data });
      }

      case "salvar-destino-youtube": {
        const contaId = String(b.yt_conta_id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(contaId)) return json({ error: "escolha a conta do YouTube" }, 400);
        const { data: conta } = await db.from("yt_contas").select("id, titulo, status").eq("id", contaId).maybeSingle();
        if (!conta || conta.status !== "conectado") return json({ error: "conta do YouTube desconectada: conecte de novo" }, 400);
        const v = validarDestinoYt(b, sala.titulo);
        if (!v.ok) return json({ error: v.motivo }, 400);
        const linha = {
          room_id: sala.id,
          tipo: "youtube",
          modo: "youtube_api",
          nome: `YouTube · ${String(conta.titulo || "canal")}`.slice(0, 80),
          rtmp_url: SERVIDOR_PADRAO_YT_RTMPS,
          chave_final: "conta conectada",
          yt_conta_id: conta.id,
          yt_titulo: v.cfg.titulo,
          yt_descricao: v.cfg.descricao,
          yt_privacidade: v.cfg.privacidade,
          updated_at: new Date().toISOString(),
        };
        const q = typeof b.id === "string"
          ? db.from("live_destinations").update(linha).eq("id", b.id).eq("room_id", sala.id).eq("no_ar", false)
          : db.from("live_destinations").insert(linha);
        const { data, error } = await q.select("id, tipo, nome, modo, yt_titulo, yt_privacidade, ativo, no_ar").single();
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, destino: data });
      }

      case "garantir-youtube": {
        const contaId = typeof b.yt_conta_id === "string" && /^[0-9a-f-]{36}$/i.test(b.yt_conta_id) ? b.yt_conta_id : null;
        return json({ ok: true, ...(await garantirDestinoYt(db, sala, { ativar: b.ativar === true, contaId })) });
      }

      case "youtube-status": {
        const { data: dests } = await db.from("live_destinations").select("*").eq("room_id", sala.id).eq("modo", "youtube_api");
        const res = [];
        for (const d of dests ?? []) {
          let estado = d.yt_estado ?? null;
          let erro: string | null = d.yt_erro ?? null;
          if (d.yt_broadcast_id && sala.status === "ao_vivo") {
            try {
              estado = (await conferirDestinoYt(db, d, await segredo())).estado;
            } catch (e) {
              erro = e instanceof Error ? e.message : "falha ao consultar o YouTube";
            }
          }
          res.push({ id: d.id, estado, erro, video_id: d.yt_video_id, link: d.yt_video_id ? linkYoutube(d.yt_video_id) : null });
        }
        return json({ ok: true, destinos: res });
      }

      case "criar-convite": {
        const nome = String(b.nome ?? "Convidado").trim().slice(0, 80) || "Convidado";
        const horas = Math.min(72, Math.max(1, Number(b.horas) || 24));
        const token = tokenAleatorio(24);
        const { error } = await db.from("live_invites").insert({
          room_id: sala.id,
          token_hash: await sha256Hex(token),
          nome_convidado: nome,
          expira_em: new Date(Date.now() + horas * 3600_000).toISOString(),
          created_by: user!.id,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, url: `${siteUrl()}/lives/convite/${token}` });
      }

      case "criar-cf-input": {
        if (sala.cf_live_input_uid) return json({ error: "esta sala já tem live input do Cloudflare" }, 409);
        // sem os secrets do Stream: avisa sem gravar em ultimo_erro (não é erro da live, e o estúdio mostrava
        // "LiveKit respondeu 500: CF_... ausentes" como se o Ir ao vivo tivesse falhado)
        if (!cfStreamConfigurado()) {
          return json({ error: "Webinário próprio indisponível: o Cloudflare Stream não está configurado no servidor. Use YouTube, Facebook ou RTMP." }, 400);
        }
        const inp = await criarLiveInputCf(`${sala.titulo} (${sala.id.slice(0, 8)})`);
        await db.from("live_destinations").insert({
          room_id: sala.id,
          tipo: "cloudflare",
          nome: "Cloudflare Stream (webinário)",
          rtmp_url: inp.rtmpsUrl,
          chave_cifrada: await cifrarChave(inp.streamKey, await segredo()),
          chave_final: finalDaChave(inp.streamKey),
        });
        await db.from("live_rooms").update({ cf_live_input_uid: inp.uid, cf_hls_url: inp.hlsUrl }).eq("id", sala.id);
        return json({ ok: true, hls_url: inp.hlsUrl });
      }

      case "ir-ao-vivo": {
        if (sala.status === "ao_vivo" && sala.egress_id) return json({ error: "já está ao vivo" }, 409);
        // só os destinos ligados da sala, cada um por RTMP (YouTube conectado cria o broadcast na hora).
        // Nada aqui chama a API do Cloudflare Stream: o destino "cloudflare" é só mais uma URL RTMPS guardada.
        const { data: todos } = await db.from("live_destinations").select("*").eq("room_id", sala.id);
        if (!todos?.length) return json({ error: "Conecte um destino (YouTube, Facebook, RTMP) antes de ir ao vivo." }, 400);
        const dests = todos.filter((d) => d.ativo);
        if (!dests.length) return json({ error: "Seus destinos estão desligados: ligue pelo menos um na aba Destinos antes de ir ao vivo." }, 400);
        // YouTube conectado cria broadcast/stream agora; se um falhar, os outros destinos seguem
        // Um Egress só (a imagem é montada uma vez) com as URLs de todos os destinos que ficaram prontos.
        const prontos = await Promise.allSettled(dests.map(urlParaTransmitir));
        const { urls, okIds, falhas } = montarSaidas(dests, prontos);
        const avisos = falhas.map((f) => `${f.nome}: ${f.motivo}`);
        await Promise.all(falhas.map((f) => {
          const d = dests.find((x) => x.id === f.id);
          return db.from("live_destinations").update({ yt_erro: f.motivo, no_ar: false, ...(d && ehYoutubeApi(d) ? { yt_estado: "erro" } : {}) }).eq("id", f.id);
        }));
        if (!urls.length) return json({ error: `nenhum destino pronto: ${avisos.join(" · ")}`.slice(0, 400) }, 400);
        // Live programada ("Iniciar sozinho"): ninguém está no estúdio e a sala do LiveKit já fechou por
        // inatividade; sem ela o StartRoomCompositeEgress volta 404 "requested room does not exist".
        // CreateRoom é idempotente (sala existente segue igual), então garante a sala antes do Egress.
        const meta = await metadataDaSala(db, sala.id);
        await criarSala(sala.livekit_room, meta).catch(() => null);
        await atualizarMetadataSala(sala.livekit_room, meta).catch(() => null);
        let eg;
        try {
          eg = await iniciarTransmissao(sala.livekit_room, templateUrl(sala.id), urls);
        } catch (e) {
          await encerrarYoutubeDaSala(sala.id, okIds); // não deixa broadcast órfão no canal
          throw e;
        }
        await db.from("live_rooms").update({
          status: "ao_vivo",
          egress_id: eg.egress_id ?? eg.egressId ?? null,
          iniciada_em: new Date().toISOString(),
          encerrada_em: null,
          ultimo_erro: null,
        }).eq("id", sala.id);
        await db.from("live_destinations").update({ no_ar: true, yt_erro: null }).in("id", okIds);
        return json({ ok: true, egress_id: eg.egress_id ?? eg.egressId ?? null, destinos: okIds.length, avisos });
      }

      case "encerrar": {
        if (sala.egress_id) await pararEgress(sala.egress_id).catch(() => null);
        await encerrarYoutubeDaSala(sala.id).catch(() => null);
        await db.from("live_rooms").update({ status: "encerrada", egress_id: null, encerrada_em: new Date().toISOString() }).eq("id", sala.id);
        await db.from("live_destinations").update({ no_ar: false }).eq("room_id", sala.id);
        return json({ ok: true });
      }

      case "gravar": {
        if (b.ligar === true) {
          if (sala.gravacao_egress_id) return json({ error: "já está gravando" }, 409);
          const eg = await iniciarGravacao(sala.livekit_room, templateUrl(sala.id));
          await db.from("live_rooms").update({ gravacao_egress_id: eg.egress_id ?? eg.egressId ?? null }).eq("id", sala.id);
          return json({ ok: true, gravando: true });
        }
        if (sala.gravacao_egress_id) await pararEgress(sala.gravacao_egress_id).catch(() => null);
        await db.from("live_rooms").update({ gravacao_egress_id: null }).eq("id", sala.id);
        return json({ ok: true, gravando: false });
      }

      case "render-url": {
        const t = await tokenRender(sala.id, await segredo());
        return json({ ok: true, url: `${templateUrl(sala.id)}?t=${encodeURIComponent(t)}` });
      }

      default:
        return json({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    if (e instanceof ErroGoogle) {
      if (typeof b.room_id === "string") await db.from("live_rooms").update({ ultimo_erro: `YouTube: ${e.message}` }).eq("id", b.room_id);
      return json({ error: `YouTube: ${e.message}`, razao: e.razao }, e.precisaReconectar ? 401 : 502);
    }
    if (e instanceof ErroLiveKit) {
      if (typeof b.room_id === "string") {
        await db.from("live_rooms").update({ ultimo_erro: `${e.message}: ${semRtmp(e.detalhe)}` }).eq("id", b.room_id);
      }
      return json({ error: e.message, detalhe: semRtmp(e.detalhe) }, e.status >= 400 && e.status < 600 ? 502 : 500);
    }
    return json({ error: semRtmp(e instanceof Error ? e.message : String(e)) }, 400);
  }
});
