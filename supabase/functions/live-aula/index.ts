// Vídeo da aula + live programada (verify_jwt = false; confere aqui dentro).
//
// Portas:
//  - a tela (JWT de usuário com módulo lives):
//      video-criar     { nome, bytes, duracao_seg?, room_id? } -> linha em live_videos + token de upload (24 h)
//                      pro servidor de aulas da VPS (https://livekit.../aulas/up/<id>, em pedaços)
//      video-concluir  { video_id } -> a função pede /aulas/fim (ffprobe) e marca pronto, convertendo (+ progresso) ou erro
//      video-apagar    { video_id } -> apaga na VPS e no banco (recusa se estiver tocando ou programado)
//      video-tocar     { room_id, video_id, palco?, encerrar_ao_fim? } -> Ingress URL_INPUT ("Vídeo da aula")
//      video-parar     { room_id }
//      programar       { room_id, agendada_em, auto_iniciar?, aula_video_id?, titulo?, descricao?, privacidade?,
//                        playlist_id?, miniatura?: {base64, mime} } -> data na sala + live programada no YouTube
//                        (cada destino YouTube conectado e ligado) com link youtu.be
//      cancelar-programacao { room_id }
//      reprisar        { room_id, agendada_em | datas[] | recorrencia{frequencia_dias, inicio, ate|quantidade|continua}, sufixo_data?,
//                        ... } -> uma sala nova por data (cena, banners, YouTube, vídeo), no máximo 30; cota do YouTube
//                        acabou = cria o que deu e devolve `faltaram`. Contínua: série em live_reprise_series (rolamento no tick)
//      reprises        { room_id } -> reprises desta live (data, link, estado) e séries contínuas ativas
//      reprise-cancelar { room_id da reprise } · reprises-cancelar-futuras { room_id da origem } (também para a série)
//      yt-playlists    { yt_conta_id }
//      semana-criar    { room_id (modelo: cena, banners, canal), nome, privacidade, playlist_id? } -> playlist nova
//                      (ou a escolhida) + live_semanas; semana-aula { semana_id, ordem, titulo, video_id, agendada_em,
//                      miniatura? } uma por chamada, na ordem (idempotente por semana+ordem); semanas { room_id };
//                      semana-cancelar { semana_id, apagar_playlist? }
//  - pg_cron (public.live_agenda_tick, header x-live-segredo): tick -> na hora agendada, com vídeo e "iniciar
//    sozinho", toca o vídeo no palco PRIMEIRO, espera ele publicar imagem e só então liga a transmissão
//    (live-control ir-ao-vivo): o YouTube nunca recebe palco vazio; sem vídeo, só
//    marca o aviso no painel. Rede de segurança do fim do vídeo e do auto start do YouTube.
import {
  apagarIngress, atualizarAtributos, criarIngress, envLiveKit, ErroLiveKit, listarParticipantes,
} from "../_shared/livekitApi.ts";
import {
  baseAulasPublica, corpoCriarIngress, decidirTick, haHumanoNoEstudio, ESPERA_VIDEO_PUBLICAR_MS, idVideoValido, lerMiniatura, MAX_BYTES_AULA, PASSO_ESPERA_VIDEO_MS, videoAulaPublicado,
  lerFimAula, quandoProgramavel, type SalaAgenda, tokenAula, urlArquivoLocal,
} from "../_shared/aulaVideo.ts";
import { ErroGoogle, PRIVACIDADES, type Privacidade } from "../_shared/youtube.ts";
import {
  apagarPlaylistDaConta, cancelarProgramacaoYt, criarPlaylistDaConta, playlistsDaConta, programarDestinoYt, type ResultadoProgramacao,
} from "../_shared/youtubeDb.ts";
import { linkPlaylist, MAX_AULAS } from "../_shared/semanaAulas.ts";
import { admin, chamadaDaAgenda, chamarFuncaoLives, corpoJson, corsHeaders, json, usuarioLives } from "../_shared/livesHttp.ts";
import { segredoLive } from "../_shared/liveSegredo.ts";
import { garantirDestinoYt } from "../_shared/destinoYtAuto.ts";
import {
  cancelarVarias, criarLote, type DepsRolamento, ehErroCota, ErroCotaReprise, estadoReprise, estimarCota, formatarBrt, lerPedidoReprise,
  type PedidoReprise, podeCancelarReprise, type ResultadoUma, rolarSerie, type SalaReprise, type SerieReprise, tituloComSufixo,
} from "../_shared/reprises.ts";

