// Card de oferta da sala ao vivo (manual ou por tempo), botão para o checkout existente ou URL.
import { formatarTempo, destinoOferta, restanteOferta, type OfertaWebinar } from "@/lib/lives/webinarTempo";

export function OfertaAoVivo({ oferta, tempoConteudo, utm, onClique }: { oferta: OfertaWebinar; tempoConteudo: number; utm?: Record<string, string>; onClique?: () => void }) {
  const url = destinoOferta(oferta, window.location.origin, utm);
  const resta = restanteOferta(oferta, tempoConteudo);
  if (!url) return null;
  return (
    <div className="rounded-lg border border-[#00ff00]/40 bg-[#00ff00]/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-lg text-white">{oferta.titulo}</div>
        {oferta.descricao && <div className="text-sm text-white/70">{oferta.descricao}</div>}
        {oferta.preco_texto && <div className="text-[#00ff00] font-semibold mt-1">{oferta.preco_texto}</div>}
        {resta != null && <div className="text-xs text-white/60 mt-1">Encerra em <span className="tabular-nums text-white">{formatarTempo(resta)}</span></div>}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClique}
        className="shrink-0 text-center px-6 py-3 rounded-lg font-extrabold uppercase tracking-wide bg-[#00ff00] text-[#0a0a0a] hover:brightness-110"
      >
        {oferta.cta_texto || "Quero garantir"}
      </a>
    </div>
  );
}
