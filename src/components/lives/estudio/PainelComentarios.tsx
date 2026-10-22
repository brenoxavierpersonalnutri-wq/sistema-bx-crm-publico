// Comentários dos destinos (YouTube/Facebook/Instagram) com "mostrar no palco".
// A leitura dos comentários depende de integração com a API de cada rede, que ainda não existe:
// a estrutura já está aqui e o destaque usa o overlay "banner" que o palco já desenha.
import { Info, MessageSquareQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { LiveDestino, LiveOverlay } from "@/lib/lives/api";
import { alternarOverlay, criarOverlay } from "@/lib/lives/overlays";
import { IconeDestino } from "@/components/lives/painel/IconeDestino";

export interface Comentario {
  id: string;
  origem: LiveDestino["tipo"];
  autor: string;
  texto: string;
  em: string;
}

interface Props {
  roomId: string;
  comentarios: Comentario[];
  overlays: LiveOverlay[];
  recarregar: () => void;
  demo?: boolean;
}

export function PainelComentarios({ roomId, comentarios, overlays, recarregar, demo }: Props) {
  const emDestaque = overlays.find((o) => o.tipo === "banner" && o.visivel && (o.conteudo as Record<string, unknown>).origem === "comentario");

  const destacar = async (c: Comentario) => {
    if (demo) return;
    const ov = await criarOverlay(roomId, "banner", { texto: c.texto, subtitulo: c.autor, origem: "comentario" }, overlays.length);
    if (ov && (await alternarOverlay(roomId, ov, true))) recarregar();
  };
  const ocultar = async () => {
    if (demo || !emDestaque) return;
    if (await alternarOverlay(roomId, emDestaque, false)) recarregar();
  };

  return (
    <div className="space-y-3">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Os comentários das redes ainda não chegam aqui: falta a integração com as APIs do YouTube, Facebook e Instagram. Quando entrar, cada comentário aparece nesta lista com o botão para mostrar no palco.
        </AlertDescription>
      </Alert>
      {emDestaque && (
        <div className="rounded-md border border-primary bg-primary/5 p-2 text-xs flex items-center justify-between gap-2">
          <span className="truncate">No palco: {emDestaque.conteudo.texto}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={ocultar}>Ocultar</Button>
        </div>
      )}
      <ul className="space-y-2">
        {comentarios.map((c) => (
          <li key={c.id} className="group rounded-md border p-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconeDestino tipo={c.origem} className="h-5 w-5" />
              <span className="font-medium text-foreground">{c.autor}</span>
            </div>
            <p className="mt-1 text-sm break-words">{c.texto}</p>
            <Button size="sm" variant="secondary" className="mt-2 h-7 w-full" onClick={() => destacar(c)}>
              <MessageSquareQuote className="h-3.5 w-3.5 mr-1" />Mostrar no palco
            </Button>
          </li>
        ))}
        {!comentarios.length && <li className="text-xs text-muted-foreground text-center py-6">Nenhum comentário.</li>}
      </ul>
    </div>
  );
}
