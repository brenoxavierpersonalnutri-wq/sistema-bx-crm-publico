import { useState } from "react";
import { Play } from "lucide-react";
import { youtubeEmbed, youtubeThumb } from "@/lib/appAluna/types";
import { cn } from "@/lib/utils";

interface Props {
  youtubeId?: string | null;
  titulo?: string;
  className?: string;
  /** Carrega o iframe só depois do clique — a lista de exercícios pode ter
   *  dezenas de vídeos e embutir todos de uma vez trava o celular da aluna. */
  lazy?: boolean;
}

export function YoutubePlayer({ youtubeId, titulo, className, lazy = true }: Props) {
  const [tocando, setTocando] = useState(!lazy);

  if (!youtubeId) {
    return (
      <div className={cn(
        "flex aspect-video w-full items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground",
        className,
      )}>
        Vídeo não cadastrado
      </div>
    );
  }

  if (!tocando) {
    return (
      <button
        type="button"
        onClick={() => setTocando(true)}
        aria-label={titulo ? `Assistir ${titulo}` : "Assistir vídeo"}
        className={cn(
          "group relative aspect-video w-full overflow-hidden rounded-xl bg-black",
          className,
        )}
      >
        <img
          src={youtubeThumb(youtubeId) ?? ""}
          alt={titulo ?? "Demonstração do exercício"}
          loading="lazy"
          className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-110">
            <Play className="ml-0.5 h-6 w-6 fill-black text-black" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={cn("aspect-video w-full overflow-hidden rounded-xl bg-black", className)}>
      <iframe
        src={youtubeEmbed(youtubeId) ?? ""}
        title={titulo ?? "Demonstração do exercício"}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
