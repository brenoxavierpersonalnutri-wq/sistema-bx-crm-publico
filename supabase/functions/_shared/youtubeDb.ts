// Parte do YouTube que fala com o banco (Deno): credenciais do app, access_token da conta e o ciclo do
// destino conectado (preparar no "Ir ao vivo", conferir/transicionar, encerrar). Usada por live-control.
//
// Ciclo de um destino modo='youtube_api':
//  preparar   liveBroadcast novo (título/descrição/privacidade do destino, agendado agora, auto start/stop)
//             + liveStream reutilizável da conta (cria se não houver) + bind. O streamName vira chave_cifrada
//             (AES-GCM, igual ao manual) e o endereço RTMPS vira rtmp_url: o Egress recebe a URL completa e
//             o front nunca vê a chave. Grava yt_broadcast_id/yt_video_id (o id do broadcast é o id do vídeo).
//  conferir   stream active + broadcast em ready/testing -> transition live (fallback do enableAutoStart).
//  encerrar   transition complete (ignora "já está"/"transição inválida") e limpa yt_broadcast_id.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cifrarChave, decifrarChave, finalDaChave, urlRtmpCompleta } from "./liveCrypto.ts";
import {
  broadcastAindaProgramado, type CandidatoGoogle, candidatosCredGoogle, ClienteYouTube, comCredencial, conferirSegredoGoogle,
  type ConfigDestinoYt, type CredGoogle, decifrarTokenYt, ErroGoogle, estadoDoBroadcast, ingestaoDoStream, linkCurtoYoutube,
  precisaTransicionarLive, type Privacidade,
} from "./youtube.ts";

/** Credenciais configuradas: env (GOOGLE_CLIENT_ID/SECRET) e depois integracao_config.google_oauth. */
export async function candidatosGoogle(db: SupabaseClient): Promise<CandidatoGoogle[]> {
  const { data } = await db.from("integracao_config").select("valor").eq("chave", "google_oauth").maybeSingle();
  return candidatosCredGoogle(
    { id: Deno.env.get("GOOGLE_CLIENT_ID"), secret: Deno.env.get("GOOGLE_CLIENT_SECRET") },
    (data?.valor as string | undefined) ?? null,
  );
}

export async function credenciaisGoogle(db: SupabaseClient): Promise<CredGoogle | null> {
  return (await candidatosGoogle(db))[0]?.cred ?? null;
}

/**
 * Credencial pro login: com uma só, ela; com duas (env e banco), a primeira cujo secret o Google aceita.
 * Assim o client_id da URL do login é o mesmo do par que vai conseguir trocar o code na volta.
 */
export async function credencialParaLogin(db: SupabaseClient): Promise<CredGoogle | null> {
  const cands = await candidatosGoogle(db);
  if (cands.length <= 1) return cands[0]?.cred ?? null;
  for (const c of cands) if ((await conferirSegredoGoogle(c.cred, redirectUriYoutube())) !== "invalido") return c.cred;
  return cands[0].cred;
}

export const redirectUriYoutube = () => `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/youtube-oauth`;

export type DestinoYt = {
  id: string;
  room_id: string;
  modo?: string | null;
  yt_conta_id?: string | null;
  yt_titulo?: string | null;
  yt_descricao?: string | null;
  yt_privacidade?: string | null;
  yt_broadcast_id?: string | null;
  yt_stream_id?: string | null;
  yt_estado?: string | null;
  yt_playlist_id?: string | null;
  rtmp_url?: string | null;
  chave_cifrada?: string | null;
};

const cfgDoDestino = (d: DestinoYt): ConfigDestinoYt => ({
  titulo: d.yt_titulo || "Ao vivo",
  descricao: d.yt_descricao ?? "",
  privacidade: (d.yt_privacidade || "unlisted") as Privacidade,
});

export const ehYoutubeApi = (d: { modo?: string | null }) => d.modo === "youtube_api";

