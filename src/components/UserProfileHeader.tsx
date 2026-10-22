import { Link } from "react-router-dom";
import { User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PrivacyToggle } from "@/components/PrivacyToggle";

export function UserProfileHeader() {
  const { profile } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Link to="/colaborador" title="Acesse seu Perfil e Agenda" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <div className="h-12 w-12 rounded-xl overflow-hidden border-2 border-primary/10 transition-all shadow-sm flex-shrink-0">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Profile" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-muted flex items-center justify-center">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center">
          <p className="font-display text-[15px] font-bold leading-tight text-foreground">
            Olá, {profile?.full_name || "Usuário"} 👋
          </p>
          <p className="text-[10px] font-bold text-primary mt-0.5">
            ACESSE SEU PERFIL/AGENDA AQUI
          </p>
        </div>
      </Link>
      <PrivacyToggle />
    </div>
  );
}
