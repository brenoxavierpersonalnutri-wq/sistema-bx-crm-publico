// No lugar da caixa de mensagem quando a IA está atendendo: aviso + "HUMANO ASSUME DAQUI".
// O clique chama crm_ai_assumir: pausa a IA com motivo 'humano' (só volta por follow-up ou "Devolver para IA"),
// quem clicou vira o atendente, a conversa sai de "Em atendimento com IA" e o evento "Fulano assumiu" vai pro
// histórico. Depois a caixa volta, com foco no campo.
import { useState } from "react";
import { Bot, Hand, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onAssumir: () => Promise<void>;
  /** sem a ação "assumir da IA": o botão some e o aviso explica */
  podeAssumir?: boolean;
}

export function AvisoIAAtendendo({ onAssumir, podeAssumir = true }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const assumir = async () => {
    setOcupado(true);
    try { await onAssumir(); } finally { setOcupado(false); }
  };
  return (
    <div className="crm-chat-barra shrink-0 px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-3" data-testid="aviso-ia-atendendo">
      <span className="inline-flex items-center gap-2 text-sm crm-chat-texto">
        <Bot className="h-4 w-4 text-violet-600" /> A IA está atendendo esta conversa
      </span>
      {podeAssumir ? (
        <Button onClick={assumir} disabled={ocupado} className="font-semibold tracking-wide" data-testid="humano-assume">
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Hand className="h-4 w-4 mr-2" />}
          HUMANO ASSUME DAQUI
        </Button>
      ) : (
        <span className="text-xs crm-chat-meta">Seu usuário não pode assumir da IA. Peça a um colega ou ao admin.</span>
      )}
    </div>
  );
}