const db = admin();
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/rtmps?:\/\/[^\s"']+/gi, "rtmp://[oculto]").slice(0, 300);

async function carregarSala(id: unknown) {
  if (typeof id !== "string") return null;
  const { data } = await db.from("live_rooms").select("*").eq("id", id).maybeSingle();
  return data;
}

async function servidorAulas(caminho: string, metodo: string, token: string) {
  const { url } = await envLiveKit();
  const r = await fetch(`${baseAulasPublica(url)}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90_000),
  });
  const dados = await r.json().catch(() => ({}));
  return { status: r.status, dados: dados as Record<string, unknown> };
}

// ------------------------------------------------------------------ vídeo no palco

// O banco solta o Ingress ANTES de apagá-lo: o ingress_ended que o LiveKit manda ao apagar não casa mais com
// aula_ingress_id (o webhook só age no ingress atual) e não encerra a live por causa do "encerrar ao fim" antigo.
async function pararVideo(sala: Record<string, unknown>) {
  await db.from("live_rooms").update({
    aula_ingress_id: null, aula_identity: null, aula_tocando_video: null, aula_tocando_desde: null,
    aula_palco_auto: false, aula_encerrar_ao_fim: false,
  }).eq("id", sala.id);
  if (sala.aula_ingress_id) await apagarIngress(String(sala.aula_ingress_id)).catch(() => null);
}

async function tocarVideo(sala: Record<string, unknown>, videoId: string, o: { palco: boolean; encerrarAoFim: boolean }) {
  const { data: v } = await db.from("live_videos").select("*").eq("id", videoId).maybeSingle();
  if (!v) throw new ErroLiveKit(404, "vídeo não encontrado");
  if (v.status !== "pronto") throw new ErroLiveKit(409, "o vídeo ainda não terminou de subir");
  if (sala.aula_ingress_id) {
    // troca de vídeo: solta o antigo no banco antes de apagar (ver pararVideo)
    await db.from("live_rooms").update({ aula_ingress_id: null, aula_encerrar_ao_fim: false, aula_tocando_desde: null }).eq("id", sala.id);
    await apagarIngress(String(sala.aula_ingress_id)).catch(() => null);
  }
  const { apiSecret } = await envLiveKit();
  const dur = Number(v.duracao_seg) || 3600;
  // token de leitura vale a duração do vídeo + 2 h (o Ingress pede pedaços com Range até o fim)
  const t = await tokenAula({ apiSecret, videoId, escopo: "ler", ttlSeg: Math.ceil(dur) + 7200 });
  const corpo = corpoCriarIngress({ sala: String(sala.livekit_room), videoId, url: urlArquivoLocal(videoId, t), nomeArquivo: v.nome });
  const ing = await criarIngress(corpo);
  await db.from("live_rooms").update({
    aula_ingress_id: ing.ingress_id ?? ing.ingressId ?? null,
    aula_identity: corpo.participant_identity,
    aula_tocando_video: videoId,
    aula_tocando_desde: new Date().toISOString(),
    aula_palco_auto: o.palco,
    aula_encerrar_ao_fim: o.encerrarAoFim,
  }).eq("id", sala.id);
  // o participante entra em ~1 s; o webhook (participant_joined) também põe no palco se aula_palco_auto
  if (o.palco) {
    for (let i = 0; i < 6; i++) {
      await dormir(1500);
      const ok = await atualizarAtributos(String(sala.livekit_room), corpo.participant_identity, { stage: "1", stage_ordem: "0" }).then(() => true).catch(() => false);
      if (ok) break;
    }
  }
  return { ingress_id: ing.ingress_id ?? ing.ingressId ?? null, identity: corpo.participant_identity, duracao_seg: v.duracao_seg };
}

// ------------------------------------------------------------------ programação

type DadosProgramacao = {
  quando: Date;
  autoIniciar: boolean;
  videoId: string | null;
  titulo?: string;
  descricao?: string;
  privacidade?: Privacidade;
  playlistId?: string | null;
  miniatura?: { bytes: Uint8Array; mime: string } | null;
};

function lerProgramacao(b: Record<string, unknown>): { ok: true; d: DadosProgramacao } | { ok: false; motivo: string } {
  const q = quandoProgramavel(b.agendada_em, new Date());
  if (!q.ok) return q;
  const videoId = b.aula_video_id == null || b.aula_video_id === "" ? null : String(b.aula_video_id);
  if (videoId && !idVideoValido(videoId)) return { ok: false, motivo: "vídeo inválido" };
  const autoIniciar = b.auto_iniciar === true;
  if (autoIniciar && !videoId) return { ok: false, motivo: "para iniciar sozinho, escolha o vídeo da aula" };
  const priv = b.privacidade == null ? undefined : String(b.privacidade);
  if (priv && !PRIVACIDADES.includes(priv as Privacidade)) return { ok: false, motivo: "privacidade inválida" };
  const playlistId = b.playlist_id ? String(b.playlist_id) : null;
  if (playlistId && !/^[A-Za-z0-9_-]{10,64}$/.test(playlistId)) return { ok: false, motivo: "playlist inválida" };
  const mini = lerMiniatura(b.miniatura);
  if (mini && !mini.ok) return { ok: false, motivo: mini.motivo };
  const titulo = b.titulo == null ? undefined : String(b.titulo).replace(/[<>]/g, "").trim().slice(0, 100);
  const descricao = b.descricao == null ? undefined : String(b.descricao).replace(/[<>]/g, "").slice(0, 5000);
  return {
    ok: true,
    d: { quando: q.quando, autoIniciar, videoId, titulo: titulo || undefined, descricao, privacidade: priv as Privacidade | undefined, playlistId, miniatura: mini && mini.ok ? mini : null },
  };
}

async function programarSala(sala: Record<string, unknown>, d: DadosProgramacao) {
  if (sala.status === "ao_vivo") throw new ErroLiveKit(409, "a live está no ar: encerre antes de programar");
  if (d.videoId) {
    const { data: v } = await db.from("live_videos").select("id, status").eq("id", d.videoId).maybeSingle();
    if (!v || v.status !== "pronto") throw new ErroLiveKit(409, "o vídeo escolhido ainda não está pronto");
  }
  const { error } = await db.from("live_rooms").update({
    agendada_em: d.quando.toISOString(),
    auto_iniciar: d.autoIniciar,
    aula_video_id: d.videoId,
    agenda_processada_em: null,
    agenda_aviso_em: null,
    agenda_erro: null,
    ...(d.descricao !== undefined ? { descricao: d.descricao || null } : {}),
  }).eq("id", sala.id);
  if (error) throw new ErroLiveKit(400, error.message);

  const { data: dests } = await db.from("live_destinations").select("*").eq("room_id", sala.id).eq("modo", "youtube_api").eq("ativo", true);
  const links: ResultadoProgramacao[] = [];
  const avisos: string[] = [];
  let cota = false;
  if (!dests?.length) avisos.push("sem canal do YouTube conectado e ligado nesta live: ficou só no painel (conecte em Destinos e programe de novo para gerar o link)");
  const seg = dests?.length ? await segredoLive(db) : "";
  for (const dest of dests ?? []) {
    const atual = {
      ...dest,
      yt_titulo: d.titulo ?? dest.yt_titulo,
      yt_descricao: d.descricao ?? dest.yt_descricao,
      yt_privacidade: d.privacidade ?? dest.yt_privacidade ?? "unlisted",
    };
    if (d.titulo || d.descricao !== undefined || d.privacidade) {
      await db.from("live_destinations").update({ yt_titulo: atual.yt_titulo, yt_descricao: atual.yt_descricao, yt_privacidade: atual.yt_privacidade }).eq("id", dest.id);
    }
    try {
      const r = await programarDestinoYt(db, atual, seg, d.quando, { miniatura: d.miniatura, playlistId: d.playlistId });
      links.push(r);
      avisos.push(...r.avisos.map((a) => `${dest.nome}: ${a}`));
    } catch (e) {
      const m = msg(e);
      if (e instanceof ErroGoogle && ehErroCota(e.razao)) cota = true;
      avisos.push(`${dest.nome}: ${m}`);
      await db.from("live_destinations").update({ yt_estado: "erro", yt_erro: `programar: ${m}` }).eq("id", dest.id);
    }
  }
  return { links: links.map(({ destino_id, nome, video_id, link }) => ({ destino_id, nome, video_id, link })), avisos, cota };
}

// ------------------------------------------------------------------ reprises (uma, lote, recorrência, rolamento)

/** A data já tem reprise nesta série (índice único série+data): não é erro, só não cria de novo. */
class ErroRepetida extends Error {}

/**
 * Uma reprise: sala nova (cena, banners, YouTube conectado, vídeo) programada em `quando`. Se o YouTube recusar por
 * cota, desfaz a sala (não deixa live sem link no painel) e levanta ErroCotaReprise para o lote parar.
 */
async function criarReprise(
  origem: Record<string, unknown>,
  d: DadosProgramacao,
  o: { quando: Date; serieId?: string | null; sufixo: boolean; tituloSala?: string; semana?: { id: string; ordem: number }; contaYt?: string | null },
): Promise<ResultadoUma> {
  const tituloSala = o.tituloSala ?? (o.sufixo ? tituloComSufixo(String(origem.titulo ?? "Reprise"), o.quando, 160) : origem.titulo);
  const base = { owner_id: origem.owner_id, titulo: tituloSala, layout: origem.layout, cor: origem.cor, descricao: origem.descricao ?? null };
  let ins = await db.from("live_rooms").insert({
    ...base, agendada_em: o.quando.toISOString(),
    // aula de semana não entra na lista de reprises da origem: fica na lista da semana
    ...(o.semana ? { semana_id: o.semana.id, semana_ordem: o.semana.ordem } : { reprise_de: origem.id, reprise_serie_id: o.serieId ?? null }),
  }).select("*").single();
  // migração 20261110100000 ainda não rodou: a reprise avulsa segue como antes (sem a lista de reprises)
  if (ins.error?.code === "42703" && !o.serieId && !o.semana) ins = await db.from("live_rooms").insert(base).select("*").single();
  if (ins.error?.code === "23505") throw new ErroRepetida(`${formatarBrt(o.quando)}: já existe nesta ${o.semana ? "semana" : "série"}`);
  if (ins.error) throw new ErroLiveKit(400, ins.error.message);
  const nova = ins.data;
  try {
    const { data: ovs } = await db.from("live_overlays").select("tipo, conteudo, visivel, ordem").eq("room_id", origem.id);
    if (ovs?.length) await db.from("live_overlays").insert(ovs.map((x: Record<string, unknown>) => ({ ...x, room_id: nova.id })));
    // só o YouTube conectado (sem chave colada): o broadcast novo nasce no programar
    const { data: todos } = await db.from("live_destinations").select("*").eq("room_id", origem.id).eq("modo", "youtube_api");
    // canal escolhido: só o destino daquele canal (a playlist e a programação vão pra ele)
    const yts = o.contaYt ? (todos ?? []).filter((y: { yt_conta_id: string | null }) => y.yt_conta_id === o.contaYt) : todos;
    for (const y of yts ?? []) {
      await db.from("live_destinations").insert({
        room_id: nova.id, tipo: "youtube", modo: "youtube_api", nome: y.nome, rtmp_url: y.rtmp_url, chave_final: "conta conectada",
        yt_conta_id: y.yt_conta_id, yt_titulo: y.yt_titulo, yt_descricao: y.yt_descricao, yt_privacidade: y.yt_privacidade,
        yt_playlist_id: null, ativo: y.ativo,
      });
    }
    // a live de origem não tinha YouTube: a reprise já nasce com o canal conectado (Não listado)
    if (!yts?.length) await garantirDestinoYt(db, nova, { contaId: o.contaYt ?? null }).catch(() => null);
    const tituloYt = d.titulo ?? (yts?.[0]?.yt_titulo as string | undefined) ?? String(origem.titulo ?? "");
    const r = await programarSala(nova, {
      ...d,
      quando: o.quando,
      titulo: o.sufixo && tituloYt ? tituloComSufixo(tituloYt, o.quando, 100) : d.titulo,
      videoId: d.videoId ?? (origem.aula_video_id as string | null) ?? null,
      playlistId: d.playlistId ?? (yts?.[0]?.yt_playlist_id ?? null),
    });
    if (r.cota && !r.links.length) throw new ErroCotaReprise(`${formatarBrt(o.quando)}: cota diária do YouTube esgotada (volta à meia-noite do Pacífico, ~4h/5h de Brasília)`);
    return { room_id: nova.id, links: r.links, avisos: r.avisos };
  } catch (e) {
    await db.from("live_rooms").delete().eq("id", nova.id); // destinos e banners saem em cascata
    throw e;
  }
}

const configDaSerie = (d: DadosProgramacao, sufixo: boolean, contaYt: string | null) => ({
  yt_conta_id: contaYt,
  auto_iniciar: d.autoIniciar, aula_video_id: d.videoId, titulo: d.titulo ?? null, descricao: d.descricao ?? null,
  privacidade: d.privacidade ?? null, playlist_id: d.playlistId ?? null, sufixo_data: sufixo,
});

function dadosDaSerie(cfg: Record<string, unknown>, quando: Date): DadosProgramacao {
  return {
    quando,
    autoIniciar: cfg.auto_iniciar === true && !!cfg.aula_video_id,
    videoId: (cfg.aula_video_id as string | null) ?? null,
    titulo: (cfg.titulo as string | null) ?? undefined,
    descricao: (cfg.descricao as string | null) ?? undefined,
    privacidade: (cfg.privacidade as Privacidade | null) ?? undefined,
    playlistId: (cfg.playlist_id as string | null) ?? null,
    miniatura: null, // a miniatura vale só para as criadas na tela (não guardamos a imagem)
  };
}

async function reprisarLote(origem: Record<string, unknown>, d: DadosProgramacao, p: PedidoReprise, ownerId: string, contaYt: string | null) {
  let serieId: string | null = null;
  if (p.serie) {
    const { data: s, error } = await db.from("live_reprise_series").insert({
      owner_id: ownerId, room_origem_id: origem.id, frequencia_dias: p.serie.frequenciaDias, proxima_em: p.serie.proximaEm.toISOString(),
      janela: p.serie.janela, config: configDaSerie(d, p.sufixoData, contaYt),
    }).select("id").single();
    if (error) throw new ErroLiveKit(400, `recorrência contínua: ${error.message} (rodou a migração 20261110100000?)`);
    serieId = s.id;
  }
  const lote = await criarLote(p.datas, (q) => criarReprise(origem, d, { quando: q, serieId, sufixo: p.sufixoData, contaYt }));
  if (serieId && !lote.criadas.length) {
    // nada saiu: não deixa série órfã rolando sozinha (quem programou vê o erro e tenta de novo)
    await db.from("live_reprise_series").delete().eq("id", serieId);
    serieId = null;
  } else if (serieId && lote.faltaram.length) {
    // o que faltou na contínua o tick tenta de novo (depois de 1 h): o ponteiro volta para a primeira que faltou
    await db.from("live_reprise_series").update({
      proxima_em: lote.faltaram[0].agendada_em, tentar_depois: new Date(Date.now() + 3_600_000).toISOString(), ultimo_erro: lote.faltaram[0].motivo,
    }).eq("id", serieId);
  }
  const destinos = Math.max(1, lote.criadas[0]?.links.length ?? 1);
  return {
    room_id: lote.criadas[0]?.room_id ?? null,
    links: lote.criadas[0]?.links ?? [],
    criadas: lote.criadas,
    faltaram: lote.faltaram,
    avisos: lote.avisos,
    serie_id: serieId,
    cota_esgotou: lote.cotaEsgotou,
    cota_unidades: estimarCota(lote.criadas.length, { miniatura: !!d.miniatura, playlist: !!d.playlistId, destinos }).unidades,
  };
}

const CAMPOS_REPRISE = "id, titulo, status, agendada_em, reprise_cancelada_em, agenda_processada_em, agenda_erro, reprise_serie_id";

async function listarReprises(origemId: string) {
  const agora = new Date();
  const { data: salas, error } = await db.from("live_rooms").select(CAMPOS_REPRISE).eq("reprise_de", origemId).order("agendada_em", { ascending: true }).limit(200);
  if (error) throw new ErroLiveKit(400, `${error.message} (rodou a migração 20261110100000?)`);
  const ids = (salas ?? []).map((s: { id: string }) => s.id);
  const { data: dests } = ids.length
    ? await db.from("live_destinations").select("room_id, nome, yt_video_id, yt_estado, yt_erro").in("room_id", ids).eq("modo", "youtube_api")
    : { data: [] };
  const { data: series } = await db.from("live_reprise_series").select("id, frequencia_dias, proxima_em, janela, ativa, tentar_depois, ultimo_erro").eq("room_origem_id", origemId).eq("ativa", true);
  const reprises = (salas ?? []).map((s: SalaReprise & { titulo: string; reprise_serie_id: string | null }) => {
    const d = (dests ?? []).find((x: { room_id: string }) => x.room_id === s.id) as { yt_video_id?: string; yt_estado?: string; yt_erro?: string } | undefined;
    return {
      id: s.id, titulo: s.titulo, agendada_em: s.agendada_em, status: s.status, serie_id: s.reprise_serie_id,
      estado: estadoReprise(s, agora, d?.yt_estado), erro: s.agenda_erro ?? d?.yt_erro ?? null,
      link: d?.yt_video_id && !s.reprise_cancelada_em ? `https://youtu.be/${d.yt_video_id}` : null,
      pode_cancelar: podeCancelarReprise(s, agora),
    };
  });
  return { reprises, series: series ?? [] };
}

