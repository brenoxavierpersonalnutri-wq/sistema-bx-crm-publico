import { useEffect, useState } from "react";

// `presentes` (opcional): contagem real do webinário ao vivo (/w/:slug/sala). Sem ela, mantém
// o comportamento antigo do /webinar (número simulado). `ocultarPresentes` esconde o contador.
export const WebinarLiveIndicator = ({ presentes, ocultarPresentes = false }: { presentes?: number; ocultarPresentes?: boolean } = {}) => {
  const [simulado, setSimulado] = useState(() => 45 + Math.floor(Math.random() * 18));

  useEffect(() => {
    if (presentes !== undefined) return;
    const id = setInterval(() => {
      setSimulado(45 + Math.floor(Math.random() * 18));
    }, 10_000);
    return () => clearInterval(id);
  }, [presentes]);
  const viewers = presentes ?? simulado;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#1a1a1a] border border-[#262626] rounded-lg">
      <div className="flex items-center gap-2">
        <span className="relative inline-flex">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping opacity-75" />
        </span>
        <span className="text-sm font-bold text-white tracking-wider">AO VIVO</span>
      </div>
      {!ocultarPresentes && <div className="flex items-center gap-2 text-sm text-[#888]">
        <span>👥</span>
        <span className="text-white font-semibold tabular-nums">{viewers}</span>
        <span className="hidden sm:inline">assistindo agora</span>
      </div>}
    </div>
  );
};
