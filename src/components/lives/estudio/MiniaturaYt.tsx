// Miniatura da live programada: botão próprio "Escolher imagem" (input escondido + click), prévia, nome e tamanho.
// Aceita qualquer imagem que o navegador abra: JPG/PNG até 2 MB vão como estão; WebP, AVIF, GIF ou imagem acima de
// 2 MB viram JPEG 1280x720 (no máximo) no próprio navegador. O seletor com accept="image/jpeg,image/png" deixava
// HEIC/WebP cinza no macOS (parecia que "não deixa selecionar").
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatarTamanho, prepararMiniatura } from "@/lib/lives/miniatura";

export function MiniaturaYt({ valor, onChange, jaEnviada, desabilitado }: {
  valor: File | null;
  onChange: (f: File | null) => void;
  jaEnviada?: boolean;
  desabilitado?: boolean;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);

  useEffect(() => {
    if (!valor || typeof URL.createObjectURL !== "function") return setPrevia(null);
    const u = URL.createObjectURL(valor);
    setPrevia(u);
    return () => URL.revokeObjectURL(u);
  }, [valor]);

  const escolher = async (f: File | undefined) => {
    if (entrada.current) entrada.current.value = ""; // escolher o mesmo arquivo de novo dispara o onChange
    if (!f) return;
    setPreparando(true);
    try {
      const r = await prepararMiniatura(f);
      if (r.ok === false) return toast.error(r.motivo, { duration: 8000 });
      if (r.convertida) toast.info(`Imagem convertida para JPEG (${formatarTamanho(r.arquivo.size)}) para caber no limite do YouTube`);
      onChange(r.arquivo);
    } finally {
      setPreparando(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>Miniatura (opcional)</Label>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="miniatura-arquivo"
        onChange={(e) => escolher(e.target.files?.[0])}
      />
      {valor ? (
        <div className="flex items-center gap-2 rounded-md border p-1.5">
          {previa && <img src={previa} alt="Prévia da miniatura" className="h-12 w-[85px] shrink-0 rounded object-cover" />}
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium" title={valor.name}>{valor.name}</div>
            <div className="text-muted-foreground">{formatarTamanho(valor.size)} · vai para o YouTube ao programar</div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Tirar miniatura" onClick={() => onChange(null)}><X className="h-4 w-4" /></Button>
        </div>
      ) : null}
      <Button type="button" size="sm" variant="outline" disabled={desabilitado || preparando} onClick={() => entrada.current?.click()}>
        {preparando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1.5 h-4 w-4" />}
        {valor ? "Trocar imagem" : "Escolher imagem"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        JPG ou PNG até 2 MB (outras imagens são convertidas). 1280x720 é o tamanho ideal.
        {jaEnviada && !valor ? " Miniatura já enviada." : ""} O canal precisa estar verificado por telefone no YouTube para aceitar miniatura.
      </p>
    </div>
  );
}