/** Cancela uma reprise: apaga a live programada no YouTube e tira da agenda (a sala fica marcada como cancelada). */
async function cancelarReprise(s: SalaReprise): Promise<string | null> {
  const { data: dests } = await db.from("live_destinations").select("*").eq("room_id", s.id).eq("modo", "youtube_api");
  const seg = dests?.length ? await segredoLive(db) : "";
  const erros = (await Promise.all((dests ?? []).map((x) => cancelarProgramacaoYt(db, x, seg)))).filter(Boolean);
  const agora = new Date().toISOString();
  // agenda_processada_em: o tick não inicia; a data fica para a lista (e ocupa a vaga dela na série)
  const { error } = await db.from("live_rooms").update({ reprise_cancelada_em: agora, agenda_processada_em: agora, auto_iniciar: false })
    .eq("id", s.id).eq("status", "rascunho");
  if (error) throw new Error(error.message);
  return erros.length ? `${s.agendada_em ? formatarBrt(s.agendada_em) : s.id}: YouTube: ${erros.join("; ")}` : null;
}


// ------------------------------------------------------------------ semana de aulas (playlist + 6 lives)

/** yt_conta_id do corpo (canal escolhido na tela), se for um uuid; senão null (= canal da live / padrão). */
const contaEscolhida = (b: Record<string, unknown>) => (typeof b.yt_conta_id === "string" && /^[0-9a-f-]{36}$/i.test(b.yt_conta_id) ? b.yt_conta_id : null);

