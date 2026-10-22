import { useEffect, useMemo, useState } from "react";
import { formatHMS } from "@/lib/webinarTime";

interface Props {
  variant: "venda" | "avaliacao";
  /** Current video position in seconds (drives appearance + countdown) */
  currentSeconds: number;
  redirectUrl: string;
  onClick?: () => void;
}

const CTA_START_MIN = 35;
const CTA_DURATION_MIN = 15;

export const WebinarCTA = ({ variant, currentSeconds, redirectUrl, onClick }: Props) => {
  const startSec = CTA_START_MIN * 60;
  const endSec = (CTA_START_MIN + CTA_DURATION_MIN) * 60;
  const visible = currentSeconds >= startSec && currentSeconds < endSec;
  const remaining = Math.max(0, endSec - currentSeconds);

  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setPulse(true);
  }, [visible]);

  const config = useMemo(() => {
    if (variant === "venda") {
      return {
        text: "🔥 GARANTIR VAGA COM 50% OFF",
        color: "#00ff00",
        textColor: "#0a0a0a",
        glow: "0 0 30px rgba(0,255,0,0.6), 0 0 60px rgba(0,255,0,0.3)",
      };
    }
    return {
      text: "🎁 AGENDAR MINHA AVALIAÇÃO GRATUITA",
      color: "#FFD700",
      textColor: "#0a0a0a",
      glow: "0 0 30px rgba(255,215,0,0.6), 0 0 60px rgba(255,215,0,0.3)",
    };
  }, [variant]);

  if (!visible) return null;

  const handleClick = () => {
    onClick?.();
    window.open(redirectUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="w-full flex flex-col items-center gap-3 py-4">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-[#888]">Oferta encerra em</p>
        <p
          className="text-2xl sm:text-3xl font-bold tabular-nums mt-1"
          style={{ color: config.color }}
        >
          {formatHMS(remaining)}
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        className={`w-full max-w-xl py-4 sm:py-5 px-6 rounded-lg font-extrabold text-base sm:text-lg uppercase tracking-wide transition-transform hover:scale-[1.02] active:scale-[0.98] ${
          pulse ? "animate-[wbn-pulse_1.5s_ease-in-out_infinite]" : ""
        }`}
        style={{
          background: config.color,
          color: config.textColor,
          boxShadow: config.glow,
        }}
      >
        {config.text}
      </button>
      <style>{`
        @keyframes wbn-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.03); filter: brightness(1.15); }
        }
      `}</style>
    </div>
  );
};
