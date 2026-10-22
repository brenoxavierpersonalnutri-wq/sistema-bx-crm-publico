// Barra de layouts logo abaixo do palco: miniaturas brancas lado a lado, a escolhida com borda azul. Cada ícone é o próprio calcularCena desenhado em miniatura,
// então o desenho do botão nunca diverge do que vai para o ar.
import { Monitor, User } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { calcularCena, LAYOUTS, type LayoutLive, type ParticipanteCena } from "@/lib/lives/layout";
import { cn } from "@/lib/utils";

export interface OpcaoLayout {
  key: string;
  label: string;
  /** layout que ainda depende de backend (ex.: migração no banco): aparece, mas avisa */
  pendente?: string;
}

const AMOSTRA: Record<LayoutLive, ParticipanteCena[]> = {
  solo: [{ identity: "a", attributes: { stage: "1" } }],
  "lado-a-lado": [{ identity: "a", attributes: { stage: "1" } }, { identity: "b", attributes: { stage: "1" } }],
  grade: ["a", "b", "c", "d"].map((identity) => ({ identity, attributes: { stage: "1" } })),
  "tela-pip": [{ identity: "a", attributes: { stage: "1" }, temTela: true }],
  "tela-cheia": [{ identity: "a", attributes: { stage: "1" }, temTela: true }],
};

export const OPCOES_LAYOUT: OpcaoLayout[] = LAYOUTS.map((l) => ({ key: l.key, label: l.label }));

function Miniatura({ opcao, ativo }: { opcao: OpcaoLayout; ativo: boolean }) {
  const amostra = AMOSTRA[opcao.key as LayoutLive];
  return (
    <div className={cn("relative aspect-video w-[52px] overflow-hidden rounded-[3px] sm:w-[60px]", ativo ? "text-primary/70" : "text-muted-foreground/45")}>
      {amostra ? (
        calcularCena(opcao.key as LayoutLive, amostra).map((b) => ({
          // a miniatura de PIP real (22% da largura) some em 60 px: no ícone ela cresce, presa no mesmo canto
          ...b, ...(b.fonte === "camera" && b.w < 0.3 ? { x: 1 - 0.06 - 0.42, y: 1 - 0.08 - 0.5, w: 0.42, h: 0.5 } : {}),
        })).map((b) => (
          <div
            key={b.key}
            data-bloco={b.fonte}
            className={cn("absolute rounded-[2px] border border-background", b.fonte === "tela" ? "bg-current opacity-70" : "bg-current")}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, zIndex: b.z }}
          >
            {b.fonte === "tela"
              ? <Monitor aria-hidden className="absolute inset-0 m-auto h-[60%] w-[60%] text-background" strokeWidth={2.5} />
              : <User aria-hidden className="absolute inset-0 m-auto h-[70%] w-[70%] text-background" strokeWidth={2.5} />}
          </div>
        ))
      ) : (
        <div className="absolute inset-0.5 flex items-center justify-center rounded-[2px] bg-current">
          <Monitor className="h-3.5 w-3.5 text-background" />
        </div>
      )}
    </div>
  );
}

interface Props {
  valor: string;
  onEscolher: (key: LayoutLive) => void;
  onPendente?: (opcao: OpcaoLayout) => void;
  opcoes?: OpcaoLayout[];
  desabilitado?: boolean;
}

export function BarraLayouts({ valor, onEscolher, onPendente, opcoes = OPCOES_LAYOUT, desabilitado }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <div role="radiogroup" aria-label="Layout do palco" className="flex flex-wrap items-center justify-center gap-2">
        {opcoes.map((o) => {
          const ativo = valor === o.key;
          return (
            <Tooltip key={o.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  aria-label={o.label}
                  disabled={desabilitado}
                  data-pendente={o.pendente ? "1" : undefined}
                  onClick={() => (o.pendente ? onPendente?.(o) : onEscolher(o.key as LayoutLive))}
                  className={cn(
                    "rounded-md border-2 bg-background p-1 shadow-sm transition-colors disabled:opacity-50",
                    ativo ? "border-primary" : "border-transparent hover:border-border",
                    o.pendente && "opacity-60",
                  )}
                >
                  <Miniatura opcao={o} ativo={ativo} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{o.label}{o.pendente ? " (em breve)" : ""}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