async function contaYtDaOrigem(origem: Record<string, unknown>, escolhida: string | null): Promise<string | null> {
  if (escolhida) {
    const { data: c } = await db.from("yt_contas").select("id, status").eq("id", escolhida).maybeSingle();
    if (!c || c.status !== "conectado") throw new ErroLiveKit(400, "o canal do YouTube escolhido não está conectado");
    return c.id;
  }
  await garantirDestinoYt(db, origem as { id: string; titulo?: string; status?: string }).catch(() => null);
  const { data } = await db.from("live_destinations").select("yt_conta_id, ativo").eq("room_id", origem.id).eq("modo", "youtube_api").order("created_at");
  const d = (data ?? []).find((x: { ativo: boolean; yt_conta_id: string | null }) => x.ativo && x.yt_conta_id) ?? (data ?? [])[0];
  return (d?.yt_conta_id as string | null) ?? null;
}

async function semanaCriar(origem: Record<string, unknown>, b: Record<string, unknown>, ownerId: string) {
  const nome = String(b.nome ?? "").replace(/[<>]/g, "").trim().slice(0, 150);
  if (!nome) throw new ErroLiveKit(400, "dê um nome para a semana (vira o nome da playlist)");
  const priv = String(b.privacidade ?? "unlisted") as Privacidade;
  if (!PRIVACIDADES.includes(priv)) throw new ErroLiveKit(400, "privacidade inválida");
  const contaId = await contaYtDaOrigem(origem, contaEscolhida(b));
  if (!contaId) throw new ErroLiveKit(400, "conecte o canal do YouTube (aba Destinos) para programar a semana na playlist");
  let playlistId = b.playlist_id ? String(b.playlist_id) : null;
  if (playlistId && !/^[A-Za-z0-9_-]{10,64}$/.test(playlistId)) throw new ErroLiveKit(400, "playlist inválida");
  const criada = !playlistId;
  if (!playlistId) playlistId = (await criarPlaylistDaConta(db, contaId, await segredoLive(db), nome, priv)).id;
  const { data, error } = await db.from("live_semanas").insert({
    owner_id: ownerId, room_origem_id: origem.id, nome, privacidade: priv, yt_conta_id: contaId, playlist_id: playlistId, playlist_criada: criada,
  }).select("id").single();
  if (error) {
    if (criada) await apagarPlaylistDaConta(db, contaId, await segredoLive(db), playlistId).catch(() => null);
    throw new ErroLiveKit(400, `${error.message} (rodou a migração 20261110110000?)`);
  }
  return { semana_id: data.id, playlist_id: playlistId, playlist_link: linkPlaylist(playlistId), playlist_criada: criada };
}

