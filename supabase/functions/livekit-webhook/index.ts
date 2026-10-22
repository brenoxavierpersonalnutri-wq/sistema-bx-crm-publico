// Webhook do LiveKit (verify_jwt = false): autentica pelo JWT no Authorization, assinado com
// LIVEKIT_API_SECRET (env ou integracao_config.livekit, via envLiveKit), com a claim sha256 do corpo. Configurar em livekit.yaml (webhook.urls).
// Mantém o status da sala em dia quando o Egress termina ou falha fora do botão Encerrar, e marca
// QUAL destino caiu quando uma saída falha no meio da live (os outros seguem no ar): o LiveKit manda
// streamResults com a URL redigida ("rtmps://host/app/{abc...xyz}"); a função redige as URLs dos
// destinos da sala do mesmo jeito, em memória, e casa. A chave decifrada não é logada nem gravada.
// Vídeo da aula (Ingress URL_INPUT): participant_joined do "Vídeo da aula" com aula_palco_auto -> palco;
// ingress_ended (o arquivo acabou) -> limpa o estado e, se a sala pediu "encerrar ao fim" e está no ar,
// encerra a transmissão pelo live-control (Egress + broadcast do YouTube).
import { decifrarChave, urlRtmpCompleta, webhookLiveKitValido } from "../_shared/liveCrypto.ts";
import { atualizarAtributos, envLiveKit } from "../_shared/livekitApi.ts";
import { ehParticipanteAula } from "../_shared/aulaVideo.ts";
import { admin, chamarFuncaoLives, json } from "../_shared/livesHttp.ts";
import { falhasDoEgress, type StreamResultado, textoFalhaSaida } from "../_shared/liveSaidas.ts";
import { segredoLiveOuNull } from "../_shared/liveSegredo.ts";

const db = admin();

/** Grava em live_destinations.yt_erro (erro da saída, qualquer destino) e tira o "no ar" de quem caiu. */
async function marcarSaidasQueCairam(roomId: string, resultados: StreamResultado[]) {
  if (!resultados.some((r) => r.status === "FAILED" || r.status === 2)) return;
  const { data: dests } = await db.from("live_destinations").select("id, nome, tipo, modo, rtmp_url, chave_cifrada, no_ar").eq("room_id", roomId).eq("no_ar", true);
  if (!dests?.length) return;
  const seg = await segredoLiveOuNull(db);
  if (!seg) return;
  const comUrl: { id: string; nome: string; url: string }[] = [];
  for (const d of dests) {
    if (!d.chave_cifrada) continue;
    try {
      comUrl.push({ id: d.id, nome: d.nome, url: urlRtmpCompleta(d.rtmp_url, await decifrarChave(d.chave_cifrada, seg)) });
    } catch {
      /* chave ilegível: não casa, segue */
    }
  }
  for (const f of falhasDoEgress(resultados, comUrl)) {
    const d = dests.find((x) => x.id === f.id);
    await db.from("live_destinations").update({
      no_ar: false,
      yt_erro: textoFalhaSaida(f.motivo, d?.tipo),
      ...(d?.modo === "youtube_api" ? { yt_estado: "erro" } : {}),
    }).eq("id", f.id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const corpo = await req.text();
  if (corpo.length > 262_144) return json({ error: "grande demais" }, 413);
  const lk = await envLiveKit().catch(() => null);
  if (!lk) return json({ error: "LiveKit não configurado" }, 503);
  const ok = await webhookLiveKitValido(corpo, req.headers.get("Authorization"), lk.apiKey, lk.apiSecret);
  if (!ok) return json({ error: "assinatura inválida" }, 401);

  let ev: any;
  try {
    ev = JSON.parse(corpo);
  } catch {
    return json({ error: "json" }, 400);
  }

  const egress = ev.egressInfo ?? ev.egress_info;
  if (egress && (ev.event === "egress_ended" || ev.event === "egress_updated")) {
    const id = egress.egressId ?? egress.egress_id;
    const status = String(egress.status ?? "");
    const resultados: StreamResultado[] = egress.streamResults ?? egress.stream_results ?? [];
    if (id && resultados.length) {
      const { data: salaDoStream } = await db.from("live_rooms").select("id").eq("egress_id", id).maybeSingle();
      if (salaDoStream) await marcarSaidasQueCairam(salaDoStream.id, resultados).catch((e) => console.error("webhook: saídas", e instanceof Error ? e.name : "erro"));
    }
    const terminou = ev.event === "egress_ended" || /COMPLETE|FAILED|ABORTED|LIMIT_REACHED/.test(status);
    if (id && terminou) {
      const erro = /FAILED|ABORTED|LIMIT/.test(status) ? `egress ${status}: ${String(egress.error ?? "").slice(0, 200)}` : null;
      const { data: sala } = await db.from("live_rooms").select("id").eq("egress_id", id).maybeSingle();
      if (sala) {
        await db.from("live_rooms").update({
          status: "encerrada", egress_id: null, encerrada_em: new Date().toISOString(), ultimo_erro: erro,
        }).eq("id", sala.id);
        await db.from("live_destinations").update({ no_ar: false }).eq("room_id", sala.id);
      }
      await db.from("live_rooms").update({ gravacao_egress_id: null, ...(erro ? { ultimo_erro: erro } : {}) }).eq("gravacao_egress_id", id);
    }
  }
  const ingress = ev.ingressInfo ?? ev.ingress_info;
  if (ingress && ev.event === "ingress_ended") {
    const id = ingress.ingressId ?? ingress.ingress_id;
    const { data: sala } = id
      ? await db.from("live_rooms").select("id, status, aula_encerrar_ao_fim").eq("aula_ingress_id", id).maybeSingle()
      : { data: null };
    // só o ingress ATUAL da sala: troca/parada de vídeo zera aula_ingress_id antes de apagar o antigo, então o
    // ingress_ended dele não acha sala aqui e não encerra nada
    if (sala) {
      const limpar = () => db.from("live_rooms").update({
        aula_ingress_id: null, aula_identity: null, aula_tocando_video: null, aula_tocando_desde: null,
        aula_palco_auto: false, aula_encerrar_ao_fim: false,
      }).eq("id", sala.id).eq("aula_ingress_id", id);
      if (sala.aula_encerrar_ao_fim && sala.status === "ao_vivo") {
        const r = await chamarFuncaoLives(db, "live-control", { acao: "encerrar", room_id: sala.id }).catch(() => null);
        if (r?.ok) await limpar();
        // falhou: o estado fica (encerrar ao fim + tocando desde) e o tick da agenda tenta de novo ao passar do fim
        else await db.from("live_rooms").update({ agenda_erro: "o vídeo acabou mas não consegui encerrar a live: tento de novo em 1 min (ou encerre no estúdio)" }).eq("id", sala.id);
      } else {
        await limpar();
      }
    }
  }

  const part = ev.participant;
  const salaLk = ev.room?.name;
  if (ev.event === "participant_joined" && part && salaLk && ehParticipanteAula(part.identity)) {
    const { data: sala } = await db.from("live_rooms").select("id, aula_palco_auto, aula_identity").eq("livekit_room", salaLk).maybeSingle();
    if (sala?.aula_palco_auto && sala.aula_identity === part.identity) {
      await atualizarAtributos(salaLk, part.identity, { stage: "1", stage_ordem: "0" }).catch(() => null);
    }
  }
  return json({ ok: true });
});
