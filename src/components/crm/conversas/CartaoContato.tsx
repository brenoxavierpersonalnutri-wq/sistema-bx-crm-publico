// Contato compartilhado (vCard) desenhado como cartão: nome, telefone e "Abrir conversa".
import { MessageCircle, UserRound } from "lucide-react";
import { formatarTelefone } from "@/lib/crm/conversas";
import type { ContatoVCard } from "@/lib/crm/vcard";

interface Props {
  contatos: ContatoVCard[];
  onAbrirConversa?: (digitos: string) => void;
}

export function CartaoContato({ contatos, onAbrirConversa }: Props) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[220px]" data-testid="cartao-contato">
      {contatos.map((c, i) => {
        const tel = c.telefones[0];
        return (
          <div key={`${c.nome}-${i}`} className="rounded-md bg-black/5 dark:bg-white/5 overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="h-9 w-9 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <UserRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.nome}</p>
                {c.telefones.map((t) => (
                  <p key={t.digitos} className="text-xs crm-chat-meta truncate">
                    {formatarTelefone(t.digitos)}
                  </p>
                ))}
              </div>
            </div>
            {tel && onAbrirConversa && (
              <button
                type="button"
                onClick={() => onAbrirConversa(tel.digitos)}
                className="w-full flex items-center justify-center gap-1.5 border-t border-black/10 dark:border-white/10 py-1.5 text-sm font-medium text-primary hover:bg-black/5 dark:hover:bg-white/5"
              >
                <MessageCircle className="h-4 w-4" /> Abrir conversa
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
