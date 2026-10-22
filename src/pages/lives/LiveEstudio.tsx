// /lives/estudio/:id — pré-sala e estúdio do produtor.
// Fluxo: pré-sala (câmera, aparelhos, nome) -> estúdio com palco (CenaLive, o mesmo componente do render
// do Egress), layouts, bastidores, banners/faixas/marca, destinos, convites, Ir ao vivo / Encerrar / Gravar.
// Sem o servidor de transmissão publicado (live-token 404), entra em "modo ensaio": só a câmera local
// no palco, com aviso claro nas ações que dependem do servidor. ?modo=gravacao esconde o Ir ao vivo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useLocalParticipant, useTracks, isTrackReference } from "@livekit/components-react";
import { DisconnectReason, Track } from "livekit-client";
import { toast } from "sonner";
import { CenaLive, paraCena, useCena } from "@/components/lives/CenaLive";
import { QuadroCena } from "@/components/lives/QuadroCena";
import { EstudioView, type AbaEstudio } from "@/components/lives/estudio/EstudioView";
import { entradaSemPrevia, PreSala, type ConfigEntrada } from "@/components/lives/estudio/PreSala";
import { DialogoConfig } from "@/components/lives/estudio/DialogoConfig";
import { useCameraPrevia, useNivelMic, useStreamLocal, VideoFaixa, VideoLocal, type EscolhaDispositivos } from "@/components/lives/estudio/Dispositivos";
import { useMidiaSala } from "@/components/lives/estudio/useMidiaSala";
import { useSaidasAoVivo } from "@/components/lives/estudio/useSaidasAoVivo";
import { useAuth } from "@/hooks/useAuth";
import type { PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import type { Convite } from "@/components/lives/estudio/PainelConvites";
import { db, lerDestinos, liveToken, type LiveDestino, type LiveOverlay } from "@/lib/lives/api";
import { acaoLive } from "@/lib/lives/acoes";
import { calcularCena, estaNoPalco, inverterDoisPrimeiros, noPalco, ordemAoSubir, ordemParaDestacar, type LayoutLive } from "@/lib/lives/layout";
import { AVISO_BACKEND, backendAusente, type LiveRoomExtra } from "@/lib/lives/painel";
import { garantirYoutube, precisaConferirYt, precisaGarantirYt } from "@/lib/lives/youtube";
import { mensagemErroLayout, motivoSemDestino } from "@/lib/lives/irAoVivo";
import { lerPrefs, RES_720 } from "@/lib/lives/dispositivos";
import { aparelhoIdeal, mensagemErroSala } from "@/lib/lives/ligarMidia";
import { sessoesDuplicadas } from "@/lib/lives/sessoes";

type Cred = { url: string; token: string; render_url?: string | null };

function useDadosSala(id: string) {
  const [sala, setSala] = useState<LiveRoomExtra | null>(null);
  const [destinos, setDestinos] = useState<LiveDestino[]>([]);
  const [overlays, setOverlays] = useState<LiveOverlay[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = useCallback(async () => {
    const [s, d, o, c] = await Promise.all([
      db.from("live_rooms").select("*").eq("id", id).maybeSingle(),
      lerDestinos((q) => q.eq("room_id", id).order("created_at")),
      db.from("live_overlays").select("*").eq("room_id", id).order("ordem"),
      db.from("live_invites").select("id, nome_convidado, expira_em, usado_em, revogado").eq("room_id", id).order("created_at", { ascending: false }),
    ]);
    if (s.error || !s.data) return setErro(s.error?.message ?? "Sala não encontrada");
    setSala(s.data);
    setDestinos(d.data ?? []);
    setOverlays(o.data ?? []);
    setConvites(c.data ?? []);
  }, [id]);
  useEffect(() => {
    recarregar();
  }, [recarregar]);
  return { sala, setSala, destinos, overlays, convites, erro, recarregar };
}

/**
 * YouTube conectado: enquanto a transmissão não entra "ao vivo" no canal, pede ao live-control pra conferir
 * a cada 10 s (lá ele faz transition -> live se o auto start não pegou). Para sozinho em ~5 min.
 */
function useConferirYoutube(id: string, status: string | undefined, destinos: LiveDestino[], recarregar: () => Promise<void> | void) {
  const precisa = precisaConferirYt(status, destinos);
  useEffect(() => {
    if (!precisa) return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (n > 30) return clearInterval(t);
      await acaoLive("youtube-status", { room_id: id }).catch(() => null);
      await recarregar();
    }, 10_000);
    return () => clearInterval(t);
  }, [id, precisa, recarregar]);
}

