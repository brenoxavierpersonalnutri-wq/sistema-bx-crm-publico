// Foto do contato/grupo como no WhatsApp: a foto quando existe (link assinado do Storage);
// sem foto ou se ela falhar ao carregar, as iniciais (contato) ou o ícone de grupo.
import { memo } from "react";
import { Instagram, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { canalDoContato, contatoEhGrupo, iniciais, type ContatoCRM } from "@/lib/crm/conversas";

interface Props {
  contato: Pick<ContatoCRM, "phone" | "name" | "avatar_url" | "is_group" | "canal">;
  className?: string;
}

export const AvatarContato = memo(function AvatarContato({ contato, className = "h-12 w-12" }: Props) {
  const grupo = contatoEhGrupo(contato);
  const instagram = canalDoContato(contato) === "instagram";
  const avatar = (
    <Avatar className={`${instagram ? "h-full w-full" : className} shrink-0`} data-testid="avatar-contato" data-grupo={grupo ? "sim" : "nao"}>
      {contato.avatar_url && <AvatarImage src={contato.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-muted text-muted-foreground font-medium">
        {grupo ? <Users className="h-1/2 w-1/2" aria-label="Grupo" /> : iniciais(contato.name, contato.phone.slice(-2))}
      </AvatarFallback>
    </Avatar>
  );
  if (!instagram) return avatar;
  // Direct do Instagram: selo do canal no canto da foto
  return (
    <span className={`relative inline-flex ${className} shrink-0`} data-canal="instagram">
      {avatar}
      <span
        className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-background flex items-center justify-center shadow-sm"
        title="Instagram Direct"
        data-testid="selo-instagram"
      >
        <Instagram className="h-3.5 w-3.5 text-pink-600" aria-label="Instagram" />
      </span>
    </span>
  );
});
