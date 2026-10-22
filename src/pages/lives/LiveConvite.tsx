// /lives/convite/:token — convidado entra no estúdio (pública). Passa pela pré-sala, cai nos bastidores
// e espera o anfitrião colocá-lo no palco. Vê a mesma prévia da transmissão e o chat dos bastidores.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { toast } from "sonner";
import { CenaLive, useCena, paraCena } from "@/components/lives/CenaLive";
import { BarraControles } from "@/components/lives/estudio/BarraControles";
import { PainelChat } from "@/components/lives/estudio/PainelChat";
import { entradaSemPrevia, PreSala, type ConfigEntrada } from "@/components/lives/estudio/PreSala";
import { DialogoConfig } from "@/components/lives/estudio/DialogoConfig";
import { useMidiaSala } from "@/components/lives/estudio/useMidiaSala";
import { RES_720 } from "@/lib/lives/dispositivos";
import { aparelhoIdeal, mensagemErroSala } from "@/lib/lives/ligarMidia";
import { useTemaEscuro } from "@/components/lives/estudio/temaEscuro";
import { estaNoPalco } from "@/lib/lives/layout";
import { liveToken } from "@/lib/lives/api";
import { AVISO_BACKEND, backendAusente } from "@/lib/lives/painel";

const USUARIO_CONVIDADO = "convidado";

function SalaConvidado({ titulo, onSair, entrada }: { titulo?: string; onSair: () => void; entrada: ConfigEntrada }) {
  useTemaEscuro();
  const [config, setConfig] = useState(false);
  const midia = useMidiaSala(entrada, entrada.desfocar, entrada.resolucao ?? RES_720);
  useCena(); // re-renderiza quando o atributo stage muda
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const noPalco = estaNoPalco(paraCena(room.localParticipant));
  const alternar = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível acessar o dispositivo");
    }
  };
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <h1 className="min-w-0 flex-1 truncate font-semibold">{titulo}</h1>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${noPalco ? "bg-red-600 text-white" : "bg-muted text-muted-foreground"}`}>
          {noPalco ? "No palco" : "Bastidores"}
        </span>
      </header>
      <div className={`px-4 py-2 text-sm ${noPalco ? "bg-red-600/15 text-red-300" : "bg-muted/50 text-muted-foreground"}`}>
        {noPalco ? "Você está NO PALCO: aparece e é ouvido na transmissão." : "Você está nos bastidores: só a produção vê e ouve. Aguarde o anfitrião colocar você no palco."}
      </div>
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-4 p-4 lg:grid-cols-4">
        <div className="lg:col-span-3"><CenaLive className="rounded-lg" /></div>
        <div className="hidden lg:block"><PainelChat conectado /></div>
      </div>
      <div className="sticky bottom-0 border-t bg-background/95 py-3">
        <BarraControles
          mic={isMicrophoneEnabled}
          cam={isCameraEnabled}
          tela={isScreenShareEnabled}
          onMic={midia.alternarMic}
          onCam={midia.alternarCamera}
          onTela={() => alternar(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true }))}
          onConfig={() => setConfig(true)}
          onSair={onSair}
          aparelhos={{ escolha: midia.escolha, onTrocar: midia.trocar, desfocar: midia.desfocar, onDesfocar: midia.setDesfocar, usuario: USUARIO_CONVIDADO }}
        />
      </div>
      <DialogoConfig
        aberto={config} onFechar={() => setConfig(false)} escolha={midia.escolha} onTrocar={midia.trocar}
        desfocar={midia.desfocar} onDesfocar={midia.setDesfocar} erroFundo={midia.erroFundo} usuario={USUARIO_CONVIDADO}
      />
    </div>
  );
}

export default function LiveConvite() {
  const { token = "" } = useParams();
  const [cred, setCred] = useState<{ url: string; token: string; titulo?: string } | null>(null);
  const [entrada, setEntrada] = useState<ConfigEntrada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [conferindo, setConferindo] = useState(true);

  const entrar = async (c: ConfigEntrada) => {
    setEntrando(true);
    try {
      setCred(await liveToken({ convite: token, nome: c.nome || undefined }));
      setEntrada(c);
      setErro(null);
    } catch (e) {
      const msg = (e as Error).message;
      setErro(backendAusente(msg) ? AVISO_BACKEND : msg);
    } finally {
      setEntrando(false);
    }
  };

  // "Sempre mostrar essa prévia" desligado e nome já salvo: entra direto nos bastidores
  useEffect(() => {
    let vivo = true;
    entradaSemPrevia(USUARIO_CONVIDADO, true).then((c) => {
      if (!vivo) return;
      setConferindo(false);
      if (c) entrar(c);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opcoes = useMemo(
    () => ({
      // ideal, nunca exact: o aparelho salvo pode ter saído (iPhone/Continuidade, AirPods) e aí entra a padrão
      videoCaptureDefaults: { ...aparelhoIdeal(entrada?.cameraId), resolution: entrada?.resolucao ?? RES_720 },
      audioCaptureDefaults: entrada?.micId ? aparelhoIdeal(entrada.micId) : undefined,
      audioOutput: entrada?.saidaId ? { deviceId: entrada.saidaId } : undefined,
    }),
    [entrada?.cameraId, entrada?.micId, entrada?.saidaId, entrada?.resolucao],
  );

  if (conferindo) return <div className="p-8 text-center text-muted-foreground">Abrindo…</div>;

  if (!cred || !entrada) {
    return (
      <PreSala
        titulo="Você foi convidado para um estúdio"
        subtitulo="Você entra nos bastidores; o anfitrião coloca você no palco."
        aviso={erro}
        entrando={entrando}
        voltarPara="/"
        rotuloEntrar="Entrar nos bastidores"
        onEntrar={entrar}
        usuario={USUARIO_CONVIDADO}
      />
    );
  }

  return (
    <LiveKitRoom serverUrl={cred.url} token={cred.token} connect audio={entrada.mic} video={entrada.cam} options={opcoes} onDisconnected={() => setCred(null)}
      onError={(e) => toast.error(mensagemErroSala(e))}>
      <RoomAudioRenderer />
      <SalaConvidado titulo={cred.titulo} entrada={entrada} onSair={() => setCred(null)} />
    </LiveKitRoom>
  );
}
