// Barra inferior central do estúdio: uma faixa branca com sombra e botões grandes com ícone e rótulo
// (Mudo, Desligar câmera, Compartilhar, Convidar, Configurações e Sair do estúdio). Com `aparelhos`, Mudo e
// Câmera ganham a setinha (^) do Zoom: lista de aparelhos, troca ao vivo, desfoque e atalho para as Configurações.
import type { ReactNode } from "react";
import { MenuCamera, MenuMicrofone, useAparelhosComAviso, type ControleAparelhos } from "@/components/lives/estudio/MenuAparelhos";
import { LogOut, Mic, MicOff, MonitorUp, MonitorX, Settings, UserPlus, Video, VideoOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  mic: boolean;
  cam: boolean;
  tela: boolean;
  onMic: () => void;
  onCam: () => void;
  onTela: () => void;
  onConvidar?: () => void;
  onConfig?: () => void;
  onSair: () => void;
  /** liga as setinhas de microfone/câmera */
  aparelhos?: ControleAparelhos;
}

function Botao({ rotulo, alerta, ativo, onClick, children }: { rotulo: string; alerta?: boolean; ativo?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={rotulo}
          aria-pressed={ativo}
          onClick={onClick}
          className={cn(
            "flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:h-[60px] sm:w-[96px]",
            alerta && "text-destructive hover:text-destructive",
            ativo && "bg-accent text-primary hover:bg-accent hover:text-primary",
          )}
        >
          {children}
          <span className="hidden whitespace-nowrap text-xs sm:block">{rotulo}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="sm:hidden">{rotulo}</TooltipContent>
    </Tooltip>
  );
}

const ICONE = "h-[22px] w-[22px]";

function BotaoMic({ mic, onMic }: { mic: boolean; onMic: () => void }) {
  return <Botao rotulo={mic ? "Mudo" : "Ativar som"} alerta={!mic} onClick={onMic}>{mic ? <Mic className={ICONE} strokeWidth={1.75} /> : <MicOff className={ICONE} strokeWidth={1.75} />}</Botao>;
}

function BotaoCam({ cam, onCam }: { cam: boolean; onCam: () => void }) {
  return <Botao rotulo={cam ? "Desligar câmera" : "Ligar câmera"} alerta={!cam} onClick={onCam}>{cam ? <Video className={ICONE} strokeWidth={1.75} /> : <VideoOff className={ICONE} strokeWidth={1.75} />}</Botao>;
}

/** Mudo e Câmera com as setinhas; a lista de aparelhos é uma só (um aviso por aparelho que conecta). */
function MicCamComMenu({ mic, cam, onMic, onCam, controle }: { mic: boolean; cam: boolean; onMic: () => void; onCam: () => void; controle: ControleAparelhos }) {
  const aparelhos = useAparelhosComAviso();
  return (
    <>
      <div className="flex shrink-0 items-center"><BotaoMic mic={mic} onMic={onMic} /><MenuMicrofone controle={controle} aparelhos={aparelhos} /></div>
      <div className="flex shrink-0 items-center"><BotaoCam cam={cam} onCam={onCam} /><MenuCamera controle={controle} aparelhos={aparelhos} /></div>
    </>
  );
}

export function BarraControles({ mic, cam, tela, onMic, onCam, onTela, onConvidar, onConfig, onSair, aparelhos }: Props) {
  const i = ICONE;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-background px-1.5 py-1 shadow-[0_2px_8px_rgba(16,24,40,0.08)] sm:gap-1">
        {aparelhos ? (
          <MicCamComMenu mic={mic} cam={cam} onMic={onMic} onCam={onCam} controle={{ onConfig, ...aparelhos }} />
        ) : (
          <>
            <BotaoMic mic={mic} onMic={onMic} />
            <BotaoCam cam={cam} onCam={onCam} />
          </>
        )}
        <Botao rotulo={tela ? "Parar tela" : "Compartilhar"} ativo={tela} onClick={onTela}>{tela ? <MonitorX className={i} strokeWidth={1.75} /> : <MonitorUp className={i} strokeWidth={1.75} />}</Botao>
        {onConvidar && <Botao rotulo="Convidar" onClick={onConvidar}><UserPlus className={i} strokeWidth={1.75} /></Botao>}
        {onConfig && <Botao rotulo="Configurações" onClick={onConfig}><Settings className={i} strokeWidth={1.75} /></Botao>}
        <div className="mx-1 h-8 w-px shrink-0 bg-border" />
        <Botao rotulo="Sair do estúdio" onClick={onSair}><LogOut className={i} strokeWidth={1.75} /></Botao>
      </div>
    </TooltipProvider>
  );
}
