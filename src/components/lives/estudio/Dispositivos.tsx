// Câmera, microfone e alto-falante: lista de aparelhos, prévia local e medidor de nível do microfone.
// Usado na pré-sala e no diálogo de Configurações do estúdio.
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mic, RefreshCw, Smartphone, Volume2 } from "lucide-react";
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { Button } from "@/components/ui/button";
import { cameraSugeridaIphone, salvarCamera, soCameraDoMac } from "@/lib/lives/cameras";
import { aposMudanca, escolherResolucao, observarAparelhos, RES_720, rotuloAparelho, separarAparelhos, type EscolhaAparelhos, type MudancaAparelhos, type Resolucao } from "@/lib/lives/dispositivos";
import { aplicarDesfoque } from "@/lib/lives/fundo";
import { aparelhoIdeal, ehPermissao, mensagemErroMidia } from "@/lib/lives/ligarMidia";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export type EscolhaDispositivos = EscolhaAparelhos;

export function useAparelhos(pedirPermissao = true) {
  const [aparelhos, setAparelhos] = useState<MediaDeviceInfo[]>([]);
  // relê a lista; usado no devicechange (o iPhone pode aparecer depois da página aberta) e no botão "atualizar"
  const reler = useCallback(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return Promise.resolve();
    return md.enumerateDevices().then(setAparelhos).catch(() => setAparelhos([]));
  }, []);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    reler();
    return observarAparelhos(md, reler);
  }, [pedirPermissao, reler]);
  return { ...separarAparelhos(aparelhos), reler };
}

/**
 * Vigia o devicechange: se o aparelho escolhido some (o iPhone saiu de perto, o AirPods desligou),
 * chama aoSumir com a escolha nova (primeiro aparelho da lista) para a tela trocar e avisar.
 */
export function useVigiaAparelhos(escolha: EscolhaDispositivos, aoSumir: (m: MudancaAparelhos) => void, aparelhos?: ReturnType<typeof useAparelhos>) {
  const proprio = useAparelhos();
  const lista = aparelhos ?? proprio;
  const ref = useRef({ escolha, aoSumir });
  ref.current = { escolha, aoSumir };
  const assinatura = [...lista.cameras, ...lista.mics, ...lista.saidas].map((d) => `${d.kind}:${d.deviceId}:${d.label ? 1 : 0}`).join("|");
  useEffect(() => {
    const m = aposMudanca(ref.current.escolha, lista);
    if (m.sumiram.length) ref.current.aoSumir(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  return lista;
}

/** Nível do microfone de 0 a 1, lido do stream com um AnalyserNode. */
export function useNivelMic(stream: MediaStream | null) {
  const [nivel, setNivel] = useState(0);
  useEffect(() => {
    const trilha = stream?.getAudioTracks()[0];
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!stream || !trilha || !AC) {
      setNivel(0);
      return;
    }
    const ctx = new AC();
    // sem gesto do usuário o navegador cria o contexto suspenso: tenta já e de novo no primeiro clique
    const retomar = () => ctx.state === "suspended" && ctx.resume().catch(() => undefined);
    retomar();
    window.addEventListener("pointerdown", retomar);
    const analisador = ctx.createAnalyser();
    analisador.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analisador);
    const dados = new Uint8Array(analisador.fftSize);
    let raf = 0;
    const medir = () => {
      analisador.getByteTimeDomainData(dados);
      let soma = 0;
      for (const v of dados) soma += ((v - 128) / 128) ** 2;
      setNivel(Math.min(1, Math.sqrt(soma / dados.length) * 4));
      raf = requestAnimationFrame(medir);
    };
    medir();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", retomar);
      ctx.close().catch(() => undefined);
    };
  }, [stream]);
  return nivel;
}

export function MedidorNivel({ nivel }: { nivel: number }) {
  const barras = 12;
  const acesas = Math.round(nivel * barras);
  return (
    <div className="flex h-3 items-end gap-0.5" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nivel * 100)}>
      {Array.from({ length: barras }, (_, i) => (
        <span key={i} className={`h-full w-1.5 rounded-sm ${i < acesas ? (i > 9 ? "bg-red-500" : i > 7 ? "bg-amber-400" : "bg-emerald-500") : "bg-muted"}`} />
      ))}
    </div>
  );
}

