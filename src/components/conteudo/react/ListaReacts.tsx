import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type ProjetoReact, ROTULO_STATUS } from "@/lib/conteudo/react/api";
import { formatarTempo } from "@/lib/conteudo/react/linhaTempo";

interface Props {
  lista: ProjetoReact[];
  carregando: boolean;
  erro: string | null;
  atualId?: string;
  onAbrir: (p: ProjetoReact) => void;
  onApagar: (p: ProjetoReact) => void;
  onRecarregar: () => void;
}

const COR: Record<ProjetoReact["status"], "default" | "secondary" | "destructive" | "outline"> = {
  rascunho: "outline", enviando: "secondary", montando: "secondary", pronto: "default", erro: "destructive",
};

export function ListaReacts({ lista, carregando, erro, atualId, onAbrir, onApagar, onRecarregar }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Seus reacts</h2>
        <Button variant="ghost" size="sm" onClick={onRecarregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!erro && lista.length === 0 && !carregando && <p className="text-sm text-muted-foreground">Nenhum react ainda.</p>}
      <ul className="divide-y rounded-lg border">
        {lista.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 p-3 text-sm ${p.id === atualId ? "bg-muted/60" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.titulo}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(p.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                {p.duracao_final_seg ? ` · ${formatarTempo(Number(p.duracao_final_seg))}` : ""}
                {p.modo === "separado" ? " · gravado separado" : ""}
              </p>
              {p.status === "erro" && p.erro && <p className="truncate text-xs text-destructive">{p.erro}</p>}
            </div>
            <Badge variant={COR[p.status]}>{ROTULO_STATUS[p.status]}</Badge>
            {p.status !== "rascunho" && <Button size="sm" variant="outline" onClick={() => onAbrir(p)}>Abrir</Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Apagar" onClick={() => onApagar(p)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
