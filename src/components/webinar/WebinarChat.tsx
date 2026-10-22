import { memo, useEffect, useMemo, useRef } from "react";
import { CHAT_MESSAGES, HOST_NAMES } from "@/lib/webinarChat";

interface Props {
  currentSeconds: number;
}

export const WebinarChat = memo(({ currentSeconds }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentMinute = Math.floor(currentSeconds / 60);

  const visible = useMemo(
    () => CHAT_MESSAGES.filter((m) => m.minute <= currentMinute),
    [currentMinute],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length]);

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] rounded-lg border border-[#262626] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00ff00] animate-pulse" />
          <span className="text-sm font-semibold text-white">Chat ao vivo</span>
        </div>
        <span className="text-[10px] text-[#888] uppercase tracking-wider">{visible.length} msgs</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-[300px] lg:min-h-0"
      >
        {visible.length === 0 && (
          <p className="text-center text-[#666] text-sm py-8">Aguardando mensagens...</p>
        )}
        {visible.map((m, i) => {
          const isHost = HOST_NAMES.has(m.sender);
          return (
            <div
              key={`${i}-${m.minute}`}
              className={`px-3 py-2 rounded-md text-sm ${
                isHost
                  ? "bg-[#00ff00]/10 border border-[#00ff00]/30"
                  : "bg-[#262626] border border-[#333]"
              }`}
            >
              <div className={`font-bold text-xs mb-0.5 ${isHost ? "text-[#00ff00]" : "text-[#FFD700]"}`}>
                {m.sender}
                {isHost && <span className="ml-1 text-[9px] uppercase">host</span>}
              </div>
              <div className="text-white/90 leading-snug">{m.message}</div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 border-t border-[#262626]">
        <input
          disabled
          placeholder="Chat moderado durante a transmissão..."
          className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-xs text-[#666] placeholder:text-[#555] focus:outline-none"
        />
      </div>
    </div>
  );
});

WebinarChat.displayName = "WebinarChat";
