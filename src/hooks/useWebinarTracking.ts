import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "webinar_session_id";

function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `wbn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `wbn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export interface UseWebinarTrackingArgs {
  urlVersion: "venda" | "avaliacao";
  /** Returns the current video position in seconds */
  getVideoSeconds: () => number;
}

export function useWebinarTracking({ urlVersion, getVideoSeconds }: UseWebinarTrackingArgs) {
  const sessionIdRef = useRef<string>("");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const sessionId = getOrCreateSessionId();
    sessionIdRef.current = sessionId;

    // Register entry (upsert by session_id)
    void supabase
      .from("webinar_analytics")
      .upsert(
        {
          session_id: sessionId,
          url_version: urlVersion,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
          video_watched_seconds: 0,
        },
        { onConflict: "session_id" },
      )
      .then(({ error }) => {
        if (error) console.warn("[webinar tracking] insert error", error.message);
      });

    // Periodic update every 30s
    const interval = setInterval(() => {
      const seconds = Math.max(0, Math.floor(getVideoSeconds()));
      void supabase
        .from("webinar_analytics")
        .update({ video_watched_seconds: seconds })
        .eq("session_id", sessionId);
    }, 30_000);

    return () => clearInterval(interval);
  }, [urlVersion, getVideoSeconds]);

  const trackCTAClick = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void supabase
      .from("webinar_analytics")
      .update({ clicked_cta: true })
      .eq("session_id", sessionId);
  };

  return { trackCTAClick };
}