function Seletor({ rotulo, Icone, valor, opcoes, onTrocar, vazio }: { rotulo: string; Icone: typeof Camera; valor?: string; opcoes: MediaDeviceInfo[]; onTrocar: (id: string) => void; vazio: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs"><Icone className="h-3.5 w-3.5" />{rotulo}</Label>
      <Select value={valor ?? opcoes[0]?.deviceId ?? ""} onValueChange={onTrocar} disabled={!opcoes.length}>
        <SelectTrigger className="h-9"><SelectValue placeholder={vazio} /></SelectTrigger>
        <SelectContent>
          {opcoes.map((d, i) => <SelectItem key={d.deviceId} value={d.deviceId}>{rotuloAparelho(d, i)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * O iPhone entra na lista "Câmera" sozinho pela Câmera de Continuidade do macOS (como no Zoom/Meet).
 * Quando não entra: no Chrome a câmera sem fio às vezes não aparece e com cabo aparece; o Safari costuma enxergar.
 */
export const DICA_IPHONE = "iPhone não aparece? Conecte-o ao Mac pelo cabo (no Chrome, sem fio às vezes não aparece) ou abra o estúdio no Safari, e clique em Atualizar dispositivos.";
export const REQUISITOS_IPHONE = "Precisa de macOS 13+ e iOS 16+, mesmo ID Apple, Wi-Fi e Bluetooth ligados, iPhone perto, travado e na horizontal.";

export function DicaIphone() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="dica-iphone">
      {DICA_IPHONE} <span className="opacity-80">{REQUISITOS_IPHONE}</span>
    </p>
  );
}

export function SeletoresDispositivo({ escolha, onTrocar, nivel, aparelhos }: {
  escolha: EscolhaDispositivos;
  onTrocar: (e: EscolhaDispositivos) => void;
  nivel?: number;
  aparelhos: ReturnType<typeof useAparelhos>;
}) {
  const { cameras, mics, saidas } = aparelhos;
  const trocarCamera = (cameraId: string) => {
    salvarCamera(cameraId);
    onTrocar({ ...escolha, cameraId });
  };
  const iphone = cameraSugeridaIphone(cameras);
  const iphoneAtivo = iphone && (escolha.cameraId ?? cameras[0]?.deviceId) === iphone.deviceId;
  return (
    <div className="space-y-3">
      <Seletor rotulo="Câmera" Icone={Camera} valor={escolha.cameraId} opcoes={cameras} vazio="Nenhuma câmera" onTrocar={trocarCamera} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => aparelhos.reler()}>
          <RefreshCw className="h-3.5 w-3.5" />Atualizar dispositivos
        </Button>
        {iphone && !iphoneAtivo && (
          <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => trocarCamera(iphone.deviceId)}>
            <Smartphone className="h-3.5 w-3.5" />Usar {iphone.label || "iPhone"}
          </Button>
        )}
      </div>
      {soCameraDoMac(cameras) && <DicaIphone />}
      <Seletor rotulo="Microfone" Icone={Mic} valor={escolha.micId} opcoes={mics} vazio="Nenhum microfone" onTrocar={(micId) => onTrocar({ ...escolha, micId })} />
      {nivel !== undefined && <MedidorNivel nivel={nivel} />}
      <Seletor rotulo="Alto-falante" Icone={Volume2} valor={escolha.saidaId} opcoes={saidas} vazio="Padrão do sistema" onTrocar={(saidaId) => onTrocar({ ...escolha, saidaId })} />
    </div>
  );
}

/** Abre câmera e microfone com os aparelhos escolhidos (e fecha o stream anterior). */
export function useStreamLocal(escolha: EscolhaDispositivos, ligar: { cam: boolean; mic: boolean }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atual = useRef<MediaStream | null>(null);
  useEffect(() => {
    let cancelado = false;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setErro("Este navegador não dá acesso à câmera e ao microfone.");
      return;
    }
    if (!ligar.cam && !ligar.mic) {
      atual.current?.getTracks().forEach((t) => t.stop());
      atual.current = null;
      setStream(null);
      return;
    }
    md.getUserMedia({
      video: ligar.cam ? (escolha.cameraId ? { deviceId: { ideal: escolha.cameraId } } : true) : false,
      audio: ligar.mic ? (escolha.micId ? { deviceId: { ideal: escolha.micId } } : true) : false,
    })
      .then((s) => {
        if (cancelado) return s.getTracks().forEach((t) => t.stop());
        atual.current?.getTracks().forEach((t) => t.stop());
        atual.current = s;
        setStream(s);
        setErro(null);
      })
      .catch((e: Error) => !cancelado && setErro(mensagemErroMidia(e, ligar.cam ? "camera" : "mic")));
    return () => {
      cancelado = true;
    };
  }, [escolha.cameraId, escolha.micId, ligar.cam, ligar.mic]);
  useEffect(() => () => atual.current?.getTracks().forEach((t) => t.stop()), []);
  return { stream, erro };
}

