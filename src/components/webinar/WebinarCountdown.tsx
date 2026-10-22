import { useEffect, useState } from "react";
import { getSecondsUntilNextWebinar } from "@/lib/webinarTime";

export const WebinarCountdown = () => {
  const [secs, setSecs] = useState(() => getSecondsUntilNextWebinar());

  useEffect(() => {
    const id = setInterval(() => setSecs(getSecondsUntilNextWebinar()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="flex flex-col items-center justify-center w-full py-12 text-center">
      <p className="text-sm uppercase tracking-widest text-[#888] mb-3">A aula começa em</p>
      <div className="flex gap-3 sm:gap-6">
        {[
          { label: "horas", value: pad(h) },
          { label: "min", value: pad(m) },
          { label: "seg", value: pad(s) },
        ].map((b) => (
          <div
            key={b.label}
            className="flex flex-col items-center justify-center bg-[#1a1a1a] border border-[#00ff00]/30 rounded-lg px-4 sm:px-6 py-3 sm:py-4 min-w-[70px] sm:min-w-[90px] shadow-[0_0_20px_rgba(0,255,0,0.15)]"
          >
            <span className="text-3xl sm:text-5xl font-bold text-[#00ff00] tabular-nums">{b.value}</span>
            <span className="text-[10px] sm:text-xs uppercase text-[#888] mt-1">{b.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[#888] text-sm max-w-md">
        Aguarde nesta página. A transmissão ao vivo iniciará automaticamente.
      </p>
    </div>
  );
};