async function semanaAula(b: Record<string, unknown>) {
  const { data: sem } = await db.from("live_semanas").select("*").eq("id", String(b.semana_id ?? "")).maybeSingle();
  if (!sem || sem.cancelada_em) throw new ErroLiveKit(404, "semana não encontrada (ou cancelada)");
  const ordem = Math.trunc(Number(b.ordem));
  if (!(ordem >= 1 && ordem <= MAX_AULAS)) throw new ErroLiveKit(400, "ordem da aula inválida");
  // idempotente: a aula já criada (e não cancelada) volta como está
  const { data: ja } = await db.from("live_rooms").select("id").eq("semana_id", sem.id).eq("semana_ordem", ordem).is("reprise_cancelada_em", null).maybeSingle();
  if (ja) {
    const { data: d } = await db.from("live_destinations").select("yt_video_id").eq("room_id", ja.id).eq("modo", "youtube_api").maybeSingle();
    return { room_id: ja.id, link: d?.yt_video_id ? `https://youtu.be/${d.yt_video_id}` : null, ja_existia: true, avisos: [] as string[] };
  }
  const titulo = String(b.titulo ?? "").replace(/[<>]/g, "").trim().slice(0, 100);
  if (!titulo) throw new ErroLiveKit(400, `aula ${ordem}: falta o título`);
  const p = lerProgramacao({
    agendada_em: b.agendada_em, aula_video_id: b.video_id, auto_iniciar: true, titulo, descricao: b.descricao ?? undefined,
    privacidade: sem.privacidade, playlist_id: sem.playlist_id, miniatura: b.miniatura ?? null,
  });
  if (!p.ok) throw new ErroLiveKit(400, `aula ${ordem}: ${p.motivo}`);
  if (!p.d.videoId) throw new ErroLiveKit(400, `aula ${ordem}: escolha o vídeo da aula`);
  const origem = await carregarSala(sem.room_origem_id);
  if (!origem) throw new ErroLiveKit(404, "a live de origem da semana foi apagada");
  try {
    const r = await criarReprise(origem, p.d, { quando: p.d.quando, sufixo: false, tituloSala: titulo, semana: { id: sem.id, ordem }, contaYt: sem.yt_conta_id ?? null });
    return { room_id: r.room_id, link: r.links[0]?.link ?? null, ja_existia: false, avisos: r.avisos };
  } catch (e) {
    if (e instanceof ErroCotaReprise) throw new ErroLiveKit(429, e.message);
    if (e instanceof ErroRepetida) return semanaAula(b); // outra chamada criou no mesmo instante
    throw e;
  }
}

async function listarSemanas(origemId: string) {
  const agora = new Date();
  const { data: semanas, error } = await db.from("live_semanas").select("*").eq("room_origem_id", origemId).is("cancelada_em", null).order("criada_em", { ascending: false }).limit(20);
  if (error) throw new ErroLiveKit(400, `${error.message} (rodou a migração 20261110110000?)`);
  const ids = (semanas ?? []).map((x: { id: string }) => x.id);
  const { data: salas } = ids.length
    ? await db.from("live_rooms").select(`${CAMPOS_REPRISE}, semana_id, semana_ordem, aula_video_id`).in("semana_id", ids).order("semana_ordem")
    : { data: [] };
  const sids = (salas ?? []).map((x: { id: string }) => x.id);
  const { data: dests } = sids.length
    ? await db.from("live_destinations").select("room_id, yt_video_id, yt_estado, yt_erro").in("room_id", sids).eq("modo", "youtube_api")
    : { data: [] };
  return (semanas ?? []).map((sem: Record<string, unknown>) => ({
    id: sem.id, nome: sem.nome, privacidade: sem.privacidade, playlist_id: sem.playlist_id, playlist_criada: sem.playlist_criada,
    playlist_link: sem.playlist_id ? linkPlaylist(String(sem.playlist_id)) : null,
    aulas: (salas ?? []).filter((x: { semana_id: string }) => x.semana_id === sem.id).map((x: SalaReprise & { titulo: string; semana_ordem: number; aula_video_id: string | null }) => {
      const d = (dests ?? []).find((y: { room_id: string }) => y.room_id === x.id) as { yt_video_id?: string; yt_estado?: string; yt_erro?: string } | undefined;
      return {
        id: x.id, ordem: x.semana_ordem, titulo: x.titulo, agendada_em: x.agendada_em, video_id: x.aula_video_id,
        estado: estadoReprise(x, agora, d?.yt_estado), erro: x.agenda_erro ?? d?.yt_erro ?? null,
        link: d?.yt_video_id && !x.reprise_cancelada_em ? `https://youtu.be/${d.yt_video_id}` : null, pode_cancelar: podeCancelarReprise(x, agora),
      };
    }),
  }));
}

