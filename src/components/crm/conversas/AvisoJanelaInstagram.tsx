// Faixa acima da caixa de mensagem no Direct: quanto falta da janela de 24 h (regra da Meta) ou por que
// o envio pode ser recusado. Quem decide de verdade é a instagram-send; aqui é só aviso pro atendente.
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { decidirJanela } from "../../../../supabase/functions/_shared/instagram";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function AvisoJanelaInstagram({ ultimaEntrada, agora }: { ultimaEntrada: string | null; agora?: Date }) {
  const [tique, setTique] = useState(0);
  useEffect(() => {
    if (agora) return;
    const t = window.setInterval(() => setTique((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [agora]);
  void tique;
  const j = decidirJanela(ultimaEntrada, agora ?? new Date(), false);
  const aberta = j.pode && j.ate;
  return (
    <div
      className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs ${aberta ? "crm-chat-meta" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}
      data-testid="aviso-janela-instagram"
      data-aberta={aberta ? "sim" : "nao"}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{aberta ? `Janela do Direct aberta até ${fmt(j.ate as string)}.` : j.aviso}</span>
    </div>
  );
}
