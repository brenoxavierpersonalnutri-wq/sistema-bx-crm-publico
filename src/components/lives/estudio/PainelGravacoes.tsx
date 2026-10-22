// Gravações da sala: a gravação do estúdio (Egress, MP4 no servidor de lives) e a do Cloudflare Stream.
import { Circle, ExternalLink, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { LiveRoomExtra } from "@/lib/lives/painel";

/** Link de reprodução do Cloudflare Stream a partir do HLS da entrada (mesmo subdomínio do cliente). */
export function linkGravacaoCf(sala: Pick<LiveRoomExtra, "cf_hls_url" | "cf_ultima_gravacao">): string | null {
  if (!sala.cf_ultima_gravacao || !sala.cf_hls_url) return null;
  try {
    const u = new URL(sala.cf_hls_url);
    return `${u.origin}/${sala.cf_ultima_gravacao}/watch`;
  } catch {
    return null;
  }
}

export function PainelGravacoes({ sala }: { sala: LiveRoomExtra }) {
  const link = linkGravacaoCf(sala);
  return (
    <div className="space-y-3">
      {sala.gravacao_egress_id && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 p-2 text-sm">
          <Circle className="h-3 w-3 fill-destructive text-destructive" />Gravando agora
        </div>
      )}
      {link ? (
        <div className="rounded-md border p-2 text-sm flex items-center justify-between gap-2">
          <span>Última transmissão (Cloudflare Stream)</span>
          <Button size="sm" variant="outline" asChild><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" />Assistir</a></Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma gravação desta sala ainda. Ao encerrar, a transmissão do webinário próprio fica gravada aqui.</p>
      )}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          O botão Gravar salva um MP4 no servidor de transmissão. A listagem e o download desses arquivos por aqui ainda não foram publicados.
        </AlertDescription>
      </Alert>
    </div>
  );
}
