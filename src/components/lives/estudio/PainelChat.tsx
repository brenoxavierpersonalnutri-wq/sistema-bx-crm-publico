// Chat privado dos bastidores: só quem está no estúdio vê (canal de dados do LiveKit, não vai para a saída).
import { useEffect, useRef, useState } from "react";
import { useChat } from "@livekit/components-react";
import { Info, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface MensagemChat { id: string; autor: string; texto: string; minha?: boolean }

export function ListaChat({ mensagens, onEnviar, desabilitado }: { mensagens: MensagemChat[]; onEnviar: (t: string) => void; desabilitado?: boolean }) {
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => fim.current?.scrollIntoView?.({ block: "end" }), [mensagens.length]);
  const enviar = () => {
    if (!texto.trim()) return;
    onEnviar(texto.trim());
    setTexto("");
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Só quem está no estúdio vê. Não aparece na transmissão.</p>
      <div className="min-h-40 max-h-96 overflow-y-auto space-y-2 rounded-md border p-2">
        {mensagens.map((m) => (
          <div key={m.id} className={m.minha ? "text-right" : ""}>
            <div className="text-[11px] text-muted-foreground">{m.autor}</div>
            <div className={`inline-block rounded-md px-2 py-1 text-sm ${m.minha ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.texto}</div>
          </div>
        ))}
        {!mensagens.length && <p className="text-xs text-muted-foreground text-center py-6">Sem mensagens.</p>}
        <div ref={fim} />
      </div>
      <div className="flex gap-2">
        <Input className="h-8" placeholder="Mensagem para a equipe" value={texto} disabled={desabilitado} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enviar()} />
        <Button size="icon" className="h-8 w-8 shrink-0" aria-label="Enviar" disabled={desabilitado || !texto.trim()} onClick={enviar}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function ChatConectado() {
  const { chatMessages, send } = useChat();
  const msgs: MensagemChat[] = chatMessages.map((m) => ({
    id: m.id,
    autor: m.from?.name || m.from?.identity || "?",
    texto: m.message,
    minha: !!m.from?.isLocal,
  }));
  return <ListaChat mensagens={msgs} onEnviar={(t) => send(t)} />;
}

export function PainelChat({ conectado }: { conectado: boolean }) {
  if (conectado) return <ChatConectado />;
  return (
    <div className="space-y-3">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">O chat dos bastidores usa a conexão com o servidor de transmissão, que ainda não está publicado.</AlertDescription>
      </Alert>
      <ListaChat mensagens={[]} onEnviar={() => undefined} desabilitado />
    </div>
  );
}
