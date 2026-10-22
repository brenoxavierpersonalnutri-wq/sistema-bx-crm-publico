// Prévia antes de entrar (no desenho da prévia do Zoom): o vídeo da câmera grande, Áudio e Vídeo sobre
// o vídeo, "Planos de fundo", seletores de câmera/microfone/alto-falante com o nome real de cada aparelho,
// desfocar o fundo, enquadrar (em breve) e "Sempre mostrar essa prévia ao entrar".
// As escolhas ficam salvas por usuário neste navegador.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Ban, ImageIcon, Info, Mic, MicOff, Sparkles, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MedidorNivel, SeletoresDispositivo, useCameraPrevia, useNivelMic, useStreamLocal, useVigiaAparelhos, VideoFaixa, type EscolhaDispositivos } from "@/components/lives/estudio/Dispositivos";
import { OpcoesVideo } from "@/components/lives/estudio/OpcoesVideo";
import { useTemaLives } from "@/components/lives/estudio/temaEscuro";
import { Marca } from "@/components/lives/tema/Marca";
import { lerCameraSalva } from "@/lib/lives/cameras";
import { escolhaDasPrefs, lerPrefs, prefsDaEscolha, RES_1080, RES_720, salvarPrefs, separarAparelhos, type Resolucao } from "@/lib/lives/dispositivos";
import { cn } from "@/lib/utils";

export interface ConfigEntrada extends EscolhaDispositivos {
  nome: string;
  cam: boolean;
  mic: boolean;
  desfocar?: boolean;
  resolucao?: Resolucao;
}

const CHAVE_NOME = "lives:nome-exibido";

export const TITULO_PREVIA = "Prévia do vídeo";

function lerNome() {
  try {
    return localStorage.getItem(CHAVE_NOME) ?? "";
  } catch {
    return "";
  }
}

/**
 * "Sempre mostrar essa prévia" desligado: monta a entrada direto com os aparelhos salvos (achados na lista
 * atual pelo id ou pelo nome). Devolve null quando a prévia deve aparecer.
 */
export async function entradaSemPrevia(usuario: string | null | undefined, exigirNome = false): Promise<ConfigEntrada | null> {
  const prefs = lerPrefs(usuario);
  if (prefs.sempreMostrarPrevia) return null;
  const nome = lerNome().trim();
  if (exigirNome && !nome) return null;
  let lista = separarAparelhos([] as MediaDeviceInfo[]);
  try {
    lista = separarAparelhos(await navigator.mediaDevices.enumerateDevices());
  } catch {
    /* sem lista: entra com os aparelhos padrão */
  }
  return { ...escolhaDasPrefs(prefs, lista), nome, cam: prefs.cam, mic: prefs.mic, desfocar: prefs.desfocar, resolucao: prefs.hd1080 ? RES_1080 : RES_720 };
}

interface Props {
  titulo: string;
  subtitulo?: string;
  nomeInicial?: string;
  aviso?: string | null;
  entrando?: boolean;
  voltarPara?: string;
  rotuloEntrar?: string;
  onEntrar: (c: ConfigEntrada) => void;
  /** dono das preferências salvas (id do usuário; "convidado" no link de convite) */
  usuario?: string | null;
  /** dev/demonstração: não abre câmera de verdade */
  semCamera?: boolean;
}

function BotaoSobreVideo({ rotulo, desligado, onClick, children }: { rotulo: string; desligado?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      className={cn(
        "flex h-12 min-w-[76px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-medium text-white transition-colors hover:bg-white/15",
        desligado && "text-red-400",
      )}
    >
      {children}
      <span>{rotulo}</span>
    </button>
  );
}

