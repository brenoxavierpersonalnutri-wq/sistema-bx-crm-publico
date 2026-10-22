// O quadro da transmissão. Usado IGUAL pela prévia do estúdio e pela página de render do Egress:
// quem está no palco, onde cada vídeo fica (calcularCena) e os overlays (metadata da sala).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AudioTrack, VideoTrack, useRoomContext, useTracks, isTrackReference, type TrackReference, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { type Participant, RoomEvent, Track } from "livekit-client";
import { AvatarBloco, QuadroCena } from "@/components/lives/QuadroCena";
import { calcularCena, ehAulaCena, estaNoPalco, lerEstadoCena, type Bloco, type EstadoCena, type ParticipanteCena } from "@/lib/lives/layout";

const EVENTOS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantAttributesChanged,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.RoomMetadataChanged,
  RoomEvent.Connected,
] as const;

export function paraCena(p: Participant): ParticipanteCena {
  return {
    identity: p.identity,
    nome: p.name || p.identity,
    attributes: p.attributes ?? {},
    oculto: !!(p.permissions?.hidden || p.permissions?.recorder),
    temTela: p.isScreenShareEnabled,
  };
}

/** Participantes + estado da cena, recalculados a cada evento relevante da sala. */
export function useCena(): { participantes: Participant[]; cena: EstadoCena } {
  const room = useRoomContext();
  const [, setVersao] = useState(0);
  useEffect(() => {
    const bump = () => setVersao((v) => v + 1);
    EVENTOS.forEach((e) => room.on(e, bump));
    return () => {
      EVENTOS.forEach((e) => room.off(e, bump));
    };
  }, [room]);
  const participantes: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  return { participantes, cena: lerEstadoCena(room.metadata) };
}

/**
 * Acha o vídeo do bloco. Câmera/tela pela fonte; o "Vídeo da aula" (Ingress) aceita qualquer vídeo dele
 * (a fonte publicada pode vir como camera, unknown ou screen_share conforme a versão do Ingress).
 */
export function acharVideo(tracks: TrackReferenceOrPlaceholder[], b: Pick<Bloco, "identity" | "fonte">): TrackReference | null {
  const fonte = b.fonte === "tela" ? Track.Source.ScreenShare : Track.Source.Camera;
  const doBloco = tracks.filter((t) => t.participant.identity === b.identity && isTrackReference(t)) as TrackReference[];
  const vivo = (t: TrackReference) => !t.publication.isMuted && t.publication.kind === Track.Kind.Video;
  const exato = doBloco.find((t) => t.source === fonte && vivo(t));
  if (exato) return exato;
  if (ehAulaCena(b.identity)) return doBloco.find(vivo) ?? null;
  return null;
}

/** Sem quadro há este tempo = mostra o aviso no lugar do preto (vídeo da aula que parou, track sem imagem). */
export const SEM_QUADRO_MS = 4000;

/**
 * VideoTrack que não deixa o quadro preto: enquanto não chega o primeiro quadro (assinatura começando, Ingress
 * travado), mostra `semImagem` por cima. Com `vigiarParada` (só o vídeo da aula: o Ingress manda quadros em ritmo
 * fixo), também volta para o aviso quando os quadros param — o vídeo que acaba antes do áudio deixava o palco
 * preto. Tela compartilhada parada não manda quadro e NÃO pode virar aviso, por isso o padrão é não vigiar.
 * Conta quadros com requestVideoFrameCallback (Chrome/Safari, inclusive o Chrome do Egress).
 */
export function VideoComAviso({ trackRef, className, semImagem, vigiarParada = false }: { trackRef: TrackReference; className: string; semImagem: ReactNode; vigiarParada?: boolean }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [temImagem, setTemImagem] = useState(false);
  useEffect(() => {
    const v = caixa.current?.querySelector("video");
    if (!v) return;
    let ultimo = 0;
    let vivo = true;
    let rvfc = 0;
    const marcar = () => {
      if (v.videoWidth > 0) {
        ultimo = performance.now();
        setTemImagem(true);
      }
    };
    const comRvfc = typeof (v as HTMLVideoElement & { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
    const quadro = () => {
      if (!vivo) return;
      marcar();
      rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(quadro);
    };
    if (comRvfc) quadro();
    v.addEventListener("loadeddata", marcar);
    v.addEventListener("resize", marcar);
    const t = setInterval(() => {
      // aba em segundo plano não pinta quadro: não acusa "sem imagem" por isso
      if (!vigiarParada || !comRvfc || document.visibilityState !== "visible") return;
      if (ultimo && performance.now() - ultimo > SEM_QUADRO_MS) setTemImagem(false);
    }, 1000);
    return () => {
      vivo = false;
      clearInterval(t);
      v.removeEventListener("loadeddata", marcar);
      v.removeEventListener("resize", marcar);
      if (comRvfc && rvfc) (v as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback?.(rvfc);
    };
  }, [trackRef.publication.trackSid, vigiarParada]);
  return (
    <div ref={caixa} className="relative h-full w-full">
      <VideoTrack trackRef={trackRef} className={className} />
      {!temImagem && <div className="absolute inset-0" data-sem-imagem="1">{semImagem}</div>}
    </div>
  );
}

interface Props {
  /** sobrescreve o estado vindo da metadata (prévia de uma mudança ainda não aplicada) */
  cenaForcada?: EstadoCena;
  /** toca o áudio de quem está no palco (render: sim; estúdio usa o RoomAudioRenderer) */
  comAudio?: boolean;
  className?: string;
  /** render do Egress: palco vazio fica preto e limpo (ver QuadroCena) */
  transmissao?: boolean;
}

export function CenaLive({ cenaForcada, comAudio = false, className = "", transmissao = false }: Props) {
  const { participantes, cena: cenaSala } = useCena();
  const cena = cenaForcada ?? cenaSala;
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Unknown, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const audios = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], { onlySubscribed: true });

  const porId = useMemo(() => new Map(participantes.map((p) => [p.identity, p])), [participantes]);
  const blocos = calcularCena(cena.layout, participantes.map(paraCena));
  const cor = cena.cor ?? "#10b981";

  return (
    <QuadroCena
      transmissao={transmissao}
      className={className}
      blocos={blocos}
      overlays={cena.overlays}
      cor={cor}
      nomeDe={(id) => porId.get(id)?.name || id}
      renderVideo={(b) => {
        const ref = acharVideo(tracks, b);
        if (!ref) return null;
        const nome = porId.get(b.identity)?.name || b.identity;
        return (
          <VideoComAviso
            trackRef={ref}
            className={`w-full h-full ${b.fonte === "tela" || ehAulaCena(b.identity) ? "object-contain" : "object-cover"}`}
            vigiarParada={ehAulaCena(b.identity)}
            semImagem={
              // no ar, vídeo da aula sem imagem fica preto e limpo (QuadroCena `transmissao`); no estúdio, avatar + aviso
              transmissao && ehAulaCena(b.identity)
                ? <div className="h-full w-full bg-black" />
                : <AvatarBloco nome={nome} cor={cor} aviso={ehAulaCena(b.identity) ? "Vídeo da aula sem imagem" : undefined} />
            }
          />
        );
      }}
    >
      {comAudio &&
        audios
          .filter((a) => {
            const p = porId.get(a.participant.identity);
            return p && estaNoPalco(paraCena(p));
          })
          .map((a) => <AudioTrack key={`${a.participant.identity}:${a.source}`} trackRef={a} />)}
    </QuadroCena>
  );
}
