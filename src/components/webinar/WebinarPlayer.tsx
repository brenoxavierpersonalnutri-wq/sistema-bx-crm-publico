import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatHMS, getVideoOffsetSeconds, WEBINAR_DURATION_MINUTES } from "@/lib/webinarTime";

export interface WebinarPlayerHandle {
  getCurrentSeconds: () => number;
}

interface Props {
  videoUrl: string;
  /** Called every ~500ms with current seconds for in-page state (chat sync, CTA gating). */
  onTimeUpdate?: (seconds: number) => void;
}

/**
 * HTML5 video player. Auto-seeks to (now - 19:30 SP) on load and starts playing.
 * For HLS (.m3u8) URLs, browsers without native support will fail silently — Bunny.net
 * usually provides MP4 too; this is a placeholder.
 */
export const WebinarPlayer = forwardRef<WebinarPlayerHandle, Props>(({ videoUrl, onTimeUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);

  useImperativeHandle(ref, () => ({
    getCurrentSeconds: () => videoRef.current?.currentTime ?? getVideoOffsetSeconds(),
  }));

  // Seek to live offset when metadata loads
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleLoaded = () => {
      const offset = getVideoOffsetSeconds();
      const safeOffset = Math.min(offset, Math.max(0, (v.duration || WEBINAR_DURATION_MINUTES * 60) - 1));
      try {
        v.currentTime = safeOffset;
      } catch {
        // ignore
      }
      setDuration(v.duration || 0);
      const playPromise = v.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(() => {
          // Browser blocked autoplay with sound. Try muted autoplay, then prompt user.
          v.muted = true;
          v.play().catch(() => setNeedsTap(true));
        });
      }
    };

    const handleTime = () => {
      const t = v.currentTime;
      setCurrent(t);
      onTimeUpdate?.(t);
    };

    v.addEventListener("loadedmetadata", handleLoaded);
    v.addEventListener("timeupdate", handleTime);
    return () => {
      v.removeEventListener("loadedmetadata", handleLoaded);
      v.removeEventListener("timeupdate", handleTime);
    };
  }, [onTimeUpdate, videoUrl]);

  const handleManualPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play().then(() => setNeedsTap(false)).catch(() => {});
  };

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="relative w-full">
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-[#1a1a1a]">
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          autoPlay
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          className="w-full h-full"
        />
        {needsTap && (
          <button
            type="button"
            onClick={handleManualPlay}
            className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-lg font-semibold"
          >
            ▶ Toque para ativar o som
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#00ff00] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-[#888] tabular-nums whitespace-nowrap">
          {formatHMS(current)} / {formatHMS(duration || WEBINAR_DURATION_MINUTES * 60)}
        </span>
      </div>
    </div>
  );
});

WebinarPlayer.displayName = "WebinarPlayer";
