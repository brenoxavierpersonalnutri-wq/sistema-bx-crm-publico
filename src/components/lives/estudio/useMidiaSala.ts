// Aparelhos dentro da sala do LiveKit (produtor e convidado): troca câmera/microfone/saída sem sair,
// segue o devicechange (iPhone sai de perto -> volta para a próxima câmera) e mantém o desfoque do fundo
// na câmera publicada, inclusive quando ela é desligada e ligada de novo.
import { useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Track, type LocalVideoTrack } from "livekit-client";
import { toast } from "sonner";
import { useVigiaAparelhos, type EscolhaDispositivos } from "@/components/lives/estudio/Dispositivos";
import { trocarNaSala, type SalaTroca, type TipoAparelho } from "@/lib/lives/dispositivos";
import { aplicarDesfoque } from "@/lib/lives/fundo";
import { desligarMidia, ligarMidia, mensagemErroMidia, type ParticipanteMidia, type TipoMidia } from "@/lib/lives/ligarMidia";

const FONTES = { camera: Track.Source.Camera, mic: Track.Source.Microphone };

export function useMidiaSala(escolhaInicial: EscolhaDispositivos, desfocarInicial = false, resolucao?: { width: number; height: number; frameRate?: number }) {
  const room = useRoomContext();
  const { cameraTrack } = useLocalParticipant();
  const [escolha, setEscolha] = useState<EscolhaDispositivos>(escolhaInicial);
  const [desfocar, setDesfocar] = useState(desfocarInicial);
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const atual = useRef(escolha);
  atual.current = escolha;

  const trocar = async (nova: EscolhaDispositivos) => {
    const antes = atual.current;
    setEscolha(nova);
    const pares: [TipoAparelho, string | undefined, string | undefined][] = [
      ["videoinput", nova.cameraId, antes.cameraId],
      ["audioinput", nova.micId, antes.micId],
      ["audiooutput", nova.saidaId, antes.saidaId],
    ];
    for (const [tipo, id, anterior] of pares) {
      if (!id || id === anterior) continue;
      try {
        await trocarNaSala(room as unknown as SalaTroca, tipo, id, FONTES);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível trocar o aparelho");
      }
    }
  };

  useVigiaAparelhos(escolha, (m) => {
    trocar(m.escolha);
    if (m.sumiram.some((s) => s.tipo === "videoinput")) toast.info("A câmera escolhida saiu da lista; trocamos para a próxima.");
    if (m.sumiram.some((s) => s.tipo === "audioinput")) toast.info("O microfone escolhido saiu da lista; trocamos para o próximo.");
  });

  const faixa = cameraTrack?.track as LocalVideoTrack | undefined;
  useEffect(() => {
    if (!faixa) return;
    aplicarDesfoque(faixa, desfocar)
      .then(() => setErroFundo(null))
      .catch((e: Error) => {
        setErroFundo(e.message);
        // o desfoque nunca derruba a câmera: desliga o desfoque e a câmera segue sem ele
        if (desfocar) {
          setDesfocar(false);
          toast.error(`${e.message || "O desfoque do fundo falhou"}. A câmera segue sem desfoque.`);
        }
      });
  }, [faixa, desfocar]);

  // Ligar/desligar câmera e microfone: aparelho escolhido como ideal, plano B na padrão, sem processador
  // se ele quebrar, e sempre um toast com o motivo real (nunca falha calada).
  const ocupado = useRef<Record<TipoMidia, boolean>>({ camera: false, mic: false });
  const alternar = async (tipo: TipoMidia) => {
    if (ocupado.current[tipo]) return;
    ocupado.current[tipo] = true;
    const part = room.localParticipant as unknown as ParticipanteMidia;
    const ligadoAgora = tipo === "camera" ? part.isCameraEnabled : part.isMicrophoneEnabled;
    try {
      if (ligadoAgora) await desligarMidia(part, tipo);
      else {
        const r = await ligarMidia(part, tipo, {
          deviceId: tipo === "camera" ? atual.current.cameraId : atual.current.micId,
          resolucao,
          fontes: FONTES,
        });
        if (r.aviso) toast.info(r.aviso);
      }
    } catch (e) {
      toast.error(mensagemErroMidia(e, tipo));
    } finally {
      ocupado.current[tipo] = false;
    }
  };

  return {
    escolha, trocar, desfocar, setDesfocar, erroFundo,
    alternarCamera: () => alternar("camera"),
    alternarMic: () => alternar("mic"),
  };
}
