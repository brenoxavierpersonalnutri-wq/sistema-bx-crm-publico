// Avatar redondo de um destino de transmissão (ícones do lucide, cores próprias do sistema).
import { Facebook, Instagram, Presentation, Radio, Youtube } from "lucide-react";
import type { LiveDestino } from "@/lib/lives/api";
import { cn } from "@/lib/utils";

const MAPA: Record<LiveDestino["tipo"], { Icone: typeof Radio; cor: string; rotulo: string }> = {
  youtube: { Icone: Youtube, cor: "bg-red-600", rotulo: "YouTube" },
  facebook: { Icone: Facebook, cor: "bg-blue-600", rotulo: "Facebook" },
  instagram: { Icone: Instagram, cor: "bg-pink-600", rotulo: "Instagram" },
  custom: { Icone: Radio, cor: "bg-slate-600", rotulo: "RTMP personalizado" },
  cloudflare: { Icone: Presentation, cor: "bg-primary", rotulo: "Webinário próprio" },
};

export const rotuloDestino = (t: LiveDestino["tipo"]) => MAPA[t]?.rotulo ?? t;

export function IconeDestino({ tipo, className, noAr }: { tipo: LiveDestino["tipo"]; className?: string; noAr?: boolean }) {
  const m = MAPA[tipo] ?? MAPA.custom;
  return (
    <span title={m.rotulo} className={cn("relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ring-2 ring-background", m.cor, className)}>
      <m.Icone className="h-1/2 w-1/2" />
      {noAr && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />}
    </span>
  );
}

export function PilhaDestinos({ tipos, max = 4 }: { tipos: LiveDestino["tipo"][]; max?: number }) {
  if (!tipos.length) return <span className="text-xs text-muted-foreground">Sem destino</span>;
  return (
    <span className="flex -space-x-2">
      {tipos.slice(0, max).map((t, i) => <IconeDestino key={`${t}-${i}`} tipo={t} />)}
      {tipos.length > max && <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] ring-2 ring-background">+{tipos.length - max}</span>}
    </span>
  );
}
