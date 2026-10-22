// Alternância de tema (automático / claro / escuro): três botões numa pílula, o ativo em branco.
import { Monitor, Moon, Sun } from "lucide-react";
import type { PreferenciaTema } from "@/components/lives/estudio/temaEscuro";
import { cn } from "@/lib/utils";

const OPCOES: { v: PreferenciaTema; rotulo: string; Icone: typeof Sun }[] = [
  { v: "auto", rotulo: "Tema automático", Icone: Monitor },
  { v: "claro", rotulo: "Tema claro", Icone: Sun },
  { v: "escuro", rotulo: "Tema escuro", Icone: Moon },
];

export function SeletorTema({ pref, onTrocar, className }: { pref: PreferenciaTema; onTrocar: (p: PreferenciaTema) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Tema" className={cn("inline-flex items-center rounded-full bg-secondary p-1", className)}>
      {OPCOES.map(({ v, rotulo, Icone }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={pref === v}
          aria-label={rotulo}
          title={rotulo}
          onClick={() => onTrocar(v)}
          className={cn(
            "flex h-8 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors",
            pref === v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
          )}
        >
          <Icone className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
