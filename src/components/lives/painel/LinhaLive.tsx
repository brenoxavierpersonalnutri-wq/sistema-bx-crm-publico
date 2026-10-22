// Uma linha da lista "Estúdios": miniatura 16:9 + título (coluna Título), destinos (coluna Canais) e
// "Entrar no estúdio" com o menu de ações à direita.
import { Link } from "react-router-dom";
import { Copy, MoreHorizontal, Pencil, Play, Presentation, Trash2, Film, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PilhaDestinos } from "@/components/lives/painel/IconeDestino";
import { linkGravacaoCf } from "@/components/lives/estudio/PainelGravacoes";
import { cn } from "@/lib/utils";
import type { ItemPainel } from "@/lib/lives/painel";

const STATUS: Record<string, { rotulo: string; classe?: string; variante?: "secondary" | "outline" }> = {
  ao_vivo: { rotulo: "Ao vivo", classe: "bg-[hsl(var(--sy-ao-vivo))] text-white hover:bg-[hsl(var(--sy-ao-vivo))]" },
  rascunho: { rotulo: "Rascunho", variante: "secondary" },
  encerrada: { rotulo: "Encerrada", variante: "outline" },
  publicado: { rotulo: "Publicado", classe: "bg-primary text-primary-foreground hover:bg-primary" },
  arquivado: { rotulo: "Arquivado", variante: "outline" },
};

function quandoTexto(i: ItemPainel) {
  if (!i.data) return "";
  const d = new Date(i.data);
  const agendada = i.sala?.agendada_em && d > new Date();
  const txt = d.toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return agendada ? `Agendada para ${txt}` : txt;
}

export function LinhaLive({ item, onEditar, onDuplicar, onExcluir }: {
  item: ItemPainel;
  onEditar: (i: ItemPainel) => void;
  onDuplicar: (i: ItemPainel) => void;
  onExcluir: (i: ItemPainel) => void;
}) {
  const st = STATUS[item.status] ?? { rotulo: item.status, variante: "secondary" as const };
  const Icone = item.tipo === "webinar" ? Presentation : Video;
  const capa = item.webinar?.capa_url;
  const gravacao = item.sala ? linkGravacaoCf(item.sala) : null;
  return (
    <li className="grid grid-cols-1 gap-3 px-3 py-4 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-center md:gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-[hsl(var(--sy-icone-fundo))] sm:w-[104px]">
          {capa ? (
            <img src={capa} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: item.sala?.cor ?? undefined }}>
              <Icone className={`h-6 w-6 ${item.sala?.cor ? "text-white/85" : "text-primary/70"}`} strokeWidth={1.75} />
            </div>
          )}
          {item.aoVivo && <span className="absolute left-1 top-1 rounded bg-[hsl(var(--sy-ao-vivo))] px-1.5 py-0.5 text-[10px] font-semibold text-white">AO VIVO</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Icone className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
            <span className="truncate text-[15px] font-medium">{item.titulo}</span>
            <Badge variant={st.variante} className={cn("shrink-0 font-normal", st.classe)}>{st.rotulo}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {item.tipo === "webinar" ? `Webinário · /w/${item.webinar?.slug}` : "Live"}{item.data ? ` · ${quandoTexto(item)}` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.tipo === "webinar" && (
              <Button size="sm" variant="outline" className="h-7 border-primary/40 px-2 text-xs text-primary hover:text-primary" asChild><Link to={`/lives/webinar/${item.id}/ao-vivo`}><Presentation className="mr-1 h-3.5 w-3.5" />Sala ao vivo</Link></Button>
            )}
            {gravacao && (
              <Button size="sm" variant="outline" className="h-7 border-primary/40 px-2 text-xs text-primary hover:text-primary" asChild><a href={gravacao} target="_blank" rel="noreferrer"><Film className="mr-1 h-3.5 w-3.5" />Gravação</a></Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 md:block">
        <span className="text-xs text-muted-foreground md:hidden">Canais:</span>
        <PilhaDestinos tipos={item.destinos} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 md:w-[200px]">
        {item.salaId && (
          <Button variant="outline" className="h-10 border-primary px-4 font-medium text-primary hover:bg-accent hover:text-primary" asChild>
            <Link to={`/lives/estudio/${item.salaId}`}><Play className="mr-1.5 h-4 w-4" />Entrar no estúdio</Link>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.tipo === "webinar" ? (
              <DropdownMenuItem asChild><Link to={`/lives/webinar/${item.id}/editar`}><Pencil className="h-4 w-4 mr-2" />Editar</Link></DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onEditar(item)}><Pencil className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onDuplicar(item)}><Copy className="h-4 w-4 mr-2" />Duplicar</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onExcluir(item)}><Trash2 className="h-4 w-4 mr-2" />Excluir</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
