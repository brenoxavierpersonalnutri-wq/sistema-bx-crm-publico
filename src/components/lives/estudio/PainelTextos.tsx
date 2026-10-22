// Banners e faixas (lower third): lista de cartões; um clique mostra/oculta no palco.
import { useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LiveOverlay } from "@/lib/lives/api";
import { alternarOverlay, apagarOverlay, criarOverlay } from "@/lib/lives/overlays";
import type { TemaFaixa } from "@/lib/lives/layout";
import { cn } from "@/lib/utils";

interface Props {
  roomId: string;
  tipo: "banner" | "lower_third";
  overlays: LiveOverlay[];
  temaPadrao?: TemaFaixa;
  recarregar: () => void;
  /** modo de demonstração: não grava no banco */
  demo?: boolean;
}

export function PainelTextos({ roomId, tipo, overlays, temaPadrao = "bloco", recarregar, demo }: Props) {
  const [texto, setTexto] = useState("");
  const [sub, setSub] = useState("");
  const lista = overlays.filter((o) => o.tipo === tipo);
  const banner = tipo === "banner";
  const [ocupado, setOcupado] = useState<string | null>(null);
  // grava no banco e relê a lista sempre (deu certo ou não), para a tela nunca ficar com o estado velho
  const rodar = async (id: string, fn: () => Promise<unknown>) => {
    if (demo || ocupado) return;
    setOcupado(id);
    try {
      await fn();
    } finally {
      setOcupado(null);
      recarregar();
    }
  };

  const adicionar = async () => {
    if (!texto.trim() || demo) return;
    const conteudo = { texto: texto.trim(), ...(sub.trim() ? { subtitulo: sub.trim() } : {}), ...(banner ? {} : { tema: temaPadrao }) };
    if (await criarOverlay(roomId, tipo, conteudo, overlays.length)) {
      setTexto("");
      setSub("");
      recarregar();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {banner ? "Clique num banner para mostrar no palco. Só um banner aparece por vez." : "Clique numa faixa para mostrar o nome e o cargo no palco."}
      </p>
      <ul className="space-y-2">
        {lista.map((o) => (
          <li key={o.id} className={cn("group rounded-md border p-2 flex items-start gap-2", o.visivel && "border-primary bg-primary/5")}>
            <button type="button" className="flex-1 min-w-0 text-left disabled:opacity-60" disabled={ocupado === o.id} onClick={() => rodar(o.id, () => alternarOverlay(roomId, o, !o.visivel))}>
              <div className="text-sm font-medium break-words">{o.conteudo.texto}</div>
              {o.conteudo.subtitulo && <div className="text-xs text-muted-foreground break-words">{o.conteudo.subtitulo}</div>}
              <div className={cn("mt-1 inline-flex items-center gap-1 text-[11px]", o.visivel ? "text-primary" : "text-muted-foreground")}>
                {o.visivel ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                {o.visivel ? "No palco — clique para ocultar" : "Oculto — clique para mostrar"}
              </div>
            </button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Apagar" disabled={ocupado === o.id} onClick={() => rodar(o.id, () => apagarOverlay(roomId, o))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {!lista.length && <li className="text-xs text-muted-foreground">Nenhum {banner ? "banner" : "faixa"} ainda.</li>}
      </ul>
      <div className="border-t pt-3 space-y-2">
        {banner ? (
          <Textarea rows={2} placeholder="Texto do banner (ex.: Link na descrição)" value={texto} onChange={(e) => setTexto(e.target.value)} />
        ) : (
          <>
            <Input className="h-8" placeholder="Nome" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <Input className="h-8" placeholder="Cargo / subtítulo (opcional)" value={sub} onChange={(e) => setSub(e.target.value)} />
          </>
        )}
        <Button size="sm" className="w-full" disabled={!texto.trim()} onClick={adicionar}>
          <Plus className="h-4 w-4 mr-1" />{banner ? "Criar banner" : "Criar faixa"}
        </Button>
      </div>
    </div>
  );
}
