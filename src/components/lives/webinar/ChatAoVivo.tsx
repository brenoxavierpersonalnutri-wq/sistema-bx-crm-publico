// Chat da sala ao vivo: mensagens reais (RPC com limite + broadcast) misturadas ao roteiro
// programado, mensagem fixada no topo e caixa de envio com aviso do limite antes da RPC.
import { useEffect, useRef, useState } from "react";
import { LIMITE_CHAT, podeEnviarChat } from "@/lib/lives/webinarTempo";

export interface MsgChat { id: string; autor_nome: string; texto: string; papel: string; ts: number; fixada?: boolean }

const AVISO: Record<string, string> = {
  rapido: "Calma! Espere uns segundos entre mensagens.",
  limite: "Muitas mensagens em pouco tempo. Aguarde um pouco.",
  longa: `Mensagem muito longa (máx. ${LIMITE_CHAT.maxCaracteres} caracteres).`,
  fora_do_ar: "O chat abre quando a transmissão começar.",
  chat_fechado: "O chat está fechado agora.",
  token: "Seu link expirou. Volte pela página de inscrição.",
};

export function ChatAoVivo({ mensagens, fixada, podeEscrever, enviar }: {
  mensagens: MsgChat[];
  fixada: MsgChat | null;
  podeEscrever: boolean;
  enviar: (texto: string) => Promise<{ ok: boolean; motivo?: string }>;
}) {
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const enviadas = useRef<number[]>([]);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [mensagens.length]);

  const mandar = async () => {
    const agora = Date.now();
    const v = podeEnviarChat(texto, enviadas.current, agora);
    if (!v.ok) {
      if (v.motivo !== "vazia") setAviso(AVISO[v.motivo] ?? null);
      return;
    }
    enviadas.current = [...enviadas.current.filter((t) => agora - t < 60_000), agora];
    const r = await enviar(texto.trim());
    if (r.ok) { setTexto(""); setAviso(null); } else setAviso(AVISO[r.motivo ?? ""] ?? "Não foi possível enviar.");
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] rounded-lg border border-[#262626] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#262626] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#00ff00] animate-pulse" />
        <span className="text-sm font-semibold text-white">Chat ao vivo</span>
      </div>
      {fixada && (
        <div className="px-3 py-2 bg-[#FFD700]/10 border-b border-[#FFD700]/30 text-sm">
          <span className="text-[10px] uppercase text-[#FFD700] font-bold mr-1">fixada</span>
          <b className="text-[#FFD700]">{fixada.autor_nome}:</b> <span className="text-white/90">{fixada.texto}</span>
        </div>
      )}
      <div ref={lista} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-[300px] lg:min-h-0">
        {mensagens.length === 0 && <p className="text-center text-[#666] text-sm py-8">Seja o primeiro a dizer oi!</p>}
        {mensagens.map((m) => {
          const host = m.papel === "produtor";
          return (
            <div key={m.id} className={`px-3 py-2 rounded-md text-sm ${host ? "bg-[#00ff00]/10 border border-[#00ff00]/30" : "bg-[#262626] border border-[#333]"}`}>
              <div className={`font-bold text-xs mb-0.5 ${host ? "text-[#00ff00]" : "text-[#FFD700]"}`}>{m.autor_nome}{host && <span className="ml-1 text-[9px] uppercase">host</span>}</div>
              <div className="text-white/90 leading-snug break-words">{m.texto}</div>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-2 border-t border-[#262626] space-y-1">
        {aviso && <p className="text-[11px] text-[#FFD700]">{aviso}</p>}
        <div className="flex gap-2">
          <input
            disabled={!podeEscrever}
            value={texto}
            maxLength={LIMITE_CHAT.maxCaracteres}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") mandar(); }}
            placeholder={podeEscrever ? "Escreva uma mensagem…" : "Chat fechado"}
            className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#00ff00]/50"
          />
          <button type="button" disabled={!podeEscrever} onClick={mandar} className="px-3 rounded bg-[#00ff00] text-black text-sm font-semibold disabled:opacity-40">Enviar</button>
        </div>
      </div>
    </div>
  );
}