/**
 * Toda live tem o canal do YouTube conectado como destino, sem clique: ao abrir o estúdio de uma sala sem destino
 * YouTube, cria (ativo, Não listado, título da live). Uma vez por sala por montagem; o servidor é idempotente.
 */
function useYoutubeAutomatico(id: string, sala: LiveRoomExtra | null, destinos: LiveDestino[], modo: "live" | "gravacao", recarregar: () => Promise<void> | void) {
  const feito = useRef<string | null>(null);
  useEffect(() => {
    if (!sala || sala.id !== id || feito.current === id || !precisaGarantirYt(sala.status, destinos, modo)) return;
    feito.current = id;
    garantirYoutube(id).then((r) => {
      if (!r?.criado) return;
      toast.success("Canal do YouTube adicionado como destino desta live (Não listado)");
      recarregar();
    });
  }, [id, sala, destinos, modo, recarregar]);
}

/** Ações do header e do palco, iguais no estúdio conectado e no modo ensaio. */
function useAcoesEstudio(id: string, sala: LiveRoomExtra | null, destinos: LiveDestino[], recarregar: () => Promise<void> | void, setSala: (f: (s: LiveRoomExtra | null) => LiveRoomExtra | null) => void) {
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (acao: string, extra: Record<string, unknown> = {}, ok?: string) => {
    setOcupado(true);
    const r = await acaoLive(acao, { room_id: id, ...extra }, ok);
    setOcupado(false);
    await recarregar();
    return r;
  };
  return {
    ocupado,
    irAoVivo: () => {
      // sem destino não chama o servidor: o "webinário próprio" (Cloudflare Stream) já vira uma linha em destinos
      const motivo = motivoSemDestino(destinos);
      if (motivo) return toast.error(motivo);
      const ativos = destinos.filter((d) => d.ativo).length;
      rodar("ir-ao-vivo", {}).then((r: { destinos?: number; avisos?: string[] } | null) => {
        if (!r) return;
        const n = r.destinos ?? ativos;
        toast.success(`No ar em ${n} destino${n > 1 ? "s" : ""}. O primeiro quadro leva alguns segundos para chegar.`);
        for (const a of r.avisos ?? []) toast.warning(`Destino não entrou: ${a}`, { duration: 15000 });
      });
    },
    encerrar: async () => {
      if (!confirm("Encerrar a transmissão em todos os destinos?")) return;
      const r = await rodar("encerrar", {}, "Transmissão encerrada em todos os destinos");
      if (r && sala?.gravacao_egress_id) await rodar("gravar", { ligar: false });
      if (r) toast.info("A gravação fica em Gravações, no painel de lives.");
    },
    gravar: () => rodar("gravar", { ligar: !sala?.gravacao_egress_id }, sala?.gravacao_egress_id ? "Gravação parada: ela fica em Gravações" : "Gravando"),
    layout: async (layout: LayoutLive) => {
      const { error } = await db.from("live_rooms").update({ layout }).eq("id", id);
      if (error) return toast.error(mensagemErroLayout(layout, error));
      setSala((s) => (s ? { ...s, layout } : s));
      await acaoLive("cena", { room_id: id });
    },
    dispensarErro: async () => {
      const { error } = await db.from("live_rooms").update({ ultimo_erro: null }).eq("id", id);
      if (error) return toast.error(error.message);
      setSala((s) => (s ? { ...s, ultimo_erro: null } : s));
    },
    convidar: async () => {
      const r = await acaoLive<{ url: string }>("criar-convite", { room_id: id, nome: "Convidado", horas: 24 });
      if (!r?.url) return;
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success("Link de convite copiado (vale 24 h). O convidado entra nos bastidores.");
      } catch {
        toast.message("Link de convite (vale 24 h)", { description: r.url, duration: 20000 });
      }
      recarregar();
    },
    palco: (identity: string, subir: boolean, ordem: number) => acaoLive("palco", { room_id: id, identity, no_palco: subir, ordem: subir ? ordem : undefined }),
    remover: (identity: string) => confirm("Tirar esta pessoa da sala?") && acaoLive("remover", { room_id: id, identity }),
    removerSemPerguntar: (identity: string) => acaoLive("remover", { room_id: id, identity }),
  };
}