/**
 * Câmera da prévia como faixa do LiveKit (a mesma classe que vai para a sala): abre em 1280x720 a 30 fps,
 * lê das capacidades se a câmera aguenta 1920x1080 (é a resolução usada ao entrar), troca de aparelho com
 * restartTrack (sem fechar a prévia) e liga/desliga o desfoque do fundo.
 */
export function useCameraPrevia(cameraId: string | undefined, ligado: boolean, desfocar: boolean) {
  const [faixa, setFaixa] = useState<LocalVideoTrack | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const [resolucao, setResolucao] = useState<Resolucao>(RES_720);
  const atual = useRef<LocalVideoTrack | null>(null);
  const idAberto = useRef<string | undefined>(undefined);

  // abre/fecha a câmera
  useEffect(() => {
    if (!ligado) {
      atual.current?.stop();
      atual.current = null;
      setFaixa(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErro("Este navegador não dá acesso à câmera.");
      return;
    }
    let cancelado = false;
    const abrir = (id?: string) => createLocalVideoTrack({ ...aparelhoIdeal(id), resolution: RES_720 });
    // aparelho salvo que não abre (sumiu, travou): tenta a câmera padrão antes de desistir
    abrir(cameraId)
      .catch((e: Error) => (cameraId && !ehPermissao(e) ? abrir() : Promise.reject(e)))
      .then((t) => {
        if (cancelado) return t.stop();
        atual.current = t;
        idAberto.current = cameraId;
        setResolucao(escolherResolucao(t.mediaStreamTrack.getCapabilities?.()));
        setFaixa(t);
        setErro(null);
      })
      .catch((e: Error) => !cancelado && setErro(mensagemErroMidia(e, "camera")));
    return () => {
      cancelado = true;
      atual.current?.stop();
      atual.current = null;
      setFaixa(null);
    };
    // a troca de aparelho com a câmera aberta é feita abaixo, sem fechar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligado]);

  // troca de câmera sem fechar a prévia
  useEffect(() => {
    const t = atual.current;
    if (!t || !cameraId || idAberto.current === cameraId) return;
    idAberto.current = cameraId;
    t.restartTrack({ deviceId: { ideal: cameraId }, resolution: RES_720 })
      .then(() => {
        setResolucao(escolherResolucao(t.mediaStreamTrack.getCapabilities?.()));
        setErro(null);
      })
      .catch((e: Error) => setErro(mensagemErroMidia(e, "camera")));
  }, [cameraId, faixa]);

  // desfoque do fundo (carrega a biblioteca só quando liga)
  useEffect(() => {
    if (!faixa) return;
    aplicarDesfoque(faixa, desfocar)
      .then(() => setErroFundo(null))
      .catch((e: Error) => setErroFundo(e.message || "Não foi possível desfocar o fundo"));
  }, [faixa, desfocar]);

  return { faixa, erro, erroFundo, resolucao };
}

/** Mostra uma faixa de vídeo do LiveKit (já com o desfoque, se houver), espelhada como num espelho. */
export function VideoFaixa({ faixa, className = "", espelhar = true }: { faixa: LocalVideoTrack | null; className?: string; espelhar?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !faixa) return;
    faixa.attach(el);
    return () => {
      faixa.detach(el);
    };
  }, [faixa]);
  return <video ref={ref} autoPlay muted playsInline className={`${className} ${espelhar ? "-scale-x-100" : ""}`} />;
}

export function VideoLocal({ stream, className = "", espelhar = true }: { stream: MediaStream | null; className?: string; espelhar?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline className={`${className} ${espelhar ? "-scale-x-100" : ""}`} />;
}