/** Cliente com access_token novo da conta. Token revogado marca a conta como desconectada. */
export async function clienteDaConta(db: SupabaseClient, contaId: string, segredo: string): Promise<{ cli: ClienteYouTube; conta: Record<string, unknown> }> {
  const { data: conta } = await db.from("yt_contas").select("*").eq("id", contaId).maybeSingle();
  if (!conta) throw new ErroGoogle(404, "conta_ausente", "conta do YouTube não encontrada");
  if (!conta.refresh_token_cifrado || conta.status !== "conectado") throw new ErroGoogle(401, "invalid_grant", "conta do YouTube desconectada: conecte de novo");
  const cands = await candidatosGoogle(db);
  if (!cands.length) throw new ErroGoogle(412, "sem_credencial", "faltam as credenciais do app Google (pareamento ou secrets)");
  try {
    const refresh = await decifrarTokenYt(conta.refresh_token_cifrado as string, segredo);
    const { valor: t } = await comCredencial(cands, (cred) => ClienteYouTube.renovar(cred, refresh));
    return { cli: new ClienteYouTube(t.accessToken), conta };
  } catch (e) {
    if (e instanceof ErroGoogle && e.precisaReconectar) {
      await db.from("yt_contas").update({ status: "desconectado", ultimo_erro: "o Google recusou o token: conecte de novo", atualizado_em: new Date().toISOString() }).eq("id", contaId);
    }
    throw e;
  }
}

/** Cria broadcast + (re)usa stream + bind. Devolve a URL RTMP completa pro Egress (só dentro da função). */
export async function prepararDestinoYt(db: SupabaseClient, d: DestinoYt, segredo: string): Promise<string> {
  if (!d.yt_conta_id) throw new ErroGoogle(400, "sem_conta", "destino YouTube sem conta conectada");
  const { cli, conta } = await clienteDaConta(db, d.yt_conta_id, segredo);
  const cfg = cfgDoDestino(d);

  // live PROGRAMADA (broadcast + stream só dela, criados no "programar"): reaproveita enquanto não começou.
  // Assim o link divulgado é o mesmo que entra no ar (o auto start liga quando o stream fica ativo).
  if (d.yt_estado === "agendado" && d.yt_broadcast_id && d.yt_stream_id && d.chave_cifrada && d.rtmp_url) {
    const b = await cli.obterBroadcast(d.yt_broadcast_id).catch(() => null);
    const ciclo = (b as { status?: { lifeCycleStatus?: string } } | null)?.status?.lifeCycleStatus;
    if (broadcastAindaProgramado(ciclo)) {
      const url = urlRtmpCompleta(d.rtmp_url, await decifrarChave(d.chave_cifrada, segredo));
      await db.from("live_destinations").update({ yt_estado: "preparando", yt_erro: null, updated_at: new Date().toISOString() }).eq("id", d.id);
      return url;
    }
  }

  // stream reutilizável da conta; se sumiu no YouTube, cria outro
  let stream = conta.stream_id ? await cli.obterStream(conta.stream_id as string).catch(() => null) : null;
  if (!stream || !ingestaoDoStream(stream)) {
    stream = await cli.inserirStream(`Estúdio CRM (${String(conta.titulo ?? "canal").slice(0, 60)})`);
    await db.from("yt_contas").update({ stream_id: stream.id, atualizado_em: new Date().toISOString() }).eq("id", conta.id);
  }
  const ing = ingestaoDoStream(stream);
  if (!ing) throw new ErroGoogle(502, "sem_ingestao", "o YouTube não devolveu o endereço de ingestão");

  const b = await cli.inserirBroadcast(cfg);
  const broadcastId = String(b.id ?? "");
  if (!broadcastId) throw new ErroGoogle(502, "sem_broadcast", "o YouTube não criou a transmissão");
  await cli.vincular(broadcastId, String(stream.id));

  const url = urlRtmpCompleta(ing.servidor, ing.chave);
  await db.from("live_destinations").update({
    rtmp_url: ing.servidor,
    chave_cifrada: await cifrarChave(ing.chave, segredo),
    chave_final: finalDaChave(ing.chave),
    yt_broadcast_id: broadcastId,
    yt_video_id: broadcastId,
    yt_stream_id: String(stream.id),
    yt_estado: "preparando",
    yt_erro: null,
    updated_at: new Date().toISOString(),
  }).eq("id", d.id);
  return url;
}

