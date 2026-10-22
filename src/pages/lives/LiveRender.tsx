// /lives/render/:id — o template do Egress (RoomComposite com layout "custom").
// Duas formas de abrir:
//  - pelo Egress: ele acrescenta ?url=<ws>&token=<token de recorder>&layout=custom;
//  - prévia humana: ?t=<token de leitura> (link do estúdio) -> live-token devolve um token oculto.
// Avisa o Egress no console: START_RECORDING quando o quadro está pronto, END_RECORDING ao sair.
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { LiveKitRoom, useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { CenaLive } from "@/components/lives/CenaLive";
import { liveToken } from "@/lib/lives/api";

function SinalEgress() {
  const estado = useConnectionState();
  const avisou = useRef(false);
  useEffect(() => {
    if (estado === ConnectionState.Connected && !avisou.current) {
      const t = setTimeout(() => {
        avisou.current = true;
        console.log("START_RECORDING");
      }, 1500);
      return () => clearTimeout(t);
    }
    if (estado === ConnectionState.Disconnected && avisou.current) console.log("END_RECORDING");
  }, [estado]);
  return null;
}

export default function LiveRender() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [cred, setCred] = useState<{ url: string; token: string } | null>(() => {
    const url = params.get("url");
    const token = params.get("token");
    return url && token ? { url, token } : null;
  });
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.background = "#000";
    if (cred) return;
    const t = params.get("t");
    if (!t) {
      setErro("Link sem token de leitura.");
      return;
    }
    liveToken({ render: t }).then((r) => setCred({ url: r.url, token: r.token })).catch((e) => setErro(e.message));
  }, [cred, params, id]);

  if (erro) return <div className="min-h-screen bg-black text-white/60 flex items-center justify-center">{erro}</div>;
  if (!cred) return <div className="min-h-screen bg-black" />;

  return (
    <LiveKitRoom serverUrl={cred.url} token={cred.token} connect audio={false} video={false} onDisconnected={() => console.log("END_RECORDING")}>
      <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
        <div style={{ width: "min(100vw, calc(100vh * 16 / 9))" }}>
          <CenaLive comAudio transmissao />
        </div>
      </div>
      <SinalEgress />
    </LiveKitRoom>
  );
}