export function PreSala({ titulo, subtitulo, nomeInicial, aviso, entrando, voltarPara = "/lives", rotuloEntrar = "Entrar no estúdio", onEntrar, usuario, semCamera }: Props) {
  useTemaLives(true);
  const [prefs] = useState(() => lerPrefs(usuario));
  const [nome, setNome] = useState(() => nomeInicial ?? lerNome());
  const [cam, setCam] = useState(prefs.cam);
  const [mic, setMic] = useState(prefs.mic);
  const [desfocar, setDesfocar] = useState(prefs.desfocar);
  const [sempreMostrar, setSempreMostrar] = useState(prefs.sempreMostrarPrevia);
  const [escolha, setEscolha] = useState<EscolhaDispositivos>(() => ({ cameraId: prefs.cameraId ?? lerCameraSalva() ?? undefined, micId: prefs.micId, saidaId: prefs.saidaId }));
  const camLigada = cam && !semCamera;
  const video = useCameraPrevia(escolha.cameraId, camLigada, desfocar);
  const audio = useStreamLocal(escolha, { cam: false, mic: mic && !semCamera });
  const nivel = useNivelMic(mic ? audio.stream : null);
  const aparelhos = useVigiaAparelhos(escolha, (m) => {
    setEscolha(m.escolha);
    for (const s of m.sumiram) toast.info(s.tipo === "videoinput" ? "A câmera escolhida saiu da lista; trocamos para a próxima." : s.tipo === "audioinput" ? "O microfone escolhido saiu da lista; trocamos para o próximo." : "O alto-falante escolhido saiu da lista.");
  });
  const { reler } = aparelhos;

  // os nomes dos aparelhos só aparecem depois da permissão: relê a lista quando a câmera/microfone abre
  useEffect(() => {
    if (video.faixa || audio.stream) reler();
  }, [video.faixa, audio.stream, reler]);

  // a escolha salva tinha um id antigo (o Safari troca ids): reencontra pelo nome quando a lista chega
  const listaComNomes = aparelhos.cameras.some((d) => d.label);
  useEffect(() => {
    if (!listaComNomes) return;
    const achada = escolhaDasPrefs(prefs, aparelhos);
    setEscolha((e) => ({
      cameraId: aparelhos.cameras.some((d) => d.deviceId === e.cameraId) ? e.cameraId : achada.cameraId,
      micId: aparelhos.mics.some((d) => d.deviceId === e.micId) ? e.micId : achada.micId,
      saidaId: aparelhos.saidas.some((d) => d.deviceId === e.saidaId) ? e.saidaId : achada.saidaId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaComNomes]);

  const guardar = (parcial: Parameters<typeof salvarPrefs>[1]) => salvarPrefs(usuario, parcial);
  const trocarDesfoque = (v: boolean) => {
    setDesfocar(v);
    guardar({ desfocar: v });
  };

  const entrar = () => {
    const n = nome.trim();
    try {
      if (n) localStorage.setItem(CHAVE_NOME, n);
    } catch {
      /* sem armazenamento */
    }
    guardar({ ...prefsDaEscolha(escolha, aparelhos), cam, mic, desfocar, sempreMostrarPrevia: sempreMostrar, hd1080: video.resolucao.width >= 1920 });
    video.faixa?.stop(); // o estúdio abre os aparelhos de novo
    audio.stream?.getTracks().forEach((t) => t.stop());
    onEntrar({ ...escolha, nome: n, cam, mic, desfocar, resolucao: video.resolucao });
  };

  const erroCamera = camLigada ? video.erro : null;
  const temVideo = camLigada && !!video.faixa;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex h-16 items-center gap-3 px-4 sm:px-8">
        <Link to={voltarPara} aria-label="Voltar" className="text-muted-foreground hover:text-foreground sm:hidden"><ArrowLeft className="h-5 w-5" /></Link>
        <Link to={voltarPara} aria-label="Voltar" className="hidden sm:block"><Marca /></Link>
        <div className="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground">{titulo}{subtitulo ? ` · ${subtitulo}` : ""}</div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-16 pt-2 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <section>
          <h1 className="mb-3 text-xl font-medium tracking-tight">{TITULO_PREVIA}</h1>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            {temVideo ? (
              <VideoFaixa faixa={video.faixa} className="h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[15px] text-white/70">
                <VideoOff className="h-12 w-12 opacity-70" />
                {erroCamera ?? (camLigada ? "Abrindo a câmera…" : "Câmera desligada")}
              </div>
            )}
            {nome.trim() && <div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{nome.trim()}</div>}
            {temVideo && (
              <div className="absolute right-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white/80" data-testid="resolucao-previa" title="Resolução pedida à câmera ao entrar no estúdio (a prévia roda em 720p)">
                Entra em {video.resolucao.height}p · {video.resolucao.frameRate} fps
              </div>
            )}

            {/* barra sobre o vídeo, como no Zoom */}
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
              <div className="flex items-center gap-1">
                <BotaoSobreVideo rotulo={mic ? "Áudio" : "Áudio mudo"} desligado={!mic} onClick={() => setMic(!mic)}>
                  {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </BotaoSobreVideo>
                <BotaoSobreVideo rotulo={cam ? "Parar vídeo" : "Iniciar vídeo"} desligado={!cam} onClick={() => setCam(!cam)}>
                  {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </BotaoSobreVideo>
                {mic && <div className="ml-2 hidden sm:block"><MedidorNivel nivel={nivel} /></div>}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-3 text-[11px] font-medium text-white hover:bg-white/15">
                    <ImageIcon className="h-5 w-5" />Planos de fundo
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-3">
                  <p className="mb-2 text-sm font-medium">Planos de fundo</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => trocarDesfoque(false)} aria-pressed={!desfocar} className={cn("flex aspect-video flex-col items-center justify-center gap-1 rounded-md border text-xs", !desfocar && "border-primary ring-2 ring-primary/40")}>
                      <Ban className="h-4 w-4" />Nenhum
                    </button>
                    <button type="button" onClick={() => trocarDesfoque(true)} aria-pressed={desfocar} className={cn("flex aspect-video flex-col items-center justify-center gap-1 rounded-md border bg-secondary text-xs", desfocar && "border-primary ring-2 ring-primary/40")}>
                      <Sparkles className="h-4 w-4" />Desfocar
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">O desfoque roda no seu navegador. Imagens de fundo personalizadas virão depois.</p>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {erroCamera && <p className="mt-2 text-sm text-destructive">{erroCamera}</p>}
          {audio.erro && mic && <p className="mt-1 text-sm text-destructive">{audio.erro}</p>}
        </section>

        <aside className="space-y-5 lg:pt-10">
          <SeletoresDispositivo escolha={escolha} onTrocar={setEscolha} aparelhos={aparelhos} />
          <OpcoesVideo desfocar={desfocar} onDesfocar={trocarDesfoque} erroFundo={video.erroFundo} sempreMostrar={sempreMostrar} onSempreMostrar={(v) => { setSempreMostrar(v); guardar({ sempreMostrarPrevia: v }); }} />
          <div className="space-y-1.5">
            <Label htmlFor="nome-exibido">Nome de exibição</Label>
            <Input id="nome-exibido" className="h-10" placeholder="Como seu nome aparece no palco" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
          </div>
          {aviso && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">{aviso}</AlertDescription>
            </Alert>
          )}
          <Button className="h-11 w-full text-[15px] font-medium" disabled={entrando} onClick={entrar}>{entrando ? "Entrando…" : rotuloEntrar}</Button>
          <p className="text-center text-xs text-muted-foreground">Ao entrar você fica nos bastidores até ir para o palco.</p>
        </aside>
      </div>
    </div>
  );
}
