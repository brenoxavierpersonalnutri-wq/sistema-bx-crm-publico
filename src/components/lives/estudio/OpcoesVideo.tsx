// Opções de vídeo da prévia e das Configurações (como na prévia do Zoom): desfocar o fundo,
// enquadrar automaticamente (ainda não existe: fica desligado com "em breve") e "sempre mostrar a prévia".
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const DICA_ENQUADRAR = "Em breve. Enquanto isso, no Mac: Central de Controle > Efeitos de vídeo > Enquadramento Centralizado (aparece quando a câmera suporta, como a do iPhone).";

export function OpcoesVideo({ desfocar, onDesfocar, erroFundo, sempreMostrar, onSempreMostrar }: {
  desfocar: boolean;
  onDesfocar: (v: boolean) => void;
  erroFundo?: string | null;
  sempreMostrar?: boolean;
  onSempreMostrar?: (v: boolean) => void;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="op-desfocar" className="text-sm font-normal">Desfocar meu plano de fundo</Label>
          <Switch id="op-desfocar" checked={desfocar} onCheckedChange={onDesfocar} />
        </div>
        {erroFundo && desfocar && <p className="text-xs text-destructive">{erroFundo}</p>}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-between gap-3" data-testid="op-enquadrar">
              <Label htmlFor="op-enquadrar" className="text-sm font-normal text-muted-foreground">
                Enquadrar meu vídeo automaticamente <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide">em breve</span>
              </Label>
              <Switch id="op-enquadrar" checked={false} disabled aria-describedby="dica-enquadrar" />
            </div>
          </TooltipTrigger>
          <TooltipContent id="dica-enquadrar" className="max-w-xs text-xs">{DICA_ENQUADRAR}</TooltipContent>
        </Tooltip>
        {onSempreMostrar && (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox id="op-previa" checked={!!sempreMostrar} onCheckedChange={(v) => onSempreMostrar(v === true)} />
            <Label htmlFor="op-previa" className="text-sm font-normal">Sempre mostrar essa prévia ao entrar</Label>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