async function semanaCancelar(b: Record<string, unknown>) {
  const { data: sem } = await db.from("live_semanas").select("*").eq("id", String(b.semana_id ?? "")).maybeSingle();
  if (!sem) throw new ErroLiveKit(404, "semana não encontrada");
  const { data: salas } = await db.from("live_rooms").select(CAMPOS_REPRISE).eq("semana_id", sem.id);
  const r = await cancelarVarias((salas ?? []) as SalaReprise[], new Date(), cancelarReprise);
  const avisos = [...r.avisos];
  let playlistApagada = false;
  if (b.apagar_playlist === true && sem.playlist_id) {
    if (!sem.playlist_criada) avisos.push("a playlist não foi criada pelo CRM (era uma existente): ficou no canal");
    else if (sem.yt_conta_id) {
      try {
        await apagarPlaylistDaConta(db, sem.yt_conta_id, await segredoLive(db), sem.playlist_id);
        playlistApagada = true;
      } catch (e) {
        avisos.push(`playlist: ${msg(e)}`);
      }
    }
  }
  await db.from("live_semanas").update({ cancelada_em: new Date().toISOString() }).eq("id", sem.id);
  return { canceladas: r.canceladas, playlist_apagada: playlistApagada, avisos };
}

async function rolarSeries(agora: Date) {
  const { data: series } = await db.from("live_reprise_series").select("*").eq("ativa", true)
    .or(`tentar_depois.is.null,tentar_depois.lte.${agora.toISOString()}`).limit(20);
  const feito: Record<string, unknown> = {};
  const deps: DepsRolamento = {
    contarFuturasAtivas: async (id) => {
      const { count } = await db.from("live_rooms").select("id", { count: "exact", head: true })
        .eq("reprise_serie_id", id).is("reprise_cancelada_em", null).gt("agendada_em", agora.toISOString());
      return count ?? 0;
    },
    reivindicar: async (id, antiga, nova) => {
      const { data } = await db.from("live_reprise_series")
        .update({ proxima_em: nova, tentar_depois: null, ultimo_erro: null, atualizada_em: new Date().toISOString() })
        .eq("id", id).eq("proxima_em", antiga).select("id");
      return !!data?.length;
    },
    criar: async (s, quando) => {
      const serie = s as SerieReprise & { room_origem_id: string; config: Record<string, unknown> };
      const origem = await carregarSala(serie.room_origem_id);
      if (!origem) {
        await db.from("live_reprise_series").update({ ativa: false, ultimo_erro: "a live de origem foi apagada" }).eq("id", s.id);
        return false;
      }
      try {
        await criarReprise(origem, dadosDaSerie(serie.config ?? {}, quando), {
          quando, serieId: s.id, sufixo: serie.config?.sufixo_data === true, contaYt: (serie.config?.yt_conta_id as string | null) ?? null,
        });
        return true;
      } catch (e) {
        if (e instanceof ErroRepetida) return false;
        throw e;
      }
    },
    devolver: async (id, deAgora, para, erro) => {
      await db.from("live_reprise_series").update({ proxima_em: para }).eq("id", id).eq("proxima_em", deAgora);
      await db.from("live_reprise_series").update({ tentar_depois: new Date(Date.now() + 3_600_000).toISOString(), ultimo_erro: erro, atualizada_em: new Date().toISOString() }).eq("id", id);
    },
  };
  for (const s of series ?? []) {
    const r = await rolarSerie(s as SerieReprise, agora, deps).catch((e) => ({ criadas: [], erro: msg(e) }));
    if (r.criadas.length || r.erro) feito[s.id] = r;
  }
  return feito;
}

// ------------------------------------------------------------------ tick

