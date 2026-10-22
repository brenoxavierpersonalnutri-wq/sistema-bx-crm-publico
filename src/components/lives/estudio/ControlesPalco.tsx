// Linha logo abaixo dos layouts: com 2+ pessoas no palco, escolhe quem fica em destaque (quem aparece no
// "1 pessoa" e o 1º do "2 lado a lado") e, no lado a lado, inverte os dois. O que se escolhe aqui vai para a sala
// (ordem do palco nos atributos do LiveKit), então o render e os outros produtores veem o mesmo.
import { ArrowLeftRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PessoaFila } from "@/components/lives/estudio/FilaBastidores";
import type { LayoutLive } from "@/lib/lives/layout";

interface Props {
  layout: string;
  pessoas: PessoaFila[];
  onDestacar?: (identity: string) => void;
  onInverter?: () => void;
  ocupado?: boolean;
}

/** O que o layout mostra, em uma frase, com os nomes de quem está no palco. */
export function resumoDoLayout(layout: LayoutLive | string, palco: PessoaFila[]): string {
  const nomes = palco.map((p) => p.nome);
  if (!nomes.length) return "Ninguém no palco";
  switch (layout) {
    case "solo":
      return `No ar: ${nomes[0]}`;
    case "lado-a-lado":
      return nomes.length >= 2 ? `No ar: ${nomes[0]} e ${nomes[1]}` : `No ar: ${nomes[0]}`;
    case "grade":
      return `No ar: ${nomes.join(", ")}`;
    default:
      return "";
  }
}

export function ControlesPalco({ layout, pessoas, onDestacar, onInverter, ocupado }: Props) {
  const palco = pessoas.filter((p) => p.noPalco).sort((a, b) => (a.posicao ?? 99) - (b.posicao ?? 99));
  if (palco.length < 2 || !onDestacar) return null;
  const destaque = palco.find((p) => p.destaque) ?? palco[0];
  const resumo = resumoDoLayout(layout, palco);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="controles-palco">
      <label className="inline-flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-amber-500" />
        Destaque
        <select
          aria-label="Destaque do palco"
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
          value={destaque.identity}
          disabled={ocupado}
          onChange={(e) => onDestacar(e.target.value)}
        >
          {palco.map((p) => (
            <option key={p.identity} value={p.identity}>{p.nome}{p.voce ? " (você)" : ""}</option>
          ))}
        </select>
      </label>
      {layout === "lado-a-lado" && onInverter && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={ocupado} onClick={onInverter}>
          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />Inverter
        </Button>
      )}
      {resumo && <span className="truncate" data-testid="resumo-palco">{resumo}</span>}
    </div>
  );
}