/** Confere o stream/broadcast e, se preciso, pede "live". Devolve o estado pra tela. */
export async function conferirDestinoYt(db: SupabaseClient, d: DestinoYt, segredo: string): Promise<{ estado: string; stream: string | null }> {
  if (!d.yt_conta_id || !d.yt_broadcast_id) return { estado: "sem_transmissao", stream: null };
  const { cli } = await clienteDaConta(db, d.yt_conta_id, segredo);
  const [b, s] = await Promise.all([
    cli.obterBroadcast(d.yt_broadcast_id),
    d.yt_stream_id ? cli.obterStream(d.yt_stream_id) : Promise.resolve(null),
  ]);
  let ciclo = (b as { status?: { lifeCycleStatus?: string } } | null)?.status?.lifeCycleStatus;
  const st = (s as { status?: { streamStatus?: string } } | null)?.status?.streamStatus ?? null;
  let erro: string | null = null;
  if (precisaTransicionarLive(st ?? undefined, ciclo)) {
    try {
      const t = await cli.transicionar(d.yt_broadcast_id, "live");
      ciclo = (t as { status?: { lifeCycleStatus?: string } }).status?.lifeCycleStatus ?? "liveStarting";
    } catch (e) {
      if (!(e instanceof ErroGoogle && e.razao === "redundantTransition")) erro = e instanceof Error ? e.message : "falha na transição";
    }
  }
  const estado = estadoDoBroadcast(ciclo);
  await db.from("live_destinations").update({ yt_estado: estado, yt_erro: erro, updated_at: new Date().toISOString() }).eq("id", d.id);
  return { estado, stream: st };
}

/** Encerra o broadcast (best effort) e libera o destino pra uma transmissão nova. */
export async function encerrarDestinoYt(db: SupabaseClient, d: DestinoYt, segredo: string): Promise<void> {
  if (!d.yt_conta_id || !d.yt_broadcast_id) return;
  let erro: string | null = null;
  try {
    const { cli } = await clienteDaConta(db, d.yt_conta_id, segredo);
    try {
      await cli.transicionar(d.yt_broadcast_id, "complete");
    } catch (e) {
      // Live PROGRAMADA que nunca entrou no ar (ex.: o ir-ao-vivo da agenda falhou): "complete" é inválido e o
      // broadcast continua agendado no canal. Soltar o id aqui deixava a live órfã no YouTube (o CRM perdia a
      // referência, o "Cancelar" não apagava e o próximo "Programar" criava outro link). Mantém o vínculo.
      if (e instanceof ErroGoogle && e.razao === "invalidTransition") {
        const b = await cli.obterBroadcast(d.yt_broadcast_id).catch(() => null);
        const ciclo = (b as { status?: { lifeCycleStatus?: string } } | null)?.status?.lifeCycleStatus;
        if (broadcastAindaProgramado(ciclo)) {
          await db.from("live_destinations").update({ yt_estado: "agendado", yt_erro: null, updated_at: new Date().toISOString() }).eq("id", d.id);
          return;
        }
      }
      throw e;
    }
  } catch (e) {
    // já encerrado (auto stop) ou nunca chegou a live: não é erro pra quem opera
    const ok = e instanceof ErroGoogle && ["redundantTransition", "invalidTransition", "liveBroadcastNotFound"].includes(e.razao);
    if (!ok) erro = e instanceof Error ? e.message : "falha ao encerrar no YouTube";
  }
  await db.from("live_destinations").update({
    yt_broadcast_id: null,
    yt_estado: erro ? "erro" : "encerrado",
    yt_erro: erro,
    updated_at: new Date().toISOString(),
  }).eq("id", d.id);
}

export type ResultadoProgramacao = { destino_id: string; nome: string; video_id: string; link: string; avisos: string[] };

/**
 * Live programada no YouTube: broadcast agendado (data, título, descrição, privacidade; auto start/stop) preso a um
 * stream SÓ dele. Já programado e ainda não começou: atualiza (mesmo link). Miniatura e playlist são opcionais e,
 * se o YouTube recusar, viram aviso (a live continua programada).
 */