async function tick() {
  const agora = new Date();
  const { data: salas } = await db.from("live_rooms")
    .select("id, status, livekit_room, agendada_em, auto_iniciar, aula_video_id, agenda_processada_em, aula_tocando_desde, aula_tocando_video, aula_encerrar_ao_fim, aula_ingress_id, iniciada_em")
    .or(`and(agendada_em.lte.${new Date(agora.getTime() + 60_000).toISOString()},agenda_processada_em.is.null),status.eq.ao_vivo`)
    .limit(20);
  const feito: Record<string, unknown> = {};
  for (const s of salas ?? []) {
    let dur: number | null = null;
    if (s.aula_tocando_video) {
      const { data: v } = await db.from("live_videos").select("duracao_seg").eq("id", s.aula_tocando_video).maybeSingle();
      dur = v?.duracao_seg ? Number(v.duracao_seg) : null;
    }
    const dec = decidirTick({ ...(s as SalaAgenda), aula_duracao_seg: dur }, agora);
    let foiAoAr = false;
    let videoTocando = false;
    try {
      if (dec.acao === "avisar") {
        await db.from("live_rooms").update({ agenda_processada_em: agora.toISOString(), agenda_aviso_em: agora.toISOString() }).eq("id", s.id);
      } else if (dec.acao === "atrasada") {
        await db.from("live_rooms").update({ agenda_processada_em: agora.toISOString(), agenda_erro: "passou do horário sem iniciar (servidor ou agenda fora do ar): nada foi transmitido" }).eq("id", s.id);
      } else if (dec.acao === "iniciar") {
        // marca antes (o próximo tick não pode iniciar de novo enquanto este espera o vídeo)
        await db.from("live_rooms").update({ agenda_processada_em: agora.toISOString(), agenda_aviso_em: agora.toISOString() }).eq("id", s.id);
        // 1) vídeo PRIMEIRO, no palco: o YouTube nunca recebe palco vazio ("Ninguém no palco" por 20 s)
        const sala = await carregarSala(s.id);
        if (!sala) throw new Error("sala sumiu");
        const v = await tocarVideo(sala, String(s.aula_video_id), { palco: true, encerrarAoFim: false });
        videoTocando = true;
        // 2) espera o "Vídeo da aula" publicar imagem (teto ESPERA_VIDEO_PUBLICAR_MS; passou, liga mesmo assim)
        const publicou = await esperarVideoPublicar(String(s.livekit_room), v.identity);
        // 3) só então a transmissão
        const r = await chamarFuncaoLives(db, "live-control", { acao: "ir-ao-vivo", room_id: s.id });
        if (!r.ok) throw new Error(`não entrou no ar: ${String(r.dados.error ?? r.status)}`);
        foiAoAr = true;
        // no ar: agora o fim do vídeo encerra a live (antes disso o ingress_ended não pode encerrar nada)
        await db.from("live_rooms").update({ aula_encerrar_ao_fim: true, ...(publicou ? {} : { agenda_erro: "o vídeo demorou a aparecer: a live entrou no ar com tela preta até a imagem chegar" }) }).eq("id", s.id);
      } else if (dec.acao === "encerrar") {
        await encerrarLive(s);
      } else if (dec.acao === "conferir-orfa") {
        // no ar sem vídeo: só encerra se ninguém estiver no estúdio (lista falhou = não sabe = não encerra agora)
        const lista = await listarParticipantes(String(s.livekit_room))
          .catch((e) => (e instanceof ErroLiveKit && e.status === 404 ? { participants: [] } : null)); // sala já não existe = vazia
        if (lista && !haHumanoNoEstudio(lista.participants ?? [])) {
          await encerrarLive(s);
          await db.from("live_rooms").update({ agenda_erro: "a live programada ficou no ar sem vídeo e sem ninguém no estúdio: encerrei" }).eq("id", s.id);
          feito[s.id] = "encerrou-orfa";
          continue;
        }
        feito[s.id] = lista ? "orfa-com-humano" : "orfa-sem-lista";
        continue;
      } else if (s.status === "ao_vivo" && s.agenda_processada_em && agora.getTime() - new Date(s.agenda_processada_em).getTime() < 15 * 60_000) {
        // auto start do YouTube às vezes não vira: o youtube-status transiciona com o stream ativo
        await chamarFuncaoLives(db, "live-control", { acao: "youtube-status", room_id: s.id });
      }
      feito[s.id] = dec.acao;
    } catch (e) {
      feito[s.id] = `erro: ${msg(e)}`;
      let erro = msg(e);
      if (dec.acao === "iniciar" && videoTocando && !foiAoAr) {
        // o vídeo tocou mas a transmissão não subiu: tira o vídeo da sala (não fica rodando à toa)
        const sala = await carregarSala(s.id);
        if (sala) await pararVideo(sala).catch(() => null);
      }
      if (dec.acao === "iniciar" && foiAoAr) {
        // entrou no ar mas o vídeo não tocou: não deixa a live no ar vazia (se o encerrar falhar, a regra
        // conferir-orfa do próximo tick tenta de novo depois de ORFA_MS)
        const enc = await encerrarLive(s).then(() => true).catch(() => false);
        erro = `o vídeo não tocou (${erro}): ${enc ? "encerrei a live" : "não consegui encerrar a live, encerre no estúdio"}`;
      }
      await db.from("live_rooms").update({ agenda_erro: erro.slice(0, 500) }).eq("id", s.id);
    }
  }
  // recorrência contínua: cria a próxima reprise quando uma acontece ou é cancelada (idempotente)
  const series = await rolarSeries(agora).catch((e) => ({ erro: msg(e) }));
  return Object.keys(series).length ? { ...feito, series } : feito;
}

/** Espera o participante do vídeo publicar imagem (true) ou o teto passar (false). Lista que falha = tenta de novo. */
async function esperarVideoPublicar(sala: string, identity: string, teto = ESPERA_VIDEO_PUBLICAR_MS): Promise<boolean> {
  const fim = Date.now() + teto;
  while (Date.now() < fim) {
    const lista = await listarParticipantes(sala).catch(() => null);
    if (lista && videoAulaPublicado(lista.participants ?? [], identity)) return true;
    await dormir(PASSO_ESPERA_VIDEO_MS);
  }
  return false;
}

/** Encerra pelo live-control (Egress + YouTube); só limpa o estado do vídeo se o encerrar deu certo. */
async function encerrarLive(s: Record<string, unknown>) {
  const r = await chamarFuncaoLives(db, "live-control", { acao: "encerrar", room_id: s.id });
  if (!r.ok) throw new Error(`não consegui encerrar a live: ${String(r.dados.error ?? r.status)}`);
  await pararVideo(s);
}

