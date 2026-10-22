import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  formatHMS,
  getSaoPauloNowDate,
  getNextWebinarTime,
  getSecondsUntilNextWebinar,
  getVideoOffsetSeconds,
  isWebinarLive,
  isWebinarOver,
  WEBINAR_DURATION_MINUTES,
} from "@/lib/webinarTime";

export default function WebinarDebug() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const sp = getSaoPauloNowDate();
  const next = getNextWebinarTime();
  const status = isWebinarLive() ? "🔴 Ao vivo" : isWebinarOver() ? "⏹️ Encerrado" : "⏳ Aguardando";

  const fmtClock = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-2 border-b border-[#262626]">
      <span className="text-[#888]">{label}</span>
      <span className="text-white font-mono">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Webinar Debug</h1>
        <p className="text-[#888] mb-6 text-sm">
          Modo de teste: webinar roda a cada hora cheia (HH:00), duração de {WEBINAR_DURATION_MINUTES} min.
        </p>

        <div className="bg-[#1a1a1a] border border-[#262626] rounded-lg p-5 mb-6">
          <Row label="Hora atual (São Paulo)" value={fmtClock(sp)} />
          <Row label="Próximo webinar às" value={fmtClock(next)} />
          <Row label="Faltam" value={formatHMS(getSecondsUntilNextWebinar())} />
          <Row label="Offset do vídeo agora" value={`${getVideoOffsetSeconds()}s`} />
          <Row label="Duração configurada" value={`${WEBINAR_DURATION_MINUTES} min`} />
          <Row label="Status" value={status} />
        </div>

        <h2 className="text-lg font-semibold mb-3">Forçar tela</h2>
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: "Countdown (venda)", to: "/webinar/venda?force=countdown" },
            { label: "Ao vivo (venda)", to: "/webinar/venda?force=live" },
            { label: "Encerrado (venda)", to: "/webinar/venda?force=over" },
            { label: "Real (venda)", to: "/webinar/venda" },
            { label: "Countdown (avaliação)", to: "/webinar/avaliacao?force=countdown" },
            { label: "Ao vivo (avaliação)", to: "/webinar/avaliacao?force=live" },
            { label: "Encerrado (avaliação)", to: "/webinar/avaliacao?force=over" },
            { label: "Real (avaliação)", to: "/webinar/avaliacao" },
          ].map((b) => (
            <Link
              key={b.to}
              to={b.to}
              className="px-4 py-3 rounded-md bg-[#1a1a1a] border border-[#262626] hover:border-[#00ff00]/50 hover:bg-[#222] text-sm text-center transition"
            >
              {b.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