export async function programarDestinoYt(
  db: SupabaseClient,
  d: DestinoYt & { nome?: string },
  segredo: string,
  quando: Date,
  extra: { miniatura?: { bytes: Uint8Array; mime: string } | null; playlistId?: string | null } = {},
): Promise<ResultadoProgramacao> {
  if (!d.yt_conta_id) throw new ErroGoogle(400, "sem_conta", "destino YouTube sem conta conectada");
  const { cli, conta } = await clienteDaConta(db, d.yt_conta_id, segredo);
  const cfg = cfgDoDestino(d);
  const avisos: string[] = [];
  let broadcastId: string | null = null;

  if (d.yt_estado === "agendado" && d.yt_broadcast_id) {
    const b = await cli.obterBroadcast(d.yt_broadcast_id).catch(() => null);
    const ciclo = (b as { status?: { lifeCycleStatus?: string } } | null)?.status?.lifeCycleStatus;
    if (broadcastAindaProgramado(ciclo)) {
      await cli.atualizarBroadcast(d.yt_broadcast_id, cfg, quando);
      broadcastId = d.yt_broadcast_id;
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!broadcastId) {
    const stream = await cli.inserirStream(`Aula programada: ${cfg.titulo} (${String(conta.titulo ?? "canal").slice(0, 40)})`, false);
    const ing = ingestaoDoStream(stream);
    if (!ing) throw new ErroGoogle(502, "sem_ingestao", "o YouTube não devolveu o endereço de ingestão");
    const b = await cli.inserirBroadcastAgendado(cfg, quando);
    broadcastId = String(b.id ?? "");
    if (!broadcastId) throw new ErroGoogle(502, "sem_broadcast", "o YouTube não criou a transmissão");
    try {
      await cli.vincular(broadcastId, String(stream.id));
    } catch (e) {
      await cli.apagarBroadcast(broadcastId).catch(() => null); // não deixa live programada sem stream no canal
      throw e;
    }
    Object.assign(patch, {
      rtmp_url: ing.servidor,
      chave_cifrada: await cifrarChave(ing.chave, segredo),
      chave_final: finalDaChave(ing.chave),
      yt_broadcast_id: broadcastId,
      yt_video_id: broadcastId,
      yt_stream_id: String(stream.id),
      yt_playlist_id: null,
    });
  }
  Object.assign(patch, { yt_estado: "agendado", yt_erro: null, yt_agendado_para: quando.toISOString() });

  if (extra.miniatura) {
    try {
      await cli.definirMiniatura(broadcastId, extra.miniatura.bytes, extra.miniatura.mime);
      patch.yt_miniatura_ok = true;
    } catch (e) {
      avisos.push(`miniatura recusada pelo YouTube: ${e instanceof Error ? e.message : "erro"} (canal precisa estar verificado por telefone para miniatura personalizada)`);
    }
  }
  const jaNaPlaylist = !patch.yt_broadcast_id && d.yt_playlist_id === extra.playlistId;
  if (extra.playlistId && !jaNaPlaylist) {
    try {
      await cli.adicionarNaPlaylist(extra.playlistId, broadcastId);
      patch.yt_playlist_id = extra.playlistId;
    } catch (e) {
      avisos.push(`não entrou na playlist: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  await db.from("live_destinations").update(patch).eq("id", d.id);
  return { destino_id: d.id, nome: d.nome ?? "YouTube", video_id: broadcastId, link: linkCurtoYoutube(broadcastId), avisos };
}

/** Cancela a live programada: apaga o broadcast no canal (só se ainda não começou) e libera o destino. */
export async function cancelarProgramacaoYt(db: SupabaseClient, d: DestinoYt, segredo: string): Promise<string | null> {
  if (d.yt_estado !== "agendado" || !d.yt_broadcast_id || !d.yt_conta_id) return null;
  let erro: string | null = null;
  try {
    const { cli } = await clienteDaConta(db, d.yt_conta_id, segredo);
    await cli.apagarBroadcast(d.yt_broadcast_id);
  } catch (e) {
    erro = e instanceof Error ? e.message : "falha ao apagar no YouTube";
  }
  await db.from("live_destinations").update({
    yt_broadcast_id: null, yt_video_id: null, yt_estado: erro ? "erro" : null, yt_erro: erro, yt_agendado_para: null,
    updated_at: new Date().toISOString(),
  }).eq("id", d.id);
  return erro;
}

export async function playlistsDaConta(db: SupabaseClient, contaId: string, segredo: string) {
  const { cli } = await clienteDaConta(db, contaId, segredo);
  return cli.playlists();
}

export async function criarPlaylistDaConta(db: SupabaseClient, contaId: string, segredo: string, titulo: string, privacidade: Privacidade) {
  const { cli } = await clienteDaConta(db, contaId, segredo);
  return cli.criarPlaylist(titulo, privacidade);
}

export async function apagarPlaylistDaConta(db: SupabaseClient, contaId: string, segredo: string, id: string) {
  const { cli } = await clienteDaConta(db, contaId, segredo);
  await cli.apagarPlaylist(id);
}
