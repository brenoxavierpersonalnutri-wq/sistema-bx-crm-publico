import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FAIXAS_POR_REGRA,
  NOME_NIVEL,
  referenciaMeta,
  type NivelSinal,
  type RegraSinal,
} from "@/lib/sinalMetricas";

export type { RegraSinal };

// Cores do sinal. Vermelho e verde são os tokens do tema (destructive/success);
// laranja, amarelo e ouro saem da paleta core do Tailwind, que o resto da tela
// já usa nos ícones dos cards. Ouro leva um troféu pra não confundir com o
// laranja/amarelo em tela pequena.
export const CLASSES_SINAL: Record<NivelSinal, { badge: string; borda: string; ponto: string }> = {
  vermelho: { badge: "bg-destructive/10 text-destructive border-destructive/40", borda: "border-destructive/40", ponto: "bg-destructive" },
  laranja: { badge: "bg-orange-500/10 text-orange-600 border-orange-500/40", borda: "border-orange-500/40", ponto: "bg-orange-500" },
  amarelo: { badge: "bg-yellow-400/15 text-yellow-700 border-yellow-500/50", borda: "border-yellow-500/50", ponto: "bg-yellow-400" },
  verde: { badge: "bg-success/10 text-success border-success/40", borda: "border-success/40", ponto: "bg-success" },
  ouro: { badge: "bg-amber-400/15 text-amber-700 border-amber-500/60", borda: "border-amber-500/60", ponto: "bg-amber-500" },
};

const TITULO_LEGENDA: Record<RegraSinal, string> = {
  feitas: "Feitas sobre as agendadas",
  confirmadas: "Confirmadas sobre o total",
};

interface SinalBadgeProps {
  nivel: NivelSinal | null;
  regra: RegraSinal;
  children: ReactNode;
  className?: string;
}

/** Pílula colorida no percentual + legenda das faixas no tooltip. */
export function SinalBadge({ nivel, regra, children, className = "" }: SinalBadgeProps) {
  const cores = nivel ? CLASSES_SINAL[nivel].badge : "bg-muted text-muted-foreground border-border";
  const faixas = FAIXAS_POR_REGRA[regra];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sinal={nivel ?? "sem-base"}
          aria-label={nivel ? `Sinal ${NOME_NIVEL[nivel]}` : "Sem base para o sinal"}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cores} ${className}`}
        >
          {nivel === "ouro" && <Trophy className="h-3 w-3" aria-hidden />}
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p className="font-semibold mb-1">{TITULO_LEGENDA[regra]}</p>
        <ul className="space-y-0.5">
          {faixas.map((f) => (
            <li key={f.nivel} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${CLASSES_SINAL[f.nivel].ponto}`} />
              <span className={f.nivel === nivel ? "font-semibold" : ""}>
                {NOME_NIVEL[f.nivel]}: {f.rotulo}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 pt-1.5 border-t border-border/60">{referenciaMeta(regra).completa}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Referência sempre visível embaixo da pílula: a meta (faixa verde) e o ouro,
 * em duas linhas curtas. O texto sai das faixas em `sinalMetricas.ts`; a frase
 * inteira fica no `title` e na legenda do tooltip.
 */
export function ReferenciaMetaSinal({ regra, className = "" }: { regra: RegraSinal; className?: string }) {
  const ref = referenciaMeta(regra);
  return (
    <p
      data-referencia={regra}
      title={ref.completa}
      className={`text-xs text-muted-foreground leading-snug ${className}`}
    >
      <span className="block">{ref.meta}</span>
      <span className="block">{ref.ouro}</span>
    </p>
  );
}
