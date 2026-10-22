// Fila de participantes abaixo do palco. Quem está nos bastidores só é visto/ouvido pela produção;
// o anfitrião passa o mouse na miniatura e coloca a pessoa no palco (ou tira) e escolhe quem fica em destaque
// (o destaque é quem aparece no layout "1 pessoa" e o 1º do "2 lado a lado"). Clicar na miniatura de quem já
// está no palco também destaca.
import type { ReactNode } from "react";
import { MicOff, MonitorUp, Star, UserPlus, UserMinus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { iniciais } from "@/components/lives/QuadroCena";
import { cn } from "@/lib/utils";

export interface PessoaFila {
  identity: string;
  nome: string;
  noPalco: boolean;
  papel?: string;
  temTela?: boolean;
  micDesligado?: boolean;
  voce?: boolean;
  /** é o destaque do palco (o 1º da ordem) */
  destaque?: boolean;
  /** posição no palco (1 = destaque), só para quem está no palco */
  posicao?: number;
  /** vídeo da câmera; sem ele, aparece o avatar com as iniciais */
  video?: ReactNode;
}

interface Props {
  pessoas: PessoaFila[];
  onAlternar: (identity: string, subir: boolean) => void;
  onRemover?: (identity: string) => void;
  /** põe a pessoa em destaque (vira a 1ª do palco) */
  onDestacar?: (identity: string) => void;
  ocupado?: string | null;
  vazio?: ReactNode;
}

export function FilaBastidores({ pessoas, onAlternar, onRemover, onDestacar, ocupado, vazio }: Props) {
  if (!pessoas.length) {
    return <div className="text-sm text-muted-foreground text-center py-4">{vazio ?? "Ninguém na sala ainda. Convide alguém pelo link."}</div>;
  }
  return (
    <ul aria-label="Bastidores" className="flex gap-3 overflow-x-auto pb-1 [&>li:first-child]:ml-auto [&>li:last-child]:mr-auto">
      {pessoas.map((p) => (
        <li key={p.identity} data-testid={`fila-${p.identity}`} className="w-36 shrink-0 sm:w-[156px]">
          <div className={cn("group relative aspect-video overflow-hidden rounded-lg border-2 bg-neutral-800 shadow-sm", p.noPalco ? "border-primary" : "border-transparent")}>
            {p.video ?? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{iniciais(p.nome)}</div>
              </div>
            )}
            {p.noPalco && <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">No palco</span>}
            {p.noPalco && (p.destaque ? (
              <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-900"><Star className="h-2.5 w-2.5 fill-current" />Destaque</span>
            ) : p.posicao ? (
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{p.posicao}º</span>
            ) : null)}
            <div className="absolute right-1 top-1 flex gap-1">
              {p.temTela && <MonitorUp aria-label="compartilhando tela" className="h-4 w-4 rounded bg-black/60 p-0.5 text-white" />}
              {p.micDesligado && <MicOff aria-label="microfone desligado" className="h-4 w-4 rounded bg-destructive p-0.5 text-white" />}
            </div>
            <div
              className={cn(
                "absolute inset-0 flex flex-wrap content-center items-center justify-center gap-1 bg-black/50 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
                p.noPalco && !p.destaque && onDestacar && "cursor-pointer",
              )}
              onClick={(e) => {
                if (e.target === e.currentTarget && p.noPalco && !p.destaque && onDestacar && ocupado !== p.identity) onDestacar(p.identity);
              }}
            >
              <Button size="sm" variant={p.noPalco ? "secondary" : "default"} className="h-7 px-2 text-xs" disabled={ocupado === p.identity} onClick={() => onAlternar(p.identity, !p.noPalco)}>
                {p.noPalco ? <UserMinus className="h-3.5 w-3.5 mr-1" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />}
                {p.noPalco ? "Tirar do palco" : "Colocar no palco"}
              </Button>
              {onDestacar && p.noPalco && !p.destaque && (
                <Button size="sm" variant="default" className="h-7 px-2 text-xs" disabled={ocupado === p.identity} onClick={() => onDestacar(p.identity)}>
                  <Star className="h-3.5 w-3.5 mr-1" />Destacar
                </Button>
              )}
              {onRemover && p.papel !== "produtor" && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:text-white hover:bg-white/20" aria-label={`Tirar ${p.nome} da sala`} onClick={() => onRemover(p.identity)}>
                  <UserX className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-1.5 truncate text-center text-xs text-muted-foreground">{p.nome}{p.voce ? " (você)" : ""}</div>
        </li>
      ))}
    </ul>
  );
}