// ------------------------------------------------------------------ estúdio conectado ao LiveKit

function EstudioConectado(props: {
  sala: LiveRoomExtra; destinos: LiveDestino[]; overlays: LiveOverlay[]; convites: Convite[];
  acoes: ReturnType<typeof useAcoesEstudio>; recarregar: () => void; renderUrl?: string | null;
  modo: "live" | "gravacao"; abaInicial?: AbaEstudio; onSair: () => void; escolhaInicial: EscolhaDispositivos;
  desfocarInicial?: boolean; usuario?: string | null; resolucao?: { width: number; height: number; frameRate?: number };
}) {
  const { participantes } = useCena();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, microphoneTrack } = useLocalParticipant();
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], { onlySubscribed: false });
  const [ocupadoPessoa, setOcupadoPessoa] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const midia = useMidiaSala(props.escolhaInicial, props.desfocarInicial, props.resolucao);
  const micStream = useMemo(() => {
    const t = microphoneTrack?.track?.mediaStreamTrack;
    return t ? new MediaStream([t]) : null;
  }, [microphoneTrack?.track?.mediaStreamTrack]);
  const nivel = useNivelMic(config ? micStream : null);

  // Mesma pessoa em duas abas/aparelhos: fica só esta aba (e, nos convidados, a entrada mais recente).
  // A aba esquecida continuava publicando microfone e câmera: o mute daqui não calava o som e o palco
  // mostrava a câmera dela. Cada identity é removida uma vez só.
  const removidas = useRef(new Set<string>());
  const duplicadas = sessoesDuplicadas(participantes.map((p) => ({ identity: p.identity, joinedAt: p.joinedAt ?? (p.isLocal ? Date.now() : 0), local: p.isLocal })));
  const chaveDuplicadas = duplicadas.join(",");
  useEffect(() => {
    const novas = duplicadas.filter((d) => !removidas.current.has(d));
    if (!novas.length) return;
    novas.forEach((d) => removidas.current.add(d));
    const minhas = novas.filter((d) => d.startsWith(localParticipant.identity.replace(/_[^_]+$/, "_")));
    Promise.all(novas.map((d) => props.acoes.removerSemPerguntar(d))).then(() => {
      if (minhas.length) toast.info("O estúdio estava aberto em outra aba ou aparelho. Fechamos aquela conexão: agora só esta aba fala e aparece.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDuplicadas]);

  // o produtor entra no palco (o token já pede stage=1; se a sala não aplicou, aplica aqui uma vez)
  const subiuSozinho = useRef(false);
  const meuStage = localParticipant.attributes?.stage;
  const conectadoSala = !!localParticipant.sid;
  useEffect(() => {
    if (subiuSozinho.current || !conectadoSala || meuStage !== undefined) return;
    subiuSozinho.current = true;
    props.acoes.palco(localParticipant.identity, true, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectadoSala, meuStage]);

  const cena = participantes.map(paraCena).filter((p) => !p.oculto && !duplicadas.includes(p.identity));
  const ordemPalco = noPalco(cena).map((p) => p.identity);
  const pessoas: PessoaFila[] = cena.map((p) => {
    const part = participantes.find((x) => x.identity === p.identity)!;
    const ref = cams.find((t) => t.participant.identity === p.identity);
    return {
      identity: p.identity,
      nome: p.nome ?? p.identity,
      noPalco: estaNoPalco(p),
      papel: p.attributes?.papel,
      temTela: p.temTela,
      micDesligado: !part.isMicrophoneEnabled,
      voce: part.isLocal,
      posicao: ordemPalco.includes(p.identity) ? ordemPalco.indexOf(p.identity) + 1 : undefined,
      destaque: ordemPalco.length > 1 && ordemPalco[0] === p.identity,
      video: ref && isTrackReference(ref) && !ref.publication.isMuted ? <VideoTrack trackRef={ref} className="h-full w-full object-cover" /> : undefined,
    };
  });

  const alternar = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível acessar o dispositivo");
    }
  };

  return (
    <>
      <EstudioView
        sala={props.sala}
        destinos={props.destinos}
        overlays={props.overlays}
        convites={props.convites}
        comentarios={[]}
        palco={<CenaLive className="rounded-lg" />}
        pessoas={pessoas}
        ocupadoPessoa={ocupadoPessoa}
        onAlternarPalco={async (identity, subir) => {
          setOcupadoPessoa(identity);
          try {
            if (!subir) await props.acoes.palco(identity, false, 0);
            else {
              // quem sobe vira o destaque (padrão), menos com o vídeo da aula no palco: aí entra logo atrás dele
              const { ordem, trocas } = ordemAoSubir(cena, identity);
              for (const t of trocas) await props.acoes.palco(t.identity, true, t.ordem);
              await props.acoes.palco(identity, true, ordem);
            }
          } finally {
            setOcupadoPessoa(null);
          }
        }}
        onDestacar={async (identity) => {
          setOcupadoPessoa(identity);
          try {
            await props.acoes.palco(identity, true, ordemParaDestacar(cena, identity));
          } finally {
            setOcupadoPessoa(null);
          }
        }}
        onInverter={async () => {
          const trocas = inverterDoisPrimeiros(cena);
          if (!trocas.length) return;
          setOcupadoPessoa(trocas[0].identity);
          try {
            for (const t of trocas) await props.acoes.palco(t.identity, true, t.ordem);
          } finally {
            setOcupadoPessoa(null);
          }
        }}
        onRemover={(identity) => props.acoes.remover(identity)}
        midia={{
          mic: isMicrophoneEnabled,
          cam: isCameraEnabled,
          tela: isScreenShareEnabled,
          onMic: midia.alternarMic,
          onCam: midia.alternarCamera,
          onTela: () => alternar(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true })),
          aparelhos: { escolha: midia.escolha, onTrocar: midia.trocar, desfocar: midia.desfocar, onDesfocar: midia.setDesfocar, usuario: props.usuario },
        }}
        onConvidar={props.acoes.convidar}
        onConfig={() => setConfig(true)}
        onSair={props.onSair}
        ocupado={props.acoes.ocupado}
        onIrAoVivo={props.acoes.irAoVivo}
        onEncerrar={props.acoes.encerrar}
        onGravar={props.acoes.gravar}
        onLayout={props.acoes.layout}
        onDispensarErro={props.acoes.dispensarErro}
        conectado
        modo={props.modo}
        renderUrl={props.renderUrl}
        recarregar={props.recarregar}
        abaInicial={props.abaInicial}
      />
      <DialogoConfig
        aberto={config} onFechar={() => setConfig(false)} escolha={midia.escolha} onTrocar={midia.trocar} nivel={nivel}
        desfocar={midia.desfocar} onDesfocar={midia.setDesfocar} erroFundo={midia.erroFundo} usuario={props.usuario}
      />
    </>
  );
}

// ------------------------------------------------------------------ modo ensaio (sem servidor)

function EstudioEnsaio(props: {
  sala: LiveRoomExtra; destinos: LiveDestino[]; overlays: LiveOverlay[]; convites: Convite[];
  acoes: ReturnType<typeof useAcoesEstudio>; recarregar: () => void; entrada: ConfigEntrada;
  modo: "live" | "gravacao"; abaInicial?: AbaEstudio; onSair: () => void; usuario?: string | null;
}) {
  const [cam, setCam] = useState(props.entrada.cam);
  const [mic, setMic] = useState(props.entrada.mic);
  const [escolha, setEscolha] = useState<EscolhaDispositivos>(props.entrada);
  const [noPalcoLocal, setNoPalcoLocal] = useState(true);
  const [tela, setTela] = useState<MediaStream | null>(null);
  const [config, setConfig] = useState(false);
  const [desfocar, setDesfocar] = useState(!!props.entrada.desfocar);
  const video = useCameraPrevia(escolha.cameraId, cam, desfocar);
  const { stream } = useStreamLocal(escolha, { cam: false, mic });
  const nivel = useNivelMic(config && mic ? stream : null);
  const nome = props.entrada.nome || "Você";
  const eu = { identity: "voce", nome, attributes: { stage: noPalcoLocal ? "1" : "0" }, temTela: !!tela };
  const blocos = calcularCena(props.sala.layout as LayoutLive, [eu]);
  const overlaysCena = props.overlays.map((o) => ({ id: o.id, tipo: o.tipo, visivel: o.visivel, conteudo: o.conteudo }));

  const compartilhar = async () => {
    if (tela) {
      tela.getTracks().forEach((t) => t.stop());
      return setTela(null);
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      s.getVideoTracks()[0]?.addEventListener("ended", () => setTela(null));
      setTela(s);
    } catch {
      /* a pessoa cancelou */
    }
  };

  return (
    <>
      <EstudioView
        sala={props.sala}
        destinos={props.destinos}
        overlays={props.overlays}
        convites={props.convites}
        comentarios={[]}
        palco={
          <QuadroCena
            className="rounded-lg"
            blocos={blocos}
            overlays={overlaysCena}
            cor={props.sala.cor ?? undefined}
            nomeDe={() => nome}
            renderVideo={(b) =>
              b.fonte === "tela" ? <VideoLocal stream={tela} espelhar={false} className="h-full w-full object-contain" />
                : cam && video.faixa ? <VideoFaixa faixa={video.faixa} className="h-full w-full object-cover" /> : null
            }
          />
        }
        pessoas={[{
          identity: "voce", nome, noPalco: noPalcoLocal, voce: true, temTela: !!tela, micDesligado: !mic, papel: "produtor",
          video: cam && video.faixa ? <VideoFaixa faixa={video.faixa} className="h-full w-full object-cover" /> : undefined,
        }]}
        onAlternarPalco={(_, subir) => setNoPalcoLocal(subir)}
        midia={{
          mic, cam, tela: !!tela, onMic: () => setMic(!mic), onCam: () => setCam(!cam), onTela: compartilhar,
          aparelhos: { escolha, onTrocar: setEscolha, desfocar, onDesfocar: setDesfocar, usuario: props.usuario },
        }}
        onConvidar={props.acoes.convidar}
        onConfig={() => setConfig(true)}
        onSair={props.onSair}
        ocupado={props.acoes.ocupado}
        onIrAoVivo={props.acoes.irAoVivo}
        onEncerrar={props.acoes.encerrar}
        onGravar={props.acoes.gravar}
        onLayout={props.acoes.layout}
        onDispensarErro={props.acoes.dispensarErro}
        conectado={false}
        aviso={`Modo ensaio: ${AVISO_BACKEND} Aqui você confere enquadramento, layout, marca, banners e faixas; convidados, chat e Ir ao vivo dependem do servidor.`}
        modo={props.modo}
        recarregar={props.recarregar}
        abaInicial={props.abaInicial}
      />
      <DialogoConfig
        aberto={config} onFechar={() => setConfig(false)} escolha={escolha} onTrocar={setEscolha} nivel={nivel}
        desfocar={desfocar} onDesfocar={setDesfocar} erroFundo={video.erroFundo} usuario={props.usuario}
      />
    </>
  );
}

// ------------------------------------------------------------------ página

export default function LiveEstudio() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const usuario = user?.id ?? null;
  const modo = params.get("modo") === "gravacao" ? "gravacao" : "live";
  const destinosPedidos = (params.get("destinos") ?? "").split(",").filter(Boolean);
  const { sala, setSala, destinos, overlays, convites, erro, recarregar } = useDadosSala(id);
  const acoes = useAcoesEstudio(id, sala, destinos, recarregar, setSala);
  useConferirYoutube(id, sala?.status, destinos, recarregar);
  useYoutubeAutomatico(id, sala, destinos, modo, recarregar);
  useSaidasAoVivo(sala?.status, destinos, recarregar);
  const [sonda, setSonda] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [entrada, setEntrada] = useState<ConfigEntrada | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const [entrando, setEntrando] = useState(false);
  // esta aba foi tirada da sala (o estúdio abriu em outra aba, ou a produção removeu)
  const [fora, setFora] = useState<string | null>(null);
  // "Sempre mostrar essa prévia" desligado: entra direto com os aparelhos salvos
  const [conferindoPrevia, setConferindoPrevia] = useState(true);

  // sonda o servidor de transmissão durante a pré-sala, para avisar antes de entrar
  useEffect(() => {
    liveToken({ room_id: id })
      .then(() => setSonda({ ok: true }))
      .catch((e: Error) => setSonda({ ok: false, msg: e.message }));
  }, [id]);

  const entrar = async (c: ConfigEntrada) => {
    setEntrando(true);
    try {
      setCred(await liveToken({ room_id: id, nome: c.nome || undefined }));
    } catch (e) {
      const msg = (e as Error).message;
      if (!backendAusente(msg)) toast.error(msg);
      setCred(null);
    } finally {
      setEntrada(c);
      setEntrando(false);
      if (destinosPedidos.length) toast.info("Conecte as chaves dos destinos escolhidos na aba Destinos.");
    }
  };

  // (a rota é protegida: quando a página monta, o usuário já está carregado)
  useEffect(() => {
    if (entrada) return;
    let vivo = true;
    entradaSemPrevia(usuario).then((c) => {
      if (!vivo) return;
      setConferindoPrevia(false);
      if (c) entrar(c);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  // memorizado: um objeto novo a cada render faria o LiveKitRoom recriar a sala
  const opcoesSala = useMemo(
    () => ({
      // ideal, nunca exact: o aparelho salvo pode ter saído (iPhone/Continuidade, AirPods) e aí entra a padrão
      videoCaptureDefaults: { ...aparelhoIdeal(entrada?.cameraId), resolution: entrada?.resolucao ?? RES_720 },
      audioCaptureDefaults: entrada?.micId ? aparelhoIdeal(entrada.micId) : undefined,
      audioOutput: entrada?.saidaId ? { deviceId: entrada.saidaId } : undefined,
    }),
    [entrada?.cameraId, entrada?.micId, entrada?.saidaId, entrada?.resolucao],
  );

  const sair = () => {
    setCred(null);
    setEntrada(null);
    nav("/lives");
  };

  if (erro) return <div className="p-8 text-center text-muted-foreground">{erro}</div>;
  if (!sala) return <div className="p-8 text-center text-muted-foreground">Abrindo o estúdio…</div>;

  const abaInicial: AbaEstudio | undefined = destinosPedidos.length ? "destinos" : undefined;

  if (!entrada && (conferindoPrevia || (entrando && !lerPrefs(usuario).sempreMostrarPrevia))) {
    return <div className="p-8 text-center text-muted-foreground">Entrando no estúdio…</div>;
  }

  if (!entrada) {
    const aviso = sonda && !sonda.ok
      ? backendAusente(sonda.msg)
        ? `${AVISO_BACKEND} Você entra em modo ensaio, só com a sua câmera.`
        : `Servidor de transmissão respondeu: ${sonda.msg}`
      : null;
    return <PreSala titulo={sala.titulo} subtitulo={modo === "gravacao" ? "Gravação" : "Estúdio"} aviso={aviso} entrando={entrando} onEntrar={entrar} usuario={usuario} />;
  }

  if (fora) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="max-w-md text-muted-foreground">{fora}</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => nav("/lives")}>Voltar ao painel</button>
          <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>Entrar de novo nesta aba</button>
        </div>
      </div>
    );
  }

  if (!cred) {
    return <EstudioEnsaio sala={sala} destinos={destinos} overlays={overlays} convites={convites} acoes={acoes} recarregar={recarregar} entrada={entrada} modo={modo} abaInicial={abaInicial} onSair={sair} usuario={usuario} />;
  }

  return (
    <LiveKitRoom
      serverUrl={cred.url}
      token={cred.token}
      connect
      audio={entrada.mic}
      video={entrada.cam}
      options={opcoesSala}
      onError={(e) => toast.error(mensagemErroSala(e))}
     
      onDisconnected={(motivo) => {
        if (motivo === DisconnectReason.DUPLICATE_IDENTITY || motivo === DisconnectReason.PARTICIPANT_REMOVED) {
          setCred(null);
          setFora("Esta aba saiu da sala: o estúdio foi aberto em outra aba ou aparelho (só uma conexão por pessoa fica na sala, para o som e a câmera não duplicarem).");
        }
      }}
    >
      <RoomAudioRenderer />
      <EstudioConectado
        sala={sala} destinos={destinos} overlays={overlays} convites={convites} acoes={acoes} recarregar={recarregar}
        renderUrl={cred.render_url} modo={modo} abaInicial={abaInicial} onSair={sair} escolhaInicial={entrada}
        desfocarInicial={entrada.desfocar} usuario={usuario} resolucao={entrada.resolucao ?? RES_720}
      />
    </LiveKitRoom>
  );
}
