// Menu de configurações da campanha (o painel lateral da Visão geral do SendFlow): o que já existe aqui,
// ligado ou desligado, com atalho para onde se configura, e o que ainda não tem motor (em breve).
import { Check, Circle, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampanhaGrupos } from "@/lib/grupos";
import { recursosDaCampanha } from "@/lib/painelGrupos";

export function RecursosCampanha({ campanha, onAbrir }: { campanha: CampanhaGrupos; onAbrir: (aba: string) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-2">
      <p className="px-2 py-1.5 text-sm font-semibold border-l-2 border-amber-400">Configurações da campanha</p>
      <ul className="mt-1">
        {recursosDaCampanha(campanha).map((r) => (
          <li key={r.chave}>
            <button type="button" disabled={r.emBreve} onClick={() => r.aba && onAbrir(r.aba)} title={r.descricao}
              className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", r.emBreve ? "opacity-60 cursor-default" : "hover:bg-muted/50")}>
              {r.emBreve ? <Hourglass className="h-3.5 w-3.5 text-amber-400" /> : r.ligado ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="flex-1 truncate">{r.titulo}</span>
              <span className="text-[10px] uppercase text-muted-foreground">{r.emBreve ? "em breve" : r.ligado ? "ativado" : "desativado"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
