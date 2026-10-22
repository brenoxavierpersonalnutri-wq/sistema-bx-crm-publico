import { memo } from "react";
import { Bot } from "lucide-react";
import {
  chaveAutor, corDoAutor, ehEnviada, horaCurta, rotuloAutor, statusEntrega, textoDaMensagem, tipoMidia, type MensagemCRM,
} from "@/lib/crm/conversas";
import { MidiaMensagem } from "./MidiaMensagem";
import { StatusEntregaIcone } from "./StatusEntregaIcone";
import { CartaoContato } from "./CartaoContato";
import { lerVCards } from "@/lib/crm/vcard";

interface Props {
  msg: MensagemCRM;
  primeiraDoGrupo: boolean;
  ultimaDoGrupo: boolean;
  tamanhoArquivo?: (url: string) => Promise<number | null>;
  baixarMidia?: (msg: MensagemCRM) => Promise<string | null>;
  autoBaixarAudio?: boolean;
  /** Conversa de grupo: a primeira bolha de cada pessoa leva o nome dela, colorido. */
  emGrupo?: boolean;
  /** Contato compartilhado (vCard): abre a conversa com o número do cartão. */
  onAbrirConversa?: (digitos: string) => void;
}

export const BolhaMensagem = memo(function BolhaMensagem({ msg, primeiraDoGrupo, ultimaDoGrupo, tamanhoArquivo, baixarMidia, autoBaixarAudio, emGrupo, onAbrirConversa }: Props) {
  const enviada = ehEnviada(msg);
  const textoCru = textoDaMensagem(msg);
  const vcards = lerVCards(textoCru);
  const texto = vcards.length ? "" : textoCru;
  const tipo = tipoMidia(msg);
  const soMidiaVisual = !texto && (tipo === "image" || tipo === "video" || tipo === "sticker");
  const figurinha = !texto && tipo === "sticker";
  const status = statusEntrega(msg);
  const autor = emGrupo && !enviada && primeiraDoGrupo ? rotuloAutor(msg) : null;

  return (
    <div
      className={`flex ${enviada ? "justify-end" : "justify-start"} ${primeiraDoGrupo ? "mt-3" : "mt-0.5"} ${ultimaDoGrupo ? "mb-1" : ""} px-3 md:px-16`}
      data-testid="bolha"
      data-direcao={enviada ? "enviada" : "recebida"}
    >
      <div
        className={
          figurinha
            ? "crm-figurinha max-w-[85%] md:max-w-[65%]"
            : `crm-bolha ${enviada ? "crm-bolha-out" : "crm-bolha-in"} ${primeiraDoGrupo ? "crm-bolha-cauda" : ""} max-w-[85%] md:max-w-[65%] rounded-lg px-2 pt-1.5 pb-1 shadow-sm`
        }
      >
        {autor && (
          <div
            className="text-xs font-medium px-1 mb-0.5 truncate"
            style={{ color: corDoAutor(chaveAutor(msg)) }}
            data-testid="autor-bolha"
          >
            {autor}
          </div>
        )}
        {msg.sender_type === "bot" && (
          <div className="flex items-center gap-1 text-xs font-medium text-primary/70 mb-0.5">
            <Bot className="h-3 w-3" /> Agente IA
          </div>
        )}
        <MidiaMensagem msg={msg} tamanhoArquivo={tamanhoArquivo} baixarMidia={baixarMidia} autoBaixarAudio={autoBaixarAudio} />
        {vcards.length > 0 && <CartaoContato contatos={vcards} onAbrirConversa={onAbrirConversa} />}
        <div className={figurinha ? "flex" : soMidiaVisual ? "relative" : "flex flex-wrap items-end gap-x-2"}>
          {texto && (
            <p className="text-sm leading-snug whitespace-pre-wrap break-words px-1 flex-1 min-w-0">{texto}</p>
          )}
          <span
            className={`ml-auto flex items-center gap-1 text-xs leading-none select-none ${
              figurinha ? "text-[10px] text-muted-foreground" : soMidiaVisual ? "absolute bottom-1 right-1 rounded px-1 py-0.5 bg-black/40 text-white" : "crm-chat-meta pb-0.5 pl-1"
            }`}
          >
            <time dateTime={msg.created_at}>{horaCurta(msg.created_at)}</time>
            <StatusEntregaIcone status={status} />
          </span>
        </div>
      </div>
    </div>
  );
});