// ------------------------------------------------------------------ HTTP

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método" }, 405);

  if (req.headers.has("x-live-segredo")) {
    if (!(await chamadaDaAgenda(req, db))) return json({ error: "Unauthorized" }, 401);
    try {
      return json({ ok: true, feito: await tick() });
    } catch (e) {
      return json({ error: msg(e) }, 500);
    }
  }

  const user = await usuarioLives(req);
  if (!user) return json({ error: "sem acesso ao módulo lives" }, 403);
  const b = await corpoJson(req, 3_000_000); // miniatura em base64 (até 2 MB)
  if (!b) return json({ error: "corpo inválido" }, 400);

  try {
    switch (b.acao) {
      case "video-criar": {
        const nome = String(b.nome ?? "").replace(/[<>]/g, "").trim().slice(0, 200) || "Aula";
        const bytes = Number(b.bytes);
        if (!Number.isFinite(bytes) || bytes <= 0) return json({ error: "tamanho do arquivo inválido" }, 400);
        if (bytes > MAX_BYTES_AULA) return json({ error: "arquivo acima de 8 GB" }, 400);
        const dur = Number(b.duracao_seg);
        const { data: v, error } = await db.from("live_videos").insert({
          owner_id: user.id, nome, bytes, duracao_seg: Number.isFinite(dur) && dur > 0 ? dur : null,
          room_id: typeof b.room_id === "string" && /^[0-9a-f-]{36}$/.test(b.room_id) ? b.room_id : null,
        }).select("*").single();
        if (error) return json({ error: error.message }, 400);
        const { url, apiSecret } = await envLiveKit();
        const token = await tokenAula({ apiSecret, videoId: v.id, escopo: "up", ttlSeg: 24 * 3600, maxBytes: bytes });
        return json({ ok: true, video: v, upload: { base: baseAulasPublica(url), token } });
      }

      case "video-concluir": {
        if (!idVideoValido(b.video_id)) return json({ error: "vídeo inválido" }, 400);
        const { apiSecret } = await envLiveKit();
        const t = await tokenAula({ apiSecret, videoId: b.video_id, escopo: "fim", ttlSeg: 600 });
        // também é o "como está a conversão?": o painel chama de novo a cada 10 s enquanto o vídeo estiver convertendo
        const r = await servidorAulas(`/fim/${b.video_id}`, "POST", t);
        const f = lerFimAula(r.status, r.dados);
        if (r.status !== 200 && r.status !== 202) {
          await db.from("live_videos").update({ status: "erro", erro: f.erro, updated_at: new Date().toISOString() }).eq("id", b.video_id);
          return json({ error: f.erro }, 400);
        }
        const { data: v, error } = await db.from("live_videos").update({
          status: f.status, erro: f.erro, ...f.campos, updated_at: new Date().toISOString(),
        }).eq("id", b.video_id).select("*").single();
        if (error) {
          const falta = /check|status/i.test(error.message) ? " (falta rodar a migração 20261112100100_lives_videos_convertendo)" : "";
          return json({ error: `não consegui registrar o vídeo: ${error.message}${falta}` }, 500);
        }
        return json({ ok: true, video: v, progresso: f.progresso });
      }

      case "video-apagar": {
        if (!idVideoValido(b.video_id)) return json({ error: "vídeo inválido" }, 400);
        const { data: usando } = await db.from("live_rooms").select("id, titulo, aula_tocando_video, agenda_processada_em, agendada_em")
          .or(`aula_tocando_video.eq.${b.video_id},aula_video_id.eq.${b.video_id}`);
        const bloqueio = (usando ?? []).find((s) => s.aula_tocando_video === b.video_id || (s.agendada_em && !s.agenda_processada_em));
        if (bloqueio) return json({ error: `em uso por "${bloqueio.titulo}" (tocando ou programado)` }, 409);
        const { apiSecret } = await envLiveKit();
        const t = await tokenAula({ apiSecret, videoId: b.video_id, escopo: "del", ttlSeg: 600 });
        const r = await servidorAulas(`/up/${b.video_id}`, "DELETE", t);
        if (r.status !== 200) return json({ error: `servidor de aulas respondeu ${r.status}` }, 502);
        await db.from("live_videos").delete().eq("id", b.video_id);
        return json({ ok: true });
      }

      case "semana-aula": {
        return json({ ok: true, ...(await semanaAula(b)) });
      }
      case "semana-cancelar": {
        return json({ ok: true, ...(await semanaCancelar(b)) });
      }

      case "yt-playlists": {
        if (typeof b.yt_conta_id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.yt_conta_id)) return json({ error: "conta inválida" }, 400);
        return json({ ok: true, playlists: await playlistsDaConta(db, b.yt_conta_id, await segredoLive(db)) });
      }
    }

    const sala = await carregarSala(b.room_id);
    if (!sala) return json({ error: "sala não encontrada" }, 404);

    switch (b.acao) {
      case "video-tocar": {
        if (!idVideoValido(b.video_id)) return json({ error: "vídeo inválido" }, 400);
        const r = await tocarVideo(sala, b.video_id, { palco: b.palco === true, encerrarAoFim: b.encerrar_ao_fim === true });
        return json({ ok: true, ...r });
      }
      case "video-parar": {
        await pararVideo(sala);
        return json({ ok: true });
      }
      case "programar": {
        const p = lerProgramacao(b);
        if (!p.ok) return json({ error: p.motivo }, 400);
        return json({ ok: true, ...(await programarSala(sala, p.d)) });
      }
      case "cancelar-programacao": {
        const { data: dests } = await db.from("live_destinations").select("*").eq("room_id", sala.id).eq("modo", "youtube_api");
        const seg = dests?.length ? await segredoLive(db) : "";
        const erros = (await Promise.all((dests ?? []).map((d) => cancelarProgramacaoYt(db, d, seg)))).filter(Boolean);
        await db.from("live_rooms").update({ agendada_em: null, auto_iniciar: false }).eq("id", sala.id);
        return json({ ok: true, avisos: erros });
      }
      case "reprisar": {
        // uma data (formato antigo), lista de datas ou recorrência; no máximo 30 por vez
        const ped = lerPedidoReprise(b, new Date());
        if (!ped.ok) return json({ error: ped.motivo }, 400);
        const p = lerProgramacao({ ...b, agendada_em: ped.p.datas[0].toISOString() });
        if (!p.ok) return json({ error: p.motivo }, 400);
        const r = await reprisarLote(sala, p.d, ped.p, user.id, contaEscolhida(b));
        if (!r.criadas.length) return json({ error: r.faltaram[0]?.motivo ?? "nenhuma reprise criada", ...r }, r.cota_esgotou ? 429 : 400);
        return json({ ok: true, ...r });
      }
      case "semana-criar": {
        return json({ ok: true, ...(await semanaCriar(sala, b, user.id)) });
      }
      case "semanas": {
        return json({ ok: true, semanas: await listarSemanas(sala.id) });
      }
      case "reprises": {
        return json({ ok: true, ...(await listarReprises(sala.id)) });
      }
      case "reprise-cancelar": {
        // room_id = a sala da reprise
        if (!sala.reprise_de) return json({ error: "esta live não é uma reprise" }, 400);
        if (!podeCancelarReprise(sala as SalaReprise, new Date())) return json({ error: "só dá pra cancelar reprise que ainda não começou" }, 409);
        const aviso = await cancelarReprise(sala as SalaReprise);
        return json({ ok: true, avisos: aviso ? [aviso] : [] });
      }
      case "reprises-cancelar-futuras": {
        // room_id = a live de origem; para a recorrência contínua ANTES (o tick não cria outra no meio)
        await db.from("live_reprise_series").update({ ativa: false, atualizada_em: new Date().toISOString() }).eq("room_origem_id", sala.id);
        const { data: salas } = await db.from("live_rooms").select(CAMPOS_REPRISE).eq("reprise_de", sala.id).limit(200);
        const r = await cancelarVarias((salas ?? []) as SalaReprise[], new Date(), cancelarReprise);
        return json({ ok: true, ...r });
      }
      default:
        return json({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    if (e instanceof ErroGoogle) return json({ error: `YouTube: ${e.message}`, razao: e.razao }, e.precisaReconectar ? 401 : 502);
    if (e instanceof ErroLiveKit) {
      const det = typeof e.detalhe === "string" ? e.detalhe : msg(JSON.stringify(e.detalhe ?? ""));
      return json({ error: e.status < 500 && typeof e.detalhe === "string" ? e.detalhe : `${e.message}: ${det}` }, e.status >= 400 && e.status < 500 ? e.status : 502);
    }
    return json({ error: msg(e) }, 400);
  }
});
