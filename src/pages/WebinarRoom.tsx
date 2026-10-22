import { useCallback, useEffect, useRef, useState } from "react";
import { WebinarCountdown } from "@/components/webinar/WebinarCountdown";
import { WebinarPlayer, WebinarPlayerHandle } from "@/components/webinar/WebinarPlayer";
import { WebinarChat } from "@/components/webinar/WebinarChat";
import { WebinarLiveIndicator } from "@/components/webinar/WebinarLiveIndicator";
import { getSecondsUntilNextWebinar, getVideoOffsetSeconds, isWebinarLive, isWebinarOver } from "@/lib/webinarTime";
import { useWebinarTracking } from "@/hooks/useWebinarTracking";

// Placeholder público — substituir pela URL do Bunny.net em produção
const PLACEHOLDER_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

interface Props {
  variant: "venda" | "avaliacao";
  videoUrl?: string;
  /** Force a screen state for debugging (?force=countdown|live|over) */
  forceScreen?: "countdown" | "live" | "over";
}

export default function WebinarRoom({ variant, videoUrl, forceScreen }: Props) {
  const [, setTick] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(() => getVideoOffsetSeconds());
  const playerRef = useRef<WebinarPlayerHandle>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleTimeUpdate = useCallback((s: number) => setCurrentSeconds(s), []);
  const getVideoSeconds = useCallback(
    () => playerRef.current?.getCurrentSeconds() ?? getVideoOffsetSeconds(),
    [],
  );
  useWebinarTracking({ urlVersion: variant, getVideoSeconds });

  useEffect(() => {
    document.title = variant === "venda" ? "Aula Ao Vivo • Oferta Especial" : "Aula Ao Vivo • Avaliação Gratuita";
  }, [variant]);

  // Decide screen
  let screen: "countdown" | "live" | "over";
  if (forceScreen) {
    screen = forceScreen;
  } else if (isWebinarLive()) {
    screen = "live";
  } else if (isWebinarOver() && getSecondsUntilNextWebinar() > 0) {
    screen = "over";
  } else {
    screen = "countdown";
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
        <div className="mb-4">
          <WebinarLiveIndicator />
        </div>

        {screen === "countdown" && (
          <div className="bg-[#1a1a1a] rounded-lg border border-[#262626] p-6 sm:p-10">
            <WebinarCountdown />
          </div>
        )}

        {screen === "over" && (
          <div className="bg-[#1a1a1a] rounded-lg border border-[#262626] p-10 text-center">
            <h2 className="text-2xl font-bold mb-3">A transmissão foi encerrada</h2>
            <p className="text-[#888]">
              Obrigado por participar! A próxima aula começa em breve.
            </p>
          </div>
        )}

        {screen === "live" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 lg:gap-6">
            <div className="flex flex-col gap-4">
              <WebinarPlayer
                ref={playerRef}
                videoUrl={videoUrl ?? PLACEHOLDER_VIDEO_URL}
                onTimeUpdate={handleTimeUpdate}
              />
            </div>
            <div className="lg:h-[calc(100vh-140px)] lg:sticky lg:top-4">
              <WebinarChat currentSeconds={currentSeconds} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
